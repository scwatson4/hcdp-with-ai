"""GeoTIFF re-encoding for the raster proxy.

The HCDP API serves statewide grids as float32 GeoTIFFs that are either
uncompressed (SPI, ~14 MB) or LZW-compressed (~2–16 MB). Re-encoding them
losslessly with deflate + the floating-point predictor, tiled, brings them to
0.7–1.0 MB — a tenth or less — which is what makes the viewer usable on a
phone. Values, nodata, CRS and transform are untouched.
"""
from __future__ import annotations

from pathlib import Path


def reencode_geotiff(src: Path, dst: Path) -> bool:
    """Write a deflate/predictor-3/tiled copy of `src` to `dst`. Returns False
    (and writes nothing) if rasterio is unavailable or the file is not a raster
    it can read, so the caller can fall back to the original bytes."""
    try:
        import rasterio
    except ImportError:
        return False
    try:
        with rasterio.open(src) as s:
            profile = s.profile
            data = s.read()
        profile.update(driver="GTiff", compress="deflate", predictor=3 if profile.get("dtype", "").startswith("float") else 2,
                       tiled=True, blockxsize=256, blockysize=256, zlevel=6)
        tmp = dst.with_suffix(".enc.part")
        with rasterio.open(tmp, "w", **profile) as d:
            d.write(data)
        tmp.replace(dst)
        return True
    except Exception:  # noqa: BLE001 - any failure means "serve the original"
        return False
