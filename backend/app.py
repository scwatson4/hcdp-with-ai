"""HCDP with AI — the navigator backend and static host for the site.

Endpoints
  POST /api/navigate          the navigator (see CONTRACT.md for the protocol)
  POST /api/narrate           one short wait line from gpt-6-luna while the answer is worked out
  POST /api/summary           the AI overview of a destination (numbered sources from the catalog; sentences with cites, a 'more' fold and follow-ups from gpt-6-luna)
  POST /api/followups         three follow-up asks for a page, without a summary (the viewer asks for them 1.5 s after a rail change, N4 A)
  POST /api/feedback/wrong-page            "Wrong page?" — what the visitor wanted instead (P4 A; SQLite, no visitor data, rate-limited) → {id}
  POST /api/feedback/wrong-page/{id}/chose the page they went to next (attached once, within the client's ten minutes)
  POST /api/feedback                       a reviewer's feedback item (F1–F5, 13 Oct): thumbs on an answer/overview, a note on a selection, the tab, a 👎 with the wanted page → {id}
  GET  /api/feedback/mine?name=            the reviewer's own items (by the name their browser remembers)
  GET  /api/feedback/others?name=          everyone else's items as titles + status only (no names)
  GET  /api/feedback/names                 the reviewer names already saved (the name picker)
  POST /api/feedback/rename {from, to}     the reviewer's earlier items follow a new name
  GET  /api/admin/feedback(.csv)           the wrong-page reports, newest first, behind ADMIN_KEY (X-Admin-Key; 404 when unset, 401 when wrong)
  GET  /api/admin/feedback/review(.csv)    the review list over both tables (?kind&feature&status), with counts; PATCH /api/admin/feedback/{id} {status, admin_note}; DELETE /api/admin/feedback/{id} removes a row
  GET  /api/admin/feedback/evals.json      the 👎 / wrong-page rows that named a page, as usecases.json-shaped eval cases (F5)
  GET  /api/raster            GeoTIFF proxy to the HCDP API (token stays here; disk cache; ETag + Range)
  GET  /api/dates             available date range for a dataset (proxy, memory cache)
  GET  /api/map.png|webp      a map rendered with a viewer ramp (landing backdrops)
  GET  /api/backdrops         the landing page's backdrop maps
  GET  /api/climate-stations  HCDP's hawaii_climate_primary stations (24 h cache, memory + disk)
  GET  /api/station-values    one day's/month's station values joined with metadata (1 h cache)
  GET  /api/timeseries        a station's (station=SKN) or a grid cell's (lat&lng) record (disk cache)
  GET  /api/og.png|webp       1200×630 link-preview card for a viewer address (disk cache)
  POST /api/shorten           deterministic short link for a viewer address; GET /s/{id} redirects to it
  GET  /api/export/options    the products, files, extents and station fills the Export form offers
  POST /api/export/instant    a zip of HCDP files, streamed from HCDP /genzip/instant/content (≤ 150 files, a byte budget, per-IP limit)
  POST /api/export/email      asks HCDP /genzip/email to send the package to an address (validated here; a harder per-IP limit)
  POST /api/download/plan     the AI-prepared download (13 Oct): a data ask → a verified checklist (gpt-6.1-sol plans, HCDP's file listing confirms)
  POST /api/download/prepare  the picked items → one zip with an AI README (HCDP genzip with the VISITOR's API key) or 202 for the emailed package
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
import hmac
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
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")  # local development; containers get the env from compose

from export import (ANONYMOUS_EMAIL, EMAIL_MAX_FILES, INSTANT_MAX_FILES, ExportError, options as export_options, payload as export_payload,  # noqa: E402
                    valid_email as export_valid_email, validate as export_validate, zip_filename)
import feedback as fb  # noqa: E402
from feedback import ID_RE as FEEDBACK_ID_RE, FeedbackStore  # noqa: E402
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
# An instant export is streamed through this process: stop at this many bytes (HCDP zips 150 files at most anyway).
EXPORT_MAX_BYTES = int(os.environ.get("EXPORT_MAX_BYTES", str(500 * 1024 * 1024)))
EXPORT_TIMEOUT = float(os.environ.get("EXPORT_TIMEOUT", "300"))
# HCDP logs every genzip request under an email address, a direct download included (its packageGen.ts answers 400
# without one). A visitor who typed none is logged as this address: the operator's, else a reserved never-deliverable name.
EXPORT_LOG_EMAIL = os.environ.get("EXPORT_LOG_EMAIL", "").strip()
if not export_valid_email(EXPORT_LOG_EMAIL):
    EXPORT_LOG_EMAIL = ANONYMOUS_EMAIL
# P4 A (13 Oct): the wrong-page feedback store and the admin key that unlocks reading it (unset → the admin view is off: 404).
FEEDBACK_DB = os.environ.get("FEEDBACK_DB", str(ROOT / "cache" / "feedback.sqlite"))
ADMIN_KEY = os.environ.get("ADMIN_KEY", "").strip()

app = FastAPI(title="HCDP with AI — navigator", docs_url=None, redoc_url=None)
app.state.llm = NavigatorLLM()
app.state.navigator = Navigator(app.state.llm, load_catalog(), ai_interface_url=AI_INTERFACE_URL)
from llm import NarrationLLM, PlannerLLM, SummaryLLM  # noqa: E402
from summary import Summarizer, empty_summary  # noqa: E402
import download_plan as dl  # noqa: E402
app.state.narrator = NarrationLLM()
app.state.summarizer = Summarizer(app.state.navigator, SummaryLLM())
# The live mirror of HCDP's pages (CONTRACT.md "Mirrored pages", 14 Oct): the copies on the cache volume, the endpoints
# (/api/portal/page, /api/portal/img, /api/portal/library) and the background job (one worker leads it).
import portal  # noqa: E402
portal.setup(app, CACHE_DIR)
app.include_router(portal.router)
# The AI-prepared download's planner (13 Oct): gpt-6.1-sol (DOWNLOAD_MODEL) through the navigator's route; its own limiter.
app.state.planner = dl.DownloadPlanner(PlannerLLM(), app.state.navigator)
app.state.download_limiter = RateLimiter(per_minute=int(os.environ.get("DOWNLOAD_PER_MINUTE", "6")), per_hour=int(os.environ.get("DOWNLOAD_PER_HOUR", "40")), global_per_day=int(os.environ.get("DOWNLOAD_GLOBAL_PER_DAY", "800")))
app.state.dates_cache = {}
app.state.limiter = RateLimiter(per_minute=int(os.environ.get("NAV_PER_MINUTE", "12")), per_hour=int(os.environ.get("NAV_PER_HOUR", "120")),
                                 global_per_day=int(os.environ.get("NAV_GLOBAL_PER_DAY", "5000")))
# Short links are cheap but write files: a second limiter keeps one visitor from filling the disk.
# The wait line: one tiny gpt-6-luna call per question, in parallel with the answer; its own limiter mirrors the navigator's.
app.state.narrate_limiter = RateLimiter(per_minute=int(os.environ.get("NAV_PER_MINUTE", "12")), per_hour=int(os.environ.get("NAV_PER_HOUR", "120")), global_per_day=int(os.environ.get("NARRATE_GLOBAL_PER_DAY", "5000")))
# The AI summary (one gpt-6-luna call per navigation) and the stand-alone follow-ups each get the navigator's numbers too.
app.state.summary_limiter = RateLimiter(per_minute=int(os.environ.get("NAV_PER_MINUTE", "12")), per_hour=int(os.environ.get("NAV_PER_HOUR", "120")), global_per_day=int(os.environ.get("SUMMARY_GLOBAL_PER_DAY", "5000")))
app.state.followups_limiter = RateLimiter(per_minute=int(os.environ.get("NAV_PER_MINUTE", "12")), per_hour=int(os.environ.get("NAV_PER_HOUR", "120")), global_per_day=int(os.environ.get("FOLLOWUPS_GLOBAL_PER_DAY", "5000")))
app.state.short_limiter = RateLimiter(per_minute=int(os.environ.get("SHORT_PER_MINUTE", "30")), per_hour=int(os.environ.get("SHORT_PER_HOUR", "300")), global_per_day=200000)
# Exports cost HCDP real work: a limiter per visitor for downloads, a harder one for emailed packages.
app.state.export_limiter = RateLimiter(per_minute=int(os.environ.get("EXPORT_PER_MINUTE", "6")), per_hour=int(os.environ.get("EXPORT_PER_HOUR", "40")), global_per_day=int(os.environ.get("EXPORT_GLOBAL_PER_DAY", "2000")))
app.state.email_limiter = RateLimiter(per_minute=int(os.environ.get("EMAIL_PER_MINUTE", "2")), per_hour=int(os.environ.get("EMAIL_PER_HOUR", "10")), global_per_day=int(os.environ.get("EMAIL_GLOBAL_PER_DAY", "500")))
# Wrong-page feedback (P4 A): a report and its follow-up write a row each; a limiter keeps one connection from filling the table.
app.state.feedback_limiter = RateLimiter(per_minute=int(os.environ.get("FEEDBACK_PER_MINUTE", "6")), per_hour=int(os.environ.get("FEEDBACK_PER_HOUR", "40")), global_per_day=int(os.environ.get("FEEDBACK_GLOBAL_PER_DAY", "5000")))
# The review-period feedback (F1–F5): thumbs are one tap each, so its own, roomier limiter (the IP is only ever counted, never stored).
app.state.feedback_items_limiter = RateLimiter(per_minute=int(os.environ.get("FEEDBACK_ITEMS_PER_MINUTE", "12")), per_hour=int(os.environ.get("FEEDBACK_ITEMS_PER_HOUR", "120")), global_per_day=int(os.environ.get("FEEDBACK_ITEMS_GLOBAL_PER_DAY", "10000")))
app.state.admin_key = ADMIN_KEY
try:
    app.state.feedback = FeedbackStore(FEEDBACK_DB)
except Exception as _e:  # noqa: BLE001 - an unwritable path: the endpoints answer 503 instead of taking the site down
    app.state.feedback = None
    app.state.feedback_error = type(_e).__name__
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


class NarrateBody(BaseModel):
    message: str = ""


@app.post("/api/narrate")
async def api_narrate(body: NarrateBody, request: Request):
    """One short line for the wait indicator ("Pulling up the API access info"), from gpt-6-luna; null when the
    model is slow, over budget or unavailable — the page then shows "Working on that…"."""
    if request.app.state.narrate_limiter.check(request.client.host if request.client else "?"):
        return {"line": None}
    narrator = getattr(request.app.state, "narrator", None)
    if narrator is None or not narrator.configured:
        return {"line": None}
    line = await run_in_threadpool(narrator.narrate, body.message)
    return {"line": line}


class SummaryBody(BaseModel):
    message: str = Field(default="", max_length=500)
    reply: str = Field(default="", max_length=1000)
    path: str = Field(default="", max_length=1000)
    intent: str = Field(default="navigate", max_length=40)


@app.post("/api/summary")
async def api_summary(body: SummaryBody, request: Request):
    """The AI overview for the page the navigator just opened (13 Oct): {summary, chunks, cites, more, more_cites, sources,
    followups}. The sources come from the catalog (numbered; `cites` says which each sentence rests on), the sentences,
    the "more" fold and the follow-ups from gpt-6-luna. Everything is empty — a 200, never an error — for an off-topic or
    analysis answer, an address this site does not have, a spent limiter, or a model that failed or timed out; the client
    then shows its reply strip instead."""
    if body.intent in ("off_topic", "analysis") or not body.path.startswith("/"):
        return empty_summary()
    if request.app.state.summary_limiter.check(request.client.host if request.client else "?"):
        return empty_summary()
    summarizer = getattr(request.app.state, "summarizer", None)
    if summarizer is None:
        return empty_summary()
    out = await run_in_threadpool(summarizer.summarize, body.message, body.reply, body.path, body.intent)
    if out.get("chunks"):
        out["request_id"] = uuid.uuid4().hex   # P4 A: a "Wrong page?" report names the overview it was about
    return out


class FollowupsBody(BaseModel):
    path: str = Field(default="", max_length=1000)
    context: dict = Field(default_factory=dict)


@app.post("/api/followups")
async def api_followups(body: FollowupsBody, request: Request):
    """Three follow-up asks for a page, without a summary: {followups}. Reserved for the follow-ups-that-follow-the-view
    feature (the client does not call it yet); its own limiter; empty on any failure."""
    if not body.path.startswith("/") or request.app.state.followups_limiter.check(request.client.host if request.client else "?"):
        return {"followups": []}
    summarizer = getattr(request.app.state, "summarizer", None)
    if summarizer is None:
        return {"followups": []}
    return {"followups": await run_in_threadpool(summarizer.followups_for, body.path, body.context)}


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
    narrator = getattr(request.app.state, "narrator", None)
    summarizer = getattr(request.app.state, "summarizer", None)
    summary_llm = getattr(summarizer, "llm", None)
    planner_llm = getattr(getattr(request.app.state, "planner", None), "llm", None)
    store = getattr(request.app.state, "feedback", None)
    try:
        stored = store.count() if store is not None else None
        items = store.count_items() if store is not None else None
    except Exception:  # noqa: BLE001
        stored = items = None
    return {
        "ok": True, "model": llm.model, "model_configured": llm.configured, "llm": llm.stats,
        # P4 A: whether the admin view is unlocked (a boolean, never the key) and whether the store answers; `stored` counts the
        # wrong-page reports, `items` the review-period feedback items (F1–F5)
        "feedback": {"enabled": bool(getattr(request.app.state, "admin_key", "")), "store": store is not None, "stored": stored, "items": items},
        # the two small gpt-6-luna clients (the wait line, the AI overview): calls, errors, the last error's class and latency
        "narration": {"model": getattr(narrator, "model", None), "stats": getattr(narrator, "stats", None)},
        "summary": {"model": getattr(summary_llm, "model", None), "timeout": getattr(summary_llm, "timeout", None), "stats": getattr(summary_llm, "stats", None)},
        # the download planner (13 Oct): model, fallback model, timeout, token budget and its client stats
        "planner": {"model": getattr(planner_llm, "model", None), "fallback_model": getattr(planner_llm, "fallback_model", None), "timeout": getattr(planner_llm, "timeout", None),
                    "max_completion_tokens": getattr(planner_llm, "max_completion_tokens", None), "stats": getattr(planner_llm, "stats", None)},
        # the mirror of HCDP's pages (14 Oct): copies cached / in the seed, the newest and oldest copy, the job's last runs, failures
        "portal": portal.health(request.app.state.portal),
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
    """Only what changes the picture: dataset, period, date, extent, ramp (and its direction), scale, a locked range,
    pseudo-log, units (not camera, basemap, layers, station)."""
    o = v["opts"]
    rng = o.get("range")
    return hashlib.sha1("|".join([v["dataset"], v["period"], v["date"], v["extent"], ramp, "r" if o.get("reverse") else "", o.get("scale", ""),
                                  f"{rng[0]}..{rng[1]}" if rng else "", "log" if o.get("log") else "", o.get("units", ""), fmt]).encode()).hexdigest()


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
            data = await run_in_threadpool(render_og, tif, ramp, legend["domain"], describe_view(v), subtitle, (legend["lo"], legend["hi"], legend["header"]), crop, fmt,
                                           "Hawaiʻi Climate Data Portal", bool(opts.get("reverse")), bool(opts.get("log")))
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


# ----- native export (CONTRACT.md "Export endpoints") ------------------------------------------
class ExportBody(BaseModel):
    dataset: str = Field(max_length=40)
    period: str = Field(max_length=10)
    start: str = Field(max_length=10)
    end: str = Field(max_length=10)
    extents: list[str] = Field(default_factory=list, max_length=10)
    files: list[str] = Field(default_factory=list, max_length=10)
    station_files: list[str] = Field(default_factory=list, max_length=4)
    email: str | None = Field(default=None, max_length=254)


@app.get("/api/export/options")
async def api_export_options():
    """The products the Export form offers, with their files, extents and station fills (export.py mirrors hcdp_v2)."""
    return JSONResponse(export_options(), headers={"Cache-Control": "public, max-age=3600"})


def _export_request(body: ExportBody) -> dict:
    try:
        return export_validate(body.model_dump())
    except ExportError as e:
        raise HTTPException(400, str(e)) from None


def _hcdp_said(r: httpx.Response) -> str:
    """HCDP's own words for a refused genzip request (its 400s name the fields it wants — the one clue there is), one
    line of at most 300 characters; an HTML error page or an unreadable body gives nothing."""
    try:
        text = " ".join(r.text.split())
    except Exception:  # noqa: BLE001
        return ""
    return "" if not text or text.startswith("<") else text[:300]


def _hcdp_refused(r: httpx.Response) -> HTTPException:
    said = _hcdp_said(r)
    return HTTPException(502, f"HCDP returned {r.status_code} for this package" + (f": {said}" if said else ""))


@app.post("/api/export/instant")
async def api_export_instant(body: ExportBody, request: Request):
    """HCDP /genzip/instant/content, streamed back as a zip download. Capped at hcdp_v2's 150 files (413 above: have it
    emailed) and at EXPORT_MAX_BYTES (413 when HCDP says the size up front; otherwise the stream stops there)."""
    if request.app.state.export_limiter.check(request.client.host if request.client else "?"):
        return JSONResponse({"detail": "That is a lot of downloads from one connection in a short time. Wait a minute and try again, or have the package emailed."}, status_code=429)
    req = _export_request(body)
    if req["files"] > INSTANT_MAX_FILES:
        raise HTTPException(413, f"about {req['files']:,} files: HCDP zips at most {INSTANT_MAX_FILES} for a direct download — have the package emailed instead")
    client = _hcdp_client(EXPORT_TIMEOUT)
    try:
        resp = await client.send(client.build_request("POST", "/genzip/instant/content", json=export_payload(req, EXPORT_LOG_EMAIL)), stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        raise HTTPException(502, f"HCDP did not answer ({type(e).__name__})") from None
    if resp.status_code != 200:
        await resp.aread()
        await client.aclose()
        raise _hcdp_refused(resp)
    length = resp.headers.get("content-length")
    if length and length.isdigit() and int(length) > EXPORT_MAX_BYTES:
        await resp.aclose()
        await client.aclose()
        raise HTTPException(413, f"this package is {int(length) / 1048576:,.0f} MB, more than this site streams ({EXPORT_MAX_BYTES / 1048576:,.0f} MB) — have it emailed instead")

    async def chunks():
        sent = 0
        try:
            async for chunk in resp.aiter_bytes():
                sent += len(chunk)
                if sent > EXPORT_MAX_BYTES:
                    break      # the budget: a stream already under way can only stop
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    headers = {"Content-Disposition": f'attachment; filename="{zip_filename(req)}"', "Cache-Control": "no-store", "X-HCDP-Files": str(req["files"])}
    if length and length.isdigit():
        headers["Content-Length"] = length
    return StreamingResponse(chunks(), media_type="application/zip", headers=headers)


@app.post("/api/export/email")
async def api_export_email(body: ExportBody, request: Request):
    """HCDP /genzip/email: the package is zipped on their side and a link mailed to the address (which is never stored here)."""
    if request.app.state.email_limiter.check(request.client.host if request.client else "?"):
        return JSONResponse({"detail": "That is a lot of email requests from one connection in a short time. Wait a few minutes and try again."}, status_code=429)
    req = _export_request(body)
    if not req["email"]:
        raise HTTPException(400, "an email address is needed to send the package")
    if req["files"] > EMAIL_MAX_FILES:
        raise HTTPException(413, f"about {req['files']:,} files is more than one package can hold ({EMAIL_MAX_FILES:,}); narrow the dates or the files")
    try:
        async with _hcdp_client(60) as client:
            r = await client.post("/genzip/email", json=export_payload(req, EXPORT_LOG_EMAIL))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"HCDP did not answer ({type(e).__name__})") from None
    if r.status_code not in (200, 202):
        raise _hcdp_refused(r)
    return JSONResponse({"ok": True, "email": req["email"], "files": req["files"],
                         "message": f"HCDP is packaging about {req['files']:,} files and will email a download link to {req['email']}. Large packages can take a while; if nothing arrives within a few hours, check the address and try again or write to hcdp@hawaii.edu."},
                        status_code=202, headers={"Cache-Control": "no-store"})


# ----- the AI-prepared download (CONTRACT.md "The AI-prepared download", 13 Oct) ------------------------
class DownloadPlanBody(BaseModel):
    ask: str = Field(min_length=1, max_length=500)
    context: dict = Field(default_factory=dict)
    hints: dict = Field(default_factory=dict)
    extra: str = Field(default="", max_length=300)
    previous: list[dict] = Field(default_factory=list, max_length=dl.MAX_ITEMS)


EXPORT_PRODUCT_PERIODS = [(p["id"], per) for p in dl.PRODUCTS for per in p["periods"]]


async def product_ranges(request: Request) -> dict:
    """{(product, period): (first, last)} for every product the export packages, from HCDP's date ranges (cached an hour by
    /api/dates); a product whose range cannot be read is simply not clamped."""
    out = {}

    async def one(product: str, period: str) -> None:
        try:
            out[(product, period)] = await date_range(request, product, period)
        except Exception:  # noqa: BLE001 - no range, no clamping
            pass

    await asyncio.gather(*(one(p, per) for p, per in EXPORT_PRODUCT_PERIODS))
    return out


async def hcdp_file_listing(data: list[dict]) -> list[str] | None:
    """HCDP GET /files/production/list with the SERVER's token (the same read the viewer's date ranges make): the links of the
    files a genzip request would zip; None when HCDP does not answer 200."""
    async with _hcdp_client(dl.LIST_TIMEOUT) as client:
        r = await client.get("/files/production/list", params={"data": json.dumps(data)})
    if r.status_code != 200:
        return None
    body = r.json()
    return [str(x) for x in body] if isinstance(body, list) else None


def _plan_links(plan: dict, request: Request) -> dict:
    """The package address (this site's /download?ask=&picks= for the ticked items), the Analyze-with-AI hand-off link and the
    catalog's API page URL, added to a plan."""
    nav = request.app.state.navigator
    picks = [i["id"] for i in plan["items"] if i.get("ticked")]
    path = dl.package_path(plan["ask"], picks)
    package_url = f"{site_origin(request.headers.get('host'))}{path}"
    plan["package_path"] = path
    plan["package_url"] = package_url
    plan["analyze_url"] = nav.handoff_url(dl.analyze_ask(plan["ask"], package_url), {"path": plan.get("primary_view")})
    plan["api_url"] = nav.api_page_url()
    plan["estimate"] = dl.estimate(plan["items"])
    return plan


@app.post("/api/download/plan")
async def api_download_plan(body: DownloadPlanBody, request: Request):
    """A data ask → the verified plan: the plain-English reading, the checklist grouped by kind (gridded maps · station data ·
    from the storm report) with the AI's first picks ticked, every grid and station item checked against HCDP's file listing
    (exact counts; unpublished dates trimmed and named; an item that does not exist is in `dropped`, not offered), the
    primary viewer map, the package address and the Analyze-with-AI link. 429 over the limiter, 503 when the planner is
    not configured or did not answer in time."""
    verdict = request.app.state.download_limiter.check(request.client.host if request.client else "?")
    if verdict:
        return JSONResponse({"detail": "That is a lot of download plans from one connection in a short time. Wait a minute and try again, or use the Export form below."}, status_code=429)
    planner = getattr(request.app.state, "planner", None)
    if planner is None or planner.llm is None or not getattr(planner.llm, "configured", False):
        return JSONResponse({"detail": "The AI planner is not configured on this server; the Export form still works."}, status_code=503)
    ranges = await product_ranges(request)
    plan = await run_in_threadpool(planner.plan, body.ask, ranges, body.hints, body.extra, body.previous[-dl.MAX_ITEMS:], body.context)
    if plan is None:
        return JSONResponse({"detail": "The AI planner did not answer in time. Try again in a moment, or tick the Export form yourself."}, status_code=503)
    if not plan["items"]:
        plan["reading"] = plan["reading"] or "I could not match this to anything HCDP's export packages (gridded rainfall and temperature maps, and their station data, by day or month)."
    offered, gone = await dl.verify_items(plan["items"], hcdp_file_listing)
    plan["items"], plan["dropped"] = offered, (plan.get("dropped") or []) + gone
    plan["groups"] = [{"id": g, "label": dl.GROUP_LABELS[g]} for g in dl.GROUPS if any(i["group"] == g for i in offered)]
    return JSONResponse(_plan_links(plan, request), headers={"Cache-Control": "no-store"})


def _unlink_quietly(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _prepare_request(raw: dict) -> dict:
    """The prepare body checked by hand — never through a pydantic model, whose 422 echoes the offending input (and so could
    echo the API key). Returns {ask, reading, items, api_key, email, picks}; raises HTTPException with plain words."""
    if not isinstance(raw, dict):
        raise HTTPException(400, "the request must be a JSON object")
    api_key = raw.get("api_key")
    if not isinstance(api_key, str) or not (8 <= len(api_key.strip()) <= 4096) or any(ord(c) < 32 or ord(c) == 127 for c in api_key):
        raise HTTPException(400, "An HCDP API key is needed to prepare the package: paste yours in the key field, or request one on HCDP's API page.")
    ask = raw.get("ask")
    if not isinstance(ask, str) or not ask.strip() or len(ask) > 500:
        raise HTTPException(400, "the ask is missing")
    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not items_raw or len(items_raw) > dl.MAX_ITEMS:
        raise HTTPException(400, "tick at least one item to prepare (and at most eight)")
    try:
        items, dropped = dl.normalize_items([i for i in items_raw if isinstance(i, dict) and i.get("group") in ("grid", "station")], None, strict=True)
    except dl.PlanError as e:
        raise HTTPException(400, str(e)) from None
    if not items:
        why = dropped[0]["why"] if dropped else "none of the ticked items is a package HCDP can build"
        raise HTTPException(400, why)
    reports = [i for i in items_raw if isinstance(i, dict) and i.get("group") == "report" and isinstance(i.get("url"), str)]
    email = raw.get("email")
    email = email.strip() if isinstance(email, str) else ""
    if email and not export_valid_email(email):
        raise HTTPException(400, "that does not look like an email address")
    reading = raw.get("reading")
    return {"ask": ask.strip(), "reading": dl.clean_text(reading)[:1500] if isinstance(reading, str) else "", "items": items, "reports": reports,
            "api_key": api_key.strip(), "email": email, "event": str(raw.get("event") or "")[:80] or None, "place": str(raw.get("place") or "")[:60] or None,
            "primary_view": canonical_viewer_path(raw.get("primary_view")) if isinstance(raw.get("primary_view"), str) else None}


def _report_items(nav, reports: list[dict]) -> list[dict]:
    """Report links the client sent back, kept only when they are catalog URLs (the README never carries a stray link)."""
    out = []
    for r in reports[:dl.MAX_REPORT_LINKS]:
        u = r.get("url")
        if isinstance(u, str) and nav.allowed_url(u) and any(e.get("url") == u for e in nav.catalog):
            out.append({"id": str(r.get("id") or "report")[:60], "group": "report", "label": str(r.get("label") or u)[:120], "url": u, "why": dl.clean_text(r.get("why"))[:dl.MAX_WHY_CHARS]})
    return out


@app.post("/api/download/prepare")
async def api_download_prepare(request: Request, raw: dict = Body(...)):
    """The picked items → the package. Body {ask, reading?, items: [the plan's items as given], api_key, email?, event?, place?,
    primary_view?}. The VISITOR's HCDP API key is required: it goes to HCDP as this one request's Authorization header and is
    never logged, stored or echoed (the server's own token is not used for AI-prepared packages). Up to 150 files (counted from
    HCDP's listing): the zip streams back with README.md added — Content-Disposition attachment, X-HCDP-Files. Over 150 with an
    email: HCDP /genzip/email, 202 {ok, email, files, message, readme, package_url, analyze_url} (the README cannot ride in HCDP's
    own zip, so it comes back for saving). Over 150 without an email: 413. HCDP refusing the key: 401."""
    req = _prepare_request(raw)
    nav = request.app.state.navigator
    counted, gone = await dl.verify_items(req["items"], hcdp_file_listing)
    if not counted:
        raise HTTPException(409, gone[0]["why"] if gone else "HCDP has no files for these items any more")
    files = sum(int(i.get("count") or 0) for i in counted)
    picks = [i["id"] for i in counted] + [r["id"] for r in req["reports"]]
    path = dl.package_path(req["ask"], picks)
    package_url = f"{site_origin(request.headers.get('host'))}{path}"
    analyze_url = nav.handoff_url(dl.analyze_ask(req["ask"], package_url), {"path": req["primary_view"]})
    plan = {"ask": req["ask"], "reading": req["reading"], "event": req["event"], "place": req["place"]}
    readme = dl.readme_text(plan, counted + _report_items(nav, req["reports"]), package_url, analyze_url, site_origin(request.headers.get("host")))
    headers = {"Authorization": f"Bearer {req['api_key']}"}
    ip = request.client.host if request.client else "?"
    if files > INSTANT_MAX_FILES:
        if not req["email"]:
            raise HTTPException(413, f"about {files:,} files: HCDP zips at most {INSTANT_MAX_FILES} for a direct download — add your email and HCDP will send the package")
        if request.app.state.email_limiter.check(ip):
            return JSONResponse({"detail": "That is a lot of email requests from one connection in a short time. Wait a few minutes and try again."}, status_code=429)
        try:
            dl.check_email_size(files)
            async with httpx.AsyncClient(base_url=HCDP_API_BASE, headers=headers, timeout=60) as client:
                await dl.email_request(client, dl.genzip_payload(counted, req["email"]))
        except dl.PrepareError as e:
            raise HTTPException(e.status, e.detail) from None
        return JSONResponse({"ok": True, "email": req["email"], "files": files, "readme": readme, "package_url": package_url, "analyze_url": analyze_url,
                             "message": f"HCDP is packaging about {files:,} files and will email a download link to {req['email']} (the link stays good for three days). The README is here to save beside it."},
                            status_code=202, headers={"Cache-Control": "no-store"})
    if request.app.state.export_limiter.check(ip):
        return JSONResponse({"detail": "That is a lot of downloads from one connection in a short time. Wait a minute and try again, or have the package emailed."}, status_code=429)
    client = httpx.AsyncClient(base_url=HCDP_API_BASE, headers=headers, timeout=EXPORT_TIMEOUT)
    try:
        zip_path = await dl.fetch_zip(client, dl.genzip_payload(counted, req["email"], EXPORT_LOG_EMAIL), EXPORT_MAX_BYTES, CACHE_DIR / "tmp")
    except dl.PrepareError as e:
        raise HTTPException(e.status, e.detail) from None
    finally:
        await client.aclose()
    try:
        await run_in_threadpool(dl.add_readme, zip_path, readme)
    except Exception:  # noqa: BLE001
        _unlink_quietly(zip_path)
        raise HTTPException(502, "the package arrived but the README could not be added to it") from None
    return FileResponse(zip_path, media_type="application/zip", filename=dl.zip_name(counted, req["event"]), background=BackgroundTask(_unlink_quietly, zip_path),
                        headers={"Cache-Control": "no-store", "X-HCDP-Files": str(files), "X-Package-Path": quote(path, safe="/?=&,%")})


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


# ----- wrong-page feedback (P4 A, 13 Oct; CONTRACT.md "Wrong page?") -----------------------------
class WantedBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    url: str | None = Field(default=None, max_length=1000)
    text: str | None = Field(default=None, max_length=500)


class WrongPageBody(BaseModel):
    ask: str = Field(default="", max_length=500)
    reply: str = Field(default="", max_length=1000)
    destination: str = Field(default="", max_length=1000)
    overview_id: str | None = Field(default=None, max_length=64)
    wanted: WantedBody


class ChoseBody(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


def _feedback_store(request: Request) -> FeedbackStore:
    store = getattr(request.app.state, "feedback", None)
    if store is None:
        raise HTTPException(503, "the feedback store is unavailable")
    return store


def _a_place(ref: str | None, request: Request) -> bool:
    """A page this site can open: one of its own paths, or an HCDP url the navigator allows."""
    if not isinstance(ref, str) or not ref.strip():
        return False
    if ref.startswith("/"):
        return "\n" not in ref and len(ref) <= 1000
    return request.app.state.navigator.allowed_url(ref)


@app.post("/api/feedback/wrong-page")
async def api_wrong_page(body: WrongPageBody, request: Request):
    """The visitor said the overview's page was the wrong one and named what they wanted: an alternative ({title, url})
    or a line of text ({text}). Stores the ask, the reply, the destination and the want — nothing about the visitor —
    and answers {id}; the client attaches the next navigation to that id."""
    if request.app.state.feedback_limiter.check(request.client.host if request.client else "?"):
        return JSONResponse({"detail": "That is a lot of feedback from one connection in a short time. Wait a minute and try again."}, status_code=429)
    if not body.destination.startswith("/"):
        raise HTTPException(400, "destination must be a path on this site")
    w = body.wanted
    text = (w.text or "").strip()
    url = (w.url or "").strip()
    if url and not _a_place(url, request):
        raise HTTPException(400, "wanted.url must be a page on this site or an HCDP page")
    if not url and not text:
        raise HTTPException(400, "wanted needs a url or a text")
    wanted = {"title": (w.title or "").strip()[:200] or None, "url": url or None, "text": text or None}
    store = _feedback_store(request)
    fid = await run_in_threadpool(store.record, body.ask.strip(), body.reply.strip(), body.destination.strip(), (body.overview_id or "").strip() or None, wanted)
    return JSONResponse({"id": fid}, headers={"Cache-Control": "no-store"})


@app.post("/api/feedback/wrong-page/{fid}/chose")
async def api_wrong_page_chose(fid: str, body: ChoseBody, request: Request):
    """The page the visitor went to next (a path here, or an HCDP url they opened); attached once per report."""
    if not FEEDBACK_ID_RE.match(fid):
        raise HTTPException(404, "unknown report")
    if request.app.state.feedback_limiter.check(request.client.host if request.client else "?"):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    if not _a_place(body.path, request):
        raise HTTPException(400, "path must be a page on this site or an HCDP page")
    store = _feedback_store(request)
    ok = await run_in_threadpool(store.attach_choice, fid, body.path.strip())
    return JSONResponse({"ok": ok}, headers={"Cache-Control": "no-store"})


def _admin_check(request: Request) -> None:
    """404 while no ADMIN_KEY is set (the admin view does not exist); 401 for a missing or wrong X-Admin-Key."""
    key = getattr(request.app.state, "admin_key", "") or ""
    if not key:
        raise HTTPException(404)
    given = request.headers.get("x-admin-key", "")
    if not given or not hmac.compare_digest(given.encode("utf-8"), key.encode("utf-8")):
        raise HTTPException(401, "Not authorised")


@app.get("/api/admin/feedback")
async def api_admin_feedback(request: Request):
    """The wrong-page reports, newest first (at most 500), with the count — behind the admin key."""
    _admin_check(request)
    store = _feedback_store(request)
    rows, count = await run_in_threadpool(lambda: (store.rows(), store.count()))
    return JSONResponse({"count": count, "rows": rows}, headers={"Cache-Control": "no-store"})


@app.get("/api/admin/feedback.csv")
async def api_admin_feedback_csv(request: Request):
    """The same as CSV with a header row, for a spreadsheet."""
    _admin_check(request)
    store = _feedback_store(request)
    text = await run_in_threadpool(store.csv)
    return PlainTextResponse(text, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="hcdp-wrong-page-feedback.csv"', "Cache-Control": "no-store"})


# ----- the review-period feedback (F1–F5, 13 Oct; CONTRACT.md "Feedback") -------------------------
class FeedbackPageBody(BaseModel):
    path: str = Field(default="", max_length=1000)
    title: str = Field(default="", max_length=200)


class FeedbackBody(BaseModel):
    kind: str = Field(max_length=20)
    rating: str | None = Field(default=None, max_length=8)
    feature: str = Field(default="other", max_length=20)
    page: FeedbackPageBody = Field(default_factory=FeedbackPageBody)
    quote: str | None = Field(default=None, max_length=500)
    ask: str | None = Field(default=None, max_length=500)
    reply: str | None = Field(default=None, max_length=2000)
    overview_id: str | None = Field(default=None, max_length=64)
    wanted: WantedBody | None = None
    text: str = Field(default="", max_length=2000)
    reviewer_name: str = Field(default="", max_length=60)


class FeedbackRenameBody(BaseModel):
    old: str = Field(min_length=1, max_length=60, alias="from")
    new: str = Field(min_length=1, max_length=60, alias="to")
    model_config = {"populate_by_name": True}


class FeedbackPatchBody(BaseModel):
    status: str | None = Field(default=None, max_length=12)
    admin_note: str | None = Field(default=None, max_length=2000)


def _feedback_limited(request: Request):
    if request.app.state.feedback_items_limiter.check(request.client.host if request.client else "?"):
        return JSONResponse({"detail": "That is a lot of feedback from one connection in a short time. Wait a minute and try again."}, status_code=429)
    return None


@app.post("/api/feedback")
async def api_feedback(body: FeedbackBody, request: Request):
    """One feedback item from a reviewer: a thumbs up or down on an AI answer or overview (the exchange attached), a note
    on a selected passage (the quote), a note from the "Give feedback" tab (a feature picked), or a 👎 that names the
    page that was wanted. Free text is required except for a one-tap thumbs up. Stores the page, the feature, the
    attachments, the text and the reviewer's name — nothing about the visitor's connection — and answers {id}."""
    limited = _feedback_limited(request)
    if limited:
        return limited
    if body.kind not in fb.KINDS:
        raise HTTPException(400, "kind must be one of " + ", ".join(fb.KINDS))
    rating = (body.rating or "").strip() or None
    if rating is not None and rating not in fb.RATINGS:
        raise HTTPException(400, "rating must be up or down")
    if body.kind == "thumbs" and rating is None:
        raise HTTPException(400, "a thumbs item needs a rating")
    feature = (body.feature or "other").strip() or "other"
    if feature not in fb.FEATURES:
        raise HTTPException(400, "feature must be one of " + ", ".join(fb.FEATURES))
    text = body.text.strip()
    if not text and not (body.kind == "thumbs" and rating == "up"):
        raise HTTPException(400, "say something in the text")
    path = body.page.path.strip()
    if path and not (path.startswith("/") and "\n" not in path):
        raise HTTPException(400, "page.path must be a path on this site")
    wanted = None
    if body.wanted is not None:
        wtext = (body.wanted.text or "").strip()
        wurl = (body.wanted.url or "").strip()
        if wurl and not _a_place(wurl, request):
            raise HTTPException(400, "wanted.url must be a page on this site or an HCDP page")
        if wurl or wtext:
            wanted = {"title": (body.wanted.title or "").strip()[:200] or None, "url": wurl or None, "text": wtext or None}
    item = {"kind": body.kind, "rating": rating, "feature": feature, "page_path": path or None, "page_title": body.page.title.strip() or None,
            "quote": (body.quote or "").strip() or None, "ask": (body.ask or "").strip() or None, "reply": (body.reply or "").strip() or None,
            "overview_id": (body.overview_id or "").strip() or None, "wanted": wanted, "text": text or None, "reviewer_name": body.reviewer_name.strip() or None}
    store = _feedback_store(request)
    fid = await run_in_threadpool(store.add, item)
    return JSONResponse({"id": fid}, headers={"Cache-Control": "no-store"})


@app.get("/api/feedback/mine")
async def api_feedback_mine(request: Request, name: str = Query(default="", max_length=60)):
    """The reviewer's own items, by the name their browser remembers (a review-period convenience, not an identity)."""
    store = _feedback_store(request)
    rows = await run_in_threadpool(store.mine, name) if name.strip() else []
    return JSONResponse({"rows": rows}, headers={"Cache-Control": "no-store"})


@app.get("/api/feedback/others")
async def api_feedback_others(request: Request, name: str = Query(default="", max_length=60)):
    """Everyone else's items as titles and statuses only — never a name."""
    store = _feedback_store(request)
    rows = await run_in_threadpool(store.others, name)
    return JSONResponse({"rows": rows}, headers={"Cache-Control": "no-store"})


@app.get("/api/feedback/names")
async def api_feedback_names(request: Request):
    """The reviewer names already saved with feedback, newest first — the panel's name picker (15 Oct)."""
    store = _feedback_store(request)
    names = await run_in_threadpool(store.names)
    return JSONResponse({"names": names}, headers={"Cache-Control": "no-store"})


@app.post("/api/feedback/rename")
async def api_feedback_rename(body: FeedbackRenameBody, request: Request):
    """The reviewer changed their name in the panel: their earlier items follow it."""
    limited = _feedback_limited(request)
    if limited:
        return limited
    store = _feedback_store(request)
    n = await run_in_threadpool(store.rename, body.old, body.new)
    return JSONResponse({"ok": True, "changed": n}, headers={"Cache-Control": "no-store"})


def _review_filters(kind: str, feature: str, status: str) -> tuple[str | None, str | None, str | None]:
    kind, feature, status = kind.strip(), feature.strip(), status.strip()
    if kind and kind not in fb.KINDS:
        raise HTTPException(400, "unknown kind")
    if feature and feature not in fb.FEATURES:
        raise HTTPException(400, "unknown feature")
    if status and status not in fb.STATUSES:
        raise HTTPException(400, "unknown status")
    return kind or None, feature or None, status or None


@app.get("/api/admin/feedback/review")
async def api_admin_feedback_review(request: Request, kind: str = Query(default="", max_length=20), feature: str = Query(default="", max_length=20), status: str = Query(default="", max_length=12)):
    """The admin's review list over BOTH tables (the feedback items and the wrong-page reports as kind wrong_page),
    newest first, filtered by kind, feature and status; with the counts for the whole store."""
    _admin_check(request)
    k, f, s = _review_filters(kind, feature, status)
    store = _feedback_store(request)
    rows, counts = await run_in_threadpool(lambda: (store.review(k, f, s), store.review_counts()))
    return JSONResponse({"count": len(rows), "counts": counts, "rows": rows}, headers={"Cache-Control": "no-store"})


@app.get("/api/admin/feedback/review.csv")
async def api_admin_feedback_review_csv(request: Request, kind: str = Query(default="", max_length=20), feature: str = Query(default="", max_length=20), status: str = Query(default="", max_length=12)):
    """The review list as CSV with a header row (the same filters)."""
    _admin_check(request)
    k, f, s = _review_filters(kind, feature, status)
    store = _feedback_store(request)
    text = await run_in_threadpool(lambda: store.review_csv(store.review(k, f, s, 5000)))
    return PlainTextResponse(text, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="hcdp-feedback-review.csv"', "Cache-Control": "no-store"})


@app.get("/api/admin/feedback/evals.json")
async def api_admin_feedback_evals(request: Request):
    """F5: the 👎 and wrong-page rows that named a page they wanted, as navigator eval cases shaped like the entries
    of backend/data/usecases.json — a JSON file ready to paste."""
    _admin_check(request)
    store = _feedback_store(request)
    catalog = request.app.state.navigator.catalog
    cases = await run_in_threadpool(lambda: fb.eval_cases(store.review(limit=5000), catalog))
    body = json.dumps({"as_of": dt.date.today().isoformat(), "cases": cases}, indent=1, ensure_ascii=False)
    return Response(body, media_type="application/json", headers={"Content-Disposition": 'attachment; filename="hcdp-feedback-eval-cases.json"', "Cache-Control": "no-store"})


@app.patch("/api/admin/feedback/{fid}")
async def api_admin_feedback_patch(fid: str, body: FeedbackPatchBody, request: Request):
    """The team's triage on one row of either table: a status (new | reviewed | fixed | wontfix) and/or an admin note."""
    _admin_check(request)
    if not FEEDBACK_ID_RE.match(fid):
        raise HTTPException(404, "unknown item")
    status = (body.status or "").strip() or None
    if status is not None and status not in fb.STATUSES:
        raise HTTPException(400, "status must be one of " + ", ".join(fb.STATUSES))
    if status is None and body.admin_note is None:
        raise HTTPException(400, "nothing to change")
    store = _feedback_store(request)
    row = await run_in_threadpool(store.set_status, fid, status, body.admin_note)
    if row is None:
        raise HTTPException(404, "unknown item")
    return JSONResponse({"ok": True, "row": row}, headers={"Cache-Control": "no-store"})



@app.delete("/api/admin/feedback/{fid}")
async def api_admin_feedback_delete(fid: str, request: Request):
    """Remove one row of either table for good (smoke-test and sample entries); 404 for an unknown id."""
    _admin_check(request)
    if not FEEDBACK_ID_RE.match(fid):
        raise HTTPException(404, "unknown item")
    store = _feedback_store(request)
    gone = await run_in_threadpool(store.delete, fid)
    if not gone:
        raise HTTPException(404, "unknown item")
    return JSONResponse({"ok": True, "id": fid}, headers={"Cache-Control": "no-store"})

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


def _mirrored_head(html: str, path: str) -> str:
    """index.html for a mirrored or embedded HCDP page: its title ("<title> – Hawaiʻi Climate Data Portal") and the
    canonical link to HCDP's own page (the original of the copy)."""
    try:
        head = portal.head_for(app.state.portal, path)
    except Exception:  # noqa: BLE001
        head = None
    if not head:
        return html
    e = lambda s: htmlmod.escape(s, quote=True)  # noqa: E731
    if head.get("title"):
        html = re.sub(r"<title>.*?</title>", f"<title>{e(head['title'])} – Hawaiʻi Climate Data Portal</title>", html, count=1, flags=re.S)
    return html.replace("</head>", f'<link rel="canonical" href="{e(head["canonical"])}" /></head>', 1)


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
        return _mirrored_head(html, path)
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
