"""Server-side map images: the landing page's backdrops (render_png) and the 1200×630 link
previews behind a shared viewer address (render_og). A GeoTIFF from the proxy cache is painted
with one of the viewer's own colour ramps (ramps_data.py, generated from ramps.js), so what a
pasted link previews as is what the viewer then shows.

Backdrops are decorative, so their colour range is the grid's 2nd–98th percentile; previews use
the portal's fixed legend range for the product, like the viewer.
"""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from ramps_data import DEFAULT_COLORMAP_BY_DATATYPE, NAMED_RAMPS

# Kept for callers that still spell the two Viridis directions by name.
VIRIDIS = NAMED_RAMPS["viridis"]
OCEAN = "#bfe0f7"          # the landing hero's light ocean; og previews use it too
OG_SIZE = (1200, 630)      # what Slack, iMessage, Teams and X ask for
FONT_DIRS = ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/usr/share/fonts/TTF", "/Library/Fonts", "C:/Windows/Fonts")


def known_ramp(name: str | None) -> bool:
    return bool(name) and name in NAMED_RAMPS


def default_ramp(datatype: str) -> str:
    """The portal's default scheme for an HCDP datatype (Viridis, oriented per product)."""
    return DEFAULT_COLORMAP_BY_DATATYPE.get(datatype, "viridis_r")


def _hex(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def lut(ramp: str = "viridis", n: int = 256) -> np.ndarray:
    """An n×3 uint8 lookup table for a named ramp: linear RGB interpolation between the stops,
    exactly as the viewer's interpolateColorRamp paints pixels. Unknown names fall back to viridis."""
    stops = NAMED_RAMPS.get(ramp) or NAMED_RAMPS["viridis"]
    seen: dict[float, str] = {}
    for p, h in stops:                      # a few HCDP ramps repeat a stop; np.interp wants strictly increasing positions
        seen.setdefault(float(p), h)
    pos = np.array(sorted(seen)); cols = np.array([_hex(seen[p]) for p in pos], dtype=float)
    t = np.linspace(0, 1, n)
    return np.stack([np.interp(t, pos, cols[:, c]) for c in range(3)], axis=1).round().astype(np.uint8)


def _read_grid(tif: Path, crop_bounds: tuple[float, float, float, float] | None = None) -> tuple[np.ndarray, np.ndarray]:
    """(values, data mask) for a GeoTIFF, optionally cropped to (west, south, east, north); the crop
    falls back to the whole grid when it would not overlap it."""
    import rasterio  # heavy import kept local
    from rasterio.windows import from_bounds
    with rasterio.open(tif) as src:
        window = None
        if crop_bounds:
            try:
                w = from_bounds(*crop_bounds, transform=src.transform).round_offsets().round_lengths()
                col0, row0 = max(0, int(w.col_off)), max(0, int(w.row_off))
                col1, row1 = min(src.width, int(w.col_off + w.width)), min(src.height, int(w.row_off + w.height))
                if col1 - col0 >= 8 and row1 - row0 >= 8:
                    from rasterio.windows import Window
                    window = Window(col0, row0, col1 - col0, row1 - row0)
            except Exception:  # noqa: BLE001 - any odd transform: show the whole grid
                window = None
        a = src.read(1, window=window).astype("float32")
        nodata = src.nodata
    mask = np.isfinite(a) & (a > -1e30) & (a < 1e30)
    if nodata is not None:
        mask &= a != nodata
    return a, mask


def _colourise(a: np.ndarray, mask: np.ndarray, ramp: str, vmin: float, vmax: float, bg: str | None) -> Image.Image:
    if vmax <= vmin:
        vmax = vmin + 1.0
    t = np.clip((np.where(mask, a, vmin) - vmin) / (vmax - vmin), 0, 1)
    rgb = lut(ramp)[(t * 255).astype(np.uint8)]
    if bg:
        ocean = np.array(_hex("#" + bg.lstrip("#")), dtype=np.uint8)
        rgb = np.where(mask[..., None], rgb, ocean)
        rgba = np.dstack([rgb, np.full(mask.shape, 255, dtype=np.uint8)])
    else:
        rgba = np.dstack([rgb, (mask * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def _encode(img: Image.Image, fmt: str) -> bytes:
    buf = io.BytesIO()
    if fmt == "webp":
        img.save(buf, "WEBP", quality=82, method=6)
    else:
        img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def render_png(tif: Path, ramp: str = "viridis", width: int = 1200, lo_pct: float = 2, hi_pct: float = 98, bg: str | None = None, fmt: str = "png") -> bytes:
    """`bg`: a hex colour (e.g. "bfe0f7") to fill no-data with — an "ocean" behind the islands; None keeps it transparent.
    `fmt`: "png" or "webp" (about ten times smaller for these maps; R7 B)."""
    a, mask = _read_grid(tif)
    vals = a[mask]
    if vals.size == 0:
        raise ValueError("grid has no data")
    vmin, vmax = float(np.percentile(vals, lo_pct)), float(np.percentile(vals, hi_pct))
    img = _colourise(a, mask, ramp, vmin, vmax, bg)
    width = max(16, min(int(width), 2400))   # the API keeps w >= 200; 24 px is the blur-up preview (R7 B)
    h0, w0 = mask.shape
    img = img.resize((width, max(1, round(h0 * width / w0))), Image.LANCZOS)
    return _encode(img, fmt)


# ----- link previews ------------------------------------------------------------
def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """DejaVu Sans (fonts-dejavu-core in the image) with PIL's built-in font as the fallback."""
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    for d in FONT_DIRS:
        p = Path(d) / name
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=size)   # Pillow ≥ 10.1 scales its bundled font
    except TypeError:
        return ImageFont.load_default()


def _fit(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    """Ellipsize a line to fit."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "…", font=font) > max_width:
        text = text[:-1]
    return text.rstrip() + "…"


def _shrink(draw: ImageDraw.ImageDraw, text: str, size: int, max_width: int, bold: bool = False, floor: int = 22):
    """The largest font size (from `size` down to `floor`) at which the line fits, then the font and the
    (possibly ellipsized) text: long descriptions get smaller type before they get cut."""
    while True:
        font = _font(size, bold)
        if draw.textlength(text, font=font) <= max_width or size <= floor:
            return font, _fit(draw, text, font, max_width)
        size -= 2


def render_og(tif: Path, ramp: str, domain: tuple[float, float], title: str, subtitle: str, legend: tuple[str, str, str] | None = None,
              crop_bounds: tuple[float, float, float, float] | None = None, fmt: str = "png", brand: str = "Hawaiʻi Climate Data Portal") -> bytes:
    """A 1200×630 preview card: the grid painted on the portal's fixed `domain` with `ramp`, centred on an
    ocean of OCEAN above a white strip carrying `title` (the view's description), `subtitle` (the product and
    units line), a legend bar (`legend` = (low label, high label, header)) and the portal's name."""
    a, mask = _read_grid(tif, crop_bounds)
    if crop_bounds and not mask.any():       # nothing of the product inside the island box: show the whole grid instead
        a, mask = _read_grid(tif)
    if not mask.any():
        raise ValueError("grid has no data")
    W, H = OG_SIZE
    strip = 118
    card = Image.new("RGB", (W, H), _hex(OCEAN))
    island = _colourise(a, mask, ramp, float(domain[0]), float(domain[1]), OCEAN.lstrip("#")).convert("RGB")
    pad = 14
    box_w, box_h = W - 2 * pad, H - strip - 2 * pad
    h0, w0 = mask.shape
    s = min(box_w / w0, box_h / h0)
    size = (max(1, round(w0 * s)), max(1, round(h0 * s)))
    island = island.resize(size, Image.LANCZOS)
    card.paste(island, (pad + (box_w - size[0]) // 2, pad + (box_h - size[1]) // 2))

    draw = ImageDraw.Draw(card)
    top = H - strip
    draw.rectangle([0, top, W, H], fill=(255, 255, 255))
    draw.line([(0, top), (W, top)], fill=(203, 213, 225), width=1)
    small = _font(17)
    right_w = 300 if legend else 0
    title_font, title_text = _shrink(draw, title, 34, W - 80 - right_w, bold=True)
    sub_font, sub_text = _shrink(draw, subtitle, 21, W - 80 - right_w, floor=16)
    draw.text((40, top + 22 + (34 - getattr(title_font, "size", 34)) // 2), title_text, font=title_font, fill=(17, 24, 39))
    draw.text((40, top + 70), sub_text, font=sub_font, fill=(71, 85, 105))
    if legend:
        lo_label, hi_label, header = legend
        bar_w, bar_h, x1 = 240, 12, W - 40
        x0, y0 = x1 - bar_w, top + 44
        grad = Image.fromarray(np.repeat(lut(ramp, bar_w)[None, :, :], bar_h, axis=0), "RGB")
        card.paste(grad, (x0, y0))
        draw.rectangle([x0, y0, x1, y0 + bar_h], outline=(148, 163, 184), width=1)
        draw.text((x0, top + 20), _fit(draw, header, small, bar_w), font=small, fill=(71, 85, 105))
        draw.text((x0, y0 + bar_h + 4), lo_label, font=small, fill=(71, 85, 105))
        hw = draw.textlength(hi_label, font=small)
        draw.text((x1 - hw, y0 + bar_h + 4), hi_label, font=small, fill=(71, 85, 105))
    bw = draw.textlength(brand, font=small)
    draw.text((W - 40 - bw, H - 30), brand, font=small, fill=(100, 116, 139))
    return _encode(card, fmt)
