"""The viewer's data endpoints (CONTRACT.md "Viewer data endpoints"), with the HCDP API mocked by respx."""
import io
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as appmod  # noqa: E402

BASE = appmod.HCDP_API_BASE
META = [
    {"value": {"skn": "1020.1", "name": "LIHUE WEATHER SERVICE OFFICE AIRPORT 1020.1", "island": "KA", "lat": 21.98, "lng": -159.34, "elevation_m": 31, "network": "NWS", "observer": "NWS", "id_field": "skn"}},
    {"value": {"skn": "1146.0", "name": "Moloaa Dairy", "island": "KA", "lat": 22.19, "lng": -159.33, "elevation_m": 120}},
    {"value": {"skn": "1146", "name": "Moloaa Dairy", "island": "KA", "lat": 22.19, "lng": -159.33, "elevation_m": 120}},   # the same station in its other spelling
    {"value": {"skn": "441.2", "name": "Hoolawa 0157", "island": "MA", "lat": 20.906941, "lng": -156.243774, "elevation_m": 177, "network": "HiMesonet", "observer": "HiMesonet"}},
    {"value": {"skn": "99.9", "name": "Kahoʻolawe gauge", "island": "KO", "lat": 20.55, "lng": -156.6}},
    {"value": {"skn": "88.8", "name": "No coordinates", "island": "OA"}},
]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(appmod, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(appmod, "SITE_ADDRESS", "hcdp.example.org")
    appmod.app.state.climate_stations = None
    appmod.app.state.stations_index = None
    appmod.app.state.station_values = {}
    appmod.app.state.short_limiter = appmod.RateLimiter(per_minute=30, per_hour=300, global_per_day=1000)
    return TestClient(appmod.app)


def stations_handler(values_rows=None, series=None, series_sid="1146", extra_row=None):
    """A fake HCDP /stations: metadata, one date's values, or a series window ([gte, lt) read from the query)."""
    calls = []

    def handler(request):
        q = unquote(request.url.params["q"])
        calls.append(q)
        if "hcdp_station_metadata" in q:
            return httpx.Response(200, json={"status": "ok", "result": META})
        if "'$and'" in q:
            gte, lt = re.search(r"'\$gte':'([^']+)'", q).group(1), re.search(r"'\$lt':'([^']+)'", q).group(1)
            rows = [{"value": {"station_id": series_sid, "date": d, "value": v}} for d, v in (series or {}).items() if gte <= d < lt]
            if extra_row:
                rows.append({"value": extra_row})
            return httpx.Response(200, json={"result": rows})
        return httpx.Response(200, json={"result": values_rows or []})
    return handler, calls


# ----- /api/climate-stations ------------------------------------------------------
@respx.mock
def test_climate_stations_shape_join_and_one_upstream_call(client, tmp_path):
    handler, calls = stations_handler()
    route = respx.get(f"{BASE}/stations").mock(side_effect=handler)
    r = client.get("/api/climate-stations")
    assert r.status_code == 200 and r.headers["cache-control"] == "public, max-age=86400"
    body = r.json()
    assert body["count"] == len(body["stations"]) == 4          # 1146/1146.0 folded, the row without coordinates dropped
    by = {s["skn"]: s for s in body["stations"]}
    assert set(by) == {"99.9", "441.2", "1020.1", "1146"}
    assert by["1146"] == {"skn": "1146", "name": "Moloaa Dairy", "island": "KA", "extent": "kauai", "lat": 22.19, "lng": -159.33, "elevation_m": 120, "network": None, "observer": None}
    assert by["441.2"]["extent"] == "maui" and by["441.2"]["network"] == "HiMesonet"
    assert by["99.9"]["island"] == "KO" and by["99.9"]["extent"] is None
    assert "hcdp_station_metadata" in calls[0] and "'value.station_group':'hawaii_climate_primary'" in calls[0]
    client.get("/api/climate-stations")
    assert route.call_count == 1                                  # memory cache
    assert json.loads((tmp_path / "cache" / "stations.json").read_text())["stations"][0]["skn"] == "99.9"
    appmod.app.state.climate_stations = None                      # "restart": the disk copy serves, no refetch
    assert client.get("/api/climate-stations").json()["count"] == 4
    assert route.call_count == 1


# ----- /api/station-values ----------------------------------------------------------
@respx.mock
def test_station_values_join_shape_and_cache(client):
    rows = [{"value": {"station_id": "1020.1", "date": "2026-09-07", "value": 7.717, "datatype": "rainfall", "period": "day", "fill": "partial", "production": "new"}},
            {"value": {"station_id": "1146", "date": "2026-09-07", "value": 0}},
            {"value": {"station_id": "9999.9", "date": "2026-09-07", "value": 3.0}},          # no metadata → dropped
            {"value": {"station_id": "441.2", "date": "2026-09-07", "value": None}}]          # no value → dropped
    handler, calls = stations_handler(values_rows=rows)
    route = respx.get(f"{BASE}/stations").mock(side_effect=handler)
    r = client.get("/api/station-values", params={"dataset": "rainfall", "period": "day", "date": "2026-09-07"})
    assert r.status_code == 200 and "max-age=" in r.headers["cache-control"]
    body = r.json()
    assert body["units"] == "mm" and body["count"] == 2 and body["dataset"] == "rainfall" and body["period"] == "day" and body["date"] == "2026-09-07" and body["fill"] == "partial"
    assert body["stations"][0] == {"skn": "1020.1", "name": "LIHUE WEATHER SERVICE OFFICE AIRPORT 1020.1", "island": "KA", "extent": "kauai", "lat": 21.98, "lng": -159.34, "value": 7.717}
    assert body["stations"][1]["skn"] == "1146" and body["stations"][1]["value"] == 0
    values_q = [q for q in calls if "hcdp_station_value" in q][0]
    assert values_q == "{'name':'hcdp_station_value','value.datatype':'rainfall','value.production':'new','value.period':'day','value.fill':'partial','value.date':'2026-09-07'}"
    n = route.call_count
    client.get("/api/station-values", params={"dataset": "rainfall", "period": "day", "date": "2026-09-07"})
    assert route.call_count == n                                   # cached an hour
    client.get("/api/station-values", params={"dataset": "humidity", "period": "day", "date": "2026-09-07", "fill": "partial"})
    assert calls[-1] == "{'name':'hcdp_station_value','value.datatype':'relative_humidity','value.period':'day','value.fill':'partial','value.date':'2026-09-07'}"
    client.get("/api/station-values", params={"dataset": "temperature-max", "period": "month", "date": "2026-08", "fill": "raw"})
    assert calls[-1] == "{'name':'hcdp_station_value','value.datatype':'temperature','value.aggregation':'max','value.period':'month','value.fill':'raw','value.date':'2026-08'}"


@respx.mock
def test_station_values_validation_and_404(client):
    handler, _ = stations_handler(values_rows=[])
    respx.get(f"{BASE}/stations").mock(side_effect=handler)
    get = lambda **p: client.get("/api/station-values", params=p).status_code  # noqa: E731
    assert get(dataset="wind", period="day", date="2026-09-07") == 400
    assert get(dataset="ndvi", period="day", date="2026-09-07") == 400                      # grids only
    assert get(dataset="humidity", period="month", date="2026-09") == 400                   # humidity is daily
    assert get(dataset="rainfall", period="day", date="2026-09", fill="partial") == 400     # a day needs a full date
    assert get(dataset="rainfall", period="day", date="2026-09-07", fill="bogus") == 400
    r = client.get("/api/station-values", params={"dataset": "rainfall", "period": "day", "date": "2026-09-07"})
    assert r.status_code == 404 and "no station values" in r.json()["detail"]
    r = client.get("/api/station-values", params={"dataset": "temperature-mean", "period": "day", "date": "2026-09-07"})
    assert r.status_code == 404 and "maximum and minimum only" in r.json()["detail"]


# ----- /api/timeseries ----------------------------------------------------------------
@respx.mock
def test_station_timeseries_windows_newest_first_merged_ascending(client):
    series = {"2024-01-03": 1.0, "2024-01-01": 0.5, "2025-06-15": 2.5, "2026-09-30": 4.0, "2026-09-28": 3.0}
    handler, calls = stations_handler(series=series, series_sid="1146.0", extra_row={"station_id": "1146.0", "date": "2026-09-30", "value": 99.0})
    route = respx.get(f"{BASE}/stations").mock(side_effect=handler)
    r = client.get("/api/timeseries", params={"dataset": "rainfall", "period": "day", "start": "2024-01-01", "end": "2026-09-30", "station": "1146"})
    assert r.status_code == 200 and r.headers["cache-control"] == "public, max-age=3600"
    body = r.json()
    assert body["units"] == "mm" and body["dataset"] == "rainfall" and body["period"] == "day" and body["start"] == "2024-01-01" and body["end"] == "2026-09-30"
    assert body["location"] == {"kind": "station", "skn": "1146", "name": "Moloaa Dairy", "island": "KA", "extent": "kauai", "lat": 22.19, "lng": -159.33}
    pts = body["points"]
    dates = [p[0] for p in pts]
    assert dates == sorted(dates) and dates[0] == "2024-01-01" and dates[-1] == "2026-09-30"
    assert len(pts) == 1004                                        # one entry per day of the record, gaps as nulls
    by = dict(pts)
    assert by["2024-01-01"] == 0.5 and by["2024-01-02"] is None and by["2025-06-15"] == 2.5 and by["2026-09-30"] == 4.0   # newest window wins the duplicate
    windows = [q for q in calls if "'$and'" in q]
    assert len(windows) == 3                                       # 1004 days → 500 + 500 + 4, newest first
    assert "'$lt':'2026-10-01'" in windows[0] and "'$gte':'2024-01-01'" in windows[-1]
    assert "'value.station_id':{'$in':['1146','1146.0']}" in windows[0]
    assert "'value.production':'new'" in windows[0] and "'value.fill':'partial'" in windows[0]
    n = route.call_count
    client.get("/api/timeseries", params={"dataset": "rainfall", "period": "day", "start": "2024-01-01", "end": "2026-09-30", "station": "1146"})
    assert route.call_count == n                                   # the disk cache answers


@respx.mock
def test_station_timeseries_monthly_and_validation(client):
    handler, calls = stations_handler(series={"2026-07": 100.0, "2026-09": 50.0}, series_sid="1020.1")
    respx.get(f"{BASE}/stations").mock(side_effect=handler)
    respx.get(f"{BASE}/raster/timeseries").mock(return_value=httpx.Response(200, json={}))
    r = client.get("/api/timeseries", params={"dataset": "rainfall", "period": "month", "start": "2026-01-15", "end": "2026-09", "station": "1020.1"})
    assert r.status_code == 200
    assert r.json()["points"] == [["2026-07", 100.0], ["2026-08", None], ["2026-09", 50.0]] and r.json()["start"] == "2026-01"
    assert "'$gte':'2026-01'" in calls[-1] and "'$lt':'2026-10'" in calls[-1]
    get = lambda **p: client.get("/api/timeseries", params=p)  # noqa: E731
    base = {"dataset": "rainfall", "period": "day", "start": "2026-01-01", "end": "2026-09-30"}
    assert get(**{**base, "station": "abc"}).status_code == 400
    assert get(**{**base, "station": "1020.1", "start": "1980-01-01"}).status_code == 400                 # 46 years of days
    assert get(**{**base, "station": "1020.1", "start": "2026-10-01"}).status_code == 400                 # start after end
    assert get(**{**base, "station": "1020.1", "dataset": "ndvi"}).status_code == 400                     # grids only
    assert get(**{**base, "station": "1020.1", "dataset": "wind"}).status_code == 400
    assert get(**{**base, "station": "1020.1", "period": "week"}).status_code == 400
    assert get(**{**base, "station": "7777.7"}).status_code == 404                                        # unknown station
    assert get(**base).status_code == 400                                                                 # neither station nor cell
    assert get(**{**base, "lat": 30.0, "lng": -120.0}).status_code == 400                                 # outside Hawaiʻi
    assert get(**{**base, "station": "1020.1", "fill": "bogus"}).status_code == 400


@respx.mock
def test_cell_timeseries_from_raster_timeseries(client):
    calls = []

    def handler(request):
        calls.append(dict(request.url.params))
        s, e = request.url.params["start"], request.url.params["end"]
        data = {"2026-09-01T10:00:00.000Z": 7.717, "2026-09-02T10:00:00.000Z": -3.4e38, "2026-09-03T10:00:00.000Z": 1.5}
        return httpx.Response(200, json={k: v for k, v in data.items() if s <= k[:10] <= e})
    route = respx.get(f"{BASE}/raster/timeseries").mock(side_effect=handler)
    r = client.get("/api/timeseries", params={"dataset": "rainfall", "period": "day", "start": "2026-09-01", "end": "2026-09-03", "lat": 22.05, "lng": -159.5})
    assert r.status_code == 200
    body = r.json()
    assert body["points"] == [["2026-09-01", 7.717], ["2026-09-02", None], ["2026-09-03", 1.5]]     # the ocean sentinel → null
    assert body["location"] == {"kind": "cell", "lat": 22.05, "lng": -159.5}
    assert calls[0]["datatype"] == "rainfall" and calls[0]["production"] == "new" and calls[0]["extent"] == "statewide" and calls[0]["period"] == "day"
    # a long daily span is split into ≤ 3-year windows fetched in parallel; a monthly one is a single call
    client.get("/api/timeseries", params={"dataset": "temperature-max", "period": "day", "start": "2016-01-01", "end": "2025-12-31", "lat": 21.3, "lng": -157.85})
    assert route.call_count == 1 + 4
    client.get("/api/timeseries", params={"dataset": "spi-3", "period": "month", "start": "1990-03", "end": "2026-09", "lat": 21.3, "lng": -157.85})
    assert route.call_count == 1 + 4 + 1 and calls[-1]["timescale"] == "timescale003"


# ----- /api/og.png ---------------------------------------------------------------------
def write_grid(path, bounds=(-160.5, 22.5), size=(600, 400), res=0.01, island=(-159.5, 22.05, 0.5, 0.4)):
    """A statewide-shaped grid (lon -160.5…-154.5, lat 18.5…22.5 at 0.01°) with one elliptical "island" of data,
    by default where Kauaʻi is (centre lon, lat, half-widths in degrees)."""
    rasterio = pytest.importorskip("rasterio")
    import numpy as np
    from rasterio.transform import from_origin
    w, h = size
    data = np.full((1, h, w), -3.4e38, dtype="float32")
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy, rx, ry = (island[0] - bounds[0]) / res, (bounds[1] - island[1]) / res, island[2] / res, island[3] / res
    blob = ((xx - cx) ** 2 / rx ** 2 + (yy - cy) ** 2 / ry ** 2) < 1
    data[0][blob] = np.linspace(0, 600, blob.sum(), dtype="float32")
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", width=w, height=h, count=1, dtype="float32", crs="EPSG:4326", transform=from_origin(bounds[0], bounds[1], res, res), nodata=-3.4e38) as d:
        d.write(data)


def test_og_png_renders_a_card_and_keys_it_by_the_canonical_view(client, tmp_path):
    from PIL import Image
    write_grid(appmod.raster_cache_path("rainfall", "month", "2026-09", "kauai")[2])
    r = client.get("/api/og.png", params={"path": "/viewer/rainfall/month/2026-09/kauai?units=in&layers=stations"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and "max-age=" in r.headers["cache-control"]
    im = Image.open(io.BytesIO(r.content))
    assert im.size == (1200, 630)
    px = im.convert("RGB")
    assert px.getpixel((5, 5)) == (0xBF, 0xE0, 0xF7)                 # ocean
    assert px.getpixel((600, 600)) == (255, 255, 255)                 # the white title strip
    og_dir = tmp_path / "cache" / "og"
    assert len(list(og_dir.glob("*.png"))) == 1
    # an alias spelling, a camera and a basemap do not make a second image
    r2 = client.get("/api/og.png", params={"path": "/viewer/rain/monthly/2026-09/ka?units=in&basemap=street&lat=22.06&lng=-159.5&z=10&station=1020.1"})
    assert r2.status_code == 200 and len(list(og_dir.glob("*.png"))) == 1
    # a different ramp or units does — and so do a reversed ramp, a locked range and pseudo-log
    client.get("/api/og.png", params={"path": "/viewer/rainfall/month/2026-09/kauai?ramp=turbo"})
    client.get("/api/og.png", params={"path": "/viewer/rainfall/month/2026-09/kauai"})
    assert len(list(og_dir.glob("*.png"))) == 3
    for q in ("?ramp=turbo-r", "?range=0..300", "?log=1", "?range=0..300&log=1"):
        assert client.get("/api/og.png", params={"path": "/viewer/rainfall/month/2026-09/kauai" + q}).status_code == 200
    assert len(list(og_dir.glob("*.png"))) == 7
    assert client.get("/api/og.png", params={"path": "/viewer/rainfall/month/2026-09/kauai?range=abc"}).status_code == 404   # not a viewer address
    r3 = client.get("/api/og.webp", params={"path": "https://hcdp.example.org/viewer/rainfall/month/2026-09/kauai"})
    assert r3.status_code == 200 and r3.headers["content-type"] == "image/webp"
    assert client.get("/api/og.png", params={"path": "/about"}).status_code == 404
    assert client.get("/api/og.png", params={"path": "/viewer/rainfall/day/2026-02-30/kauai"}).status_code == 404
    assert client.get("/api/og.png", params={"path": "/viewer/rainfall/month/2026-09/kauai", "fmt": "gif"}).status_code == 400


def _land_pixels(png_bytes):
    import numpy as np
    from PIL import Image
    arr = np.array(Image.open(io.BytesIO(png_bytes)).convert("RGB"))[:500]
    return int((np.abs(arr.astype(int) - (0xBF, 0xE0, 0xF7)).sum(axis=2) > 30).sum())


def test_og_png_crops_shared_grids_to_the_island(client, tmp_path):
    write_grid(appmod.raster_cache_path("spi-3", "month", "2026-08", "statewide")[2])       # the statewide grid SPI links share
    whole = client.get("/api/og.png", params={"path": "/viewer/spi-3/month/2026-08/statewide"})
    kauai = client.get("/api/og.png", params={"path": "/viewer/spi-3/month/2026-08/kauai"})
    assert whole.status_code == 200 and kauai.status_code == 200
    assert _land_pixels(kauai.content) > 3 * _land_pixels(whole.content)                     # the island fills the card
    maui = client.get("/api/og.png", params={"path": "/viewer/spi-3/month/2026-08/maui"})    # no data in that box: the whole grid
    assert maui.status_code == 200 and _land_pixels(maui.content) == _land_pixels(whole.content)


def test_server_legend_honours_a_locked_range():
    from viewer_meta import legend_for
    auto = legend_for("rainfall", "month", {})
    assert auto["domain"] == (0, 650) and (auto["lo"], auto["hi"]) == ("0", "+650+")
    locked = legend_for("rainfall", "month", {"range": (0.0, 300.0)})
    assert locked["domain"] == (0.0, 300.0) and (locked["lo"], locked["hi"]) == ("0", "+300+")      # 0 is the portal's closed end; 300 is open
    inside = legend_for("rainfall", "month", {"range": (10.0, 300.0), "units": "in"})
    assert (inside["lo"], inside["hi"]) == ("+0.39-", "+11.81+") and inside["units"] == "in"          # both ends open, in inches
    rh = legend_for("humidity", "day", {"range": (20.0, 100.0)})
    assert (rh["lo"], rh["hi"]) == ("+20-", "+100")                                                    # 100 % is the portal's closed top
    extreme = legend_for("rainfall", "day", {"scale": "extreme", "range": (0.0, 400.0)})
    assert extreme["domain"] == (0.0, 400.0) and extreme["hi"] == "+400+"                              # the lock wins over the storm scale


# ----- link previews in index.html -----------------------------------------------------------
def test_viewer_links_get_canonical_and_og_tags(tmp_path, monkeypatch, client):
    (tmp_path / "index.html").write_text('<html><head><title>Hawaiʻi Climate Data Portal</title><meta name="description" content="generic" /></head><body></body></html>')
    monkeypatch.setattr(appmod, "DIST", tmp_path)
    html = client.get("/viewer/spi3/monthly/2026-08/bi?z=9&lng=-155.5&lat=19.6&opacity=75").text
    assert "<title>Drought index SPI 3-month, August 2026, Hawaiʻi Island — Hawaiʻi Climate Data Portal</title>" in html
    assert '<link rel="canonical" href="https://hcdp.example.org/viewer/spi-3/month/2026-08/hawaii" />' in html
    assert '<meta property="og:url" content="https://hcdp.example.org/viewer/spi-3/month/2026-08/hawaii?lat=19.6000&amp;lng=-155.5000&amp;z=9" />' in html
    assert '<meta property="og:image" content="https://hcdp.example.org/api/og.png?path=%2Fviewer%2Fspi-3%2Fmonth%2F2026-08%2Fhawaii%3Flat%3D19.6000%26lng%3D-155.5000%26z%3D9" />' in html
    assert '<meta property="og:image:width" content="1200" />' in html and '<meta property="og:image:height" content="630" />' in html
    assert '<meta name="twitter:card" content="summary_large_image" />' in html and '<meta name="twitter:image" content="https://hcdp.example.org/api/og.png' in html
    assert 'property="og:title"' in html and 'property="og:description"' in html
    plain = client.get("/about/team").text
    assert 'rel="canonical"' not in plain and "<title>Hawaiʻi Climate Data Portal</title>" in plain
    monkeypatch.setattr(appmod, "SITE_ADDRESS", "")                     # no SITE_ADDRESS: the request's Host serves
    html = client.get("/viewer/rainfall/day/2026-09-07/kauai", headers={"host": "preview.example.net"}).text
    assert '<link rel="canonical" href="https://preview.example.net/viewer/rainfall/day/2026-09-07/kauai" />' in html
    assert appmod.site_origin("localhost:8010") == "http://localhost:8010" and appmod.site_origin("https://x.org/") == "https://x.org"


# ----- short links ----------------------------------------------------------------------------
def test_shorten_is_deterministic_and_redirects(client, tmp_path):
    r = client.post("/api/shorten", json={"path": "/viewer/rain/daily/2026-09-07/ka?basemap=street&z=10&lat=22.06&lng=-159.5"})
    assert r.status_code == 200
    body = r.json()
    canonical = "/viewer/rainfall/day/2026-09-07/kauai?basemap=street&lat=22.0600&lng=-159.5000&z=10"
    assert body["path"] == canonical and re.fullmatch(r"[a-z2-7]{7,8}", body["id"]) and body["url"] == f"https://hcdp.example.org/s/{body['id']}"
    assert body["id"] == appmod.short_id(canonical)
    again = client.post("/api/shorten", json={"path": "https://hcdp.example.org" + canonical}).json()
    assert again["id"] == body["id"]                                      # the same view, the same id
    assert (tmp_path / "cache" / "short" / f"{body['id']}.txt").read_text() == canonical
    r = client.get(f"/s/{body['id']}", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == canonical
    r = client.get("/s/zzzzzzz", follow_redirects=False)
    assert r.status_code == 404 and "hint" in r.json()
    assert client.get("/s/%2e%2e%2fetc", follow_redirects=False).status_code == 404       # a traversal id is just unknown
    assert client.post("/api/shorten", json={"path": "/about/team"}).status_code == 400
    assert client.post("/api/shorten", json={"path": "/viewer/rainfall/day/2026-02-30/kauai"}).status_code == 400
    assert client.post("/api/shorten", json={"path": ""}).status_code == 422
    appmod.app.state.short_limiter = appmod.RateLimiter(per_minute=1, per_hour=10, global_per_day=100)
    assert client.post("/api/shorten", json={"path": canonical}).status_code == 200
    assert client.post("/api/shorten", json={"path": canonical}).status_code == 429


# ----- /api/raster hardening ---------------------------------------------------------------------
def test_raster_has_an_etag_and_honours_range_requests(client):
    _, key, path = appmod.raster_cache_path("rainfall", "day", "2026-09-07", "kauai")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(range(256)) * 4)                                # 1024 "GeoTIFF" bytes already in the cache
    params = {"dataset": "rainfall", "period": "day", "date": "2026-09-07", "extent": "kauai"}
    full = client.get("/api/raster", params=params)
    assert full.status_code == 200 and full.headers["etag"] == f'"{key}.tif"' and len(full.content) == 1024
    part = client.get("/api/raster", params=params, headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and part.headers["content-range"] == "bytes 0-99/1024" and part.content == bytes(range(100))
    assert part.headers["etag"] == f'"{key}.tif"'


def test_map_png_accepts_every_viewer_ramp_but_not_nonsense(client):
    assert client.get("/api/map.png", params={"dataset": "rainfall", "period": "month", "date": "2026-08", "ramp": "rainbow-unicorn"}).status_code == 400
    assert appmod.DEFAULT_RAMP["rainfall"] == "viridis_r" and appmod.DEFAULT_RAMP["temperature-max"] == "viridis" and appmod.DEFAULT_RAMP["spi-36"] == "viridis_r"
