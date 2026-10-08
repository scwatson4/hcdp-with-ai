import io
import re
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ramps_data import DEFAULT_COLORMAP_BY_DATATYPE, NAMED_RAMPS  # noqa: E402
from mapimage import default_ramp, known_ramp, lut, render_og, render_png  # noqa: E402

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

RAMPS_JS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "viewer" / "map" / "ramps.js"


def test_lut_ends_match_the_portal_ramp():
    v, r = lut("viridis"), lut("viridis_r")
    assert tuple(v[0]) == (0x44, 0x01, 0x54) and tuple(v[-1]) == (0xFD, 0xE7, 0x25)
    assert tuple(r[0]) == (0xFD, 0xE7, 0x25) and tuple(r[-1]) == (0x44, 0x01, 0x54)
    t, m = lut("turbo"), lut("magma")
    assert tuple(t[0]) == (0x7A, 0x04, 0x03) and tuple(t[-1]) == (0x30, 0x12, 0x3B)
    assert tuple(m[0]) == (0x00, 0x00, 0x04) and tuple(m[-1]) == (0xFC, 0xFD, 0xBF)
    assert lut("tacc3").shape == (256, 3)                       # repeated stops do not break the interpolation
    assert np.array_equal(lut("no-such-ramp"), lut("viridis"))
    assert known_ramp("turbo") and not known_ramp("rainbow") and not known_ramp("") and not known_ramp(None)
    assert default_ramp("rainfall") == "viridis_r" and default_ramp("temperature") == "viridis" and default_ramp("unknown") == "viridis_r"


def _parse_ramps_js(text):
    """The same extraction that generated ramps_data.py: {name: [(pos, hex), …]}."""
    def block(name):
        m = re.search(rf"(?:export )?const {name} = \{{\n(.*?)\n\}}", text, re.S)
        out, current = {}, None
        for line in m.group(1).splitlines():
            head = re.match(r"^  ([a-z_0-9]+): \[\s*$", line)
            ref = re.match(r"^  ([a-z_0-9]+): CLIMATE_COLOR_RAMPS\.([a-z_0-9]+),\s*$", line)
            if head:
                current = head.group(1); out[current] = []
            elif ref:
                out[ref.group(1)] = ("ref", ref.group(2))
            elif re.match(r"^  \],?\s*$", line):
                current = None
            elif current:
                out[current] += [(float(p), h.lower()) for p, h in re.findall(r"\[\s*([0-9.]+)\s*,\s*'(#[0-9a-fA-F]{6})'\s*\]", line)]
        return out
    climate, named = block("CLIMATE_COLOR_RAMPS"), block("NAMED_RAMPS")
    return {k: (climate[v[1]] if isinstance(v, tuple) else v) for k, v in named.items()}


@pytest.mark.skipif(not RAMPS_JS.exists(), reason="frontend sources not present")
def test_ramp_table_is_in_step_with_the_frontend():
    js = RAMPS_JS.read_text(encoding="utf-8")
    assert _parse_ramps_js(js) == {k: [(float(p), h) for p, h in v] for k, v in NAMED_RAMPS.items()}, "regenerate backend/ramps_data.py from ramps.js"
    defaults = dict(re.findall(r"^  ([a-z_]+): '([a-z_]+)',\s*$", re.search(r"export const DEFAULT_COLORMAP_BY_DATATYPE = \{\n(.*?)\n\}", js, re.S).group(1), re.M))
    assert defaults == DEFAULT_COLORMAP_BY_DATATYPE


def _grid(tmp_path, name="g.tif"):
    data = np.full((1, 100, 200), -3.4e38, dtype="float32")
    data[0, 20:80, 50:150] = np.linspace(0, 300, 60 * 100, dtype="float32").reshape(60, 100)
    p = tmp_path / name
    with rasterio.open(p, "w", driver="GTiff", width=200, height=100, count=1, dtype="float32", crs="EPSG:4326", transform=from_origin(-160, 22, 0.01, 0.01), nodata=-3.4e38) as d:
        d.write(data)
    return p


def test_render_png_is_transparent_where_there_is_no_data(tmp_path):
    p = _grid(tmp_path)
    png = render_png(p, "viridis_r", width=400)
    im = Image.open(io.BytesIO(png)); assert im.mode == "RGBA" and im.size == (400, 200)
    a = np.array(im)
    assert a[10, 10, 3] == 0            # no data → transparent
    assert a[100, 200, 3] == 255        # data → opaque
    assert not np.array_equal(a[50, 110, :3], a[150, 290, :3])   # low and high values get different colours
    ocean = np.array(Image.open(io.BytesIO(render_png(p, "viridis_r", width=400, bg="bfe0f7"))))
    assert tuple(ocean[10, 10]) == (0xBF, 0xE0, 0xF7, 255)   # no data → the ocean colour, opaque
    with pytest.raises(ValueError):
        render_png(_all_nodata(tmp_path), "viridis")
    assert Image.open(io.BytesIO(render_png(p, "turbo", width=300))).size == (300, 150)   # any viewer ramp renders


def test_render_og_card(tmp_path):
    p = _grid(tmp_path)
    png = render_og(p, "viridis_r", (0, 300), "Rainfall, September 2026, Kauaʻi", "Monthly Rainfall (mm)", ("0", "300+", "Rainfall (mm)"))
    im = Image.open(io.BytesIO(png)).convert("RGB")
    assert im.size == (1200, 630)
    assert im.getpixel((3, 3)) == (0xBF, 0xE0, 0xF7)            # ocean fills the corners
    assert im.getpixel((600, 610)) == (255, 255, 255)            # white title strip
    arr = np.array(im)
    assert (arr[520:630, 40:400] != 255).any()                   # text was drawn into the strip
    low, high = lut("viridis_r")[0], lut("viridis_r")[-1]
    assert (np.abs(arr[:500].astype(int) - low).sum(axis=2) < 40).any()       # 0 mm cells wear the ramp's low colour
    assert (np.abs(arr[:500].astype(int) - high).sum(axis=2) < 40).any()      # 300 mm cells (the domain's top) its high colour
    mid = render_og(p, "viridis_r", (0, 650), "x", "y")          # on the portal's 0–650 scale the same grid never reaches the top colour
    assert not (np.abs(np.array(Image.open(io.BytesIO(mid)).convert("RGB"))[:500].astype(int) - high).sum(axis=2) < 40).any()
    webp = render_og(p, "turbo", (0, 20), "x", "y", None, None, "webp")
    assert Image.open(io.BytesIO(webp)).format == "WEBP"
    cropped = render_og(p, "viridis", (0, 300), "x", "y", None, (-159.6, 21.4, -158.4, 21.9))   # crop to part of the grid
    assert Image.open(io.BytesIO(cropped)).size == (1200, 630)
    outside = render_og(p, "viridis", (0, 300), "x", "y", None, (-100.0, 10.0, -99.0, 11.0))     # a crop off the grid shows the whole grid
    assert Image.open(io.BytesIO(outside)).size == (1200, 630)
    with pytest.raises(ValueError):
        render_og(_all_nodata(tmp_path), "viridis", (0, 1), "x", "y")


def _all_nodata(tmp_path):
    p = tmp_path / "empty.tif"
    with rasterio.open(p, "w", driver="GTiff", width=10, height=10, count=1, dtype="float32", crs="EPSG:4326", transform=from_origin(-160, 22, 0.01, 0.01), nodata=-9999) as d:
        d.write(np.full((1, 10, 10), -9999, dtype="float32"))
    return p
