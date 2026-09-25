import io
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

from mapimage import lut, render_png  # noqa: E402


def test_lut_ends_match_the_portal_ramp():
    v, r = lut("viridis"), lut("viridis_r")
    assert tuple(v[0]) == (0x44, 0x01, 0x54) and tuple(v[-1]) == (0xFD, 0xE7, 0x25)
    assert tuple(r[0]) == (0xFD, 0xE7, 0x25) and tuple(r[-1]) == (0x44, 0x01, 0x54)


def test_render_png_is_transparent_where_there_is_no_data(tmp_path):
    data = np.full((1, 100, 200), -3.4e38, dtype="float32")
    data[0, 20:80, 50:150] = np.linspace(0, 300, 60 * 100, dtype="float32").reshape(60, 100)
    p = tmp_path / "g.tif"
    with rasterio.open(p, "w", driver="GTiff", width=200, height=100, count=1, dtype="float32", crs="EPSG:4326", transform=from_origin(-160, 22, 0.01, 0.01), nodata=-3.4e38) as d:
        d.write(data)
    png = render_png(p, "viridis_r", width=400)
    im = Image.open(io.BytesIO(png)); assert im.mode == "RGBA" and im.size == (400, 200)
    a = np.array(im)
    assert a[10, 10, 3] == 0            # no data → transparent
    assert a[100, 200, 3] == 255        # data → opaque
    assert not np.array_equal(a[50, 110, :3], a[150, 290, :3])   # low and high values get different colours
    with pytest.raises(ValueError):
        render_png(_all_nodata(tmp_path), "viridis")


def _all_nodata(tmp_path):
    p = tmp_path / "empty.tif"
    with rasterio.open(p, "w", driver="GTiff", width=10, height=10, count=1, dtype="float32", crs="EPSG:4326", transform=from_origin(-160, 22, 0.01, 0.01), nodata=-9999) as d:
        d.write(np.full((1, 10, 10), -9999, dtype="float32"))
    return p
