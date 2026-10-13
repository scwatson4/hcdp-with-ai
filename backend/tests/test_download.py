"""The AI-prepared download (13 Oct): the plan's validation, the verification against HCDP's file listing, the estimates,
the README, the zip with README.md added, the email branch, the key that is never logged, and the limiters — HCDP and the
planner's model both faked."""
import datetime as dt
import io
import json
import logging
import sys
import zipfile
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as appmod  # noqa: E402
import download_plan as dl  # noqa: E402
from llm import PLANNER_SYSTEM  # noqa: E402
from navigator import Navigator, load_catalog  # noqa: E402

BASE = appmod.HCDP_API_BASE
ORIGIN = appmod.site_origin("testserver")      # the package address is absolute: this site's origin (https for any real host)
LINK_ROOT = "https://ikeauth.its.hawaii.edu/files/v2/download/public/system/ikewai-annotated-data/HCDP/production"
RANGES = {("rainfall", "day"): ("1990-01-01", "2026-10-11"), ("rainfall", "month"): ("1990-01", "2026-09"), ("rainfall-legacy", "month"): ("1920-01", "2012-12"),
          ("temperature-max", "day"): ("1990-01-01", "2026-10-11"), ("temperature-max", "month"): ("1990-01", "2026-09"),
          ("temperature-min", "day"): ("1990-01-01", "2026-10-11"), ("temperature-min", "month"): ("1990-01", "2026-09"),
          ("temperature-mean", "day"): ("1990-01-01", "2026-10-11"), ("temperature-mean", "month"): ("1990-01", "2026-09")}
LAST_DAY = "2026-10-11"          # what the fake HCDP has published (daily)
VISITOR_KEY = "visitor-key-7f3a9c-never-printed"
SERVER_TOKEN = "server-token-never-used-for-packages"
LOWELL_RAW = {
    "reading": "You asked for Hurricane Lowell's rainfall data. I read this as the storm of 6 to 8 September 2026, which hit Kauaʻi hardest, so I ticked the daily rainfall maps for Kauaʻi on those three days and the partial-filled station totals; the standard-error maps and the unfilled station data are there unticked as context.",
    "event": "Hurricane Lowell", "event_id": "lowell", "place": "Kauaʻi", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"],
    "items": [
        {"id": "rain-day-maps", "group": "grid", "product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "files": ["data_map"], "ticked": True, "why": "the storm's three days"},
        {"id": "rain-day-stations", "group": "station", "product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "station_fills": ["partial"], "ticked": True, "why": "the gauge totals behind the maps"},
        {"id": "rain-day-se", "group": "grid", "product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "files": ["se"], "ticked": False, "why": "how sure the map is"},
        {"id": "rain-day-raw", "group": "station", "product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "station_fills": ["raw"], "ticked": False, "why": "the readings before QA/QC"},
        {"id": "wind", "group": "grid", "product": "wind", "period": "hour", "start": "2026-09-07", "end": "2026-09-07", "files": ["data_map"], "ticked": True, "why": "junk the model made up"},
    ],
    "primary_view": {"dataset": "rainfall", "period": "day", "date": "2026-09-07", "extent": "kauai"},
}


class FakePlanner:
    configured = True

    def __init__(self, payload):
        self.payload, self.calls = payload, []

    def complete(self, system, user):
        self.calls.append((system, user))
        return self.payload


def make_planner(payload):
    llm = FakePlanner(payload)
    return dl.DownloadPlanner(llm, Navigator(None, load_catalog(), ai_interface_url="https://ai.example.org"), today=dt.date(2026, 10, 13)), llm


# ----- the fake HCDP: the file listing a package group would produce, in HCDP's own naming -----------
def fake_links(data: list[dict], last_day: str = LAST_DAY) -> list[str]:
    out = []
    for group in data:
        params = group["params"]
        kind = params["datatype"] + "_" + (params.get("production") or params.get("aggregation"))
        period = params["period"]
        dates = dl.dates_between(group["dates"]["start"], group["dates"]["end"], period)
        if period == "day":
            dates = [d for d in dates if d <= last_day]
        for fd in group["fileData"]:
            for ext in fd["fileParams"]["extent"]:
                fills = fd["fileParams"].get("fill")
                if fills:
                    for fill in fills:
                        keys = sorted({d[:7] if period == "day" else d[:4] for d in dates})
                        for k in keys:
                            tag = k.replace("-", "_")
                            out.append(f"{LINK_ROOT}/{kind.replace('_', '/')}/{period}/{ext}/{fill}/station_data/{k.replace('-', '/')}/{kind}_{period}_{ext}_{fill}_station_data_{tag}.csv")
                else:
                    for tag in fd["files"]:
                        for d in dates:
                            e = "txt" if tag == "metadata" else "tif"
                            out.append(f"{LINK_ROOT}/{kind.replace('_', '/')}/{period}/{ext}/{tag}/{d.replace('-', '/')[:7]}/{kind}_{period}_{ext}_{tag}_{d.replace('-', '_')}.{e}")
    return out


def small_zip(names=("data/production/rainfall/new/day/ka/data_map/2026/09/rainfall_new_day_ka_data_map_2026_09_06.tif", "data/production/rainfall/new/day/ka/metadata/2026/09/rainfall_new_day_ka_metadata_2026_09_06.txt")) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, b"II*\x00" + b"\x00" * 100 if n.endswith(".tif") else b"metadata text")
    return buf.getvalue()


def mock_hcdp(last_day: str = LAST_DAY, zip_bytes: bytes | None = None, zip_status: int = 200, email_status: int = 202, seen: dict | None = None):
    seen = seen if seen is not None else {}

    def listing(request):
        seen.setdefault("listing", []).append(request.headers.get("authorization"))
        return httpx.Response(200, json=fake_links(json.loads(request.url.params["data"]), last_day))

    def ranges(request):
        period = request.url.params.get("period")
        return httpx.Response(200, json=["1990-01-01T10:00:00.000Z", f"{last_day}T10:00:00.000Z" if period == "day" else "2026-09-01T10:00:00.000Z"])

    def genzip(request):
        seen["genzip_auth"] = request.headers.get("authorization")
        seen["genzip_body"] = json.loads(request.content)
        if zip_status != 200:
            return httpx.Response(zip_status, text="Unauthorized" if zip_status == 401 else "boom")
        return httpx.Response(200, content=zip_bytes if zip_bytes is not None else small_zip(), headers={"content-type": "application/zip"})

    def email(request):
        seen["email_auth"] = request.headers.get("authorization")
        seen["email_body"] = json.loads(request.content)
        return httpx.Response(email_status, text="Request received. Generating download package")

    respx.get(f"{BASE}/files/production/list").mock(side_effect=listing)
    respx.get(f"{BASE}/datasets/date/range").mock(side_effect=ranges)
    respx.post(f"{BASE}/genzip/instant/content").mock(side_effect=genzip)
    respx.post(f"{BASE}/genzip/email").mock(side_effect=email)
    return seen


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(appmod, "HCDP_TOKEN", SERVER_TOKEN)
    monkeypatch.setattr(appmod, "CACHE_DIR", tmp_path / "cache")
    appmod.app.state.download_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.export_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.email_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.dates_cache = {}
    # test_app.py leaves a stub navigator on the app; the plan needs the real one (catalog links, the hand-off builder)
    appmod.app.state.navigator = Navigator(None, load_catalog(), ai_interface_url=appmod.AI_INTERFACE_URL, today=dt.date(2026, 10, 13))
    planner, _ = make_planner(LOWELL_RAW)
    appmod.app.state.planner = planner
    dl.clear_listing_cache()
    return TestClient(appmod.app)


# ----- validation (pure) ---------------------------------------------------------------
def test_items_are_checked_against_the_export_recipes_and_split_by_kind():
    items, dropped = dl.normalize_items(LOWELL_RAW["items"], RANGES)
    assert [(i["group"], i["product"], i["files"], i["station_fills"], i["ticked"]) for i in items] == [
        ("grid", "rainfall", ["data_map", "metadata"], [], True),      # the map pulls its metadata in, as the Export form does
        ("station", "rainfall", [], ["partial"], True),
        ("grid", "rainfall", ["se", "metadata"], [], False),
        ("station", "rainfall", [], ["raw"], False),
    ]
    assert dropped == []                                                 # an unknown product is simply not an item
    assert items[0]["label"] == "Daily rainfall maps, 6–8 Sep 2026, Kauaʻi" and items[1]["label"] == "Daily rainfall station data (partial-filled), 6–8 Sep 2026"
    assert items[2]["label"] == "Daily rainfall standard error maps, 6–8 Sep 2026, Kauaʻi"
    assert items[0]["count"] == 6 and items[0]["bytes"] == 3 * dl.SIZE_BYTES["tif"]["ka"] + 3 * dl.SIZE_BYTES["txt"]
    assert items[0]["id"].startswith("grid-rainfall-day-") and len(items[0]["id"]) == len("grid-rainfall-day-") + 6
    assert items[0]["id"] == dl.normalize_items([LOWELL_RAW["items"][0]], RANGES)[0][0]["id"]      # deterministic ids: a shared picks= survives a re-plan
    # a mixed item (files and fills) becomes a grid item and a station item; aliases and Molokaʻi → Maui County resolve
    mixed, _ = dl.normalize_items([{"product": "rain", "period": "monthly", "start": "2026-09-01", "end": "2026-09-30", "extents": ["big-island", "molokai"], "files": ["se"], "station_fills": ["partial"]}], RANGES)
    assert [(i["group"], i["extents"], i["start"], i["end"]) for i in mixed] == [("grid", ["hawaii", "maui"], "2026-09", "2026-09"), ("station", [], "2026-09", "2026-09")]
    assert mixed[0]["label"] == "Monthly rainfall standard error maps, Sep 2026, Hawaiʻi Island, Maui County"
    # station data for a product that has none is dropped with HCDP's reason, not turned into a map
    none, gone = dl.normalize_items([{"product": "temperature-mean", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "station_fills": ["partial"]}], RANGES)
    assert none == [] and "maximum and minimum only" in gone[0]["why"]
    assert dl.normalize_items([{"product": "rainfall-legacy", "period": "month", "start": "1950-01", "end": "1950-03", "extents": ["oahu"], "files": ["data_map"]}], RANGES)[0][0]["extents"] == ["statewide"]   # legacy: statewide only → the island is not offered
    assert dl.normalize_items("junk", RANGES) == ([], []) and dl.normalize_items([{"product": "rainfall"}], RANGES) == ([], [])


def test_dates_are_clamped_to_the_published_range_and_unpublished_items_are_named_with_the_alternative():
    items, dropped = dl.normalize_items([{"product": "rainfall", "period": "day", "start": "2026-10-09", "end": "2026-10-13", "files": ["data_map"]}], RANGES)
    assert items[0]["end"] == "2026-10-11" and items[0]["note"] == "no daily rainfall for 12–13 Oct 2026 yet — the last day published is 11 Oct 2026"
    items, dropped = dl.normalize_items([{"product": "rainfall", "period": "day", "start": "2026-10-12", "end": "2026-10-13", "files": ["data_map"]}], RANGES)
    assert items == [] and dropped[0]["why"] == "no daily rainfall for 12 Oct 2026 yet — the last day published is 11 Oct 2026" and dropped[0]["alternative"]["end"] == "2026-10-11"
    items, dropped = dl.normalize_items([{"product": "rainfall", "period": "month", "start": "1985-01", "end": "1990-03", "files": ["data_map"]}], RANGES)
    assert items[0]["start"] == "1990-01" and "starts in Jan 1990" in items[0]["note"]
    assert dl.normalize_items([{"product": "rainfall", "period": "month", "start": "1980-01", "end": "1985-03", "files": ["data_map"]}], RANGES)[1][0]["why"] == "HCDP's rainfall by month starts in Jan 1990"
    with pytest.raises(dl.PlanError):      # the prepare step refuses instead of clamping
        dl.normalize_items([{"product": "rainfall", "period": "day", "start": "2026-10-09", "end": "2026-10-13", "files": ["data_map"]}], RANGES, strict=True)
    # without a range nothing is clamped
    assert dl.normalize_items([{"product": "rainfall", "period": "day", "start": "2026-10-09", "end": "2026-10-13", "files": ["data_map"]}], None)[0][0]["end"] == "2026-10-13"
    assert dl.fmt_span("2026-09-28", "2026-10-02", "day") == "28 Sep – 2 Oct 2026" and dl.fmt_span("2025-12", "2026-01", "month") == "Dec 2025 – Jan 2026" and dl.fmt_span("2026-09", "2026-09", "month") == "Sep 2026"


def test_the_listing_gives_exact_counts_and_trims_what_is_not_published():
    item = dl.normalize_items([{"product": "rainfall", "period": "day", "start": "2026-10-09", "end": "2026-10-13", "extents": ["kauai", "oahu"], "files": ["data_map"]}], None)[0][0]
    assert item["count"] == 20                                          # the formula: 5 days × 2 extents × 2 files
    links = fake_links(dl.listing_data(item), last_day="2026-10-11")
    out = dl.apply_listing(item, links)
    assert out["status"] == "ok" and out["count"] == 12 and out["end"] == "2026-10-11"
    assert out["note"] == "no daily rainfall map for 12–13 Oct 2026 yet — the last day published is 11 Oct 2026"
    assert out["label"] == "Daily rainfall maps, 9–11 Oct 2026, Kauaʻi, Oʻahu" and out["id"] != item["id"]   # the id follows the content
    assert dl.apply_listing(item, [])["status"] == "missing"
    assert dl.apply_listing(item, None)["status"] == "unverified" and "did not answer" in dl.apply_listing(item, None)["note"]
    # a gap in the middle is a partial item: offered as is, with the count
    gap = [l for l in fake_links(dl.listing_data(item), last_day="2026-10-13") if "2026_10_11" not in l]
    part = dl.apply_listing(item, gap)
    assert part["status"] == "partial" and part["note"] == "4 of 5 days have maps; 1 is not published" and part["count"] == 16
    # stations: one CSV per month of days; three days in one month → one file, status ok
    st = dl.normalize_items([{"product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "station_fills": ["partial", "raw"]}], None)[0][0]
    out = dl.apply_listing(st, fake_links(dl.listing_data(st)))
    assert out["status"] == "ok" and out["count"] == 2 and st["count"] == 6
    assert dl.parse_link(f"{LINK_ROOT}/rainfall/new/day/ka/data_map/2026/09/rainfall_new_day_ka_data_map_2026_09_06.tif") == {"tag": "data_map", "extent": "kauai", "date": "2026-09-06", "ext": "tif"}
    assert dl.parse_link(f"{LINK_ROOT}/temperature/max/month/statewide/partial/station_data/2026/temperature_max_month_statewide_partial_station_data_2026.csv") == {"tag": "station_data", "extent": "statewide", "date": "2026", "ext": "csv"}
    assert dl.parse_link("https://x/y/README.md") is None


@pytest.mark.anyio
async def test_verify_items_lists_each_item_once_caches_and_drops_what_does_not_exist():
    dl.clear_listing_cache()
    calls = []

    async def lister(data):
        calls.append(data)
        if data[0]["dates"]["start"] == "2027-01-01":
            return []
        return fake_links(data)

    items, _ = dl.normalize_items([
        {"product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "files": ["data_map"]},
        {"product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "station_fills": ["partial"]},
        {"product": "rainfall", "period": "day", "start": "2027-01-01", "end": "2027-01-02", "files": ["data_map"]},
    ], None)
    items.append({"id": "report-lowell", "group": "report", "label": "Hurricane Lowell report", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/", "why": "x", "ticked": True, "status": "pending", "count": 0, "bytes": 0})
    offered, dropped = await dl.verify_items(items, lister)
    assert [i["status"] for i in offered] == ["ok", "ok", "ok"] and [i["count"] for i in offered] == [6, 1, 0]
    assert len(calls) == 3                                               # the report item makes no listing call
    assert dropped[0]["why"] == "HCDP has no rainfall maps for 1–2 Jan 2027 (Statewide) — nothing to package"
    await dl.verify_items(items, lister)
    assert len(calls) == 3                                               # cached
    est = dl.estimate(offered)
    assert est == {"files": 7, "bytes": offered[0]["bytes"] + offered[1]["bytes"], "over_instant": False}
    assert dl.estimate(offered, {offered[1]["id"]})["files"] == 1 and dl.estimate(offered, set()) == {"files": 0, "bytes": 0, "over_instant": False}

    async def broken(data):
        raise httpx.ConnectError("down")
    dl.clear_listing_cache()
    off2, gone2 = await dl.verify_items(items[:1], broken)
    assert off2[0]["status"] == "unverified" and gone2 == []


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ----- the planner: grounding and the plan ---------------------------------------------------
def test_planner_grounds_the_model_and_validates_everything_it_answers():
    planner, llm = make_planner(LOWELL_RAW)
    plan = planner.plan("I need rainfall data from Hurricane Lowell", RANGES, hints={"event": "Lowell", "junk": {"deep": 1}}, context={"path": "/data/api"})
    system, user = llm.calls[0]
    assert system == PLANNER_SYSTEM and "Today in Hawaiʻi: 2026-10-13" in user
    assert "- rainfall (Rainfall, mm): periods month, day; grid files data_map, se, anom, anom_se, metadata" in user and "published: month 1990-01 → 2026-09; day 1990-01-01 → 2026-10-11" in user
    assert "- lowell: Hurricane Lowell report — 2026-09-06 → 2026-09-08; islands: kauai, oahu" in user
    assert 'HINTS FROM THE NAVIGATOR (its quick reading; check them): {"event": "Lowell"}' in user and "The visitor is on page /data/api" in user
    assert user.rstrip().endswith("VISITOR'S ASK: I need rainfall data from Hurricane Lowell")
    assert plan["event"] == "Hurricane Lowell" and plan["event_id"] == "lowell" and plan["place"] == "Kauaʻi" and plan["period"] == "day"
    assert plan["start"] == "2026-09-06" and plan["end"] == "2026-09-08" and plan["extents"] == ["kauai"]
    assert plan["reading"] == LOWELL_RAW["reading"]
    assert [i["group"] for i in plan["items"]] == ["grid", "station", "grid", "station", "report", "report", "report"]
    reports = [i for i in plan["items"] if i["group"] == "report"]
    assert reports[0]["url"] == "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/" and reports[0]["ticked"] is True and reports[0]["count"] == 0
    assert all(r["url"].startswith("https://") and not r["ticked"] for r in reports[1:]) and "lowell" in reports[1]["label"].lower()
    assert plan["primary_view"] == "/viewer/rainfall/day/2026-09-07/kauai" and plan["primary_view_label"] == "Rainfall, September 7, 2026, Kauaʻi"
    assert [g["id"] for g in plan["groups"]] == ["grid", "station", "report"] and plan["instant_max_files"] == 150
    # the model's junk never leaks: a wind item, markdown in the reading, a bad primary view
    noisy = dict(LOWELL_RAW, reading="**You asked** for [Lowell](https://x.y) rain. I read this as the storm. I ticked the maps. Context: the rest.", primary_view={"dataset": "wind", "period": "hour", "date": "x", "extent": "mars"})
    plan2 = make_planner(noisy)[0].plan("Lowell rain", RANGES)
    assert plan2["reading"] == "You asked for Lowell rain. I read this as the storm. I ticked the maps. Context: the rest."
    assert plan2["primary_view"] == "/viewer/rainfall/day/2026-09-08/kauai"      # from the first ticked grid item's last date
    # no reading from the model → a plain default one; a date after the published range is clamped in the view too
    bare = {"items": [{"product": "rainfall", "period": "day", "start": "2026-10-09", "end": "2026-10-13", "extents": ["oahu"], "files": ["data_map"], "ticked": True}], "primary_view": {"dataset": "rainfall", "period": "day", "date": "2026-10-13", "extent": "oahu"}}
    plan3 = make_planner(bare)[0].plan("rain Oahu this week", RANGES)
    assert plan3["reading"].startswith("You asked for rain Oahu this week. I read this as 9–11 Oct 2026. I ticked daily rainfall maps, 9–11 Oct 2026, Oʻahu.")
    assert plan3["primary_view"] == "/viewer/rainfall/day/2026-10-11/oahu" and plan3["event"] is None and plan3["groups"] == [{"id": "grid", "label": "Gridded maps"}]
    # off topic: the model answers empty → an empty plan, no items
    empty = make_planner({"reading": "", "items": []})[0].plan("cookie recipe", RANGES)
    assert empty["items"] == [] and empty["primary_view"] is None
    # a model that does not answer, or is not configured → None
    assert make_planner(None)[0].plan("x", RANGES) is None
    unconfigured = dl.DownloadPlanner(type("L", (), {"configured": False, "complete": lambda *a: {}})(), Navigator(None, load_catalog()))
    assert unconfigured.plan("x", RANGES) is None


def test_a_replan_keeps_the_items_already_planned_and_the_extra_wish_reaches_the_model():
    planner, llm = make_planner({"reading": "You asked for Lowell data and then for the temperature too. I read this as the storm days on Kauaʻi; I ticked the rainfall maps and added the maximum temperature maps you asked for.", "items": [
        {"group": "grid", "product": "temperature-max", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "files": ["data_map"], "ticked": True, "why": "the extra wish"}]})
    previous, _ = dl.normalize_items(LOWELL_RAW["items"][:2], RANGES)
    plan = planner.plan("I need rainfall data from Hurricane Lowell", RANGES, extra="also the max temperature", previous=previous)
    user = llm.calls[0][1]
    assert "EXTRA WISH (something else the visitor wants in the package): also the max temperature" in user and "ITEMS ALREADY PLANNED" in user and previous[0]["id"] in user
    assert [i["product"] for i in plan["items"] if i["group"] != "report"] == ["temperature-max", "rainfall", "rainfall"]
    assert plan["items"][1]["id"] == previous[0]["id"] and plan["items"][1]["ticked"] is True


def test_readme_package_address_and_analyze_link():
    items, _ = dl.normalize_items(LOWELL_RAW["items"][:2], RANGES)
    items = [dl.apply_listing(i, fake_links(dl.listing_data(i))) for i in items]
    items.append({"id": "report-lowell", "group": "report", "label": "Hurricane Lowell report", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/", "why": "the story", "ticked": True})
    path = dl.package_path("I need rainfall data from Hurricane Lowell", [i["id"] for i in items] + ["bad id!"])
    assert path == f"/download?ask=I%20need%20rainfall%20data%20from%20Hurricane%20Lowell&picks={items[0]['id']},{items[1]['id']},report-lowell"
    package_url = "https://hcdp-with-ai.example.org" + path
    ask = dl.analyze_ask("I need rainfall data from Hurricane Lowell", package_url)
    assert ask == f"I need rainfall data from Hurricane Lowell (HCDP data package: {package_url})"
    nav = Navigator(None, load_catalog(), ai_interface_url="https://ai.example.org")
    analyze = nav.handoff_url(ask, {"path": "/viewer/rainfall/day/2026-09-07/kauai"})
    assert analyze.startswith("https://ai.example.org/?ask=I%20need%20rainfall") and "ctx=viewer%3A%2Fviewer%2Frainfall%2Fday%2F2026-09-07%2Fkauai&from=website" in analyze
    plan = {"ask": "I need rainfall data from Hurricane Lowell", "reading": LOWELL_RAW["reading"], "event": "Hurricane Lowell", "place": "Kauaʻi"}
    text = dl.readme_text(plan, items, package_url, analyze, "https://hcdp-with-ai.example.org", now=dt.datetime(2026, 10, 13, 9, 30, tzinfo=dl.HST))
    for needle in ("# HCDP data package — prepared with AI", "Prepared 13 October 2026, 09:30 Hawaiʻi time", "## What you asked", "I need rainfall data from Hurricane Lowell",
                   "## How the AI read it", LOWELL_RAW["reading"], "Event or place: Hurricane Lowell · Kauaʻi.", "## What is inside",
                   "- **Daily rainfall maps, 6–8 Sep 2026, Kauaʻi** — 6 files; files: data_map, metadata; extent Kauaʻi (ka); dates 2026-09-06 to 2026-09-08 by day. The storm's three days.",
                   "- **Daily rainfall station data (partial-filled), 6–8 Sep 2026** — 1 file; station CSV: partial-filled (quality-controlled, gaps estimated); extent statewide station list",
                   "About 7 data files in all.", "## From the storm report", "- Hurricane Lowell report: https://www.hawaii.edu/climate-data-portal/hurricane-lowell/ — the story",
                   "## File naming", "rainfall_new_day_ka_data_map_2026_09_07.tif", "## Units", "Rainfall: millimetres (mm).", "## How to cite", dl.HCDP_CITATION, dl.HOW_TO_CITE, "CC BY-NC-ND 4.0",
                   "## This package", f"Re-open or share this list: {package_url}", f"Analyze with AI: {analyze}"):
        assert needle in text, needle
    assert dl.zip_name(items, "Hurricane Lowell") == "hcdp_hurricane-lowell_2026-09-06_2026-09-08.zip" and dl.zip_name(items) == "hcdp_rainfall_2026-09-06_2026-09-08.zip" and dl.zip_name([]) == "hcdp_package.zip"
    payload = dl.genzip_payload(items, "ikaika@example.edu")
    assert payload["email"] == "ikaika@example.edu" and len(payload["data"]) == 2 and payload["data"][0]["params"] == {"location": "hawaii", "datatype": "rainfall", "production": "new", "period": "day"}
    assert payload["data"][0]["fileData"] == [{"fileParams": {"extent": ["ka"], "units": ["mm"]}, "files": ["data_map", "metadata"]}]
    assert payload["data"][1]["fileData"] == [{"fileParams": {"extent": ["statewide"], "units": ["mm"], "fill": ["partial"]}, "files": ["station_data"]}]
    assert dl.genzip_payload(items, "not an address", "ops@example.edu")["email"] == "ops@example.edu"
    with pytest.raises(dl.PlanError):
        dl.genzip_payload([items[2]], "")


def test_add_readme_appends_to_a_zip_without_touching_its_entries(tmp_path):
    p = tmp_path / "pkg.zip"
    p.write_bytes(small_zip())
    dl.add_readme(p, "# hello\n")
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
        assert names[-1] == "README.md" and len(names) == 3 and z.read("README.md") == b"# hello\n"
        assert z.testzip() is None and z.getinfo("README.md").compress_type == zipfile.ZIP_DEFLATED


# ----- the endpoints -------------------------------------------------------------------------
@respx.mock
def test_plan_endpoint_verifies_and_links_the_plan(client):
    seen = mock_hcdp()
    r = client.post("/api/download/plan", json={"ask": "I need rainfall data from Hurricane Lowell", "context": {"path": "/data/api"}, "hints": {"event": "Lowell"}})
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["reading"] == LOWELL_RAW["reading"] and plan["event"] == "Hurricane Lowell"
    assert [(i["group"], i["status"], i["count"], i["ticked"]) for i in plan["items"]] == [("grid", "ok", 6, True), ("station", "ok", 1, True), ("grid", "ok", 6, False), ("station", "ok", 1, False), ("report", "ok", 0, True), ("report", "ok", 0, False), ("report", "ok", 0, False)]
    assert plan["dropped"] == [] and plan["estimate"] == {"files": 7, "bytes": plan["items"][0]["bytes"] + plan["items"][1]["bytes"], "over_instant": False}
    picks = ",".join(i["id"] for i in plan["items"] if i["ticked"])
    assert plan["package_path"] == f"/download?ask=I%20need%20rainfall%20data%20from%20Hurricane%20Lowell&picks={picks}"
    assert plan["package_url"] == ORIGIN + plan["package_path"]
    assert plan["analyze_url"].startswith(appmod.AI_INTERFACE_URL + "/?ask=") and "HCDP%20data%20package" in plan["analyze_url"] and plan["analyze_url"].endswith("&from=website")
    assert plan["api_url"] == "https://www.hawaii.edu/climate-data-portal/hcdp-hawaii-mesonet-api/"       # from the catalog's api entry
    assert plan["primary_view"] == "/viewer/rainfall/day/2026-09-07/kauai" and r.headers["cache-control"] == "no-store"
    # the listing was made with the server's token (a read, like /api/dates), once per data item
    assert set(seen["listing"]) == {f"Bearer {SERVER_TOKEN}"} and len(seen["listing"]) == 4
    # the user's words reached the model, the published ranges came from HCDP
    user = appmod.app.state.planner.llm.calls[-1][1]
    assert "day 1990-01-01 → 2026-10-11" in user and "month 1990-01 → 2026-09" in user
    assert client.post("/api/download/plan", json={"ask": ""}).status_code == 422 and client.post("/api/download/plan", json={"ask": "x" * 501}).status_code == 422


@respx.mock
def test_plan_endpoint_trims_unpublished_dates_and_names_what_does_not_exist(client):
    mock_hcdp(last_day="2026-10-11")
    appmod.app.state.planner = make_planner({"reading": "You asked for this week's rain on Oʻahu. I read this as daily rainfall for Oʻahu from 9 to 13 October; I ticked the daily maps.", "items": [
        {"group": "grid", "product": "rainfall", "period": "day", "start": "2026-10-09", "end": "2026-10-13", "extents": ["oahu"], "files": ["data_map"], "ticked": True, "why": "the week"},
        {"group": "grid", "product": "rainfall", "period": "day", "start": "2026-10-12", "end": "2026-10-13", "extents": ["oahu"], "files": ["se"], "ticked": False, "why": "context"}]})[0]
    plan = client.post("/api/download/plan", json={"ask": "rain on Oahu this week"}).json()
    assert len(plan["items"]) == 1 and plan["items"][0]["end"] == "2026-10-11" and plan["items"][0]["count"] == 6
    assert plan["items"][0]["note"] == "no daily rainfall for 12–13 Oct 2026 yet — the last day published is 11 Oct 2026"
    assert plan["dropped"][0]["why"] == "no daily rainfall for 12 Oct 2026 yet — the last day published is 11 Oct 2026"
    assert plan["primary_view"] == "/viewer/rainfall/day/2026-10-11/oahu"


@respx.mock
def test_plan_endpoint_answers_503_without_a_planner_and_429_over_the_limiter(client):
    mock_hcdp()
    appmod.app.state.planner = make_planner(None)[0]
    r = client.post("/api/download/plan", json={"ask": "rain"})
    assert r.status_code == 503 and "did not answer" in r.json()["detail"]
    appmod.app.state.planner = dl.DownloadPlanner(type("L", (), {"configured": False})(), appmod.app.state.navigator)
    assert client.post("/api/download/plan", json={"ask": "rain"}).status_code == 503
    appmod.app.state.planner = make_planner(LOWELL_RAW)[0]
    appmod.app.state.download_limiter = appmod.RateLimiter(per_minute=1, per_hour=10, global_per_day=100)
    assert client.post("/api/download/plan", json={"ask": "rain"}).status_code == 200
    r = client.post("/api/download/plan", json={"ask": "rain"})
    assert r.status_code == 429 and "Export form" in r.json()["detail"]


def plan_items(client):
    plan = client.post("/api/download/plan", json={"ask": "I need rainfall data from Hurricane Lowell"}).json()
    return plan, [i for i in plan["items"] if i["ticked"]]


@respx.mock
def test_prepare_streams_hcdps_zip_with_readme_added_using_the_visitors_key_only(client, caplog):
    caplog.set_level(logging.DEBUG)
    seen = mock_hcdp()
    plan, picked = plan_items(client)
    body = {"ask": plan["ask"], "reading": plan["reading"], "items": picked, "api_key": VISITOR_KEY, "event": plan["event"], "place": plan["place"], "primary_view": plan["primary_view"]}
    r = client.post("/api/download/prepare", json=body)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip" and r.headers["x-hcdp-files"] == "7" and r.headers["cache-control"] == "no-store"
    assert r.headers["content-disposition"] == 'attachment; filename="hcdp_hurricane-lowell_2026-09-06_2026-09-08.zip"'
    assert r.headers["x-package-path"].startswith("/download?ask=I%20need%20rainfall")
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        names = z.namelist()
        assert names[:2] == list(zipfile.ZipFile(io.BytesIO(small_zip())).namelist()) and names[-1] == "README.md"
        readme = z.read("README.md").decode("utf-8")
    assert "## How the AI read it" in readme and LOWELL_RAW["reading"] in readme and "Hurricane Lowell report: https://www.hawaii.edu/climate-data-portal/hurricane-lowell/" in readme
    assert f"Re-open or share this list: {ORIGIN}{plan['package_path']}" in readme and "Analyze with AI: " + appmod.AI_INTERFACE_URL in readme
    # HCDP got the VISITOR's key for the package, never the server's token (which only ever makes the read-only listing);
    # the payload is hcdp_v2's shape with one group per item
    assert seen["genzip_auth"] == f"Bearer {VISITOR_KEY}" and SERVER_TOKEN not in json.dumps({k: v for k, v in seen.items() if k != "listing"})
    assert set(seen["listing"]) == {f"Bearer {SERVER_TOKEN}"} and VISITOR_KEY not in json.dumps(seen["listing"])
    assert seen["genzip_body"]["email"] == appmod.EXPORT_LOG_EMAIL and [g["params"]["period"] for g in seen["genzip_body"]["data"]] == ["day", "day"]
    assert seen["genzip_body"]["data"][0]["dates"] == {"start": "2026-09-06", "end": "2026-09-08", "unit": "day", "interval": 1}
    # the key appears nowhere: not in the response, its headers, the logs, or the plan the server keeps
    assert VISITOR_KEY not in r.text and all(VISITOR_KEY not in v for v in r.headers.values())
    assert all(VISITOR_KEY not in rec.getMessage() for rec in caplog.records)
    assert VISITOR_KEY not in json.dumps(appmod.app.state.planner.llm.calls)
    # the temp file is gone once the response is sent
    tmp = appmod.CACHE_DIR / "tmp"
    assert not list(tmp.glob("hcdp-ai-*.zip"))
    # a typed email is forwarded to HCDP for logging; the server's log address otherwise (checked above)
    client.post("/api/download/prepare", json={**body, "email": "ikaika@example.edu"})
    assert seen["genzip_body"]["email"] == "ikaika@example.edu"


@respx.mock
def test_prepare_refuses_bad_requests_without_echoing_the_key_and_relays_hcdps_refusals(client, caplog):
    caplog.set_level(logging.DEBUG)
    seen = mock_hcdp(zip_status=401)
    plan, picked = plan_items(client)
    good = {"ask": plan["ask"], "items": picked, "api_key": VISITOR_KEY}
    for bad, status, words in (({**good, "api_key": ""}, 400, "API key is needed"), ({**good, "api_key": "short"}, 400, "API key is needed"), ({"items": picked, "api_key": VISITOR_KEY}, 400, "ask is missing"),
                               ({**good, "items": []}, 400, "tick at least one"), ({**good, "items": "x"}, 400, "tick at least one"), ({**good, "email": "nope"}, 400, "email address"),
                               ({**good, "items": [{"group": "grid", "product": "wind", "period": "hour", "start": "x", "end": "y"}]}, 400, "none of the ticked items"),
                               ({**good, "items": [{"group": "report", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/"}]}, 400, "none of the ticked items")):
        r = client.post("/api/download/prepare", json=bad)
        assert r.status_code == status and words in r.json()["detail"], (bad, r.text)
        assert VISITOR_KEY not in r.text and "genzip_auth" not in seen
    assert client.post("/api/download/prepare", content=b"[1,2]", headers={"content-type": "application/json"}).status_code in (400, 422)
    assert all(VISITOR_KEY not in rec.getMessage() for rec in caplog.records)
    # HCDP refuses the key → 401 in plain words, the key still nowhere
    r = client.post("/api/download/prepare", json=good)
    assert r.status_code == 401 and r.json()["detail"] == "HCDP did not accept that API key (it answered 401). Check the key, or request one on HCDP's API page." and VISITOR_KEY not in r.text
    assert seen["genzip_auth"] == f"Bearer {VISITOR_KEY}"
    respx.post(f"{BASE}/genzip/instant/content").mock(return_value=httpx.Response(500, text="boom"))
    assert client.post("/api/download/prepare", json=good).json()["detail"] == "HCDP returned 500 for this package: boom"
    respx.post(f"{BASE}/genzip/instant/content").mock(return_value=httpx.Response(200, content=b""))
    r = client.post("/api/download/prepare", json=good)
    assert r.status_code == 502 and "empty zip" in r.json()["detail"]
    respx.post(f"{BASE}/genzip/instant/content").mock(return_value=httpx.Response(200, content=b"not a zip at all"))
    assert "not a zip" in client.post("/api/download/prepare", json=good).json()["detail"]
    respx.post(f"{BASE}/genzip/instant/content").mock(side_effect=httpx.ConnectError("down"))
    assert client.post("/api/download/prepare", json=good).status_code == 502
    # nothing left on disk after the failures
    assert not list((appmod.CACHE_DIR / "tmp").glob("hcdp-ai-*.zip"))


@respx.mock
def test_prepare_keeps_to_the_byte_budget(client, monkeypatch):
    mock_hcdp(zip_bytes=small_zip(tuple(f"data/f{i}.tif" for i in range(40))))
    monkeypatch.setattr(appmod, "EXPORT_MAX_BYTES", 500)
    plan, picked = plan_items(client)
    r = client.post("/api/download/prepare", json={"ask": plan["ask"], "items": picked, "api_key": VISITOR_KEY})
    assert r.status_code == 413 and "emailed" in r.json()["detail"]
    assert not list((appmod.CACHE_DIR / "tmp").glob("hcdp-ai-*.zip"))


@respx.mock
def test_prepare_over_150_files_becomes_the_emailed_package(client):
    seen = mock_hcdp()
    appmod.app.state.planner = make_planner({"reading": "You asked for all of 2026's daily rainfall statewide. I read this as every day from January through October; I ticked the daily maps, which is more than one download can hold, so the package is emailed.", "items": [
        {"group": "grid", "product": "rainfall", "period": "day", "start": "2026-01-01", "end": "2026-10-13", "extents": ["statewide"], "files": ["data_map"], "ticked": True, "why": "every day"}]})[0]
    plan = client.post("/api/download/plan", json={"ask": "every daily rainfall map of 2026"}).json()
    assert plan["items"][0]["count"] == 284 * 2 and plan["estimate"]["over_instant"] is True
    body = {"ask": plan["ask"], "reading": plan["reading"], "items": plan["items"], "api_key": VISITOR_KEY}
    r = client.post("/api/download/prepare", json=body)
    assert r.status_code == 413 and "add your email" in r.json()["detail"] and "email_auth" not in seen
    r = client.post("/api/download/prepare", json={**body, "email": "ikaika@example.edu"})
    assert r.status_code == 202, r.text
    out = r.json()
    assert out["ok"] is True and out["email"] == "ikaika@example.edu" and out["files"] == 568 and "three days" in out["message"]
    assert out["readme"].startswith("# HCDP data package") and out["package_url"].startswith(ORIGIN + "/download?ask=") and out["analyze_url"].endswith("&from=website")
    assert seen["email_auth"] == f"Bearer {VISITOR_KEY}" and seen["email_body"]["email"] == "ikaika@example.edu"
    assert seen["email_body"]["data"][0]["dates"] == {"start": "2026-01-01", "end": "2026-10-11", "unit": "day", "interval": 1}      # trimmed to what HCDP has
    assert VISITOR_KEY not in r.text
    respx.post(f"{BASE}/genzip/email").mock(return_value=httpx.Response(401, text="Unauthorized"))
    assert client.post("/api/download/prepare", json={**body, "email": "ikaika@example.edu"}).status_code == 401


@respx.mock
def test_prepare_limiters_are_the_export_ones(client):
    mock_hcdp()
    plan, picked = plan_items(client)
    appmod.app.state.export_limiter = appmod.RateLimiter(per_minute=1, per_hour=10, global_per_day=100)
    body = {"ask": plan["ask"], "items": picked, "api_key": VISITOR_KEY}
    assert client.post("/api/download/prepare", json=body).status_code == 200
    r = client.post("/api/download/prepare", json=body)
    assert r.status_code == 429 and "emailed" in r.json()["detail"]


def test_health_shows_the_planner(client):
    h = client.get("/api/health").json()
    assert set(h["planner"]) == {"model", "fallback_model", "timeout", "max_completion_tokens", "stats"}


# ----- the navigator's download intent -----------------------------------------------------------
def test_navigator_download_intent_goes_to_the_api_page_with_the_offer():
    from test_navigator import FakeLLM
    nav = Navigator(FakeLLM({"intent": "download", "reply": "Taking you to the API page, where I can prepare the Lowell rainfall files.", "actions": [{"type": "navigate", "path": "/download"}],
                             "alternatives": [{"title": "Hurricane Lowell report", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/", "why": "the story"}], "minimize": True,
                             "download": {"ask": "How do I download Hurricane Lowell rainfall data?", "offer": "I can prepare the daily rainfall maps and station totals for Hurricane Lowell (6–8 September 2026, Kauaʻi) as one zip.",
                                          "hints": {"product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "event": "Hurricane Lowell", "evil": {"x": 1}, "files": ["data_map"]}}}),
                    load_catalog(), ai_interface_url="https://ai.example.org", today=dt.date(2026, 10, 13))
    out = nav.respond("How do I download Hurricane Lowell rainfall data?", [], {"path": "/"})
    assert out["intent"] == "download" and out["actions"][0] == {"type": "navigate", "path": "/data/api"} and out["minimize"] is True
    assert out["download"]["ask"] == "How do I download Hurricane Lowell rainfall data?" and out["download"]["offer"].startswith("I can prepare the daily rainfall maps")
    assert out["download"]["hints"] == {"product": "rainfall", "period": "day", "start": "2026-09-06", "end": "2026-09-08", "extents": ["kauai"], "event": "Hurricane Lowell", "files": ["data_map"]}
    assert out["download"]["api_url"] == "https://www.hawaii.edu/climate-data-portal/hcdp-hawaii-mesonet-api/"
    assert out["alternatives"][0]["url"].endswith("/hurricane-lowell/")
    s = nav.system_prompt({"path": "/"})
    assert "7. download — the visitor wants DATA FILES" in s and '"download": {"ask": "…", "offer": "…", "hints": {…}}' in s and "Never navigate to /download yourself" in s
    # a bare download intent still gets the API page, the ask as typed and the default offer sentence
    nav2 = Navigator(FakeLLM({"intent": "download", "reply": "", "actions": [], "alternatives": []}), load_catalog(), today=dt.date(2026, 10, 13))
    out2 = nav2.respond("get me the station totals for Maui in August")
    assert out2["actions"] == [{"type": "navigate", "path": "/data/api"}] and out2["download"]["ask"] == "get me the station totals for Maui in August" and out2["download"]["hints"] == {}
    assert out2["reply"] == "Taking you to the API page, where I can prepare these files for download." and "one zip" in out2["download"]["offer"]
    # the other intents carry no download object
    assert "download" not in Navigator(FakeLLM({"intent": "info", "reply": "ok", "actions": [], "alternatives": []}), load_catalog()).respond("what is HCDP")
