"""The navigator's test cases (backend/data/usecases.json): what visitors ask and where they should land.

These tests keep the cases well-formed and consistent with the catalog and the
viewer's URL grammar; they do not call the model.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from navigator import DATASETS, EXTENTS, Navigator, parse_viewer_path, valid_internal_path  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
USECASES = json.loads((DATA / "usecases.json").read_text(encoding="utf-8"))
CASES = USECASES["cases"]
CATALOG = {e["id"]: e for e in json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))["entries"]}

PERSONAS = {"climate-scientist", "emergency-responder", "researcher", "citizen", "teacher", "farmer-rancher",
            "water-utility", "journalist", "developer"}
INTENTS = {"navigate", "analysis", "info", "clarify"}
REQUIRED = {"id": str, "persona": str, "query": str, "expected_intent": str, "expected_ids": list, "notes": str}
OPTIONAL = {"expected_path_prefix": str, "context": dict}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
AS_OF = dt.date(2026, 9, 25)
LAST_DAY = AS_OF - dt.timedelta(days=1)     # daily maps run through yesterday
LAST_MONTH = "2026-08"                      # monthly maps through the last complete month
FORBIDDEN_NAMES = re.compile(r"\bsam(?:uel|my)?\b", re.I)


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


def viewer_prefix_problem(prefix: str) -> str | None:
    """None when `prefix` can begin a valid viewer path; otherwise the reason.

    Complete segments must be valid; the last segment may be partial
    (e.g. "/viewer/rainfall/day/2026-09-0" means any of 1–9 September)."""
    base = prefix.split("?")[0].split("#")[0]
    parts = base.split("/")
    if parts[:2] != ["", "viewer"]:
        return "not a viewer path"
    segs = parts[2:]
    if len(segs) > 4:
        return "too many segments"
    ds = period = None
    for i, seg in enumerate(segs):
        last = i == len(segs) - 1
        if i == 0:
            options = list(DATASETS)
        elif i == 1:
            options = DATASETS[ds]["periods"]
        elif i == 3:
            options = list(EXTENTS)
        else:  # the date
            full = 10 if period == "day" else 7
            if len(seg) == full:
                try:
                    d = dt.date.fromisoformat(seg if period == "day" else seg + "-01")
                except ValueError:
                    return f"bad date {seg}"
                if period == "day" and d > LAST_DAY:
                    return f"{seg} is after the newest daily map"
                if period == "month" and seg > LAST_MONTH:
                    return f"{seg} is after the newest monthly map"
                continue
            if last and re.fullmatch(r"\d{0,4}(-\d{0,2}(-\d{0,2})?)?", seg) and len(seg) < full:
                continue
            return f"bad date segment {seg!r}"
        ok = any(o.startswith(seg) for o in options) if last else seg in options
        if not ok:
            return f"bad segment {seg!r}"
        if i == 0:
            ds = seg
        elif i == 1:
            period = seg
    return None


def test_top_level_shape():
    assert set(USECASES) == {"as_of", "cases"} and USECASES["as_of"] == "2026-09-25"
    assert isinstance(CASES, list) and len(CASES) >= 70


def test_case_keys_and_types():
    for c in CASES:
        assert set(REQUIRED) <= set(c), (c.get("id"), set(REQUIRED) - set(c))
        assert set(c) <= set(REQUIRED) | set(OPTIONAL), (c["id"], set(c) - set(REQUIRED) - set(OPTIONAL))
        for key, typ in {**REQUIRED, **OPTIONAL}.items():
            if key in c:
                assert isinstance(c[key], typ), (c["id"], key)
        assert ID_RE.match(c["id"]), c["id"]
        assert c["persona"] in PERSONAS, c["id"]
        assert c["expected_intent"] in INTENTS, c["id"]
        assert c["query"].strip() and len(c["query"]) <= 500, c["id"]   # the API's message limit
        assert c["notes"].strip(), c["id"]
        assert all(isinstance(i, str) for i in c["expected_ids"]), c["id"]
        assert len(set(c["expected_ids"])) == len(c["expected_ids"]), c["id"]


def test_ids_are_unique():
    ids = [c["id"] for c in CASES]
    assert len(ids) == len(set(ids)), sorted({i for i in ids if ids.count(i) > 1})


def test_every_expected_id_exists_in_the_catalog():
    missing = {(c["id"], i) for c in CASES for i in c["expected_ids"] if i not in CATALOG}
    assert not missing, sorted(missing)


def test_intent_mix_and_personas():
    by_intent = {k: [c for c in CASES if c["expected_intent"] == k] for k in INTENTS}
    assert len(by_intent["analysis"]) >= 12
    assert len(by_intent["info"]) >= 6
    assert len(by_intent["clarify"]) >= 4
    assert all(c["expected_ids"] == [] for c in by_intent["analysis"]), "analysis hands off; no catalog target"
    assert all(c["expected_ids"] for c in by_intent["navigate"]), "a navigate case needs a target"
    assert all(c["expected_ids"] for c in by_intent["clarify"]), "a clarify case names the candidates"
    assert {c["persona"] for c in CASES} == PERSONAS


def test_follow_up_cases_carry_a_real_viewer_path():
    follow = [c for c in CASES if c.get("context", {}).get("path", "").startswith("/viewer/")]
    assert len(follow) >= 8
    for c in CASES:
        if "context" in c:
            assert set(c["context"]) <= {"path", "viewer"}, c["id"]
            path = c["context"]["path"]
            assert valid_internal_path(path), (c["id"], path)
            if path.startswith("/viewer/"):
                assert parse_viewer_path(path) is not None, (c["id"], path)
                assert viewer_prefix_problem(path) is None, (c["id"], viewer_prefix_problem(path))


def test_expected_path_prefixes_are_reachable():
    for c in CASES:
        prefix = c.get("expected_path_prefix")
        if prefix is None:
            continue
        assert c["expected_intent"] == "navigate", c["id"]
        assert prefix.startswith("/"), c["id"]
        if prefix.startswith("/viewer/"):
            problem = viewer_prefix_problem(prefix)
            assert problem is None, (c["id"], problem)
            # some expected catalog entry must be about the same dataset
            ds = prefix.split("/")[2]
            entry_paths = [CATALOG[i]["internal_path"] or "" for i in c["expected_ids"]]
            if ds in DATASETS:
                assert any(p.startswith(f"/viewer/{ds}/") for p in entry_paths), c["id"]
        else:
            assert valid_internal_path(prefix), (c["id"], prefix)


def test_expected_targets_survive_the_navigators_validation():
    """If the model picks an expected entry, the navigator must let the visitor through."""
    nav = Navigator(None, list(CATALOG.values()))
    for c in CASES:
        for i in c["expected_ids"]:
            e = CATALOG[i]
            if e["url"]:
                assert nav.allowed_url(e["url"]), (c["id"], e["url"])
            path = e["internal_path"]
            if path and "{" not in path:
                assert valid_internal_path(path), (c["id"], path)
        prefix = c.get("expected_path_prefix")
        if prefix and (not prefix.startswith("/viewer/") or parse_viewer_path(prefix)):
            assert valid_internal_path(prefix), (c["id"], prefix)


def test_prefix_checker_itself():
    assert viewer_prefix_problem("/viewer/rainfall/day/2026-09-07/kauai") is None
    assert viewer_prefix_problem("/viewer/rainfall/day/2026-09-0") is None
    assert viewer_prefix_problem("/viewer/spi-3/month/") is None
    assert viewer_prefix_problem("/viewer/humidity/month/2026-08/oahu") is not None   # daily only
    assert viewer_prefix_problem("/viewer/rainfall/day/2026-09-25/kauai") is not None  # not published yet
    assert viewer_prefix_problem("/viewer/rainfall/month/2026-09/kauai") is not None
    assert viewer_prefix_problem("/viewer/rainfall/day/2026-09-07/bigisland") is not None


def test_no_placeholder_text_or_forbidden_names():
    for data in (USECASES, {"catalog": list(CATALOG.values())}):
        for s in _strings(data):
            low = s.lower()
            assert "todo" not in low and "lorem" not in low, s[:80]
            assert not FORBIDDEN_NAMES.search(s), s[:80]
