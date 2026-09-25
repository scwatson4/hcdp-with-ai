import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as appmod  # noqa: E402


class StubNavigator:
    catalog = [{"id": "x", "title": "X"}]

    def respond(self, message, history, context):
        return {"intent": "info", "reply": f"echo {message} on {context.get('path')}", "actions": [], "alternatives": [], "minimize": False, "history_len": len(history)}


def client():
    appmod.app.state.navigator = StubNavigator()
    return TestClient(appmod.app)


def test_navigate_roundtrip():
    c = client()
    r = c.post("/api/navigate", json={"message": "hi", "history": [{"role": "user", "content": "a"}] * 12, "context": {"path": "/data"}})
    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == "echo hi on /data" and body["history_len"] == 12


def test_navigate_rejects_empty_and_huge_messages():
    c = client()
    assert c.post("/api/navigate", json={"message": ""}).status_code == 422
    assert c.post("/api/navigate", json={"message": "x" * 501}).status_code == 422


def test_raster_validates_before_touching_the_network():
    c = client()
    assert c.get("/api/raster", params={"dataset": "wind", "period": "day", "date": "2026-09-01"}).status_code == 400
    assert c.get("/api/raster", params={"dataset": "humidity", "period": "month", "date": "2026-09"}).status_code == 400
    assert c.get("/api/raster", params={"dataset": "rainfall", "period": "day", "date": "2026-09", "extent": "oahu"}).status_code == 400
    assert c.get("/api/raster", params={"dataset": "rainfall", "period": "day", "date": "2026-09-01", "extent": "bigisland"}).status_code == 400
    assert appmod.raster_params("temperature-max", "month", "2026-08", "maui") == {"datatype": "temperature", "aggregation": "max", "period": "month", "date": "2026-08", "extent": "mn", "returnEmptyNotFound": "true"}


def test_health_and_catalog():
    c = client()
    h = c.get("/api/health").json()
    assert h["ok"] is True and h["catalog_entries"] == 1 and "model" in h
    assert c.get("/api/catalog").json()["entries"][0]["id"] == "x"


def test_unknown_api_path_is_404_not_index():
    c = client()
    assert c.get("/api/nope").status_code == 404
