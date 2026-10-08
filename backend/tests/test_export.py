"""The native export: validation, hcdp_v2's exact payload, the streamed download, the emailed package (HCDP mocked by respx)."""
import json
import sys
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as appmod  # noqa: E402
from export import EXTENT_CODES, INSTANT_MAX_FILES, ExportError, estimate_files, options, package_group, payload, periods_between, validate, valid_email  # noqa: E402

BASE = appmod.HCDP_API_BASE
RAIN = {"dataset": "rainfall", "period": "month", "start": "2026-01", "end": "2026-08", "extents": ["statewide", "oahu"], "files": ["data_map"], "station_files": ["partial"]}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(appmod, "HCDP_TOKEN", "test-token-never-printed")
    appmod.app.state.export_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    appmod.app.state.email_limiter = appmod.RateLimiter(per_minute=100, per_hour=1000, global_per_day=10000)
    return TestClient(appmod.app)


# ----- the pure part --------------------------------------------------------------
def test_payload_is_hcdp_v2s_package_group_details_to_the_letter():
    req = validate({**RAIN, "station_files": ["partial"], "email": "ikaika@example.edu"})
    assert req["grid_files"] == ["data_map", "metadata"]          # a grid pulls its metadata in, as hcdp_v2 ticks it
    assert req["files"] == 8 * (2 * 2 + 1)                        # 8 months × (2 extents × 2 grid files + 1 station file)
    assert package_group(req) == {
        "fileData": [
            {"fileParams": {"extent": ["statewide", "oa"], "units": ["mm"]}, "files": ["data_map", "metadata"]},
            {"fileParams": {"extent": ["statewide"], "units": ["mm"], "fill": ["partial"]}, "files": ["station_data"]},
        ],
        "params": {"location": "hawaii", "datatype": "rainfall", "production": "new", "period": "month"},
        "dates": {"start": "2026-01", "end": "2026-08", "unit": "month", "interval": 1},
    }
    assert payload(req) == {"email": "ikaika@example.edu", "data": [package_group(req)]}
    # two station files: one tag per file, both fills in the params (hcdp_v2's quirk, kept)
    daily = validate({"dataset": "rainfall", "period": "day", "start": "2026-09-01", "end": "2026-09-07", "station_files": ["partial", "raw"]})
    assert package_group(daily)["fileData"] == [{"fileParams": {"extent": ["statewide"], "units": ["mm"], "fill": ["partial", "raw"]}, "files": ["station_data", "station_data"]}]
    assert daily["files"] == 7 * 2 and "email" not in payload(daily)
    temp = validate({"dataset": "temperature-max", "period": "day", "start": "2026-09-01", "end": "2026-09-01", "extents": ["hawaii", "maui", "kauai"], "files": ["se"]})
    assert package_group(temp)["params"] == {"location": "hawaii", "datatype": "temperature", "aggregation": "max", "period": "day"}
    assert package_group(temp)["fileData"][0] == {"fileParams": {"extent": ["bi", "mn", "ka"], "units": ["c"]}, "files": ["se", "metadata"]}
    legacy = validate({"dataset": "rainfall-legacy", "period": "month", "start": "1950-01", "end": "1950-12", "extents": ["statewide"], "files": ["data_map"]})
    assert package_group(legacy)["fileData"] == [{"fileParams": {"extent": ["statewide"], "units": ["mm"]}, "files": ["data_map"]}]
    assert package_group(legacy)["params"]["production"] == "legacy" and estimate_files(legacy) == 12
    assert EXTENT_CODES["molokai"] == "mn" and periods_between("2026-09-01", "2026-09-07", "day") == 7 and periods_between("2025-12", "2026-01", "month") == 2


def test_validation_refuses_what_the_form_could_not_send():
    def bad(body):
        with pytest.raises(ExportError):
            validate(body)
    bad({**RAIN, "dataset": "wind"})
    bad({**RAIN, "period": "week"})
    bad({"dataset": "rainfall-legacy", "period": "day", "start": "1950-01-01", "end": "1950-01-02", "files": ["data_map"], "extents": ["statewide"]})
    bad({**RAIN, "start": "2026-13"})
    bad({**RAIN, "start": "2026-01-01"})                                  # a monthly export takes YYYY-MM
    bad({**RAIN, "start": "2026-09", "end": "2026-01"})
    bad({**RAIN, "start": "1800-01"})                                      # 226 years of months
    bad({**RAIN, "files": ["wind_map"]})
    bad({**RAIN, "files": ["anom"], "dataset": "temperature-min"})          # temperature has no anomaly maps
    bad({**RAIN, "station_files": ["raw"]})                                 # no raw monthly station data
    bad({**RAIN, "station_files": ["partial"], "dataset": "temperature-mean"})   # mean temperature: grids only
    bad({**RAIN, "extents": []})                                           # maps need an extent
    bad({**RAIN, "extents": ["mars"]})
    bad({"dataset": "rainfall-legacy", "period": "month", "start": "1950-01", "end": "1950-12", "extents": ["oahu"], "files": ["data_map"]})   # legacy: statewide only
    bad({**RAIN, "files": [], "station_files": []})
    bad({**RAIN, "email": "not-an-address"})
    bad({**RAIN, "files": "data_map"})
    assert valid_email("a@b.co") and not valid_email("a@b") and not valid_email("a b@c.de") and not valid_email("x" * 250 + "@a.bc")
    # station files alone need no extent
    assert validate({"dataset": "rainfall", "period": "month", "start": "2026-01", "end": "2026-02", "station_files": ["partial"]})["extents"] == []


def test_options_lists_the_products_their_files_and_fills():
    o = options()
    ids = [d["id"] for d in o["datasets"]]
    assert ids == ["rainfall", "rainfall-legacy", "temperature-max", "temperature-min", "temperature-mean"]
    rain = o["datasets"][0]
    assert [f["id"] for f in rain["grid_files"]] == ["data_map", "se", "anom", "anom_se", "metadata"]
    assert rain["grid_files"][0] == {"id": "data_map", "tag": "data_map", "label": "Rainfall map", "description": "The gridded rainfall map: estimated values over the whole extent.", "type": "tif", "requires": ["metadata"]}
    assert [f["id"] for f in rain["station_fills"]["day"]] == ["partial", "raw"] and [f["id"] for f in rain["station_fills"]["month"]] == ["partial"]
    assert o["datasets"][1]["extents"] == ["statewide"] and o["datasets"][4]["station_fills"] == {"month": [], "day": []}
    assert o["instant_max_files"] == INSTANT_MAX_FILES == 150 and o["file_types"]["tif"]["ext"] == ".tif"


# ----- the routes -------------------------------------------------------------------
def test_options_endpoint(client):
    r = client.get("/api/export/options")
    assert r.status_code == 200 and r.json()["datasets"][0]["id"] == "rainfall" and "max-age" in r.headers["cache-control"]


@respx.mock
def test_instant_download_streams_the_zip_with_the_token_kept_server_side(client):
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=b"PK\x03\x04zip-bytes", headers={"content-type": "application/zip"})
    route = respx.post(f"{BASE}/genzip/instant/content").mock(side_effect=handler)
    r = client.post("/api/export/instant", json={**RAIN, "email": "ikaika@example.edu"})
    assert r.status_code == 200, r.text
    assert r.content == b"PK\x03\x04zip-bytes"
    assert r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"] == 'attachment; filename="hcdp_rainfall_month_2026-01_2026-08.zip"'
    assert r.headers["x-hcdp-files"] == "40" and r.headers["cache-control"] == "no-store" and r.headers["content-length"] == "13"
    assert seen["auth"] == "Bearer test-token-never-printed"
    assert "test-token-never-printed" not in r.text and all("test-token" not in v for v in r.headers.values())
    assert seen["body"] == {"email": "ikaika@example.edu", "data": [{
        "fileData": [{"fileParams": {"extent": ["statewide", "oa"], "units": ["mm"]}, "files": ["data_map", "metadata"]},
                     {"fileParams": {"extent": ["statewide"], "units": ["mm"], "fill": ["partial"]}, "files": ["station_data"]}],
        "params": {"location": "hawaii", "datatype": "rainfall", "production": "new", "period": "month"},
        "dates": {"start": "2026-01", "end": "2026-08", "unit": "month", "interval": 1}}]}
    assert route.call_count == 1
    # without an email the key is absent (HCDP logs it when given)
    client.post("/api/export/instant", json=RAIN)
    assert "email" not in seen["body"]


@respx.mock
def test_instant_download_refuses_bad_requests_before_touching_hcdp_and_relays_hcdp_failures(client):
    route = respx.post(f"{BASE}/genzip/instant/content").mock(return_value=httpx.Response(500))
    assert client.post("/api/export/instant", json={**RAIN, "dataset": "wind"}).status_code == 400
    assert client.post("/api/export/instant", json={**RAIN, "email": "nope"}).status_code == 400
    assert client.post("/api/export/instant", json={"dataset": "rainfall"}).status_code == 422
    # more than 150 files: the download is refused with a word, the email route is the way
    big = client.post("/api/export/instant", json={**RAIN, "period": "day", "start": "2026-01-01", "end": "2026-03-31"})
    assert big.status_code == 413 and "emailed" in big.json()["detail"]
    assert route.call_count == 0
    r = client.post("/api/export/instant", json=RAIN)
    assert r.status_code == 502 and "HCDP returned 500" in r.json()["detail"]
    respx.post(f"{BASE}/genzip/instant/content").mock(side_effect=httpx.ConnectError("down"))
    assert client.post("/api/export/instant", json=RAIN).status_code == 502


@respx.mock
def test_instant_download_keeps_to_its_byte_budget(client, monkeypatch):
    monkeypatch.setattr(appmod, "EXPORT_MAX_BYTES", 10)
    respx.post(f"{BASE}/genzip/instant/content").mock(return_value=httpx.Response(200, content=b"x" * 20))
    r = client.post("/api/export/instant", json=RAIN)
    assert r.status_code == 413 and "emailed" in r.json()["detail"]                 # HCDP said the size up front
    # no content-length: the stream is cut at the budget
    respx.post(f"{BASE}/genzip/instant/content").mock(return_value=httpx.Response(200, stream=httpx.ByteStream(b"y" * 25)))
    r = client.post("/api/export/instant", json=RAIN)
    assert r.status_code == 200 and len(r.content) <= 10 and "content-length" not in r.headers


@respx.mock
def test_email_request_validates_the_address_and_relays_hcdps_answer(client):
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(202, text="accepted")
    route = respx.post(f"{BASE}/genzip/email").mock(side_effect=handler)
    r = client.post("/api/export/email", json={**RAIN, "email": "ikaika@example.edu"})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["ok"] is True and body["email"] == "ikaika@example.edu" and body["files"] == 40 and "ikaika@example.edu" in body["message"]
    assert seen["body"]["email"] == "ikaika@example.edu" and seen["body"]["data"][0]["dates"] == {"start": "2026-01", "end": "2026-08", "unit": "month", "interval": 1}
    assert seen["auth"] == "Bearer test-token-never-printed" and "test-token" not in r.text
    assert client.post("/api/export/email", json=RAIN).status_code == 400                          # no address
    assert client.post("/api/export/email", json={**RAIN, "email": "ikaika@example"}).status_code == 400
    assert client.post("/api/export/email", json={**RAIN, "email": "ikaika@example.edu", "start": "1990-01", "end": "2026-08", "period": "month",
                                                  "extents": ["statewide", "hawaii", "maui", "oahu", "kauai"], "files": ["data_map", "se", "anom", "anom_se"], "station_files": ["partial"]}).status_code == 202   # 440 months × 25 files: fine by email
    daily_huge = client.post("/api/export/email", json={**RAIN, "email": "ikaika@example.edu", "period": "day", "start": "1990-01-01", "end": "2026-09-23", "extents": ["statewide", "hawaii", "maui", "oahu", "kauai"], "files": ["data_map", "se", "anom", "anom_se"], "station_files": ["partial", "raw"]})
    assert daily_huge.status_code == 413                                                            # ~295,000 files
    assert route.call_count == 2
    respx.post(f"{BASE}/genzip/email").mock(return_value=httpx.Response(500))
    assert client.post("/api/export/email", json={**RAIN, "email": "ikaika@example.edu"}).status_code == 502


@respx.mock
def test_export_rate_limits_are_per_client_and_harder_for_email(client):
    respx.post(f"{BASE}/genzip/instant/content").mock(return_value=httpx.Response(200, content=b"zip"))
    respx.post(f"{BASE}/genzip/email").mock(return_value=httpx.Response(202))
    appmod.app.state.export_limiter = appmod.RateLimiter(per_minute=2, per_hour=10, global_per_day=100)
    appmod.app.state.email_limiter = appmod.RateLimiter(per_minute=1, per_hour=10, global_per_day=100)
    assert client.post("/api/export/instant", json=RAIN).status_code == 200
    assert client.post("/api/export/instant", json=RAIN).status_code == 200
    r = client.post("/api/export/instant", json=RAIN)
    assert r.status_code == 429 and "emailed" in r.json()["detail"]
    assert client.post("/api/export/email", json={**RAIN, "email": "ikaika@example.edu"}).status_code == 202
    assert client.post("/api/export/email", json={**RAIN, "email": "ikaika@example.edu"}).status_code == 429
