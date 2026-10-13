"""End-to-end: the AI-prepared download against HCDP's real API (marker `e2e`).

Skipped unless an HCDP token is available in-process: the variable HCDP_API_TOKEN, or — when unset — the line
HCDP_API_TOKEN=… of the file named by ENV_FILE (default /opt/hcdp/src/deploy/.env), parsed here and never printed. The
token plays two parts, as in production: the server's token for the file listing (verification) and the VISITOR's API key
sent with the prepare request. Three small real plans run through HCDP (a gridded month statewide, three daily rainfall
days on one island, a station month); each zip must arrive, carry README.md and at least the expected number of data
files. The email path is tried only when HCDP_TEST_EMAIL names an address to send to (it would otherwise mail a real
inbox), with a syntactically valid address of your own. Run with -s to see the timings and sizes:

    python -m pytest -q -s -m e2e backend/tests/test_download_e2e.py
"""
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as appmod  # noqa: E402
import download_plan as dl  # noqa: E402
from navigator import Navigator, load_catalog  # noqa: E402


def _token() -> str:
    t = os.environ.get("HCDP_API_TOKEN", "").strip()
    if t:
        return t
    env_file = Path(os.environ.get("ENV_FILE") or "/opt/hcdp/src/deploy/.env")
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("HCDP_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        return ""
    return ""


TOKEN = _token()
TEST_EMAIL = os.environ.get("HCDP_TEST_EMAIL", "").strip()
pytestmark = [pytest.mark.e2e, pytest.mark.skipif(not TOKEN, reason="no HCDP token in HCDP_API_TOKEN or the ENV_FILE")]
TIMINGS: list[dict] = []


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(appmod, "HCDP_TOKEN", TOKEN)                  # the server's listing token (verification), as on the live site
    monkeypatch.setattr(appmod, "CACHE_DIR", tmp_path / "cache")
    appmod.app.state.export_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.email_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.dates_cache = {}
    appmod.app.state.navigator = Navigator(None, load_catalog(), ai_interface_url=appmod.AI_INTERFACE_URL)   # test_app.py may have left a stub
    dl.clear_listing_cache()
    return TestClient(appmod.app)


def _items(raw):
    items, dropped = dl.normalize_items(raw, None)
    assert items, dropped
    return items


def _prepare(client, label, ask, raw_items, expect_files):
    items = _items(raw_items)
    t0 = time.monotonic()
    r = client.post("/api/download/prepare", json={"ask": ask, "reading": f"e2e: {label}", "items": items, "api_key": TOKEN})
    ms = int((time.monotonic() - t0) * 1000)
    assert r.status_code == 200, (r.status_code, r.text[:300])
    assert r.headers["content-type"] == "application/zip" and "attachment" in r.headers["content-disposition"]
    assert TOKEN not in r.text and all(TOKEN not in v for v in r.headers.values())
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        names = z.namelist()
        assert z.testzip() is None
        assert "README.md" in names
        readme = z.read("README.md").decode("utf-8")
        data = [n for n in names if n != "README.md" and not n.endswith("/")]
        sizes = {n: z.getinfo(n).file_size for n in data}
    assert len(data) >= expect_files, (len(data), data[:5])
    assert ask in readme and "## How the AI read it" in readme and "## This package" in readme and TOKEN not in readme
    assert int(r.headers["x-hcdp-files"]) == len(data), (r.headers["x-hcdp-files"], len(data))
    by_ext = {}
    for n, s in sizes.items():
        by_ext.setdefault(n.rsplit(".", 1)[-1], []).append(s)
    row = {"case": label, "ms": ms, "zip_bytes": len(r.content), "data_files": len(data), "x_hcdp_files": r.headers["x-hcdp-files"],
           "sizes_by_ext": {k: {"n": len(v), "min": min(v), "max": max(v), "mean": int(sum(v) / len(v))} for k, v in by_ext.items()}, "first": data[0]}
    TIMINGS.append(row)
    print(f"\n[e2e] {label}: {ms} ms, zip {len(r.content):,} B, {len(data)} data files + README.md; sizes {json.dumps(row['sizes_by_ext'])}; first {data[0]}")
    return row


def test_gridded_month_statewide(client):
    """One monthly rainfall map statewide (data_map + metadata): 2 files."""
    _prepare(client, "gridded month statewide", "monthly rainfall for August 2026 statewide",
             [{"group": "grid", "product": "rainfall", "period": "month", "start": "2026-08", "end": "2026-08", "extents": ["statewide"], "files": ["data_map"], "ticked": True, "why": "the month"}], 2)


def test_daily_rainfall_three_days_one_island(client):
    """Hurricane Lowell's three days on Kauaʻi (data_map + metadata): 6 files."""
    _prepare(client, "daily rainfall 3 days one island", "I need rainfall data from Hurricane Lowell",
             [{"group": "grid", "product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "files": ["data_map"], "ticked": True, "why": "the storm days"}], 6)


def test_station_month(client):
    """One month of partial-filled rainfall station data: one CSV (HCDP packs a year of months per file)."""
    _prepare(client, "station month", "download the station data for August 2026",
             [{"group": "station", "product": "rainfall", "period": "month", "start": "2026-08", "end": "2026-08", "station_fills": ["partial"], "ticked": True, "why": "the gauges"}], 1)


def test_plan_verification_against_the_live_listing(client):
    """The verification step alone, against HCDP's real listing: exact counts, and the trailing unpublished days trimmed."""
    items = _items([
        {"group": "grid", "product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "files": ["data_map"], "ticked": True},
        {"group": "station", "product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "station_fills": ["partial"], "ticked": True},
        {"group": "grid", "product": "rainfall", "period": "day", "start": "2026-10-05", "end": "2026-10-20", "extents": ["oahu"], "files": ["data_map"], "ticked": False},
    ])
    import asyncio
    t0 = time.monotonic()
    offered, dropped = asyncio.run(dl.verify_items(items, appmod.hcdp_file_listing))
    ms = int((time.monotonic() - t0) * 1000)
    assert [i["status"] for i in offered[:2]] == ["ok", "ok"] and offered[0]["count"] == 6 and offered[1]["count"] == 1
    tail = offered[2] if len(offered) > 2 else None
    assert tail is not None and tail["status"] in ("ok", "partial") and tail["end"] < "2026-10-20" and tail["note"], tail
    TIMINGS.append({"case": "verification (3 items, live listing)", "ms": ms, "statuses": [i["status"] for i in offered], "counts": [i["count"] for i in offered], "trimmed_end": tail["end"], "note": tail["note"]})
    print(f"\n[e2e] verification of 3 items against the live listing: {ms} ms; counts {[i['count'] for i in offered]}; trimmed end {tail['end']}: {tail['note']}")


@pytest.mark.skipif(not TEST_EMAIL, reason="HCDP_TEST_EMAIL not set: the email path would mail a real inbox")
def test_email_path_is_accepted(client):
    """Over 150 files with an address → HCDP /genzip/email answers 202 (a real mail goes to HCDP_TEST_EMAIL)."""
    items = _items([{"group": "grid", "product": "rainfall", "period": "day", "start": "2026-01-01", "end": "2026-03-31", "extents": ["statewide"], "files": ["data_map"], "ticked": True}])
    t0 = time.monotonic()
    r = client.post("/api/download/prepare", json={"ask": "every daily rainfall map of early 2026", "items": items, "api_key": TOKEN, "email": TEST_EMAIL})
    ms = int((time.monotonic() - t0) * 1000)
    assert r.status_code == 202, (r.status_code, r.text[:300])
    out = r.json()
    assert out["ok"] is True and out["files"] > 150 and out["readme"].startswith("# HCDP data package") and TOKEN not in r.text
    TIMINGS.append({"case": "email path (202)", "ms": ms, "files": out["files"]})
    print(f"\n[e2e] email path: 202 in {ms} ms, {out['files']} files")


def test_zz_report():
    out = Path(os.environ.get("E2E_REPORT") or "/tmp/claude-1001/-home-exouser/064baeac-7523-4d99-8946-e07207afc920/scratchpad/dl/e2e_timings.json")
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(TIMINGS, indent=1), encoding="utf-8")
    except OSError:
        pass
    print("\n[e2e] cases run:", [t["case"] for t in TIMINGS])
