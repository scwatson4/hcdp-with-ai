"""The site catalog (backend/data/catalog.json): the navigator's knowledge of HCDP.

The navigator may only send people to URLs that appear here, so these tests
keep the file well-formed, honest about its hosts, and complete.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from navigator import DATASETS, EXTENTS, ROUTES, STATIC_HOSTS, Navigator, load_catalog, parse_viewer_path, valid_internal_path  # noqa: E402

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "catalog.json"
RAW = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
ENTRIES = RAW["entries"]
BY_ID = {e["id"]: e for e in ENTRIES}

KINDS = {"event", "page", "viewer", "tool", "api", "dataset", "atlas", "external", "internal"}
REGIONS = {"hawaii", "american_samoa", "guam", "pacific", None}
REQUIRED = {
    "id": str, "kind": str, "title": str, "url": (str, type(None)), "internal_path": (str, type(None)),
    "summary": str, "when_to_use": str, "example_queries": list, "region": (str, type(None)),
    "dates": (dict, type(None)), "tags": list,
}
OPTIONAL = {"checked", "http"}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

AI_INTERFACE_HOST = "hcdp-ai-interface.cis251375.projects.jetstream-cloud.org"
# HCDP-affiliated hosts, spelled out so that a stray host fails this test.
HCDP_HOSTS = {
    "www.hawaii.edu",                 # the portal itself and UH News
    "rainfall.geography.hawaii.edu",  # Rainfall Atlas of Hawaiʻi
    "ccvd.manoa.hawaii.edu",          # CCVD climate portfolios (Climate Tools)
    "hrip.manoa.hawaii.edu",          # Hawaiʻi Rangeland Information Portal (Climate Tools)
    "www.pacioos.hawaii.edu",         # State sea level rise viewer (Climate Tools)
    "www.soest.hawaii.edu",           # SOEST coastal viewer (Climate Tools)
    "ikeauth.its.hawaii.edu",         # public HCDP file downloads
    "cherryleh.github.io",            # Climate Summary app and storm trackers
    "hcdp.github.io",                 # API docs, American Samoa and Guam viewers
    "github.com",                     # github.com/HCDP/... only (checked below)
    "hawaiimesonet.app",              # Hawaiʻi Mesonet mobile app
    "api.hcdp.ikewai.org",            # the HCDP API
    "recharge.ikewai.org",            # Groundwater Recharge Tool (UH ʻIke Wai), listed on Climate Tools
    "www.weather.gov",                # NWS Honolulu, for forecasts (kind external only)
    AI_INTERFACE_HOST,                # the HCDP AI interface (kind internal only)
}

# Ids the navigator must always be able to reach (portal menus, Climate Tools, events, atlases).
MUST_HAVE = {
    # menus
    "hcdp-home", "team", "hcdp-history", "rainfall-mapping-history", "climate-monitoring-history", "acknowledgements",
    "how-to-cite", "access-data", "api", "tutorials", "cultural-resources", "library", "research-highlights",
    "external-resources", "presentations", "climate-tools",
    # home-page sections
    "mesonet", "climate-summary", "pacific-portal", "extreme-events",
    # Climate Tools page
    "rainfall-atlas", "ccvd-portfolios", "h-rip", "groundwater-recharge-tool", "sea-level-rise-viewer",
    "american-samoa-data-viewer", "soest-coastal-viewer", "climate-atlas", "avian-malaria-tool",
    # atlases, Mesonet, Pacific
    "evapotranspiration-atlas", "solar-radiation-atlas", "mesonet-live-data", "mesonet-station-list", "hawaii-mesonet-app",
    "american-samoa-portal", "guam-data-viewer", "guam-climate-data-portal",
    # events
    "nolo", "lowell", "lowell-mesonet-viewer", "lala", "kona-low-1", "kona-low-2",
    # data, API, analysis hand-off, forecasts
    "data-downloads", "station-data", "api-docs", "api-mesonet", "hcdp-ai-interface", "nws-honolulu",
}


def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _strings(k)
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)


def _period_of(path: str) -> str:
    parts = path.split("?")[0].split("/")
    return parts[3] if len(parts) > 3 else ""


def expand_template(path: str) -> list[str]:
    """Every concrete path a viewer template stands for, with sample values."""
    for k, v in {"{id}": "0115", "{year}": "2026", "{month}": "8", "{question}": "rainfall%20map", "{slug}": "h-rip"}.items():
        path = path.replace(k, v)
    if "{" not in path:
        return [path]
    datasets = [path.split("/")[2]] if "{dataset}" not in path else list(DATASETS)
    out = []
    for ds in datasets:
        p = path.replace("{dataset}", ds)
        periods = [_period_of(p)] if "{period}" not in p else DATASETS[ds]["periods"]
        for period in periods:
            if period not in DATASETS.get(ds, {}).get("periods", []):
                continue
            q = p.replace("{period}", period)
            q = q.replace("{date}", "2026-09-07" if period == "day" else "2026-08")
            extents = list(EXTENTS) if "{extent}" in q else [None]
            for ext in extents:
                out.append(q.replace("{extent}", ext) if ext else q)
    return out


def test_top_level_shape():
    assert set(RAW) == {"as_of", "entries"}
    assert RAW["as_of"] == "2026-09-25"
    assert isinstance(ENTRIES, list) and len(ENTRIES) >= 90


@pytest.mark.parametrize("e", ENTRIES, ids=lambda e: e.get("id", "?"))
def test_entry_keys_and_types(e):
    assert set(REQUIRED) <= set(e), f"missing {set(REQUIRED) - set(e)}"
    assert set(e) <= set(REQUIRED) | OPTIONAL, f"unexpected {set(e) - set(REQUIRED) - OPTIONAL}"
    for key, typ in REQUIRED.items():
        assert isinstance(e[key], typ), f"{key} has type {type(e[key]).__name__}"
    assert ID_RE.match(e["id"]), e["id"]
    assert e["kind"] in KINDS
    assert e["region"] in REGIONS
    for key, least in (("title", 3), ("summary", 20), ("when_to_use", 20)):
        assert e[key].strip() == e[key] and len(e[key]) >= least, key
    assert len(e["summary"]) <= 600
    qs = e["example_queries"]
    assert len(qs) >= 3 and all(isinstance(q, str) and q.strip() for q in qs) and len(set(qs)) == len(qs)
    assert e["tags"] and all(isinstance(t, str) and t.strip() == t and t for t in e["tags"])
    assert len(set(e["tags"])) == len(e["tags"]), "duplicate tags"
    assert e["url"] is not None or e["internal_path"] is not None, "an entry must lead somewhere"


def test_ids_are_unique():
    ids = [e["id"] for e in ENTRIES]
    assert len(ids) == len(set(ids)), sorted({i for i in ids if ids.count(i) > 1})


@pytest.mark.parametrize("e", [e for e in ENTRIES if e["url"]], ids=lambda e: e["id"])
def test_urls_are_https_on_hcdp_hosts(e):
    u = urlparse(e["url"])
    assert u.scheme == "https", e["url"]
    assert u.hostname in HCDP_HOSTS, f"stray host {u.hostname}"
    if u.hostname == "github.com":
        assert u.path.startswith("/HCDP"), "only github.com/HCDP/..."
    if u.hostname == "www.weather.gov":
        assert e["kind"] == "external"
    if u.hostname == AI_INTERFACE_HOST:
        assert e["kind"] == "internal"
    if u.hostname == "www.hawaii.edu":
        assert u.path.startswith(("/climate-data-portal/", "/news/")), e["url"]


def test_url_checks_are_recorded_consistently():
    for e in ENTRIES:
        if "checked" in e or "http" in e:
            assert e["url"], e["id"]
            assert "checked" in e and "http" in e, e["id"]
            assert isinstance(e["http"], int) and ISO_DATE.match(e["checked"]), e["id"]
            dt.date.fromisoformat(e["checked"])
    # every portal page was verified, and every one answered 200
    portal = [e for e in ENTRIES if e["url"] and urlparse(e["url"]).hostname == "www.hawaii.edu"]
    assert portal and all(e.get("http") == 200 for e in portal), [e["id"] for e in portal if e.get("http") != 200]


@pytest.mark.parametrize("e", [e for e in ENTRIES if e["internal_path"]], ids=lambda e: e["id"])
def test_internal_paths_are_routes_or_viewer_links(e):
    path = e["internal_path"]
    if "{" in path:
        concrete = expand_template(path)
        assert concrete, f"template {path} expands to nothing"
        for p in concrete:
            assert "{" not in p and "}" not in p, p
            if p.startswith("/viewer/"):
                assert parse_viewer_path(p) is not None, p
            assert valid_internal_path(p), p
    else:
        assert valid_internal_path(path), path
        if path.startswith("/viewer/"):
            assert parse_viewer_path(path.split("#")[0]) is not None, path
        else:
            pass  # storm/tool routes and page query keys are validated by valid_internal_path above


def test_every_viewer_dataset_has_a_catalog_entry():
    paths = [e["internal_path"] for e in ENTRIES if e["kind"] == "viewer" and e["internal_path"]]
    for ds, spec in DATASETS.items():
        assert any(p.startswith(f"/viewer/{ds}/") for p in paths), f"no viewer entry for {ds}"
    templates = [p for p in paths if "{date}" in p]
    assert any(p.startswith("/viewer/rainfall/day/") for p in templates)
    assert any(p.startswith("/viewer/rainfall/month/") for p in templates)


def _check_dates(e):
    d = e["dates"]
    assert set(d) == {"start", "end"}, e["id"]
    assert isinstance(d["start"], str) and ISO_DATE.match(d["start"]), e["id"]
    start = dt.date.fromisoformat(d["start"])
    if d["end"] is not None:
        assert ISO_DATE.match(d["end"]) and dt.date.fromisoformat(d["end"]) >= start, e["id"]
    assert start <= dt.date(2026, 9, 25), e["id"]


def test_every_event_has_dates_and_all_dates_are_valid():
    events = [e for e in ENTRIES if e["kind"] == "event"]
    assert len(events) >= 5
    for e in events:
        assert e["dates"] is not None, e["id"]
    for e in ENTRIES:
        if e["dates"] is not None:
            _check_dates(e)


def test_no_placeholder_text():
    for s in _strings(RAW):
        low = s.lower()
        assert "todo" not in low and "lorem" not in low, s[:80]


def test_required_coverage():
    missing = MUST_HAVE - set(BY_ID)
    assert not missing, sorted(missing)


# The words visitors actually type: places (→ their island) and topics.
PLACE_SYNONYMS = {"big island", "hawaiʻi island", "hilo", "kona", "waimea", "honolulu", "kailua", "lihue", "kahului",
                  "lahaina", "kaunakakai", "lanai city", "maui", "oahu", "kauai", "molokai", "lanai"}
TOPIC_SYNONYMS = {"rain", "rainfall", "precipitation", "storm", "hurricane", "tropical storm", "flood", "drought", "dry",
                  "heat", "temperature", "hot", "cold", "humidity", "fire", "wildfire", "vegetation", "greenness",
                  "download", "csv", "geotiff", "api", "python", "live", "now", "current", "station", "sensor", "forecast",
                  "sea level", "groundwater", "evapotranspiration", "solar", "cite", "citation", "paper"}


def test_tags_carry_the_words_visitors_type():
    all_tags = {t for e in ENTRIES for t in e["tags"]}
    assert not (PLACE_SYNONYMS | TOPIC_SYNONYMS) - all_tags, sorted((PLACE_SYNONYMS | TOPIC_SYNONYMS) - all_tags)
    # the per-dataset viewer entries answer "…in Hilo / on the Big Island", so they carry every place name
    for e in ENTRIES:
        if e["kind"] == "viewer" and "{date}" in (e["internal_path"] or ""):
            assert PLACE_SYNONYMS <= set(e["tags"]), (e["id"], sorted(PLACE_SYNONYMS - set(e["tags"])))


def test_exactly_one_internal_entry_the_ai_interface():
    internal = [e for e in ENTRIES if e["kind"] == "internal"]
    assert [e["id"] for e in internal] == ["hcdp-ai-interface"]
    assert urlparse(internal[0]["url"]).hostname == AI_INTERFACE_HOST
    assert "analysis" in internal[0]["when_to_use"].lower()


def test_forecast_questions_have_somewhere_honest_to_go():
    nws = BY_ID["nws-honolulu"]
    assert nws["kind"] == "external" and "forecast" in nws["tags"]
    assert "not" in nws["summary"] and "forecast" in nws["summary"]


class _NoLLM:
    def complete_json(self, system, messages):  # pragma: no cover - never called here
        raise AssertionError("not used")


def test_navigator_loads_this_catalog_and_allows_its_urls():
    loaded = load_catalog()
    assert [e["id"] for e in loaded] == [e["id"] for e in ENTRIES]
    nav = Navigator(_NoLLM(), loaded, ai_interface_url="https://ai.example.org", today=dt.date(2026, 9, 25))
    prompt = nav.system_prompt({"path": "/"})
    for e in ENTRIES:
        assert f"[{e['id']}]" in prompt
        if e["url"]:
            assert nav.allowed_url(e["url"]), e["url"]
    assert len(nav.catalog_text()) < 150_000, "the catalog is getting too big for the prompt"


def test_navigator_trust_set_stays_hcdp_only():
    """The navigator trusts STATIC_HOSTS plus every catalog host; nothing else may sneak in."""
    nav = Navigator(_NoLLM(), ENTRIES)
    assert nav.hosts - STATIC_HOSTS <= HCDP_HOSTS, sorted(nav.hosts - STATIC_HOSTS - HCDP_HOSTS)
    assert not nav.allowed_url("https://evil.example.com/")


@pytest.mark.parametrize("message,expected", [
    ("Hurricane Lowell rainfall", {"lowell", "lowell-rainfall-map"}),
    ("Nolo tracker", {"nolo", "nolo-tracker-fullscreen"}),
    ("how do I cite HCDP data", {"how-to-cite"}),
    ("API token", {"api"}),
    ("mesonet stations", {"mesonet", "mesonet-station-list", "mesonet-station-map"}),
    ("evapotranspiration", {"evapotranspiration-atlas"}),
    ("weather forecast", {"nws-honolulu"}),
])
def test_keyword_fallback_finds_the_obvious_entry(message, expected):
    nav = Navigator(_NoLLM(), ENTRIES)
    top = [e["id"] for e in nav.search(message)]
    assert expected & set(top), f"{message!r} -> {top}"
