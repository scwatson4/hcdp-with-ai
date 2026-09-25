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
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")  # local development; containers get the env from compose

from llm import NavigatorLLM  # noqa: E402
from navigator import DATASETS, EXTENTS, Navigator, load_catalog  # noqa: E402

HCDP_API_BASE = os.environ.get("HCDP_API_BASE", "https://api.hcdp.ikewai.org").rstrip("/")
HCDP_TOKEN = os.environ.get("HCDP_API_TOKEN", "")
CACHE_DIR = Path(os.environ.get("RASTER_CACHE_DIR", ROOT / "cache"))
DIST = Path(os.environ.get("FRONTEND_DIST", ROOT.parent / "frontend" / "dist"))
AI_INTERFACE_URL = os.environ.get("AI_INTERFACE_URL", "https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org")

app = FastAPI(title="HCDP with AI — navigator", docs_url=None, redoc_url=None)
app.state.llm = NavigatorLLM()
app.state.navigator = Navigator(app.state.llm, load_catalog(), ai_interface_url=AI_INTERFACE_URL)
app.state.dates_cache = {}


def _hcdp_headers() -> dict:
    return {"Authorization": f"Bearer {HCDP_TOKEN}"} if HCDP_TOKEN else {}


class NavigateBody(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[dict] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)


@app.post("/api/navigate")
async def api_navigate(body: NavigateBody, request: Request):
    nav = request.app.state.navigator
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
    return {**ds["api"], "period": period, "date": date, "extent": EXTENTS[extent], "returnEmptyNotFound": "true"}


@app.get("/api/raster")
async def api_raster(dataset: str, period: str, date: str, extent: str = "statewide"):
    params = raster_params(dataset, period, date, extent)
    key = hashlib.sha1(("&".join(f"{k}={v}" for k, v in sorted(params.items()))).encode()).hexdigest()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.tif"
    recent = (dt.date.today() - dt.date.fromisoformat(date if period == "day" else date + "-01")).days < 45
    if not path.exists():
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(f"{HCDP_API_BASE}/raster", params=params, headers=_hcdp_headers())
        if r.status_code == 404 or (r.status_code == 200 and len(r.content) < 200):
            raise HTTPException(404, "no map for that date")
        if r.status_code != 200:
            raise HTTPException(502, f"HCDP API returned {r.status_code}")
        tmp = path.with_suffix(".part")
        tmp.write_bytes(r.content)
        tmp.replace(path)
    return FileResponse(path, media_type="image/tiff", headers={"Cache-Control": f"public, max-age={3600 if recent else 86400 * 30}"})


@app.get("/api/dates")
async def api_dates(request: Request, dataset: str, period: str, extent: str = "statewide"):
    params = raster_params(dataset, period, "2020-01-01" if period == "day" else "2020-01", extent)
    params.pop("date"); params.pop("returnEmptyNotFound")
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
    if full_path.startswith("api/"):
        raise HTTPException(404)
    if not DIST.exists():
        return JSONResponse({"error": "frontend not built"}, status_code=503)
    candidate = (DIST / full_path).resolve()
    if full_path and candidate.is_file() and str(candidate).startswith(str(DIST.resolve())):
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if full_path.startswith("assets/") else {}
        return FileResponse(candidate, headers=headers)
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
