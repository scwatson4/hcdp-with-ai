"""The AI summary and the follow-ups (13 Oct): grounding, validation and the two endpoints, with a fake model."""
import json
import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as appmod  # noqa: E402
from llm import FOLLOWUPS_SYSTEM, SUMMARY_SYSTEM  # noqa: E402
from navigator import Navigator, load_catalog  # noqa: E402
from summary import EMPTY, Summarizer, clean_cited, clean_followups, clean_summary, empty_summary, extract_cites, page_hint, split_sentences  # noqa: E402

LOWELL = "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/"
THREE = "You asked for the Hurricane Lowell report. This section tells the story of the storm, 6 to 8 September 2026, with its official HCDP links and viewer maps. Open the report or a rainfall map for 7 September below."
CITED = "You asked for the Hurricane Lowell report. [1] This section tells the story of the storm, 6 to 8 September 2026, with its official HCDP links and viewer maps. [1, 2] Open the report or a rainfall map for 7 September below."
MORE = "The official links card lists the report, the Mesonet viewer and two UH News stories. [1][2] Day chips open the viewer on 6, 7 and 8 September. The peak-day button opens Kauaʻi's rainfall for 7 September. [9]"
FOLLOWUPS = ["Show me the daily rainfall map for 7 September", "Where can I download these station totals?", "Take me to the Lowell Mesonet viewer"]
EMPTY_OUT = {"summary": "", "chunks": [], "cites": [], "more": [], "more_cites": [], "sources": [], "followups": []}


class FakeLLM:
    configured = True

    def __init__(self, payload):
        self.payload, self.calls = payload, []

    def complete(self, system, user, max_completion_tokens=None):
        self.calls.append((system, user, max_completion_tokens))
        if isinstance(self.payload, Exception):
            return None
        return self.payload


def make(payload):
    llm = FakeLLM(payload)
    nav = Navigator(None, load_catalog())
    return Summarizer(nav, llm), llm


# ── the helpers ───────────────────────────────────────────────────────────────
def test_sentences_are_split_cleaned_and_capped_at_sixty_words():
    assert split_sentences(THREE) == [THREE.split(". ")[0] + ".", THREE.split(". ")[1] + ".", THREE.split(". ")[2]]
    assert clean_summary("**Bold** [link](https://x.y) and https://example.com/a?b=1 end. Second one!") == ["Bold link and end.", "Second one!"]
    assert clean_summary("Kauaʻi had 23 in. of rain on 7 Sept. The map shows it.") == ["Kauaʻi had 23 in. of rain on 7 Sept.", "The map shows it."]   # abbreviations stay
    long = " ".join(["word"] * 40) + ". " + " ".join(["More"] * 30) + ". Tail."
    assert clean_summary(long) == [" ".join(["word"] * 40) + "."]      # the second sentence would break the budget
    only = " ".join(["w"] * 70) + "."
    assert clean_summary(only) == [" ".join(["w"] * 60) + "…"]          # one over-long sentence is cut hard
    assert clean_summary("") == [] and clean_summary(None) == [] and clean_summary(42) == []


def test_citation_markers_are_pulled_out_and_aligned_with_the_chunks():
    chunks, cites = clean_cited(CITED, 60, 3)
    assert chunks == split_sentences(THREE) and cites == [[1], [1, 2], []]
    assert "[" not in " ".join(chunks)
    more, more_cites = clean_cited(MORE, 80, 3)
    assert len(more) == 3 and more_cites == [[1, 2], [], []]            # [9] names no source: dropped
    assert more[0] == "The official links card lists the report, the Mesonet viewer and two UH News stories."
    assert extract_cites("Open the map [2][2] today [4].", 3) == ("Open the map today.", [2])
    assert clean_cited("[1] [2]", 60, 2) == ([], [])                    # markers alone are not a sentence
    assert clean_cited(CITED, 60, 0)[1] == [[], [], []]                 # no sources → no cites
    assert clean_summary(CITED) == split_sentences(THREE)


def test_followups_are_strings_short_distinct_and_at_most_three():
    assert clean_followups(FOLLOWUPS + ["A fourth"]) == FOLLOWUPS
    assert clean_followups(["- Show me the map", "show me the map [1]", "x" * 91, "", None, 3, "**Where** is the API?"]) == ["Show me the map", "Where is the API?"]
    assert clean_followups("not a list") == [] and clean_followups(None) == []


def test_page_hint_knows_maps_pages_and_storms():
    assert page_hint("/viewer/rainfall/day/2026-09-07/kauai", None).startswith("an interactive climate map")
    assert page_hint("/data", {"kind": "tool"}).startswith("the Access Data page")
    assert page_hint("/extreme-events/lowell", {"kind": "event"}).startswith("a storm's report: HCDP's interactive storm report")
    assert page_hint("/tools/h-rip", {"kind": "tool"}).startswith("a tool's tile")
    assert page_hint("/about/team", None) == "a page on this site"


# ── the summarizer ────────────────────────────────────────────────────────────
def test_summary_is_grounded_split_into_chunks_with_catalog_sources_and_validated_followups():
    s, llm = make({"summary": CITED, "more": MORE, "followups": FOLLOWUPS + ["one too many"]})
    out = s.summarize("Take me to the Hurricane Lowell report", "Taking you to the Hurricane Lowell report.", "/extreme-events/lowell", "navigate")
    assert set(out) == set(EMPTY_OUT)
    assert out["chunks"] == split_sentences(THREE) and len(out["chunks"]) == 3
    assert out["cites"] == [[1], [1, 2], []] and out["summary"] == THREE                  # the markers are stripped from the text
    assert len(out["more"]) == 3 and out["more_cites"] == [[1, 2], [], []] and "[" not in " ".join(out["more"])
    assert out["sources"][0] == {"title": "Hurricane Lowell report", "url": LOWELL}
    assert len(out["sources"]) == 3 and all(x["url"].startswith("https://www.hawaii.edu/") for x in out["sources"])
    assert out["followups"] == FOLLOWUPS
    system, user, _ = llm.calls[0]
    assert system == SUMMARY_SYSTEM and '"more"' in system and "square brackets" in system
    assert "Visitor's ask: Take me to the Hurricane Lowell report" in user and "Navigator's reply: Taking you to the Hurricane Lowell report." in user
    assert "Page title: Hurricane Lowell report" in user and "What it is: HCDP's story of Hurricane Lowell" in user and "When it is the answer:" in user
    assert "Page kind: a storm's report" in user
    assert "Sources (cite by number):\n1. Hurricane Lowell report\n2. Hurricane Lowell Mesonet Viewer\n3. " in user   # titles only, numbered
    assert LOWELL not in user                                                               # never the URLs


def test_viewer_summary_tells_the_model_what_the_map_shows_and_leads_with_visualize_data():
    s, llm = make({"summary": "You asked for Kauaʻi's rain on 7 September. The map shows that day's gridded rainfall. Turn on the stations or change the date.", "followups": FOLLOWUPS})
    out = s.summarize("rain on Kauai on Sept 7", "Taking you to the map.", "/viewer/rainfall/day/2026-09-07/kauai", "navigate")
    assert "The map shows: Rainfall, September 7, 2026, Kauaʻi" in llm.calls[0][1] and "Page kind: an interactive climate map" in llm.calls[0][1]
    assert out["sources"][0]["title"].startswith("Visualize Data") and out["sources"][1]["url"] == LOWELL   # Access Data's map tool (18 Oct)
    assert len(out["chunks"]) == 3 and out["cites"] == [[], [], []] and out["more"] == [] and out["more_cites"] == []


def test_summary_is_empty_for_off_topic_analysis_bad_paths_and_model_failures():
    s, llm = make({"summary": THREE, "followups": FOLLOWUPS})
    empty = EMPTY_OUT
    assert s.summarize("cookie recipe", "I can only help with HCDP…", "/data", "off_topic") == empty and llm.calls == []   # the model is never asked
    assert s.summarize("total rainfall?", "This is better answered…", "/data", "analysis") == empty and llm.calls == []
    assert s.summarize("x", "y", "/nowhere", "navigate") == empty and s.summarize("x", "y", "https://evil.example/", "navigate") == empty and lls(s, "") == empty
    assert llm.calls == []
    for bad in ({"summary": "", "followups": FOLLOWUPS}, {"followups": FOLLOWUPS}, {"summary": 42}, None, "prose", []):
        s2, _ = make(bad)
        assert s2.summarize("Lowell", "Taking you there.", "/extreme-events/lowell", "navigate") == empty, bad
    s3, _ = make(RuntimeError("timeout"))
    assert s3.summarize("Lowell", "Taking you there.", "/extreme-events/lowell", "navigate") == empty
    s4 = Summarizer(Navigator(None, load_catalog()), None)
    assert s4.summarize("Lowell", "Taking you there.", "/extreme-events/lowell", "navigate") == empty
    assert EMPTY == empty and empty_summary() == empty and empty_summary() is not EMPTY


def lls(s, path):
    return s.summarize("x", "y", path, "navigate")


def test_followups_for_runs_without_a_summary():
    s, llm = make({"followups": FOLLOWUPS})
    assert s.followups_for("/viewer/rainfall/day/2026-09-07/kauai") == FOLLOWUPS
    system, user, budget = llm.calls[0]
    assert system == FOLLOWUPS_SYSTEM and "The map shows: Rainfall, September 7, 2026, Kauaʻi" in user and budget == 200
    assert s.followups_for("/extreme-events/lowell", {"viewer": None}) == FOLLOWUPS
    assert s.followups_for("/nowhere") == FOLLOWUPS[:0] and len(llm.calls) == 2   # not asked for an address the site lacks
    s2, _ = make({"followups": "nope"})
    assert s2.followups_for("/data") == []
    s3, _ = make(None)
    assert s3.followups_for("/data") == []


# ── the endpoints ─────────────────────────────────────────────────────────────
def client(payload):
    appmod.app.state.navigator = Navigator(None, load_catalog())
    appmod.app.state.summarizer = Summarizer(appmod.app.state.navigator, FakeLLM(payload))
    appmod.app.state.summary_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.followups_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    return TestClient(appmod.app)


def test_summary_endpoint_contract():
    c = client({"summary": THREE, "followups": FOLLOWUPS})
    r = c.post("/api/summary", json={"message": "Take me to the Hurricane Lowell report", "reply": "Taking you to the Hurricane Lowell report.", "path": "/extreme-events/lowell", "intent": "navigate"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == set(EMPTY_OUT) | {"request_id"}   # P4 A: a written overview carries a request id for "Wrong page?" reports
    assert re.fullmatch(r"[0-9a-f]{32}", body["request_id"])
    assert body["chunks"] == split_sentences(THREE) and body["sources"][0]["url"] == LOWELL and body["followups"] == FOLLOWUPS
    assert body["cites"] == [[], [], []] and body["more"] == [] and body["more_cites"] == []
    # off_topic and analysis never get a summary; neither does a foreign address; all are 200 with everything empty
    empty = EMPTY_OUT
    assert c.post("/api/summary", json={"message": "cookie recipe", "reply": "…", "path": "/data", "intent": "off_topic"}).json() == empty
    assert c.post("/api/summary", json={"message": "x", "reply": "…", "path": "/data", "intent": "analysis"}).json() == empty
    assert c.post("/api/summary", json={"message": "x", "reply": "…", "path": "https://evil.example/", "intent": "navigate"}).json() == empty
    assert c.post("/api/summary", json={"message": "x", "reply": "…", "path": "/nowhere", "intent": "navigate"}).json() == empty
    assert appmod.app.state.summarizer.llm.calls and len(appmod.app.state.summarizer.llm.calls) == 1   # only the real one reached the model
    assert c.post("/api/summary", json={"message": "x" * 501, "path": "/data"}).status_code == 422


def test_summary_endpoint_is_empty_not_an_error_when_the_model_fails_or_the_limiter_is_spent():
    empty = EMPTY_OUT
    c = client(RuntimeError("slow"))
    r = c.post("/api/summary", json={"message": "Lowell", "reply": "Taking you there.", "path": "/extreme-events/lowell", "intent": "navigate"})
    assert r.status_code == 200 and r.json() == empty
    c = client({"summary": THREE, "followups": FOLLOWUPS})
    appmod.app.state.summary_limiter = appmod.RateLimiter(per_minute=1, per_hour=10, global_per_day=100)
    assert c.post("/api/summary", json={"message": "a", "reply": "b", "path": "/data", "intent": "navigate"}).json()["chunks"]
    assert c.post("/api/summary", json={"message": "a", "reply": "b", "path": "/data", "intent": "navigate"}).json() == empty
    appmod.app.state.summarizer = None
    assert c.post("/api/summary", json={"message": "a", "reply": "b", "path": "/data", "intent": "navigate"}).json() == empty


def test_followups_endpoint_is_reserved_but_works():
    c = client({"followups": FOLLOWUPS})
    r = c.post("/api/followups", json={"path": "/viewer/rainfall/day/2026-09-07/kauai"})
    assert r.status_code == 200 and r.json() == {"followups": FOLLOWUPS}
    assert c.post("/api/followups", json={"path": "/nowhere"}).json() == {"followups": []}
    assert c.post("/api/followups", json={"path": "https://evil.example/"}).json() == {"followups": []}
    assert c.post("/api/followups", json={"path": "/data", "context": {"viewer": None}}).json() == {"followups": FOLLOWUPS}
    appmod.app.state.followups_limiter = appmod.RateLimiter(per_minute=1, per_hour=10, global_per_day=100)
    assert c.post("/api/followups", json={"path": "/data"}).json() == {"followups": FOLLOWUPS}
    assert c.post("/api/followups", json={"path": "/data"}).json() == {"followups": []}
    # the summary limiter is separate from the follow-ups limiter and from the navigator's
    assert appmod.app.state.summary_limiter is not appmod.app.state.followups_limiter is not appmod.app.state.limiter


def test_the_model_is_told_the_latest_dates_for_dated_followups():
    """The date rule (13 Oct): a follow-up that names a date uses yesterday (daily) or the last complete month (monthly)."""
    import datetime as dt
    llm = FakeLLM({"summary": THREE, "followups": FOLLOWUPS})
    nav = Navigator(None, load_catalog(), today=dt.date(2026, 10, 13))
    s = Summarizer(nav, llm)
    s.summarize("rain", "Taking you there.", "/viewer/rainfall/day/2026-10-12/kauai", "navigate")
    system, user, _ = llm.calls[0]
    assert "Dates: today is 2026-10-13; the newest daily map is 2026-10-12 (yesterday); the newest monthly map and summary are for September 2026 (2026-09, the last complete month)." in user
    assert "yesterday for a daily map, the last complete month" in system
    s.followups_for("/data")
    assert "the newest daily map is 2026-10-12" in llm.calls[1][1] and "last complete month" in FOLLOWUPS_SYSTEM
    # the month boundary and New Year
    assert Summarizer(Navigator(None, load_catalog(), today=dt.date(2026, 1, 1)), llm).dates_line() == "Dates: today is 2026-01-01; the newest daily map is 2025-12-31 (yesterday); the newest monthly map and summary are for December 2025 (2025-12, the last complete month)."
    assert "2026-02-28 (yesterday)" in Summarizer(Navigator(None, load_catalog(), today=dt.date(2026, 3, 1)), llm).dates_line()
