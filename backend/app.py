"""HCDP with AI — the navigator backend and static host for the site.

Endpoints
  POST /api/navigate      the navigator (see CONTRACT.md for the protocol)
  GET  /api/raster        GeoTIFF proxy to the HCDP API (token stays here; disk cache)
  GET  /api/dates         available date range for a dataset (proxy, memory cache)
  GET  /api/catalog       the site catalog the navigator reasons over
  GET  /api/health
  GET  /*                 the built frontend (SPA fallback to index.html)
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
import uuid
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")  # local development; containers get the env from compose

from llm import NavigatorLLM  # noqa: E402
from navigator import DATASETS, EXTENTS, STATEWIDE_ONLY, Navigator, describe_view, load_catalog, parse_viewer_path  # noqa: E402
from rasters import reencode_geotiff  # noqa: E402
from ratelimit import RateLimiter  # noqa: E402
from mapimage import DEFAULT_RAMP, render_png  # noqa: E402

HCDP_API_BASE = os.environ.get("HCDP_API_BASE", "https://api.hcdp.ikewai.org").rstrip("/")
HCDP_TOKEN = os.environ.get("HCDP_API_TOKEN", "")
CACHE_DIR = Path(os.environ.get("RASTER_CACHE_DIR", ROOT / "cache"))
DIST = Path(os.environ.get("FRONTEND_DIST", ROOT.parent / "frontend" / "dist"))
AI_INTERFACE_URL = os.environ.get("AI_INTERFACE_URL", "https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org")

app = FastAPI(title="HCDP with AI — navigator", docs_url=None, redoc_url=None)
app.state.llm = NavigatorLLM()
app.state.navigator = Navigator(app.state.llm, load_catalog(), ai_interface_url=AI_INTERFACE_URL)
app.state.dates_cache = {}
app.state.limiter = RateLimiter(per_minute=int(os.environ.get("NAV_PER_MINUTE", "12")), per_hour=int(os.environ.get("NAV_PER_HOUR", "120")),
                                 global_per_day=int(os.environ.get("NAV_GLOBAL_PER_DAY", "5000")))


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
        "navigator_calls_today": request.app.state.limiter.today_count,
        "system_prompt_chars": len(request.app.state.navigator.system_prompt()),
    }


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


async def fetch_raster(dataset: str, period: str, date: str, extent: str) -> Path:
    """The (re-encoded) GeoTIFF for a map, fetched from HCDP once and cached on disk."""
    params = raster_params(dataset, period, date, extent)
    key = hashlib.sha1(("&".join(f"{k}={v}" for k, v in sorted(params.items()))).encode()).hexdigest()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.tif"
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
    path = await fetch_raster(dataset, period, date, extent)
    return FileResponse(path, media_type="image/tiff", headers={"Cache-Control": f"public, max-age={3600 if _is_recent(period, date) else 86400 * 30}"})


@app.get("/api/map.png")
async def api_map_png(dataset: str, period: str, date: str, extent: str = "statewide", w: int = 1200, ramp: str = ""):
    """A rendered PNG of a map (landing-page backdrops, previews); transparent where there is no data."""
    ramp = ramp or DEFAULT_RAMP.get(dataset, "viridis_r")
    if ramp not in ("viridis", "viridis_r"):
        raise HTTPException(400, "ramp must be viridis or viridis_r")
    w = max(200, min(int(w), 2400))
    path = await fetch_raster(dataset, period, date, extent)
    png_dir = CACHE_DIR / "png"; png_dir.mkdir(parents=True, exist_ok=True)
    out = png_dir / f"{path.stem}_{w}_{ramp}.png"
    if not out.exists():
        try:
            data = await run_in_threadpool(render_png, path, ramp, w)
        except ValueError:
            raise HTTPException(404, "no data in that map") from None
        tmp = out.with_name(f"{out.stem}.{uuid.uuid4().hex}.part"); tmp.write_bytes(data); tmp.replace(out)
    return FileResponse(out, media_type="image/png", headers={"Cache-Control": f"public, max-age={3600 if _is_recent(period, date) else 86400 * 30}"})


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
        items.append({"dataset": dataset, "period": period, "date": date, "extent": "statewide", "label": label,
                      "url": f"/api/map.png?dataset={dataset}&period={period}&date={date}&extent=statewide&w=1400"})
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


# ----- the built site ---------------------------------------------------------
@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    if full_path.startswith("api/") or any(seg.startswith(".") for seg in full_path.split("/")) or full_path.endswith((".php", ".asp", ".aspx", ".cgi", ".sql", ".bak")):
        raise HTTPException(404)
    if not DIST.exists():
        return JSONResponse({"error": "frontend not built"}, status_code=503)
    candidate = (DIST / full_path).resolve()
    if full_path and candidate.is_file() and str(candidate).startswith(str(DIST.resolve())):
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if full_path.startswith("assets/") else {}
        return FileResponse(candidate, headers=headers)
    return HTMLResponse(index_html_for("/" + full_path), headers={"Cache-Control": "no-cache"})


_index_cache = {}


def index_html_for(path: str) -> str:
    """index.html with a title and description that describe a viewer deep link, so a pasted link previews as
    'Rainfall, September 7, 2026, Kauaʻi' instead of the generic site title."""
    p = DIST / "index.html"
    mtime = p.stat().st_mtime
    if _index_cache.get("mtime") != mtime:
        _index_cache.update(mtime=mtime, html=p.read_text(encoding="utf-8"))
    html = _index_cache["html"]
    v = parse_viewer_path(path)
    if not v:
        return html
    title = f"{describe_view(v)} — Hawaiʻi Climate Data Portal"
    desc = f"HCDP climate viewer: {describe_view(v)}. A shareable map link from the Hawaiʻi Climate Data Portal."
    html = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", html, count=1, flags=re.S)
    html = re.sub(r'<meta name="description" content=".*?" />', f'<meta name="description" content="{desc}" />', html, count=1)
    return html.replace("</head>", f'<meta property="og:title" content="{title}" /><meta property="og:description" content="{desc}" /></head>', 1)
