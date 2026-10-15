"""Wrong-page feedback (P4 A, 13 Oct): the store, the two visitor endpoints and the admin view behind ADMIN_KEY."""
import csv
import io
import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as appmod  # noqa: E402
from feedback import CSV_HEADER, FeedbackStore  # noqa: E402
from navigator import Navigator, load_catalog  # noqa: E402

HEX32 = re.compile(r"^[0-9a-f]{32}$")
REPORT = {"ask": "fire", "reply": "Taking you to the ignition map.", "destination": "/viewer/ignition/day/2026-10-12/statewide", "overview_id": "a" * 32,
          "wanted": {"title": "Fire ignition probability and 1–3 day predictions", "url": "/data"}}


def client(tmp_path, key="", store=True, db="feedback.sqlite"):
    appmod.app.state.navigator = Navigator(None, load_catalog())
    appmod.app.state.feedback = FeedbackStore(tmp_path / db) if store else None
    appmod.app.state.feedback_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.feedback_items_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.admin_key = key
    return TestClient(appmod.app)


# The review-period feedback items (F1–F5): a one-tap thumbs up with the exchange, a 👎 that named the wanted page, a note on a
# selected passage, and a note from the tab.
UP = {"kind": "thumbs", "rating": "up", "feature": "answer", "page": {"path": "/data", "title": "Access Data"}, "ask": "where are the downloads", "reply": "Taking you to Access Data.", "reviewer_name": "Ikaika"}
DOWN = {"kind": "thumbs", "rating": "down", "feature": "overview", "page": {"path": "/mesonet", "title": "Hawaiʻi Mesonet"}, "ask": "station data", "reply": "Opening the Mesonet.",
        "overview_id": "b" * 32, "wanted": {"title": "Access Data", "url": "/data"}, "text": "I wanted the station CSVs, not the live dashboard.", "reviewer_name": "Ikaika"}
SEL = {"kind": "selection", "feature": "page", "page": {"path": "/about", "title": "About"}, "quote": "The HCDP was founded in 2019", "text": "The year is wrong — 2020.", "reviewer_name": "Leilani"}
TAB = {"kind": "tab", "feature": "viewer", "page": {"path": "/viewer/rainfall/day/2026-09-07/kauai", "title": "Rainfall"}, "text": "The legend hides the compass on my phone.", "reviewer_name": "Leilani"}


# ── the store ─────────────────────────────────────────────────────────────────
def test_store_records_attaches_once_and_lists_newest_first(tmp_path):
    s = FeedbackStore(tmp_path / "f.sqlite")
    assert s.count() == 0 and s.rows() == []
    a = s.record("fire", "Taking you there.", "/viewer/ignition/day/2026-10-12/statewide", "x" * 32, {"title": "Access Data", "url": "/data", "text": None})
    b = s.record("rain", "Opening the map.", "/data", None, {"title": None, "url": None, "text": "the Lowell wind map"})
    assert HEX32.match(a) and HEX32.match(b) and a != b
    assert s.count() == 2
    rows = s.rows()
    assert [r["id"] for r in rows] == [b, a]                                   # newest first
    assert rows[1]["wanted_url"] == "/data" and rows[1]["wanted_title"] == "Access Data" and rows[1]["overview_id"] == "x" * 32
    assert rows[0]["wanted_text"] == "the Lowell wind map" and rows[0]["wanted_url"] is None and rows[0]["chose_path"] is None
    assert rows[0]["created_at"].endswith("Z")
    assert s.attach_choice(a, "/extreme-events/lowell") is True
    assert s.attach_choice(a, "/somewhere-else") is False                      # once
    assert s.attach_choice("nope", "/data") is False and s.attach_choice("f" * 32, "/data") is False
    assert s.rows()[1]["chose_path"] == "/extreme-events/lowell" and s.rows()[1]["chose_at"]
    text = s.csv()
    assert text.startswith("﻿")
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    head, *body = list(reader)
    assert head == CSV_HEADER and len(body) == 2 and body[0][0] == b and body[1][9] == "/extreme-events/lowell"
    # a second store on the same file sees the rows (two uvicorn workers share one file)
    assert FeedbackStore(tmp_path / "f.sqlite").count() == 2


# ── the visitor endpoints ─────────────────────────────────────────────────────
def test_wrong_page_report_and_chose(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/feedback/wrong-page", json=REPORT)
    assert r.status_code == 200 and HEX32.match(r.json()["id"]) and r.headers["cache-control"] == "no-store"
    fid = r.json()["id"]
    row = appmod.app.state.feedback.rows()[0]
    assert row["ask"] == "fire" and row["destination"] == REPORT["destination"] and row["wanted_url"] == "/data" and row["overview_id"] == "a" * 32
    assert set(row) == {"id", "created_at", "ask", "reply", "destination", "overview_id", "wanted_title", "wanted_url", "wanted_text", "chose_path", "chose_at"}   # no address, no agent
    # the next navigation, attached once
    assert c.post(f"/api/feedback/wrong-page/{fid}/chose", json={"path": "/data"}).json() == {"ok": True}
    assert c.post(f"/api/feedback/wrong-page/{fid}/chose", json={"path": "/mesonet"}).json() == {"ok": False}
    assert appmod.app.state.feedback.rows()[0]["chose_path"] == "/data"
    # an HCDP url the navigator allows counts as a place; anything else does not
    r2 = c.post("/api/feedback/wrong-page", json={**REPORT, "wanted": {"text": "the Lowell wind map"}}).json()
    assert c.post(f"/api/feedback/wrong-page/{r2['id']}/chose", json={"path": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/"}).json() == {"ok": True}
    assert c.post(f"/api/feedback/wrong-page/{r2['id']}/chose", json={"path": "https://evil.example/"}).status_code == 400
    assert c.post("/api/feedback/wrong-page/not-an-id/chose", json={"path": "/data"}).status_code == 404
    assert c.post(f"/api/feedback/wrong-page/{'0' * 32}/chose", json={"path": "/data"}).json() == {"ok": False}


def test_wrong_page_validation_limits_and_unavailable_store(tmp_path):
    c = client(tmp_path)
    assert c.post("/api/feedback/wrong-page", json={**REPORT, "destination": "https://evil.example/"}).status_code == 400
    assert c.post("/api/feedback/wrong-page", json={**REPORT, "wanted": {"title": "x"}}).status_code == 400              # neither url nor text
    assert c.post("/api/feedback/wrong-page", json={**REPORT, "wanted": {"url": "https://evil.example/"}}).status_code == 400
    assert c.post("/api/feedback/wrong-page", json={**REPORT, "wanted": {"url": "javascript:alert(1)"}}).status_code == 400
    assert c.post("/api/feedback/wrong-page", json={**REPORT, "ask": "x" * 501}).status_code == 422
    assert c.post("/api/feedback/wrong-page", json={**REPORT, "wanted": {"text": "x" * 501}}).status_code == 422
    assert c.post("/api/feedback/wrong-page", json={**REPORT, "wanted": {"text": "  "}}).status_code == 400
    assert appmod.app.state.feedback.count() == 0
    appmod.app.state.feedback_limiter = appmod.RateLimiter(per_minute=1, per_hour=10, global_per_day=100)
    assert c.post("/api/feedback/wrong-page", json=REPORT).status_code == 200
    assert c.post("/api/feedback/wrong-page", json=REPORT).status_code == 429
    c2 = client(tmp_path, store=False)
    assert c2.post("/api/feedback/wrong-page", json=REPORT).status_code == 503


# ── the admin view ────────────────────────────────────────────────────────────
def test_admin_view_is_404_without_a_key_401_with_the_wrong_one_and_lists_newest_first(tmp_path):
    c = client(tmp_path, key="")
    c.post("/api/feedback/wrong-page", json=REPORT)
    assert c.get("/api/admin/feedback").status_code == 404                                     # unset → the view does not exist
    assert c.get("/api/admin/feedback", headers={"X-Admin-Key": "anything"}).status_code == 404
    assert c.get("/api/admin/feedback.csv", headers={"X-Admin-Key": "anything"}).status_code == 404
    h = c.get("/api/health").json()["feedback"]
    assert h["enabled"] is False and h["store"] is True and h["stored"] == 1
    c = client(tmp_path, key="correct-horse", db="keyed.sqlite")
    a = c.post("/api/feedback/wrong-page", json=REPORT).json()["id"]
    b = c.post("/api/feedback/wrong-page", json={**REPORT, "ask": "rain", "wanted": {"text": "the Lowell wind map"}}).json()["id"]
    c.post(f"/api/feedback/wrong-page/{b}/chose", json={"path": "/extreme-events/lowell"})
    assert c.get("/api/admin/feedback").status_code == 401
    r = c.get("/api/admin/feedback", headers={"X-Admin-Key": "wrong"})
    assert r.status_code == 401 and r.json()["detail"] == "Not authorised"
    r = c.get("/api/admin/feedback", headers={"X-Admin-Key": "correct-horse"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["count"] == 2 and [x["id"] for x in body["rows"]] == [b, a]
    assert body["rows"][0]["wanted_text"] == "the Lowell wind map" and body["rows"][0]["chose_path"] == "/extreme-events/lowell"
    assert c.get("/api/health").json()["feedback"] == {"enabled": True, "store": True, "stored": 2, "items": 0}
    assert "correct-horse" not in c.get("/api/health").text
    # the CSV: a header, newest first, as an attachment
    r = c.get("/api/admin/feedback.csv", headers={"X-Admin-Key": "correct-horse"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    assert rows[0] == CSV_HEADER and rows[0][1] == "when" and rows[0][9] == "chose_instead"
    assert rows[1][0] == b and rows[1][2] == "rain" and rows[2][0] == a
    assert c.get("/api/admin/feedback.csv", headers={"X-Admin-Key": "wrong"}).status_code == 401
    # the SPA never serves these paths as the index
    assert c.get("/api/admin/nothing").status_code == 404


# ── the review-period feedback (F1–F5): the table ─────────────────────────────
def test_the_feedback_table_has_the_contract_columns_and_nothing_about_the_visitor(tmp_path):
    import sqlite3
    FeedbackStore(tmp_path / "f.sqlite")
    with sqlite3.connect(tmp_path / "f.sqlite") as c:
        cols = [r[1] for r in c.execute("PRAGMA table_info(feedback)").fetchall()]
    assert cols == ["id", "created_at", "kind", "rating", "feature", "page_path", "page_title", "quote", "ask", "reply", "overview_id", "wanted", "text",
                    "reviewer_name", "status", "admin_note", "updated_at"]
    assert not any(k in c for c in cols for k in ("ip", "agent", "cookie", "host"))


def test_an_older_wrong_page_table_gains_the_triage_columns(tmp_path):
    import sqlite3
    with sqlite3.connect(tmp_path / "old.sqlite") as c:   # the P4 A schema as it shipped on 13 Oct
        c.execute("CREATE TABLE wrong_page (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ask TEXT, reply TEXT, destination TEXT, overview_id TEXT, "
                  "wanted_title TEXT, wanted_url TEXT, wanted_text TEXT, chose_path TEXT, chose_at TEXT)")
        c.execute("INSERT INTO wrong_page (id, created_at, ask, destination, wanted_text) VALUES (?, '2026-10-13T20:00:00Z', 'fire', '/data', 'the fire map')", ("c" * 32,))
    s = FeedbackStore(tmp_path / "old.sqlite")
    (row,) = s.review()
    assert row["id"] == "c" * 32 and row["kind"] == "wrong_page" and row["status"] == "new" and row["admin_note"] is None
    assert row["wanted"] == {"text": "the fire map"} and row["page_path"] == "/data" and row["feature"] == "navigation"
    assert s.rows()[0]["ask"] == "fire"                                                       # the P4 A view is unchanged


def test_store_adds_lists_mine_and_others_renames_and_triages(tmp_path):
    s = FeedbackStore(tmp_path / "f.sqlite")
    item = lambda d: {"kind": d["kind"], "rating": d.get("rating"), "feature": d["feature"], "page_path": d["page"]["path"], "page_title": d["page"]["title"],  # noqa: E731
                      "quote": d.get("quote"), "ask": d.get("ask"), "reply": d.get("reply"), "overview_id": d.get("overview_id"), "wanted": d.get("wanted"),
                      "text": d.get("text"), "reviewer_name": d.get("reviewer_name")}
    up, down, sel, tab = (s.add(item(d)) for d in (UP, DOWN, SEL, TAB))
    wp = s.record("fire", "Taking you there.", "/viewer/ignition/day/2026-10-12/statewide", None, {"title": "Access Data", "url": "/data", "text": None})
    assert all(HEX32.match(x) for x in (up, down, sel, tab, wp)) and s.count_items() == 4 and s.count() == 1
    mine = s.mine("ikaika")                                                                   # by name, case-insensitive, newest first
    assert [r["id"] for r in mine] == [down, up]
    assert mine[0]["wanted"] == {"title": "Access Data", "url": "/data"} and mine[0]["status"] == "new" and "admin_note" not in mine[0]
    assert mine[0]["title"] == "I wanted the station CSVs, not the live dashboard." and mine[1]["title"] == "Thumbs up on an AI answer"
    assert s.mine("") == [] and s.mine("nobody") == []
    others = s.others("Ikaika")                                                               # everyone else: titles + status, never a name
    assert {r["id"] for r in others} == {sel, tab, wp}
    assert all(set(r) == {"id", "created_at", "kind", "rating", "feature", "page_path", "title", "status"} for r in others)
    assert next(r for r in others if r["id"] == wp)["title"] == "Wrong page — wanted Access Data"
    assert "Leilani" not in str(others)
    assert s.rename("leilani", "Leilani K.") == 2 and [r["id"] for r in s.mine("Leilani K.")] == [tab, sel] and s.mine("Leilani") == []
    assert s.rename("", "x") == 0 and s.rename("x", " ") == 0
    # the team's triage, on either table
    r = s.set_status(sel, "fixed", "Corrected the year on the About page.")
    assert r["status"] == "fixed" and r["admin_note"] == "Corrected the year on the About page." and r["updated_at"]
    r = s.set_status(wp, "reviewed")
    assert r["kind"] == "wrong_page" and r["status"] == "reviewed" and r["admin_note"] is None
    assert s.set_status(wp, admin_note="  ")["admin_note"] is None                            # an empty note clears it
    assert s.set_status(sel, "maybe") is None and s.set_status("f" * 32, "fixed") is None and s.set_status("nope", "fixed") is None
    # the unified review list and its filters
    stamps = [x["created_at"] for x in s.review()]
    assert len(stamps) == 5 and stamps == sorted(stamps, reverse=True) and stamps[0].endswith("Z") and "." in stamps[0]   # newest first, ms precision
    assert {x["id"] for x in s.review(kind="thumbs")} == {up, down}
    assert {x["id"] for x in s.review(feature="viewer")} == {tab}
    assert {x["id"] for x in s.review(status="fixed")} == {sel}
    assert {x["id"] for x in s.review(kind="wrong_page", status="reviewed")} == {wp}
    counts = s.review_counts()
    assert counts["total"] == 5 and counts["by_status"] == {"fixed": 1, "new": 3, "reviewed": 1}
    assert counts["by_kind"] == {"selection": 1, "tab": 1, "thumbs": 2, "wrong_page": 1}
    assert counts["thumbs"] == {"up": 1, "down": 1, "by_feature": {"answer": {"up": 1, "down": 0}, "overview": {"up": 0, "down": 1}}}
    # the CSV over the unified rows
    from feedback import REVIEW_CSV_HEADER
    text = FeedbackStore.review_csv(s.review())
    head, *body = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    assert text.startswith("﻿") and head == REVIEW_CSV_HEADER and len(body) == 5
    sel_row = next(b for b in body if b[0] == sel)
    assert sel_row[head.index("quote")] == SEL["quote"] and sel_row[head.index("status")] == "fixed" and sel_row[head.index("reviewer_name")] == "Leilani K."
    down_row = next(b for b in body if b[0] == down)
    assert down_row[head.index("wanted_url")] == "/data" and down_row[head.index("wanted_title")] == "Access Data" and down_row[head.index("rating")] == "down"


def test_eval_cases_are_shaped_like_usecases_entries(tmp_path):
    import json
    from feedback import eval_cases
    from navigator import load_catalog
    catalog = load_catalog()
    usecase_keys = set().union(*(set(e) for e in json.loads((Path(__file__).resolve().parents[1] / "data" / "usecases.json").read_text())["cases"]))
    s = FeedbackStore(tmp_path / "f.sqlite")
    base = {"feature": "overview", "page_path": "/mesonet", "page_title": "Hawaiʻi Mesonet", "quote": None, "reply": "Opening the Mesonet.", "overview_id": None, "reviewer_name": "Ikaika"}
    a = s.add({**base, "kind": "thumbs", "rating": "down", "ask": "station data", "wanted": {"title": "Access Data", "url": "/data"}, "text": "I wanted the CSVs."})
    s.add({**base, "kind": "thumbs", "rating": "down", "ask": "station data", "wanted": {"text": "the CSV download"}, "text": "No page fits."})   # no page → no case
    s.add({**base, "kind": "thumbs", "rating": "up", "ask": "station data", "wanted": None, "text": None})                                        # a 👍 → no case
    s.add({**base, "kind": "selection", "rating": None, "ask": None, "wanted": None, "text": "Typo."})                                            # not a navigation verdict
    lowell = next(e for e in catalog if e.get("id") == "lowell")
    b = s.record("lowell", "Opening the map.", "/viewer/rainfall/day/2026-09-07/kauai", None, {"title": lowell["title"], "url": lowell["url"], "text": None})
    c = s.record("rain on kauai", "Opening the report.", "/extreme-events/lowell", None, {"title": "Daily rainfall", "url": "/viewer/rainfall/day/2026-09-07/kauai", "text": None})
    cases = {x["id"]: x for x in eval_cases(s.review(), catalog)}
    assert set(cases) == {f"feedback-{a[:8]}", f"feedback-{b[:8]}", f"feedback-{c[:8]}"}
    for case in cases.values():
        assert set(case) <= usecase_keys | {"expected_url"}
        assert case["persona"] == "reviewer" and case["expected_intent"] == "navigate" and isinstance(case["expected_ids"], list) and case["notes"].endswith(".")
    ca = cases[f"feedback-{a[:8]}"]
    assert ca["query"] == "station data" and ca["expected_path_prefix"] == "/data" and ca["expected_ids"]
    assert "the assistant opened /mesonet" in ca["notes"] and "wanted Access Data" in ca["notes"] and "note: I wanted the CSVs." in ca["notes"]
    cb = cases[f"feedback-{b[:8]}"]
    assert cb["expected_ids"] == ["lowell"] and "expected_path_prefix" not in cb and "expected_url" not in cb
    cc = cases[f"feedback-{c[:8]}"]
    assert cc["expected_path_prefix"] == "/viewer/rainfall/day/2026-09-07/kauai" and {"lowell-rainfall-map", "rainfall-daily-map"} <= set(cc["expected_ids"])


# ── the review-period feedback: the reviewer endpoints ────────────────────────
def test_post_feedback_stores_an_item_and_validates(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/feedback", json=UP)                                                      # a one-tap 👍 needs no text
    assert r.status_code == 200 and HEX32.match(r.json()["id"]) and r.headers["cache-control"] == "no-store"
    row = appmod.app.state.feedback.find(r.json()["id"])
    assert row["kind"] == "thumbs" and row["rating"] == "up" and row["feature"] == "answer" and row["page_path"] == "/data" and row["page_title"] == "Access Data"
    assert row["ask"] == UP["ask"] and row["reply"] == UP["reply"] and row["reviewer_name"] == "Ikaika" and row["status"] == "new" and row["text"] is None
    for body in (DOWN, SEL, TAB):
        assert c.post("/api/feedback", json=body).status_code == 200
    d = appmod.app.state.feedback.mine("Ikaika")[0]
    assert d["wanted"] == {"title": "Access Data", "url": "/data"} and d["overview_id"] == "b" * 32
    assert c.post("/api/feedback", json={**TAB, "reviewer_name": ""}).status_code == 200            # anonymous is fine
    assert appmod.app.state.feedback.count_items() == 5
    bad = [
        ({**TAB, "kind": "rumour"}, 400), ({**UP, "rating": None}, 400), ({**UP, "rating": "sideways"}, 400), ({**TAB, "feature": "weather"}, 400),
        ({**TAB, "text": "   "}, 400), ({**DOWN, "text": ""}, 400),                                # text is required except for a 👍
        ({**TAB, "page": {"path": "https://evil.example/", "title": "x"}}, 400), ({**DOWN, "wanted": {"url": "https://evil.example/"}}, 400),
        ({**DOWN, "wanted": {"url": "javascript:alert(1)"}}, 400),
        ({**SEL, "quote": "x" * 501}, 422), ({**TAB, "text": "x" * 2001}, 422), ({**TAB, "reviewer_name": "x" * 61}, 422), ({**UP, "reply": "x" * 2001}, 422),
    ]
    for body, code in bad:
        assert c.post("/api/feedback", json=body).status_code == code, body
    assert appmod.app.state.feedback.count_items() == 5
    # an HCDP url the navigator allows is a fine wanted page; a 👎 may also say what it wanted in words
    lowell = "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/"
    assert c.post("/api/feedback", json={**DOWN, "wanted": {"title": "Lowell", "url": lowell}}).status_code == 200
    assert c.post("/api/feedback", json={**DOWN, "wanted": {"text": "the wind map"}}).status_code == 200


def test_mine_others_and_rename_endpoints(tmp_path):
    c = client(tmp_path)
    ids = {k: c.post("/api/feedback", json=v).json()["id"] for k, v in (("up", UP), ("down", DOWN), ("sel", SEL), ("tab", TAB))}
    r = c.get("/api/feedback/mine", params={"name": "ikaika"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    rows = r.json()["rows"]
    assert [x["id"] for x in rows] == [ids["down"], ids["up"]] and all("admin_note" not in x for x in rows) and rows[0]["title"]
    assert c.get("/api/feedback/mine").json() == {"rows": []} and c.get("/api/feedback/mine", params={"name": "  "}).json() == {"rows": []}
    o = c.get("/api/feedback/others", params={"name": "Ikaika"}).json()["rows"]
    assert {x["id"] for x in o} == {ids["sel"], ids["tab"]} and "Leilani" not in str(o) and all("reviewer_name" not in x and "text" not in x for x in o)
    assert {x["id"] for x in c.get("/api/feedback/others").json()["rows"]} == set(ids.values())     # no name → everyone, still without names
    r = c.post("/api/feedback/rename", json={"from": "Ikaika", "to": "Ikaika K."})
    assert r.status_code == 200 and r.json() == {"ok": True, "changed": 2}
    assert [x["id"] for x in c.get("/api/feedback/mine", params={"name": "Ikaika K."}).json()["rows"]] == [ids["down"], ids["up"]]
    assert c.post("/api/feedback/rename", json={"from": "", "to": "x"}).status_code == 422
    assert c.post("/api/feedback/rename", json={"from": "a", "to": "x" * 61}).status_code == 422


def test_feedback_limiter_and_unavailable_store(tmp_path):
    c = client(tmp_path)
    appmod.app.state.feedback_items_limiter = appmod.RateLimiter(per_minute=2, per_hour=10, global_per_day=100)
    assert c.post("/api/feedback", json=UP).status_code == 200
    assert c.post("/api/feedback", json=TAB).status_code == 200
    r = c.post("/api/feedback", json=SEL)
    assert r.status_code == 429 and "Wait a minute" in r.json()["detail"]
    assert c.post("/api/feedback/rename", json={"from": "Ikaika", "to": "K"}).status_code == 429
    assert c.post("/api/feedback/wrong-page", json=REPORT).status_code == 200                         # the P4 A report keeps its own limiter
    assert appmod.app.state.feedback.count_items() == 2
    c2 = client(tmp_path, store=False)
    assert c2.post("/api/feedback", json=UP).status_code == 503
    assert c2.get("/api/feedback/mine", params={"name": "Ikaika"}).status_code == 503
    assert c2.get("/api/feedback/others").status_code == 503


# ── the review-period feedback: the admin review list ─────────────────────────
def test_admin_review_list_patch_csv_and_eval_export_behind_the_key(tmp_path):
    c = client(tmp_path, key="")
    fid = c.post("/api/feedback", json=SEL).json()["id"]
    for method, url in (("get", "/api/admin/feedback/review"), ("get", "/api/admin/feedback/review.csv"), ("get", "/api/admin/feedback/evals.json")):
        assert getattr(c, method)(url, headers={"X-Admin-Key": "anything"}).status_code == 404               # no ADMIN_KEY → the view does not exist
    assert c.patch(f"/api/admin/feedback/{fid}", json={"status": "fixed"}, headers={"X-Admin-Key": "anything"}).status_code == 404
    c = client(tmp_path, key="correct-horse", db="keyed.sqlite")
    K = {"X-Admin-Key": "correct-horse"}
    ids = {k: c.post("/api/feedback", json=v).json()["id"] for k, v in (("up", UP), ("down", DOWN), ("sel", SEL), ("tab", TAB))}
    wp = c.post("/api/feedback/wrong-page", json=REPORT).json()["id"]
    for url in ("/api/admin/feedback/review", "/api/admin/feedback/review.csv", "/api/admin/feedback/evals.json"):
        assert c.get(url).status_code == 401 and c.get(url, headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert c.patch(f"/api/admin/feedback/{ids['sel']}", json={"status": "fixed"}).status_code == 401
    r = c.get("/api/admin/feedback/review", headers=K)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["count"] == 5 and body["counts"]["total"] == 5 and {x["id"] for x in body["rows"]} == {*ids.values(), wp}
    assert [x["created_at"] for x in body["rows"]] == sorted((x["created_at"] for x in body["rows"]), reverse=True)
    assert next(x for x in body["rows"] if x["id"] == wp)["kind"] == "wrong_page"
    assert body["counts"]["thumbs"]["up"] == 1 and body["counts"]["thumbs"]["down"] == 1 and body["counts"]["by_kind"]["wrong_page"] == 1
    assert {x["id"] for x in c.get("/api/admin/feedback/review", params={"kind": "thumbs"}, headers=K).json()["rows"]} == {ids["up"], ids["down"]}
    assert {x["id"] for x in c.get("/api/admin/feedback/review", params={"feature": "viewer"}, headers=K).json()["rows"]} == {ids["tab"]}
    for bad in ({"kind": "x"}, {"feature": "x"}, {"status": "x"}):
        assert c.get("/api/admin/feedback/review", params=bad, headers=K).status_code == 400
    # PATCH: a status and a note, on either table
    r = c.patch(f"/api/admin/feedback/{ids['sel']}", json={"status": "fixed", "admin_note": "Corrected."}, headers=K)
    assert r.status_code == 200 and r.json()["row"]["status"] == "fixed" and r.json()["row"]["admin_note"] == "Corrected."
    assert c.patch(f"/api/admin/feedback/{wp}", json={"status": "wontfix"}, headers=K).json()["row"]["status"] == "wontfix"
    assert c.patch(f"/api/admin/feedback/{ids['tab']}", json={"admin_note": "Next sprint."}, headers=K).json()["row"]["status"] == "new"
    assert c.patch(f"/api/admin/feedback/{ids['tab']}", json={"status": "done"}, headers=K).status_code == 400
    assert c.patch(f"/api/admin/feedback/{ids['tab']}", json={}, headers=K).status_code == 400
    assert c.patch(f"/api/admin/feedback/{'0' * 32}", json={"status": "fixed"}, headers=K).status_code == 404
    assert c.patch("/api/admin/feedback/not-an-id", json={"status": "fixed"}, headers=K).status_code == 404
    assert {x["id"] for x in c.get("/api/admin/feedback/review", params={"status": "fixed"}, headers=K).json()["rows"]} == {ids["sel"]}
    assert c.get("/api/feedback/mine", params={"name": "Leilani"}).json()["rows"][-1]["status"] == "fixed"       # the reviewer sees the status
    assert "Corrected." not in c.get("/api/feedback/mine", params={"name": "Leilani"}).text                     # but not the team's note
    # the CSV, with the same filters
    from feedback import REVIEW_CSV_HEADER
    r = c.get("/api/admin/feedback/review.csv", headers=K)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "hcdp-feedback-review.csv" in r.headers["content-disposition"]
    head, *rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    assert head == REVIEW_CSV_HEADER and len(rows) == 5 and {x[0] for x in rows} == {*ids.values(), wp}
    wrow = next(x for x in rows if x[0] == wp)
    assert wrow[head.index("kind")] == "wrong_page" and wrow[head.index("chose_instead")] == "" and wrow[head.index("status")] == "wontfix"
    head, *rows = list(csv.reader(io.StringIO(c.get("/api/admin/feedback/review.csv", params={"kind": "selection"}, headers=K).text.lstrip("﻿"))))
    assert [x[0] for x in rows] == [ids["sel"]] and rows[0][head.index("admin_note")] == "Corrected."
    # the eval export: the 👎 with a wanted page and the wrong-page report, as usecases.json-shaped cases
    r = c.get("/api/admin/feedback/evals.json", headers=K)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json") and "attachment" in r.headers["content-disposition"]
    out = r.json()
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", out["as_of"])
    assert {x["id"] for x in out["cases"]} == {f"feedback-{ids['down'][:8]}", f"feedback-{wp[:8]}"}
    down = next(x for x in out["cases"] if x["id"] == f"feedback-{ids['down'][:8]}")
    assert down["query"] == "station data" and down["expected_intent"] == "navigate" and down["expected_path_prefix"] == "/data"


# ── 15 Oct: the name picker and the admin delete ──────────────────────────────
def test_names_lists_saved_reviewer_names_newest_first_without_duplicates(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/feedback/names").json() == {"names": []}
    c.post("/api/feedback", json=SEL)                                   # Leilani
    c.post("/api/feedback", json=UP)                                    # the UP reviewer
    c.post("/api/feedback", json={**TAB, "reviewer_name": " leilani "})   # the same person, spelt differently: folded
    c.post("/api/feedback", json={**TAB, "reviewer_name": ""})            # no name: not listed
    r = c.get("/api/feedback/names")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    names = r.json()["names"]
    assert len(names) == 2 and names[0].lower() == "leilani" and names[1] == UP["reviewer_name"]


def test_admin_delete_removes_a_row_from_either_table_behind_the_key(tmp_path):
    c = client(tmp_path, key="correct-horse", db="del.sqlite")
    K = {"X-Admin-Key": "correct-horse"}
    fid = c.post("/api/feedback", json=SEL).json()["id"]
    wp = c.post("/api/feedback/wrong-page", json=REPORT).json()["id"]
    assert c.delete(f"/api/admin/feedback/{fid}").status_code == 401
    assert c.delete(f"/api/admin/feedback/{fid}", headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert c.delete("/api/admin/feedback/not-an-id", headers=K).status_code == 404
    assert c.delete(f"/api/admin/feedback/{'0' * 32}", headers=K).status_code == 404
    r = c.delete(f"/api/admin/feedback/{fid}", headers=K)
    assert r.status_code == 200 and r.json() == {"ok": True, "id": fid} and r.headers["cache-control"] == "no-store"
    assert c.delete(f"/api/admin/feedback/{wp}", headers=K).status_code == 200
    assert c.get("/api/admin/feedback/review", headers=K).json()["count"] == 0
    assert c.delete(f"/api/admin/feedback/{fid}", headers=K).status_code == 404     # gone for good

