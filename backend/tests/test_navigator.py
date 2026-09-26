import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from navigator import Navigator, describe_view, parse_viewer_path, valid_internal_path, SEED_CATALOG  # noqa: E402


class FakeLLM:
    def __init__(self, payload=None, error=None):
        self.payload, self.error, self.calls = payload, error, []

    def complete_json(self, system, messages):
        self.calls.append((system, messages))
        if self.error:
            raise self.error
        return self.payload


def make(payload=None, error=None):
    llm = FakeLLM(payload, error)
    return Navigator(llm, SEED_CATALOG, ai_interface_url="https://ai.example.org", today=dt.date(2026, 9, 25)), llm


def test_viewer_path_grammar():
    assert parse_viewer_path("/viewer/rainfall/day/2026-09-07/kauai")["extent"] == "kauai"
    assert parse_viewer_path("/viewer/spi-3/month/2026-08/statewide")["dataset"] == "spi-3"
    assert parse_viewer_path("/viewer/rainfall/month/2026-09/kauai?units=in&stations=1") is not None
    assert parse_viewer_path("/viewer/rainfall/day/2026-09/kauai") is None          # day needs a full date
    assert parse_viewer_path("/viewer/humidity/month/2026-08/statewide") is None    # humidity is daily only
    assert parse_viewer_path("/viewer/rainfall/day/2026-02-30/oahu") is None        # not a real date
    assert parse_viewer_path("/viewer/rainfall/day/2026-09-07/bigisland") is None
    assert parse_viewer_path("/viewer/rainfall/day/2026-09-07/kauai?evil=1") is None
    assert valid_internal_path("/extreme-events#lowell")
    assert valid_internal_path("/about/team")
    assert valid_internal_path("/extreme-events/lowell") and valid_internal_path("/tools/h-rip")
    assert valid_internal_path("/mesonet?viewer=live&station=0115&view=dashboard")
    assert valid_internal_path("/climate-summary?year=2026&month=8") and valid_internal_path("/?ask=rainfall%20map")
    assert not valid_internal_path("/mesonet?evil=1") and not valid_internal_path("/tools/../x") and not valid_internal_path("/extreme-events/Lowell!")
    assert not valid_internal_path("/admin")
    assert not valid_internal_path("https://www.hawaii.edu/")


def test_system_prompt_carries_dates_catalog_and_context():
    nav, _ = make()
    s = nav.system_prompt({"path": "/viewer/rainfall/day/2026-09-07/kauai", "viewer": {"dataset": "rainfall", "date": "2026-09-07"}})
    assert "Today is 2026-09-25" in s and "through 2026-09-24" in s and "through 2026-08" in s
    assert "[lowell]" in s and "hurricane-lowell" in s
    assert "/viewer/rainfall/day/2026-09-07/kauai" in s and '"dataset": "rainfall"' in s


def test_navigate_is_validated_and_minimizes():
    nav, llm = make({
        "intent": "navigate", "reply": "Opening the Lowell report.",
        "actions": [
            {"type": "navigate", "path": "/viewer/rainfall/day/2026-09-07/kauai"},
            {"type": "navigate", "path": "/about"},                       # second navigate dropped
            {"type": "open", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/"},
            {"type": "open", "url": "https://evil.example.com/"},           # foreign host dropped
        ],
        "alternatives": [
            {"title": "Data portal", "url": "/data", "why": "downloads"},
            {"title": "Bad", "url": "javascript:alert(1)", "why": "x"},
            {"title": "Mesonet app", "url": "https://hawaiimesonet.app/", "why": "live"},
        ],
        "minimize": False,
    })
    out = nav.respond("download rainfall data from Hurricane Lowell", [], {"path": "/"})
    assert out["intent"] == "navigate"
    assert [a["type"] for a in out["actions"]] == ["navigate", "open"]
    assert out["actions"][0]["path"] == "/viewer/rainfall/day/2026-09-07/kauai"
    assert [a["url"] for a in out["alternatives"]] == ["/data", "https://hawaiimesonet.app/"]
    assert out["minimize"] is True
    assert llm.calls[0][1][-1] == {"role": "user", "content": "download rainfall data from Hurricane Lowell"}


def test_analysis_gets_a_server_built_handoff():
    nav, _ = make({"intent": "analysis", "reply": "", "actions": [{"type": "handoff", "url": "https://phish.example/"}], "alternatives": []})
    out = nav.respond("what was the total rainfall at Hilo during Lowell?")
    assert out["intent"] == "analysis"
    assert out["actions"] == [{"type": "handoff", "url": "https://ai.example.org/?ask=what%20was%20the%20total%20rainfall%20at%20Hilo%20during%20Lowell%3F"}]
    # from a viewer page the hand-off carries what the visitor was looking at
    nav2, _ = make({"intent": "analysis", "reply": "", "actions": [], "alternatives": []})
    out2 = nav2.respond("which gauge had the most?", [], {"path": "/viewer/rainfall/day/2026-09-07/kauai", "viewer": {"dataset": "rainfall", "period": "day", "date": "2026-09-07", "extent": "kauai"}})
    assert "I%20was%20looking%20at%20the%20Rainfall%20map%20for%202026-09-07%2C%20kauai" in out2["actions"][0]["url"]
    assert "analysis" in out["reply"]
    assert out["minimize"] is False


def test_navigate_without_a_valid_target_degrades_to_info_with_alternatives():
    nav, _ = make({"intent": "navigate", "reply": "", "actions": [{"type": "navigate", "path": "/nowhere"}], "alternatives": []})
    out = nav.respond("mesonet stations")
    assert out["intent"] == "info"
    assert out["alternatives"] and out["alternatives"][0]["url"] == "/mesonet"


def test_model_failure_falls_back_to_keyword_search():
    nav, _ = make(error=TimeoutError("slow"))
    out = nav.respond("Hurricane Lowell rainfall")
    assert out["intent"] == "info" and out["error"] == "TimeoutError"
    assert out["alternatives"][0]["url"] == "/extreme-events#lowell"


def test_history_is_trimmed_and_typed():
    nav, llm = make({"intent": "info", "reply": "ok", "actions": [], "alternatives": []})
    hist = [{"role": "user", "content": f"m{i}"} for i in range(20)] + [{"role": "system", "content": "ignored"}, "junk"]
    nav.respond("hello", hist)
    msgs = llm.calls[0][1]
    assert len(msgs) == 9 and all(m["role"] in ("user", "assistant") for m in msgs)


def test_describe_view_matches_the_frontend_wording():
    assert describe_view({"dataset": "rainfall", "period": "day", "date": "2026-09-07", "extent": "kauai"}) == "Rainfall, September 7, 2026, Kauaʻi"
    assert describe_view({"dataset": "spi-3", "period": "month", "date": "2026-08", "extent": "statewide"}) == "Drought index SPI 3-month, August 2026, Statewide"


def test_today_is_hawaii_time_when_not_overridden():
    import datetime as dt
    from zoneinfo import ZoneInfo
    nav = Navigator(FakeLLM({}), SEED_CATALOG)
    assert nav.today() == dt.datetime.now(ZoneInfo("Pacific/Honolulu")).date()


def test_prompt_lists_stations_for_links():
    nav = Navigator(FakeLLM({}), SEED_CATALOG, today=dt.date(2026, 9, 25), stations=[{"id": "0115", "name": "Hilo", "island": "hawaii", "status": "active"}, {"id": "0999", "name": "Planned", "island": "maui", "status": "planned"}])
    s = nav.system_prompt({"path": "/"})
    assert "hawaii: 0115 Hilo" in s and "0999" not in s and "/mesonet?viewer=live" in s
