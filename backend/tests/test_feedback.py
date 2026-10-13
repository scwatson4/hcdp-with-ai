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
    appmod.app.state.admin_key = key
    return TestClient(appmod.app)


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
    assert c.get("/api/health").json()["feedback"] == {"enabled": True, "store": True, "stored": 2}
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
