import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

from rasters import reencode_geotiff  # noqa: E402


def write_grid(path, nodata=-3.4e38):
    rng = np.random.default_rng(0)
    data = (rng.random((1, 300, 400)) * 250).astype("float32")
    data[0, :40, :] = nodata
    with rasterio.open(path, "w", driver="GTiff", width=400, height=300, count=1, dtype="float32", crs="EPSG:4326",
                       transform=from_origin(-160.5, 22.5, 0.002, 0.002), nodata=nodata) as d:
        d.write(data)
    return data


def test_reencode_is_lossless_and_smaller(tmp_path):
    src, dst = tmp_path / "in.tif", tmp_path / "out.tif"
    data = write_grid(src)
    assert reencode_geotiff(src, dst) is True
    assert dst.stat().st_size < src.stat().st_size
    with rasterio.open(src) as a, rasterio.open(dst) as b:
        assert a.transform == b.transform and a.crs == b.crs and a.nodata == b.nodata
        assert b.profile["compress"] == "deflate" and b.profile["tiled"] is True
        np.testing.assert_array_equal(a.read(), b.read())
        np.testing.assert_array_equal(b.read(), data)


def test_reencode_refuses_garbage(tmp_path):
    src, dst = tmp_path / "in.tif", tmp_path / "out.tif"
    src.write_bytes(b"not a tiff")
    assert reencode_geotiff(src, dst) is False
    assert not dst.exists()
