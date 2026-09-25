"""Backdrop maps for the landing page: a GeoTIFF from the proxy cache rendered as a PNG
with the portal's viridis ramp (transparent where there is no data). Decorative, so the
colour range is the grid's 2nd–98th percentile rather than the viewer's fixed legend."""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image

# The portal's viridis (copied from the viewer's ramps.js); viridis_r is the reverse.
VIRIDIS = [
    (0.0, '#440154'),
    (0.0312, '#450d5f'),
    (0.0625, '#461668'),
    (0.0938, '#472070'),
    (0.125, '#482878'),
    (0.1562, '#45327d'),
    (0.1875, '#423b82'),
    (0.2188, '#404386'),
    (0.25, '#3d4c89'),
    (0.2812, '#3a548b'),
    (0.3125, '#365d8c'),
    (0.3438, '#32658d'),
    (0.375, '#2f6d8e'),
    (0.4062, '#2c758e'),
    (0.4375, '#287c8e'),
    (0.4688, '#25848e'),
    (0.5, '#248c8c'),
    (0.5312, '#22938b'),
    (0.5625, '#209b8a'),
    (0.5938, '#23a286'),
    (0.625, '#2aaa81'),
    (0.6562, '#30b17d'),
    (0.6875, '#39b977'),
    (0.7188, '#4bc06c'),
    (0.75, '#5bc663'),
    (0.7812, '#6bcc5a'),
    (0.8125, '#7fd14e'),
    (0.8438, '#94d640'),
    (0.875, '#a8db34'),
    (0.9062, '#bbdf2b'),
    (0.9375, '#d3e229'),
    (0.9688, '#e8e427'),
    (1.0, '#fde725'),
]
DEFAULT_RAMP = {"rainfall": "viridis_r", "humidity": "viridis_r", "ndvi": "viridis_r", "ignition": "viridis",
                "temperature-mean": "viridis", "temperature-max": "viridis", "temperature-min": "viridis"}


def _hex(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def lut(ramp: str = "viridis", n: int = 256) -> np.ndarray:
    stops = VIRIDIS if ramp == "viridis" else [(1 - p, h) for p, h in reversed(VIRIDIS)]
    pos = np.array([p for p, _ in stops]); cols = np.array([_hex(h) for _, h in stops], dtype=float)
    t = np.linspace(0, 1, n)
    return np.stack([np.interp(t, pos, cols[:, c]) for c in range(3)], axis=1).round().astype(np.uint8)


def render_png(tif: Path, ramp: str = "viridis", width: int = 1200, lo_pct: float = 2, hi_pct: float = 98) -> bytes:
    import rasterio  # heavy import kept local
    with rasterio.open(tif) as src:
        a = src.read(1).astype("float32")
        nodata = src.nodata
        h0, w0 = src.height, src.width
    mask = np.isfinite(a) & (a > -1e30)
    if nodata is not None:
        mask &= a != nodata
    vals = a[mask]
    if vals.size == 0:
        raise ValueError("grid has no data")
    vmin, vmax = float(np.percentile(vals, lo_pct)), float(np.percentile(vals, hi_pct))
    if vmax <= vmin:
        vmax = vmin + 1.0
    t = np.clip((np.where(mask, a, vmin) - vmin) / (vmax - vmin), 0, 1)
    idx = (t * 255).astype(np.uint8)
    rgb = lut(ramp if ramp in ("viridis", "viridis_r") else "viridis")[idx]
    rgba = np.dstack([rgb, (mask * 255).astype(np.uint8)])
    img = Image.fromarray(rgba, "RGBA")
    width = max(200, min(int(width), 2400))
    img = img.resize((width, max(1, round(h0 * width / w0))), Image.LANCZOS)
    buf = io.BytesIO(); img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
