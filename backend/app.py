"""HCDP with AI — the navigator backend and static host for the site.

Endpoints
  POST /api/navigate          the navigator (see CONTRACT.md for the protocol)
  GET  /api/raster            GeoTIFF proxy to the HCDP API (token stays here; disk cache; ETag + Range)
  GET  /api/dates             available date range for a dataset (proxy, memory cache)
  GET  /api/map.png|webp      a map rendered with a viewer ramp (landing backdrops)
  GET  /api/backdrops         the landing page's backdrop maps
  GET  /api/climate-stations  HCDP's hawaii_climate_primary stations (24 h cache, memory + disk)
  GET  /api/station-values    one day's/month's station values joined with metadata (1 h cache)
  GET  /api/timeseries        a station's (station=SKN) or a grid cell's (lat&lng) record (disk cache)
  GET  /api/og.png|webp       1200×630 link-preview card for a viewer address (disk cache)
  POST /api/shorten           deterministic short link for a viewer address; GET /s/{id} redirects to it
  GET  /api/stations          the Hawaiʻi Mesonet station registry (Mesonet page)
  GET  /api/catalog           the site catalog the navigator reasons over
  GET  /api/health
  GET  /*                     the built frontend (SPA fallback to index.html; viewer links get canonical + og tags)
"""
from __future__ import annotations

import asyncio
import datetime as dt
import base64
import hashlib
import html as htmlmod
import json
import os
import re
import uuid
import time
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")  # local development; containers get the env from compose

from llm import NavigatorLLM  # noqa: E402
from navigator import (DATASETS, EXTENTS, HAWAII_BOX, STATEWIDE_ONLY, STATION_DATASETS, Navigator, canonical_viewer_path,  # noqa: E402
                       describe_view, load_catalog, parse_viewer_path)
from rasters import reencode_geotiff  # noqa: E402
from ratelimit import RateLimiter  # noqa: E402
from mapimage import default_ramp, known_ramp, render_og, render_png  # noqa: E402
from stations import (FILLS, METADATA_QUERY, SKN_RE, dense_points, fetch_cell_series, fetch_series, fetch_station_rows, join_values,  # noqa: E402
                      metadata_to_stations, norm_skn, props_query, steps_between, values_query)
from viewer_meta import ISLAND_BOUNDS, UNITS, legend_for  # noqa: E402

HCDP_API_BASE = os.environ.get("HCDP_API_BASE", "https://api.hcdp.ikewai.org").rstrip("/")
HCDP_TOKEN = os.environ.get("HCDP_API_TOKEN", "")
CACHE_DIR = Path(os.environ.get("RASTER_CACHE_DIR", ROOT / "cache"))
DIST = Path(os.environ.get("FRONTEND_DIST", ROOT.parent / "frontend" / "dist"))
AI_INTERFACE_URL = os.environ.get("AI_INTERFACE_URL", "https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org")
# The public host (Caddy's site address, e.g. hcdp-with-ai.cis251375.projects.jetstream-cloud.org) for absolute links in
# og/canonical tags and short links; when unset the request's Host header is used.
SITE_ADDRESS = os.environ.get("SITE_ADDRESS", "")
# Every dataset opens on the portal's default scheme for its datatype (Viridis, oriented per product).
DEFAULT_RAMP = {k: default_ramp(v["api"]["datatype"]) for k, v in DATASETS.items()}

app = FastAPI(title="HCDP with AI — navigator", docs_url=None, redoc_url=None)
app.state.llm = NavigatorLLM()
app.state.navigator = Navigator(app.state.llm, load_catalog(), ai_interface_url=AI_INTERFACE_URL)
app.state.dates_cache = {}
app.state.limiter = RateLimiter(per_minute=int(os.environ.get("NAV_PER_MINUTE", "12")), per_hour=int(os.environ.get("NAV_PER_HOUR", "120")),
                                 global_per_day=int(os.environ.get("NAV_GLOBAL_PER_DAY", "5000")))
# Short links are cheap but write files: a second limiter keeps one visitor from filling the disk.
app.state.short_limiter = RateLimiter(per_minute=int(os.environ.get("SHORT_PER_MINUTE", "30")), per_hour=int(os.environ.get("SHORT_PER_HOUR", "300")), global_per_day=200000)
app.state.climate_stations = None      # (fetched_at, [station, …]) — HCDP's climate station list
app.state.stations_index = None        # (that list, {skn: station})
app.state.stations_lock = asyncio.Lock()
app.state.station_values = {}          # (dataset, period, date, fill) → (fetched_at, payload)


def _hcdp_headers() -> dict:
    return {"Authorization": f"Bearer {HCDP_TOKEN}"} if HCDP_TOKEN else {}


class NavigateBody(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[dict] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)


@app.post("/api/navigate")
async def api_navigate(body: NavigateBody, request: Request):
    nav = request.app.state.navigator
    verdict = request.app.state.limiter.check(request.client.host if request.client else "?")
    if verdict == "ip":
        return JSONResponse({"intent": "info", "reply": "That is a lot of questions from one connection in a short time. Wait a minute and try again, or browse the tools below.",
                             "actions": [], "alternatives": [{"title": "Access Data", "url": "/data", "why": "maps and downloads"}, {"title": "Hawaiʻi Mesonet", "url": "/mesonet", "why": "live stations"}], "minimize": False}, status_code=429)
    if verdict == "global":
        # The model budget for today is spent: answer from the catalog by keyword instead.
        out = nav.fallback(body.message)
        out["reply"] = "The assistant has reached today's limit, so here are the closest matches by keyword."
        return out
    return await run_in_threadpool(nav.respond, body.message, body.history[-24:], body.context)


@app.get("/api/stations")
async def api_stations(request: Request):
    """The Hawaiʻi Mesonet stations (id, name, island, lat, lng, status) for station pickers and links."""
    return {"stations": request.app.state.navigator.stations}


@app.get("/api/catalog")
async def api_catalog(request: Request):
    return {"entries": request.app.state.navigator.catalog}


@app.get("/api/health")
async def api_health(request: Request):
    llm = request.app.state.llm
    return {
        "ok": True, "model": llm.model, "model_configured": llm.configured, "llm": llm.stats,
        "catalog_entries": len(request.app.state.navigator.catalog),
        "raster_cache_files": len(list(CACHE_DIR.glob("*.tif"))) if CACHE_DIR.exists() else 0,
        "frontend_built": (DIST / "index.html").exists(),
        "rasterio": _rasterio_ok(),
        "navigator_calls_today": request.app.state.limiter.today_count,
        "system_prompt_chars": len(request.app.state.navigator.system_prompt()),
    }


def _rasterio_ok() -> bool:
    """False when the image lacks a system library rasterio needs (then rasters are served un-re-encoded and maps cannot render)."""
    try:
        import rasterio  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def raster_params(dataset: str, period: str, date: str, extent: str) -> dict:
    ds = DATASETS.get(dataset)
    if not ds:
        raise HTTPException(400, f"unknown dataset {dataset!r}")
    if period not in ds["periods"]:
        raise HTTPException(400, f"{dataset} is not available by {period}")
    if extent not in EXTENTS:
        raise HTTPException(400, f"unknown extent {extent!r}")
    try:
        if period == "day":
            dt.date.fromisoformat(date)
        else:
            if len(date) != 7:
                raise ValueError
            dt.date.fromisoformat(date + "-01")
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD for daily maps or YYYY-MM for monthly maps") from None
    # No returnEmptyNotFound: HCDP then answers an unpublished date with 404 instead of an all-nodata grid.
    return {**ds["api"], "period": period, "date": date, "extent": "statewide" if dataset in STATEWIDE_ONLY else EXTENTS[extent]}


def raster_cache_path(dataset: str, period: str, date: str, extent: str) -> tuple[dict, str, Path]:
    """(HCDP params, cache key, on-disk path) for a map — the path exists only once the map has been fetched."""
    params = raster_params(dataset, period, date, extent)
    key = hashlib.sha1(("&".join(f"{k}={v}" for k, v in sorted(params.items()))).encode()).hexdigest()
    return params, key, CACHE_DIR / f"{key}.tif"


async def fetch_raster(dataset: str, period: str, date: str, extent: str) -> Path:
    """The (re-encoded) GeoTIFF for a map, fetched from HCDP once and cached on disk."""
    params, key, path = raster_cache_path(dataset, period, date, extent)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(f"{HCDP_API_BASE}/raster", params=params, headers=_hcdp_headers())
        if r.status_code == 404 or (r.status_code == 200 and len(r.content) < 200):
            raise HTTPException(404, "no map for that date")
        if r.status_code != 200:
            raise HTTPException(502, f"HCDP API returned {r.status_code}")
        tmp = path.with_name(f"{key}.{uuid.uuid4().hex}.part")   # unique: concurrent identical requests must not collide
        tmp.write_bytes(r.content)
        # Lossless deflate+predictor re-encode: 10× smaller for the browser (see rasters.py).
        if not await run_in_threadpool(reencode_geotiff, tmp, path):
            tmp.replace(path)
        tmp.unlink(missing_ok=True)
    return path


def _is_recent(period: str, date: str) -> bool:
    return (dt.date.today() - dt.date.fromisoformat(date if period == "day" else date + "-01")).days < 45


@app.get("/api/raster")
async def api_raster(dataset: str, period: str, date: str, extent: str = "statewide"):
    """The GeoTIFF. Starlette's FileResponse answers Range requests (206) so GeoTIFF readers can fetch tiles; the ETag is
    the cache file's name, which changes only if the map is re-fetched."""
    path = await fetch_raster(dataset, period, date, extent)
    return FileResponse(path, media_type="image/tiff", headers={"Cache-Control": f"public, max-age={3600 if _is_recent(period, date) else 86400 * 30}", "ETag": f'"{path.name}"'})


@app.get("/api/map.png")
async def api_map_png(dataset: str, period: str, date: str, extent: str = "statewide", w: int = 1200, ramp: str = "", bg: str = "", fmt: str = "png"):
    """A rendered image of a map (landing-page backdrops, previews); transparent where there is no data
    unless `bg` fills the ocean; `fmt=webp` (or /api/map.webp) is about ten times smaller."""
    if fmt not in ("png", "webp"):
        raise HTTPException(400, "fmt must be png or webp")
    ramp = ramp or DEFAULT_RAMP.get(dataset, "viridis_r")
    if not known_ramp(ramp):
        raise HTTPException(400, "unknown ramp (the names are those of viewer/map/ramps.js NAMED_RAMPS)")
    w = max(200, min(int(w), 2400))
    bg = bg.lstrip("#").lower()
    if bg and not re.fullmatch(r"[0-9a-f]{6}", bg):
        raise HTTPException(400, "bg must be a 6-digit hex colour")
    path = await fetch_raster(dataset, period, date, extent)
    png_dir = CACHE_DIR / "png"; png_dir.mkdir(parents=True, exist_ok=True)
    out = png_dir / f"{path.stem}_{w}_{ramp}{"_" + bg if bg else ""}.{fmt}"
    if not out.exists():
        try:
            data = await run_in_threadpool(render_png, path, ramp, w, 2, 98, bg or None, fmt)
        except ValueError:
            raise HTTPException(404, "no data in that map") from None
        tmp = out.with_name(f"{out.stem}.{uuid.uuid4().hex}.part"); tmp.write_bytes(data); tmp.replace(out)
    return FileResponse(out, media_type=f"image/{fmt}", headers={"Cache-Control": f"public, max-age={3600 if _is_recent(period, date) else 86400 * 30}"})


@app.get("/api/map.webp")
async def api_map_webp(dataset: str, period: str, date: str, extent: str = "statewide", w: int = 1200, ramp: str = "", bg: str = ""):
    """The same map as WebP (the landing backdrops use this)."""
    return await api_map_png(dataset, period, date, extent, w, ramp, bg, "webp")


def _preview_data_uri(dataset: str, period: str, date: str, extent: str) -> str | None:
    """A 24 px transparent PNG of a map as a data URI (~500 bytes) for blur-up first paint — only when the
    GeoTIFF is already on disk, so /api/backdrops never waits on HCDP."""
    _, _, path = raster_cache_path(dataset, period, date, extent)
    if not path.exists():
        return None
    try:
        data = render_png(path, DEFAULT_RAMP.get(dataset, "viridis_r"), 24, 2, 98, None, "png")
    except Exception:  # noqa: BLE001
        return None
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


async def date_range(request: Request, dataset: str, period: str, extent: str = "statewide"):
    """(first, last) ISO dates for a dataset, from HCDP's /datasets/date/range (shape: two timestamps)."""
    data = await api_dates(request, dataset, period, extent)
    if isinstance(data, list) and len(data) >= 2:
        first, last = str(data[0])[:10], str(data[-1])[:10]
        if period == "month":
            first, last = first[:7], last[:7]
        return first, last
    raise HTTPException(502, "unexpected date-range shape")


@app.get("/api/backdrops")
async def api_backdrops(request: Request):
    """The maps the landing page fades between: the newest of a few datasets, statewide."""
    cache = request.app.state.dates_cache
    hit = cache.get("__backdrops__")
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    wanted = [("rainfall", "month", 0), ("temperature-max", "day", 0), ("spi-3", "month", 0), ("rainfall", "month", 1), ("humidity", "day", 0), ("ndvi", "day", 0)]
    items = []
    for dataset, period, back in wanted:
        try:
            _, last = await date_range(request, dataset, period)
        except HTTPException:
            continue
        date = last
        if back:
            d = dt.date.fromisoformat(last + "-01"); m = d.month - back
            date = (d.replace(year=d.year + (m - 1) // 12, month=(m - 1) % 12 + 1)).strftime("%Y-%m")
        label = f"{DATASETS[dataset]['label']} · " + (dt.date.fromisoformat(date).strftime("%-d %B %Y") if period == "day" else dt.date.fromisoformat(date + "-01").strftime("%B %Y"))
        item = {"dataset": dataset, "period": period, "date": date, "extent": "statewide", "label": label,
                "url": f"/api/map.webp?dataset={dataset}&period={period}&date={date}&extent=statewide&w=1400"}
        preview = await run_in_threadpool(_preview_data_uri, dataset, period, date, "statewide")
        if preview:
            item["preview"] = preview
        items.append(item)
    out = {"items": items}
    cache["__backdrops__"] = (time.time(), out)
    return out


@app.get("/api/dates")
async def api_dates(request: Request, dataset: str, period: str, extent: str = "statewide"):
    params = raster_params(dataset, period, "2020-01-01" if period == "day" else "2020-01", extent)
    params.pop("date")
    key = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    cache = request.app.state.dates_cache
    hit = cache.get(key)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{HCDP_API_BASE}/datasets/date/range", params=params, headers=_hcdp_headers())
    if r.status_code != 200:
        raise HTTPException(502, f"HCDP API returned {r.status_code}")
    data = r.json()
    cache[key] = (time.time(), data)
    return data


# The landing hero paints its ocean in these colours (light, dark); MapBackdrop.jsx asks for the same fills.
OCEAN_FILLS = ("bfe0f7", "10263a")


@app.on_event("startup")
async def warm_backdrops():
    """Render the landing page's backdrop maps right after start, so the first visitor
    after a deploy does not wait for six GeoTIFF fetches; failures are silent."""
    import asyncio

    async def _warm():
        await asyncio.sleep(2)
        try:
            from starlette.requests import Request as _R
            scope = {"type": "http", "app": app, "headers": [], "method": "GET", "path": "/api/backdrops", "query_string": b""}
            data = await api_backdrops(_R(scope))
            for it in data.get("items", []):
                for bg in OCEAN_FILLS:   # the landing's light and dark oceans (R4 B), as WebP (R7 B)
                    try:
                        await api_map_png(it["dataset"], it["period"], it["date"], it["extent"], 1400, "", bg, "webp")
                    except Exception:  # noqa: BLE001
                        pass
            app.state.dates_cache.pop("__backdrops__", None)   # next /api/backdrops recomputes with the previews
        except Exception:  # noqa: BLE001
            pass

    if os.environ.get("WARM_BACKDROPS", "1") != "0":
        asyncio.create_task(_warm())


# ----- the viewer's data (CONTRACT.md "Viewer data endpoints") -------------------------
# The HCDP query shapes and the parameter sets per dataset are documented in stations.py.
STATIONS_TTL, VALUES_TTL, SERIES_TTL = 86400, 3600, 3600
MAX_SERIES_YEARS = {"day": 40, "month": 120}


def _hcdp_client(timeout: float = 60) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=HCDP_API_BASE, headers=_hcdp_headers(), timeout=timeout)


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.part")   # unique: concurrent identical requests must not collide
    tmp.write_bytes(data)
    tmp.replace(path)


def _fresh(path: Path, max_age: float) -> bool:
    try:
        return time.time() - path.stat().st_mtime < max_age
    except OSError:
        return False


def site_origin(request_host: str | None = None) -> str:
    """scheme://host of this site for absolute links: SITE_ADDRESS first, else the request's Host header."""
    host = (SITE_ADDRESS or request_host or "localhost").strip()
    host = re.sub(r"^[a-z]+://", "", host, flags=re.I).split("/")[0].rstrip(".") or "localhost"
    scheme = "http" if host.split(":")[0] in ("localhost", "127.0.0.1") else "https"
    return f"{scheme}://{host}"


def _view_from(path_or_url: str) -> dict | None:
    """A parsed viewer address from a path (with query) or a full URL of this site."""
    s = (path_or_url or "").strip()
    if s.startswith(("http://", "https://")):
        u = urlparse(s)
        s = u.path + (f"?{u.query}" if u.query else "")
    return parse_viewer_path(s)


async def climate_stations() -> list[dict]:
    """HCDP's hawaii_climate_primary stations: in memory for a day, on disk (CACHE_DIR/stations.json) across restarts,
    and the stale copy when HCDP is unreachable."""
    st = app.state
    hit = st.climate_stations
    if hit and time.time() - hit[0] < STATIONS_TTL:
        return hit[1]
    async with st.stations_lock:
        hit = st.climate_stations
        if hit and time.time() - hit[0] < STATIONS_TTL:
            return hit[1]
        disk = CACHE_DIR / "stations.json"
        if _fresh(disk, STATIONS_TTL):
            try:
                stations = json.loads(disk.read_text(encoding="utf-8"))["stations"]
                st.climate_stations = (disk.stat().st_mtime, stations)
                return stations
            except (OSError, ValueError, KeyError, TypeError):
                pass
        try:
            async with _hcdp_client(90) as client:
                rows = await fetch_station_rows(client, props_query("hcdp_station_metadata", METADATA_QUERY))
            stations = metadata_to_stations(rows)
            if not stations:
                raise ValueError("empty station list")
            body = json.dumps({"fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "stations": stations}).encode()
            await run_in_threadpool(_atomic_write, disk, body)
            st.climate_stations = (time.time(), stations)
            return stations
        except Exception as e:  # noqa: BLE001 - a stale list beats none
            if disk.exists():
                stations = json.loads(disk.read_text(encoding="utf-8"))["stations"]
                st.climate_stations = (time.time() - STATIONS_TTL + 600, stations)   # try HCDP again in ten minutes
                return stations
            raise HTTPException(502, f"the HCDP station list is unavailable ({type(e).__name__})") from None


async def stations_by_skn() -> dict[str, dict]:
    stations = await climate_stations()
    st = app.state
    if st.stations_index is None or st.stations_index[0] is not stations:
        st.stations_index = (stations, {s["skn"]: s for s in stations})
    return st.stations_index[1]


@app.get("/api/climate-stations")
async def api_climate_stations():
    """Every station of HCDP's hawaii_climate_primary group, island codes expanded to the viewer's extent slugs."""
    stations = await climate_stations()
    return JSONResponse({"stations": stations, "count": len(stations)}, headers={"Cache-Control": f"public, max-age={STATIONS_TTL}"})


def _station_dataset(dataset: str) -> None:
    if dataset not in DATASETS:
        raise HTTPException(400, f"unknown dataset {dataset!r}")
    if dataset not in STATION_DATASETS:
        raise HTTPException(400, f"{dataset} has no station values (gridded only)")


def _check_fill(fill: str) -> str:
    if fill not in FILLS:
        raise HTTPException(400, "fill must be partial (quality-controlled) or raw")
    return fill


async def station_values(dataset: str, period: str, date: str, fill: str = "partial") -> dict:
    """One date's station values joined with metadata, cached an hour in memory; 404 when HCDP has none."""
    raster_params(dataset, period, date, "statewide")   # the same dataset/period/date validation as /api/raster
    _station_dataset(dataset)
    _check_fill(fill)
    key = (dataset, period, date, fill)
    cache = app.state.station_values
    hit = cache.get(key)
    if hit and time.time() - hit[0] < VALUES_TTL:
        return hit[1]
    try:
        async with _hcdp_client() as client:
            rows = await fetch_station_rows(client, values_query(dataset, period, date, fill))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"HCDP API error ({type(e).__name__})") from None
    stations = join_values(rows, await stations_by_skn())
    if not stations:
        why = ""
        if dataset == "temperature-mean":
            why = " HCDP publishes station temperature as daily and monthly maximum and minimum only."
        elif fill == "raw" and (period == "month" or dataset == "humidity"):
            why = " HCDP has no raw series for this product; use fill=partial."
        raise HTTPException(404, f"no station values for {dataset} on {date}.{why}")
    payload = {"stations": stations, "units": UNITS.get(dataset, ""), "count": len(stations), "dataset": dataset, "period": period, "date": date, "fill": fill}
    if len(cache) > 400:
        for k in [k for k, v in cache.items() if time.time() - v[0] >= VALUES_TTL]:
            del cache[k]
    cache[key] = (time.time(), payload)
    return payload


@app.get("/api/station-values")
async def api_station_values(dataset: str, period: str, date: str, fill: str = "partial"):
    payload = await station_values(dataset, period, date, fill)
    return JSONResponse(payload, headers={"Cache-Control": f"public, max-age={3600 if _is_recent(period, date) else 86400 * 30}"})


def _series_date(text: str, period: str, what: str) -> str:
    """start/end in the period's spelling; a monthly series also accepts any day of the month."""
    try:
        if period == "day":
            return dt.date.fromisoformat(text).isoformat()
        text = text[:7] if len(text) == 10 else text
        if len(text) != 7:
            raise ValueError
        dt.date.fromisoformat(text + "-01")
        return text
    except ValueError:
        raise HTTPException(400, f"{what} must be YYYY-MM-DD for a daily series or YYYY-MM for a monthly one") from None


@app.get("/api/timeseries")
async def api_timeseries(dataset: str, period: str, start: str, end: str, station: str | None = None, lat: float | None = None, lng: float | None = None, fill: str = "partial"):
    """A station's record (station=SKN; HCDP /stations in 500-step windows, newest first, four in flight) or a grid cell's
    (lat&lng; HCDP /raster/timeseries). Points are ascending, one per step from the first to the last value in the window,
    null where a step has no value. Cached on disk for an hour (a day when the window ended more than 45 days ago)."""
    ds = DATASETS.get(dataset)
    if not ds:
        raise HTTPException(400, f"unknown dataset {dataset!r}")
    if period not in ds["periods"]:
        raise HTTPException(400, f"{dataset} is not available by {period}")
    start, end = _series_date(start, period, "start"), _series_date(end, period, "end")
    if start > end:
        raise HTTPException(400, "start must not be after end")
    if steps_between(start, end, period) / (365.25 if period == "day" else 12) > MAX_SERIES_YEARS[period]:
        raise HTTPException(400, f"a {'daily' if period == 'day' else 'monthly'} series covers at most {MAX_SERIES_YEARS[period]} years at a time")
    _check_fill(fill)
    if station is not None:
        _station_dataset(dataset)
        if not SKN_RE.match(station.strip()):
            raise HTTPException(400, "station must be an SKN such as 1020.1")
        skn = norm_skn(station)
        meta = (await stations_by_skn()).get(skn)
        if meta is None:
            raise HTTPException(404, f"no climate station {skn}")
        location = {"kind": "station", "skn": skn, "name": meta["name"], "island": meta["island"], "extent": meta["extent"], "lat": meta["lat"], "lng": meta["lng"]}
        key = f"station|{dataset}|{period}|{start}|{end}|{skn}|{fill}"

        async def load():
            async with _hcdp_client(120) as client:
                return await fetch_series(client, dataset, period, skn, start, end, fill)
    elif lat is not None and lng is not None:
        s, n, w, e = HAWAII_BOX
        if not (s <= lat <= n and w <= lng <= e):
            raise HTTPException(400, "lat and lng must be in Hawaiʻi")
        lat, lng = round(lat, 4), round(lng, 4)
        location = {"kind": "cell", "lat": lat, "lng": lng}
        key = f"cell|{dataset}|{period}|{start}|{end}|{lat:.4f}|{lng:.4f}"

        async def load():
            async with _hcdp_client(120) as client:
                return await fetch_cell_series(client, ds["api"], period, lat, lng, start, end)
    else:
        raise HTTPException(400, "give station=SKN or lat and lng")
    path = CACHE_DIR / "timeseries" / f"{hashlib.sha1(key.encode()).hexdigest()}.json"
    points = None
    if _fresh(path, SERIES_TTL if _is_recent(period, end) else 86400):
        try:
            points = json.loads(path.read_text(encoding="utf-8"))["points"]
        except (OSError, ValueError, KeyError, TypeError):
            points = None
    if points is None:
        try:
            values = await load()
        except httpx.HTTPError as e:
            raise HTTPException(502, f"HCDP API error ({type(e).__name__})") from None
        points = dense_points(values, period)
        await run_in_threadpool(_atomic_write, path, json.dumps({"points": points}).encode())
    body = {"points": points, "units": UNITS.get(dataset, ""), "dataset": dataset, "period": period, "start": start, "end": end, "location": location}
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=3600"})


def og_cache_key(v: dict, ramp: str, fmt: str) -> str:
    """Only what changes the picture: dataset, period, date, extent, ramp, scale, units (not camera, basemap, layers, station)."""
    o = v["opts"]
    return hashlib.sha1("|".join([v["dataset"], v["period"], v["date"], v["extent"], ramp, o.get("scale", ""), o.get("units", ""), fmt]).encode()).hexdigest()


async def og_image(path: str, fmt: str) -> Path:
    v = _view_from(path)
    if not v:
        raise HTTPException(404, "not a viewer address")
    dataset, period, date, extent, opts = v["dataset"], v["period"], v["date"], v["extent"], v["opts"]
    ramp = opts["ramp"] if known_ramp(opts.get("ramp")) else DEFAULT_RAMP.get(dataset, "viridis_r")
    out = CACHE_DIR / "og" / f"{og_cache_key(v, ramp, fmt)}.{fmt}"
    if not out.exists():
        tif = await fetch_raster(dataset, period, date, extent)
        legend = legend_for(dataset, period, opts) or {"domain": (0, 1), "header": "", "lo": "0", "hi": "1", "units": "", "label": DATASETS[dataset]["label"]}
        # Shared grids (statewide-only products, Maui County) are cropped to the island the link names.
        crop = ISLAND_BOUNDS.get(extent) if extent != "statewide" and (dataset in STATEWIDE_ONLY or EXTENTS[extent] == "mn") else None
        subtitle = f"{legend['label']} ({legend['units']})" if legend["units"] else legend["label"]
        try:
            data = await run_in_threadpool(render_og, tif, ramp, legend["domain"], describe_view(v), subtitle, (legend["lo"], legend["hi"], legend["header"]), crop, fmt)
        except ValueError:
            raise HTTPException(404, "no data in that map") from None
        await run_in_threadpool(_atomic_write, out, data)
    return out


@app.get("/api/og.png")
async def api_og_png(path: str = Query(..., max_length=1000), fmt: str = "png"):
    """A 1200×630 preview card for a viewer address — what a chat app shows for a pasted link. The address may be an
    alias spelling; the card is keyed by its canonical form."""
    if fmt not in ("png", "webp"):
        raise HTTPException(400, "fmt must be png or webp")
    out = await og_image(path, fmt)
    v = _view_from(path)
    return FileResponse(out, media_type=f"image/{fmt}", headers={"Cache-Control": f"public, max-age={3600 if _is_recent(v['period'], v['date']) else 86400 * 30}"})


@app.get("/api/og.webp")
async def api_og_webp(path: str = Query(..., max_length=1000)):
    return await api_og_png(path, "webp")


SHORT_ID_RE = re.compile(r"^[a-z2-7]{7,12}$")


def short_id(canonical: str, length: int = 8) -> str:
    """The first 8 base32 characters of sha1(canonical path): the same view always gets the same id."""
    return base64.b32encode(hashlib.sha1(canonical.encode("utf-8")).digest()).decode("ascii").lower()[:length]


class ShortenBody(BaseModel):
    path: str = Field(min_length=1, max_length=2000)


@app.post("/api/shorten")
async def api_shorten(body: ShortenBody, request: Request):
    """{"path": "/viewer/..."} → {"id", "url", "path"}; only viewer addresses, stored as CACHE_DIR/short/<id>.txt."""
    if request.app.state.short_limiter.check(request.client.host if request.client else "?"):
        return JSONResponse({"error": "too many short links from this connection; wait a minute and try again"}, status_code=429)
    v = _view_from(body.path)
    if not v:
        raise HTTPException(400, "only viewer addresses (/viewer/...) can be shortened")
    canonical = v["canonical"]
    sid = short_id(canonical)
    while True:   # a clash between two views (about one in a trillion) gets the longer id
        p = CACHE_DIR / "short" / f"{sid}.txt"
        if not p.exists():
            await run_in_threadpool(_atomic_write, p, canonical.encode("utf-8"))
            break
        if p.read_text(encoding="utf-8").strip() == canonical:
            break
        sid = short_id(canonical, len(sid) + 1)
    return {"id": sid, "url": f"{site_origin(request.headers.get('host'))}/s/{sid}", "path": canonical}


@app.get("/s/{sid}", include_in_schema=False)
async def short_link(sid: str):
    p = CACHE_DIR / "short" / f"{sid}.txt" if SHORT_ID_RE.match(sid) else None
    target = p.read_text(encoding="utf-8").strip() if p is not None and p.exists() else ""
    if not target or canonical_viewer_path(target) != target:
        return JSONResponse({"error": "unknown short link", "hint": "Short links are made by this site's Share button and point at /viewer/… addresses; ask the sender for the full link."}, status_code=404)
    return RedirectResponse(target, status_code=302)


@app.on_event("startup")
async def warm_viewer():
    """After the backdrops: the newest rainfall day and month and the newest SPI-3 month, statewide, plus their station
    values, so the first viewer visitor after a deploy does not wait; failures are silent. WARM_VIEWER=0 disables."""
    async def _warm():
        await asyncio.sleep(25)
        from starlette.requests import Request as _R
        req = _R({"type": "http", "app": app, "headers": [], "method": "GET", "path": "/api/dates", "query_string": b""})
        for dataset, period in (("rainfall", "day"), ("rainfall", "month"), ("spi-3", "month")):
            try:
                _, last = await date_range(req, dataset, period)
                await fetch_raster(dataset, period, last, "statewide")
                if dataset in STATION_DATASETS:
                    await station_values(dataset, period, last, "partial")
            except Exception:  # noqa: BLE001
                pass

    if os.environ.get("WARM_VIEWER", "1") != "0":
        asyncio.create_task(_warm())


# ----- the built site ---------------------------------------------------------
@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str, request: Request):
    if full_path.startswith("api/") or any(seg.startswith(".") for seg in full_path.split("/")) or full_path.endswith((".php", ".asp", ".aspx", ".cgi", ".sql", ".bak")):
        raise HTTPException(404)
    if not DIST.exists():
        return JSONResponse({"error": "frontend not built"}, status_code=503)
    candidate = (DIST / full_path).resolve()
    if full_path and candidate.is_file() and str(candidate).startswith(str(DIST.resolve())):
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if full_path.startswith("assets/") else {}
        return FileResponse(candidate, headers=headers)
    query = request.url.query
    return HTMLResponse(index_html_for("/" + full_path + (f"?{query}" if query else ""), request.headers.get("host")), headers={"Cache-Control": "no-cache"})


_index_cache = {}


def index_html_for(path: str, host: str | None = None) -> str:
    """index.html with a title and description that describe a viewer deep link, so a pasted link previews as
    'Rainfall, September 7, 2026, Kauaʻi' instead of the generic site title — plus the canonical link, og:url/og:image
    (the /api/og.png card) and Twitter card tags. An alias spelling previews as its canonical form."""
    p = DIST / "index.html"
    mtime = p.stat().st_mtime
    if _index_cache.get("mtime") != mtime:
        _index_cache.update(mtime=mtime, html=p.read_text(encoding="utf-8"))
    html = _index_cache["html"]
    v = parse_viewer_path(path)
    if not v:
        return html
    e = lambda s: htmlmod.escape(s, quote=True)  # noqa: E731
    what = describe_view(v)
    title = f"{what} — Hawaiʻi Climate Data Portal"
    desc = f"HCDP climate viewer: {what}. A shareable map link from the Hawaiʻi Climate Data Portal."
    origin, canonical = site_origin(host), v["canonical"]
    image = f"{origin}/api/og.png?path={quote(canonical, safe='')}"
    html = re.sub(r"<title>.*?</title>", f"<title>{e(title)}</title>", html, count=1, flags=re.S)
    html = re.sub(r'<meta name="description" content=".*?" />', f'<meta name="description" content="{e(desc)}" />', html, count=1)
    tags = "".join([
        f'<link rel="canonical" href="{e(origin + canonical.partition("?")[0])}" />',
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="Hawaiʻi Climate Data Portal" />',
        f'<meta property="og:title" content="{e(title)}" />',
        f'<meta property="og:description" content="{e(desc)}" />',
        f'<meta property="og:url" content="{e(origin + canonical)}" />',
        f'<meta property="og:image" content="{e(image)}" />',
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        f'<meta property="og:image:alt" content="{e(what)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{e(title)}" />',
        f'<meta name="twitter:description" content="{e(desc)}" />',
        f'<meta name="twitter:image" content="{e(image)}" />',
    ])
    return html.replace("</head>", tags + "</head>", 1)
