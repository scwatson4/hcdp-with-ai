"""The catalog's dates and credits agree with HCDP's own (data-access audit, 20 Oct 2026).

tests/data/hcdp_inventory_2026-10-20.json is the audit's inventory: every product's first and last date
as HCDP's /datasets/date/range answered on 20 Oct 2026, with the catalog claims the audit corrected. These
tests pin the catalog to it, so "monthly from about 1990" or a wrong paper cannot come back.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DATA = Path(__file__).resolve().parent / "data"
INVENTORY = {(e["product"], e["period"]): e for e in json.loads((DATA / "hcdp_inventory_2026-10-20.json").read_text())["entries"]}
CATALOG = {e["id"]: e for e in json.loads((Path(__file__).resolve().parents[1] / "data" / "catalog.json").read_text(encoding="utf-8"))["entries"]}


def _first_day(api_first: str) -> str:
    return api_first if len(api_first) == 10 else f"{api_first}-01"


@pytest.mark.parametrize("months", [1, 3, 6, 9, 12, 24, 36, 48, 60])
def test_every_spi_map_starts_where_hcdp_starts(months):
    first = INVENTORY[(f"SPI-{months}", "month")]["api_first"]
    entry = CATALOG[f"spi-{months}-map"]
    assert entry["dates"] == {"start": _first_day(first), "end": None}
    assert "about 1990" not in entry["summary"]
    assert "(HCDP's first SPI-%d month)" % months in entry["summary"]


@pytest.mark.parametrize("entry_id,product,period", [
    ("humidity-daily-map", "Relative humidity", "day"),
    ("ndvi-daily-map", "NDVI (MODIS)", "day"),
    ("ignition-daily-map", "Ignition probability (lead 0)", "day"),
    ("rainfall-daily-map", "Rainfall, new production", "day"),
    ("rainfall-monthly-map", "Rainfall, new production", "month"),
    ("temperature-mean-map", "Temperature mean", "month"),
    ("legacy-rainfall-maps", "Rainfall, legacy production", "month"),
    ("rainfall-legacy-map", "Rainfall, legacy production", "month"),
])
def test_other_viewer_ranges_match_the_inventory(entry_id, product, period):
    inv = INVENTORY[(product, period)]
    assert CATALOG[entry_id]["dates"]["start"] == _first_day(inv["api_first"])
    if product == "Rainfall, legacy production":
        assert CATALOG[entry_id]["dates"]["end"] == "2012-12-31" and inv["api_last"] == "2012-12"


def test_the_legacy_maps_entry_no_longer_says_the_viewer_lacks_them():
    s = CATALOG["legacy-rainfall-maps"]["summary"]
    assert "1990-onward product only" not in s
    assert "/viewer/rainfall-legacy/month/" in s
    assert "January 1990" in s and "1920–1989" in s


def test_frazier_2016_is_credited_for_the_legacy_maps_only():
    for entry in CATALOG.values():
        if "Frazier et al. 2016" in entry["summary"] and entry["kind"] in ("viewer", "dataset"):
            assert "legacy" in (entry["id"] + entry["summary"]).lower() or "1920" in entry["summary"], entry["id"]
