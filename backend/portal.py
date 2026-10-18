"""The live mirror of HCDP's pages (CONTRACT.md "Mirrored pages", 14 Oct; the user's pick DEC-20261013-MIRROR-M1 A).

HCDP's WordPress pages are copied into this site and kept current by a background job, never on a visitor's request:
- every 30 minutes the job lists `wp-json/wp/v2/pages` and `posts` (id, slug, link, modified_gmt) and re-fetches the HTML
  of any mirrored page whose modified_gmt changed; once a day it re-fetches every mirrored page (a theme or reusable-block
  change does not touch modified_gmt); every request to www.hawaii.edu goes out one at a time, at least 3 s after the
  previous one ended (HCDP's robots.txt Crawl-delay), with an honest User-Agent and a 15 s timeout — redirects included;
- a copy is stored only if HCDP answered 200, the title is not "Page not found", `.entry-content` is there and the text
  is at least half of the last good copy's; the two previous copies are kept (atomic writes);
- `GET /api/portal/page?path=` answers the copy (fresh → last good with `copied_at` → the committed seed snapshot,
  backend/data/portal_seed → 404 with the HCDP address); `GET /api/portal/img` serves HCDP's uploads resized to at most
  800 px WebP from a disk cache the job fills (a picture not cached yet redirects to HCDP's own file — the visitor's
  browser fetches it, our server does not); `GET /api/portal/library` the Library from HCDP's public Zotero group;
- each mirrored page gets an AI overview for direct loads (QB-O1 B), written once per copy by the Summarizer and
  regenerated when the copy changes; so do the app pages that have no copy (18 Oct: the storm reports, the Monthly Climate
  Summary, the Mesonet's live and Nolo viewers, the Guam viewer — routes.APP_OVERVIEWS), written from the catalog and
  rewritten when the catalog or the month changes (`GET /api/portal/overview?path=`).

uvicorn runs two workers: the job runs in whichever holds CACHE_DIR/portal/leader.lock (an flock); the other waits.
"""
from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import hashlib
import io
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response

import portal_routes as routes
from portal_sanitize import SanitizeError, accept, sanitize_page, upload_url

log = logging.getLogger("portal")

UA = "HCDP-with-AI mirror (+https://hcdp-with-ai.cis251375.projects.jetstream-cloud.org)"
SPACING = float(os.environ.get("PORTAL_SPACING", "3"))          # seconds between requests to www.hawaii.edu (robots.txt)
TIMEOUT = float(os.environ.get("PORTAL_TIMEOUT", "15"))
REST_EVERY = 30 * 60
SWEEP_EVERY = 24 * 3600
IMG_REVALIDATE_EVERY = 7 * 24 * 3600
LIBRARY_EVERY = 24 * 3600
STALE_AFTER = 2 * 24 * 3600     # a copy not confirmed for this long shows "Copied from HCDP on …"
KEEP_VERSIONS = 2
MAX_REDIRECTS = 3
IMG_LADDER = (100, 200, 300, 400, 500, 600, 700, 800)
IMG_MAX_BYTES = 25 * 1024 * 1024
IMG_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
OVERVIEWS_PER_DAY = int(os.environ.get("PORTAL_OVERVIEWS_PER_DAY", "400"))
# The overviews share the model route with the visitors' own overviews and the navigator, so they go out gently: one at a
# time, OVERVIEW_GAP seconds apart, at most OVERVIEWS_PER_TICK a minute's tick, and the first failure (a rate limit, a
# timeout) ends the pass and backs off — OVERVIEW_BACKOFF seconds, doubling up to OVERVIEW_BACKOFF_MAX — so the job can
# never crowd the route (14 Oct: a back-to-back burst at start-up met a rate-limited route).
OVERVIEW_GAP = float(os.environ.get("PORTAL_OVERVIEW_GAP", "6"))
OVERVIEWS_PER_TICK = int(os.environ.get("PORTAL_OVERVIEWS_PER_TICK", "20"))
OVERVIEW_BACKOFF = 600.0
OVERVIEW_BACKOFF_MAX = 6 * 3600.0
ZOTERO_GROUP = "2846077"
ZOTERO_API = f"https://api.zotero.org/groups/{ZOTERO_GROUP}/items/top"
REST = routes.HCDP + "/wp-json/wp/v2"
PAGE_CACHE = "public, max-age=300, stale-while-revalidate=86400"
IMMUTABLE = "public, max-age=31536000, immutable"
# The order overviews and sweeps take: the menu's pages first, then the families, then the posts.
PRIORITY = [s for s in dict.fromkeys(routes.MIRRORED.values())]


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def parse_iso(s) -> float | None:
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    tmp.write_bytes(data)
    tmp.replace(path)


def write_json(path: Path, obj) -> None:
    atomic_write(path, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def ladder(w) -> int:
    try:
        w = int(w)
    except (TypeError, ValueError):
        w = IMG_LADDER[-1]
    return next((x for x in IMG_LADDER if x >= w), IMG_LADDER[-1])


# ----- fetching www.hawaii.edu ---------------------------------------------------------------------------------------------
class Spacing:
    """One request at a time, the next one starting at least `spacing` seconds after the previous one ENDED."""

    def __init__(self, spacing: float = SPACING, clock=time.monotonic, sleep=None):
        self.spacing = spacing
        self.clock = clock
        self.sleep = sleep or asyncio.sleep
        self.lock = asyncio.Lock()
        self.last_end: float | None = None

    async def __aenter__(self):
        await self.lock.acquire()
        if self.last_end is not None:
            wait = self.spacing - (self.clock() - self.last_end)
            if wait > 0:
                await self.sleep(wait)
        return self

    async def __aexit__(self, *exc):
        self.last_end = self.clock()
        self.lock.release()


class Fetcher:
    """GET from www.hawaii.edu under the spacing rule; redirects are followed by hand so each hop is spaced too."""

    def __init__(self, client: httpx.AsyncClient | None = None, spacing: Spacing | None = None):
        self.client = client or httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": UA}, follow_redirects=False)
        self.spacing = spacing or Spacing()
        self.count = 0

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            await self.client.aclose()

    async def get(self, url: str, headers: dict | None = None) -> tuple[int, bytes, dict, str]:
        """(status, body, headers, final url); status 0 for a network failure."""
        for _ in range(MAX_REDIRECTS + 1):
            async with self.spacing:
                self.count += 1
                try:
                    r = await self.client.get(url, headers=headers or {})
                except (httpx.HTTPError, OSError) as e:
                    return 0, b"", {"error": type(e).__name__}, url
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                nxt = urljoin(url, r.headers["location"])
                if (urlparse(nxt).hostname or "") not in routes.PORTAL_HOSTS:
                    return r.status_code, b"", dict(r.headers), nxt
                url = nxt
                continue
            return r.status_code, r.content, dict(r.headers), url
        return 310, b"", {}, url


# ----- building a copy --------------------------------------------------------------------------------------------------
def build_record(html: str, *, slug: str, path: str, final_url: str, fetched_at: str, modified_gmt: str | None) -> dict:
    rec = sanitize_page(html, final_url or routes.hcdp_url(slug), routes.path_for_url, slug=slug)
    rec["title"] = routes.title_for(slug, rec.get("title") or "") or rec.get("band") or slug
    rec.update(path=path, url=routes.hcdp_url(slug), final_url=final_url, fetched_at=fetched_at, checked_at=fetched_at,
               modified_gmt=modified_gmt)
    return rec


# ----- the store ----------------------------------------------------------------------------------------------------------
class PortalStore:
    """CACHE_DIR/portal: pages/<stem>.json (+ .1/.2 previous copies), overviews/<stem>.json, img/{src,var,wanted},
    index.json (the job's bookkeeping), library.json; the committed seed in backend/data/portal_seed is the last resort."""

    def __init__(self, root: Path, seed_dir: Path | None = None):
        self.root = Path(root)
        self.seed_dir = Path(seed_dir) if seed_dir else routes.SEED_DIR
        self._index_cache: tuple[float, dict] | None = None

    # -- pages --
    def page_file(self, slug: str, version: int = 0) -> Path:
        stem = routes.file_stem(slug)
        return self.root / "pages" / (f"{stem}.json" if not version else f"{stem}.{version}.json")

    def load(self, slug: str) -> dict | None:
        return read_json(self.page_file(slug))

    def load_seed(self, slug: str) -> dict | None:
        return read_json(self.seed_dir / f"{routes.file_stem(slug)}.json")

    def best(self, slug: str) -> tuple[dict | None, str]:
        rec = self.load(slug)
        if rec:
            return rec, "cache"
        rec = self.load_seed(slug)
        return (rec, "seed") if rec else (None, "none")

    def save(self, rec: dict) -> None:
        """Write a new copy; the previous two stay as .1 and .2 (the current file is replaced atomically, never missing)."""
        slug = rec["slug"]
        cur = self.page_file(slug)
        for v in range(KEEP_VERSIONS, 1, -1):
            prev = self.page_file(slug, v - 1)
            if prev.exists():
                with contextlib.suppress(OSError):
                    os.replace(prev, self.page_file(slug, v))
        if cur.exists():
            with contextlib.suppress(OSError):
                atomic_write(self.page_file(slug, 1), cur.read_bytes())
        write_json(cur, rec)

    def touch_checked(self, slug: str, rec: dict, when: str) -> None:
        rec = dict(rec, checked_at=when)
        write_json(self.page_file(slug), rec)

    # -- overviews --
    def overview_file(self, slug: str) -> Path:
        return self.root / "overviews" / f"{routes.file_stem(slug)}.json"

    def load_overview(self, slug: str) -> dict | None:
        return read_json(self.overview_file(slug)) or read_json(self.seed_dir / "overviews" / f"{routes.file_stem(slug)}.json")

    def save_overview(self, slug: str, ov: dict) -> None:
        write_json(self.overview_file(slug), ov)

    # -- the app pages' overviews (18 Oct; no HCDP copy behind them) --
    def app_overview_file(self, path: str) -> Path:
        return self.root / "overviews" / f"{routes.app_overview_stem(path)}.json"

    def load_app_overview(self, path: str) -> dict | None:
        return read_json(self.app_overview_file(path))

    def save_app_overview(self, path: str, ov: dict) -> None:
        write_json(self.app_overview_file(path), ov)

    # -- the job's bookkeeping --
    def index_file(self) -> Path:
        return self.root / "index.json"

    def index(self) -> dict:
        p = self.index_file()
        try:
            m = p.stat().st_mtime
        except OSError:
            return {}
        if self._index_cache and self._index_cache[0] == m:
            return self._index_cache[1]
        data = read_json(p) or {}
        self._index_cache = (m, data)
        return data

    def save_index(self, idx: dict) -> None:
        write_json(self.index_file(), idx)
        self._index_cache = None

    # -- images --
    def img_key(self, url: str) -> str:
        return sha1(url)

    def img_src(self, url: str) -> tuple[Path, Path]:
        k = self.img_key(url)
        return self.root / "img" / "src" / f"{k}.bin", self.root / "img" / "src" / f"{k}.json"

    def img_variant(self, url: str, w: int) -> Path:
        return self.root / "img" / "var" / f"{self.img_key(url)}-{w}.webp"

    def want_image(self, url: str) -> None:
        p = self.root / "img" / "wanted" / self.img_key(url)
        if not p.exists():
            with contextlib.suppress(OSError):
                atomic_write(p, url.encode("utf-8"))

    # -- the library --
    def load_library(self) -> tuple[dict | None, str]:
        lib = read_json(self.root / "library.json")
        if lib:
            return lib, "cache"
        lib = read_json(self.seed_dir / "library.json")
        return (lib, "seed") if lib else (None, "none")


def make_variant(src: bytes, w: int) -> bytes | None:
    """The upload at most `w` px wide as WebP (never enlarged); None for what Pillow cannot (or should not) convert."""
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 80_000_000
    try:
        im = Image.open(io.BytesIO(src))
        if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
            return None
        im.load()
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
        if im.width > w:
            im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, "WEBP", quality=82, method=4)
        return out.getvalue()
    except Exception:  # noqa: BLE001 - a broken or exotic file: the caller falls back to HCDP's own
        return None


# ----- the Library (HCDP's public Zotero group) ----------------------------------------------------------------------------
def _authors(creators: list) -> str:
    names = []
    for c in creators or []:
        if c.get("creatorType") not in (None, "author", "editor", "contributor", "presenter", "programmer", "inventor"):
            continue
        if c.get("name"):
            names.append(c["name"].strip())
        elif c.get("lastName"):
            initials = " ".join(f"{p[0]}." for p in re.split(r"[\s-]+", c.get("firstName") or "") if p)
            names.append(f"{c['lastName'].strip()}, {initials}".strip().rstrip(","))
    if len(names) > 8:
        names = names[:7] + ["…", names[-1]]
    return "; ".join(names)


def library_item(it: dict) -> dict | None:
    d = it.get("data") or {}
    if d.get("itemType") in ("attachment", "note", "annotation") or not (d.get("title") or "").strip():
        return None
    meta = it.get("meta") or {}
    year = (meta.get("parsedDate") or "")[:4]
    if not re.fullmatch(r"\d{4}", year):
        m = re.search(r"\b(1[89]\d\d|20\d\d)\b", d.get("date") or "")
        year = m.group(1) if m else ""
    venue = next((d.get(k) for k in ("publicationTitle", "bookTitle", "proceedingsTitle", "conferenceName", "websiteTitle", "university",
                                     "institution", "publisher", "repository", "blogTitle", "reportType") if (d.get(k) or "").strip()), "")
    doi = (d.get("DOI") or "").strip()
    url = (d.get("url") or "").strip() or (f"https://doi.org/{doi}" if doi else "")
    if url and not url.startswith(("http://", "https://")):
        url = ""
    return {"key": it.get("key") or d.get("key"), "year": year, "title": re.sub(r"\s+", " ", d["title"]).strip(), "authors": _authors(d.get("creators")),
            "venue": re.sub(r"\s+", " ", venue).strip(), "type": d.get("itemType") or "", "url": url,
            "zotero": f"https://www.zotero.org/groups/{ZOTERO_GROUP}/items/{it.get('key') or d.get('key')}"}


def library_payload(items: list[dict], fetched_at: str) -> dict:
    clean = [x for x in (library_item(i) for i in items) if x]
    clean.sort(key=lambda x: (-(int(x["year"]) if x["year"] else 0), x["title"].lower()))
    return {"fetched_at": fetched_at, "total": len(clean), "group": ZOTERO_GROUP, "source": f"https://www.zotero.org/groups/{ZOTERO_GROUP}", "items": clean}


async def fetch_library(client: httpx.AsyncClient, pause: float = 1.0) -> list[dict] | None:
    """Every top-level item of the group, 100 at a time (the API's Total-Results says how many pages)."""
    items: list[dict] = []
    start, total = 0, None
    while total is None or start < total:
        try:
            r = await client.get(ZOTERO_API, params={"format": "json", "limit": 100, "start": start}, headers={"User-Agent": UA, "Zotero-API-Version": "3"})
        except (httpx.HTTPError, OSError):
            return None
        if r.status_code != 200:
            return None
        total = int(r.headers.get("Total-Results") or 0)
        batch = r.json()
        if not batch:
            break
        items.extend(batch)
        start += len(batch)
        if r.headers.get("Backoff"):
            await asyncio.sleep(min(float(r.headers["Backoff"]), 60))
        await asyncio.sleep(pause)
    return items


# ----- the job --------------------------------------------------------------------------------------------------------------
class MirrorJob:
    """The background refresher (leader only). `summarizer` writes the direct-load overviews (None → none)."""

    def __init__(self, store: PortalStore, summarizer=None, fetcher: Fetcher | None = None, clock=time.time):
        self.store = store
        self.summarizer = summarizer
        self.fetcher = fetcher
        self.clock = clock
        self.overview_day = ("", 0)
        self.overview_wait_until = 0.0      # no overview call before this (the backoff after a failure)
        self.overview_backoff = OVERVIEW_BACKOFF
        self.sleep = asyncio.sleep

    # -- bookkeeping --
    def _idx(self) -> dict:
        idx = dict(self.store.index())
        idx.setdefault("pages", {})
        idx.setdefault("failures", [])
        idx.setdefault("fetches", {"pages": 0, "images": 0, "rest": 0})
        return idx

    def _failure(self, idx: dict, slug: str, reason: str) -> None:
        idx["failures"] = ([{"slug": slug, "at": now_iso(), "reason": reason[:160]}] + idx.get("failures", []))[:50]

    def _due(self, idx: dict, key: str, every: float, default: str | None = None) -> bool:
        t = parse_iso(idx.get(key) or default)
        return t is None or self.clock() - t >= every

    def work_list(self) -> list[tuple[str, str]]:
        """(slug, our path) for every mirrored page, the menu's pages first."""
        allm = routes.mirrored_slugs()
        first = [(s, allm[s]) for s in PRIORITY if s in allm]
        seen = {s for s, _ in first}
        fam = [(s, p) for s, p in allm.items() if s not in seen and not p.startswith(routes.POSTS_PREFIX)]
        posts = [(s, p) for s, p in allm.items() if s not in seen and p.startswith(routes.POSTS_PREFIX)]
        return first + fam + posts

    # -- REST: what changed --
    async def rest_listing(self) -> dict | None:
        """{slug: {modified_gmt, type, link}} for every page and post, or None when HCDP did not answer."""
        out: dict[str, dict] = {}
        for kind in ("pages", "posts"):
            page, pages = 1, 1
            while page <= pages:
                url = f"{REST}/{kind}?_fields=id,slug,link,modified_gmt&per_page=100&page={page}"
                status, body, headers, _ = await self.fetcher.get(url)
                if status != 200:
                    return None
                try:
                    rows = json.loads(body)
                except ValueError:
                    return None
                pages = int({k.lower(): v for k, v in headers.items()}.get("x-wp-totalpages") or 1)
                for r in rows:
                    slug = unquote(r.get("slug") or "")
                    if slug:
                        out[slug] = {"modified_gmt": r.get("modified_gmt"), "type": "post" if kind == "posts" else "page", "link": r.get("link")}
                page += 1
        return out

    async def rest_pass(self) -> list[str]:
        """List pages and posts; fetch every mirrored page whose modified_gmt moved (or that has no copy at all); a copy
        the listing confirms is current is marked checked (a seed copy is promoted into the cache)."""
        listing = await self.rest_listing()
        idx = self._idx()
        idx["fetches"]["rest"] = idx["fetches"].get("rest", 0) + 1
        if listing is None:
            self._failure(idx, "wp-json", "the REST listing did not answer")
            self.store.save_index(idx)
            return []
        idx["rest"] = {k: v["modified_gmt"] for k, v in listing.items()}
        idx["posts"] = sorted(k for k, v in listing.items() if v["type"] == "post")
        idx["rest_at"] = now_iso()
        self.store.save_index(idx)
        changed: list[str] = []
        for slug, path in self.work_list():
            rest = listing.get(slug)
            rec, source = self.store.best(slug)
            if rec is None or (rest and rest.get("modified_gmt") != rec.get("modified_gmt")):
                changed.append(slug)
            elif source == "seed":
                write_json(self.store.page_file(slug), dict(rec, checked_at=now_iso()))
            else:
                self.store.touch_checked(slug, rec, now_iso())
        for slug in changed:
            await self.fetch_page(slug, (listing.get(slug) or {}).get("modified_gmt"))
        self._refresh_page_index()
        return changed

    async def sweep(self) -> int:
        """Re-fetch every mirrored page (the daily full sweep), the oldest copy first."""
        idx = self._idx()
        rest = idx.get("rest") or {}
        todo = self.work_list()
        todo.sort(key=lambda sp: parse_iso((self.store.best(sp[0])[0] or {}).get("fetched_at")) or 0)
        n = 0
        for slug, _ in todo:
            n += 1 if await self.fetch_page(slug, rest.get(slug)) else 0
        idx = self._idx()
        idx["sweep_at"] = now_iso()
        self.store.save_index(idx)
        self._refresh_page_index()
        return n

    async def fetch_page(self, slug: str, modified_gmt: str | None) -> bool:
        path = routes.mirrored_slugs().get(slug) or ""
        status, body, _headers, final = await self.fetcher.get(routes.hcdp_url(slug))
        idx = self._idx()
        idx["fetches"]["pages"] = idx["fetches"].get("pages", 0) + 1
        last_good, _ = self.store.best(slug)
        rec = None
        reason = None
        if status == 200:
            try:
                rec = await asyncio.to_thread(build_record, body.decode("utf-8", "replace"), slug=slug, path=path, final_url=final,
                                              fetched_at=now_iso(), modified_gmt=modified_gmt or (last_good or {}).get("modified_gmt"))
            except SanitizeError as e:
                reason = str(e)
            except Exception as e:  # noqa: BLE001
                reason = f"sanitiser failed: {type(e).__name__}"
        reason = reason or accept(rec, status, last_good)
        if reason:
            self._failure(idx, slug, reason)
            self.store.save_index(idx)
            log.warning("portal: kept the last good copy of %s (%s)", slug, reason)
            return False
        self.store.save(rec)
        self.store.save_index(idx)
        return True

    def _refresh_page_index(self) -> None:
        idx = self._idx()
        pages = {}
        for slug, path in routes.mirrored_slugs().items():
            rec = self.store.load(slug)
            if rec:
                pages[slug] = {"path": path, "title": rec.get("title"), "fetched_at": rec.get("fetched_at"), "checked_at": rec.get("checked_at"),
                               "modified_gmt": rec.get("modified_gmt"), "sha256": rec.get("sha256"), "kind": rec.get("kind")}
        idx["pages"] = pages
        idx["images"] = self._image_counts()
        idx["overviews"] = len(list((self.store.root / "overviews").glob("*.json"))) if (self.store.root / "overviews").exists() else 0
        self.store.save_index(idx)

    def _image_counts(self) -> dict:
        d = self.store.root / "img"
        count = lambda sub, pat: len(list((d / sub).glob(pat))) if (d / sub).exists() else 0  # noqa: E731
        return {"sources": count("src", "*.bin"), "variants": count("var", "*.webp"), "wanted": count("wanted", "*")}

    # -- overviews for direct loads (QB-O1 B) --
    async def overviews_pass(self, limit: int = OVERVIEWS_PER_TICK) -> int:
        """Write the missing or outdated direct-load overviews — the mirrored pages' (once per copy), then the app pages'
        (from the catalog: once per catalog text and month): one call at a time, OVERVIEW_GAP s apart, at most `limit` a
        tick; the first failure ends the pass and backs off (10 min, doubling up to 6 h); a success resets the backoff."""
        if self.summarizer is None or not getattr(getattr(self.summarizer, "llm", None), "configured", False):
            return 0
        if self.clock() < self.overview_wait_until:
            return 0
        todo = []   # (label, fingerprint, the call, where it is kept)
        for slug, path in self.work_list():
            rec, _ = self.store.best(slug)
            if not rec:
                continue
            ov = self.store.load_overview(slug)
            if ov and ov.get("for_sha") == rec.get("sha256"):
                continue
            todo.append((slug, rec.get("sha256"), (lambda p=path, r=rec: self.summarizer.page_overview(p, r)),
                         (lambda out, s=slug, p=path, sha=rec.get("sha256"): self.store.save_overview(s, dict(out, for_sha=sha, generated_at=now_iso(), path=p)))))
        if getattr(self.summarizer, "app_overview", None) and getattr(self.summarizer, "app_fingerprint", None):
            for path in routes.APP_OVERVIEWS:
                fp = self.summarizer.app_fingerprint(path)
                ov = self.store.load_app_overview(path)
                if ov and ov.get("for_sha") == fp:
                    continue
                todo.append((path, fp, (lambda p=path: self.summarizer.app_overview(p)),
                             (lambda out, p=path, f=fp: self.store.save_app_overview(p, dict(out, for_sha=f, generated_at=now_iso(), path=p)))))
        made = 0
        calls = 0
        for label, _fp, call, save in todo:
            if made >= limit or not self._overview_budget():
                break
            if calls:
                await self.sleep(OVERVIEW_GAP)
            calls += 1
            try:
                out = await asyncio.to_thread(call)
            except Exception:  # noqa: BLE001
                out = None
            self._spend_overview()
            if not (out and out.get("chunks")):
                self.overview_wait_until = self.clock() + self.overview_backoff
                self.overview_backoff = min(self.overview_backoff * 2, OVERVIEW_BACKOFF_MAX)
                log.warning("portal: the overview for %s failed; next try in %.0f s", label, self.overview_wait_until - self.clock())
                break
            self.overview_backoff = OVERVIEW_BACKOFF
            save(out)
            made += 1
        if made:
            self._refresh_page_index()
        return made

    def _overview_budget(self) -> bool:
        day = dt.date.today().isoformat()
        if self.overview_day[0] != day:
            self.overview_day = (day, 0)
        return self.overview_day[1] < OVERVIEWS_PER_DAY

    def _spend_overview(self) -> None:
        self.overview_day = (self.overview_day[0], self.overview_day[1] + 1)

    # -- images --
    def referenced_images(self) -> dict[str, int | None]:
        refs: dict[str, int | None] = {}
        for slug, _ in self.work_list():
            rec, _ = self.store.best(slug)
            for it in (rec or {}).get("images") or []:
                u = it.get("u")
                if u and u not in refs:
                    refs[u] = it.get("w")
        return refs

    async def fetch_image(self, url: str, width: int | None = None) -> bool:
        bin_path, meta_path = self.store.img_src(url)
        meta = read_json(meta_path) or {}
        headers = {}
        if bin_path.exists() and meta.get("etag"):
            headers["If-None-Match"] = meta["etag"]
        if bin_path.exists() and meta.get("last_modified"):
            headers["If-Modified-Since"] = meta["last_modified"]
        status, body, hdrs, _ = await self.fetcher.get(url, headers=headers)
        h = {k.lower(): v for k, v in hdrs.items()}
        idx = self._idx()
        idx["fetches"]["images"] = idx["fetches"].get("images", 0) + 1
        self.store.save_index(idx)
        if status == 304 and bin_path.exists():
            write_json(meta_path, dict(meta, fetched_at=now_iso()))
            return True
        ctype = (h.get("content-type") or "").split(";")[0].strip().lower()
        if status != 200 or ctype not in IMG_TYPES or not body or len(body) > IMG_MAX_BYTES:
            return False
        changed = not bin_path.exists() or hashlib.sha256(body).hexdigest() != meta.get("sha256")
        atomic_write(bin_path, body)
        write_json(meta_path, {"url": url, "type": ctype, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "etag": h.get("etag"),
                               "last_modified": h.get("last-modified"), "fetched_at": now_iso()})
        if changed:
            for old in (self.store.root / "img" / "var").glob(f"{self.store.img_key(url)}-*.webp"):
                with contextlib.suppress(OSError):
                    old.unlink()
        # the sizes the pages ask for, made now so the first visitor gets them from disk
        for w in {ladder(min(width or IMG_LADDER[-1], IMG_LADDER[-1])), 400}:
            out = self.store.img_variant(url, w)
            if not out.exists():
                data = await asyncio.to_thread(make_variant, body, w)
                if data:
                    atomic_write(out, data)
        return True

    async def images_pass(self, limit: int = 100000) -> int:
        """Missing pictures first (those a visitor asked for, then the rest), then the weekly revalidation."""
        refs = self.referenced_images()
        wanted_dir = self.store.root / "img" / "wanted"
        wanted = []
        for p in sorted(wanted_dir.glob("*")) if wanted_dir.exists() else []:
            with contextlib.suppress(OSError):
                u = p.read_text(encoding="utf-8").strip()
                p.unlink()
                if u in refs:   # only pictures a mirrored page shows — a request for anything else just keeps redirecting
                    wanted.append(u)
        missing = [u for u in refs if not self.store.img_src(u)[0].exists()]
        order = list(dict.fromkeys(wanted + missing))
        n = 0
        for u in order[:limit]:
            n += 1 if await self.fetch_image(u, refs.get(u)) else 0
        idx = self._idx()
        if self._due(idx, "img_revalidated_at", IMG_REVALIDATE_EVERY, idx.get("img_first_at") or now_iso()):
            for u in refs:
                meta = read_json(self.store.img_src(u)[1]) or {}
                t = parse_iso(meta.get("fetched_at"))
                if t is not None and self.clock() - t >= IMG_REVALIDATE_EVERY:
                    await self.fetch_image(u, refs.get(u))
            idx = self._idx()
            idx["img_revalidated_at"] = now_iso()
        idx.setdefault("img_first_at", now_iso())
        self.store.save_index(idx)
        if n:
            self._refresh_page_index()
        return n

    # -- the library --
    async def library_pass(self) -> bool:
        async with httpx.AsyncClient(timeout=30) as client:
            items = await fetch_library(client)
        idx = self._idx()
        if items is None:
            self._failure(idx, "zotero", "the Zotero group did not answer")
            self.store.save_index(idx)
            return False
        payload = library_payload(items, now_iso())
        write_json(self.store.root / "library.json", payload)
        idx["library_at"] = now_iso()
        idx["library_items"] = payload["total"]
        self.store.save_index(idx)
        return True

    # -- the loop --
    async def tick(self) -> None:
        idx = self._idx()
        seed_at = (routes.seed_index(self.store.seed_dir) or {}).get("generated_at")
        if self._due(idx, "rest_at", REST_EVERY):
            await self.rest_pass()
        idx = self._idx()
        first = min((t for t in (idx.get("first_at"), seed_at) if t), key=lambda t: parse_iso(t) or 0, default=None)
        if self._due(idx, "sweep_at", SWEEP_EVERY, first):
            await self.sweep()
        await self.overviews_pass()
        await self.images_pass()
        idx = self._idx()
        if self._due(idx, "library_at", LIBRARY_EVERY, (self.store.load_library()[0] or {}).get("fetched_at")):
            await self.library_pass()

    async def lead(self) -> None:
        idx = self._idx()
        idx.setdefault("first_at", now_iso())
        idx["leader"] = {"pid": os.getpid(), "since": now_iso()}
        self.store.save_index(idx)
        if self.fetcher is None:
            self.fetcher = Fetcher()
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - the job never dies; the next tick tries again
                log.exception("portal job tick failed: %s", e)
            await asyncio.sleep(60)


def try_lead(lock_path: Path):
    """An open file holding the exclusive leader lock, or None when another process leads."""
    import fcntl
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = open(lock_path, "a+")  # noqa: SIM115 - held open for the life of the leader
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except OSError:
        fd.close()
        return None


async def run_forever(store: PortalStore, summarizer_getter) -> None:
    while True:
        fd = await asyncio.to_thread(try_lead, store.root / "leader.lock")
        if fd is not None:
            try:
                await MirrorJob(store, summarizer_getter()).lead()
            finally:
                fd.close()
        await asyncio.sleep(60)


# ----- what the endpoints answer -------------------------------------------------------------------------------------------
def page_payload(store: PortalStore, path: str) -> tuple[int, dict]:
    """(status, body) for GET /api/portal/page: the copy (cache → seed) with `source`, `copied_at` when it is not known to
    be current, the direct-load `overview` when one is written; 404 {detail, hcdp_url} otherwise."""
    slug = routes.slug_for_path(path)
    if slug is None:
        emb = routes.embed_for_path(path)
        return 404, {"detail": "This address is not a mirrored page.", "hcdp_url": routes.hcdp_url(emb["slug"]) if emb else None}
    rec, source = store.best(slug)
    if rec is None:
        return 404, {"detail": "This page has not been copied from HCDP yet.", "hcdp_url": routes.hcdp_url(slug)}
    out = {k: v for k, v in rec.items() if k not in ("text",)}
    out["source"] = source
    out["path"] = routes.mirrored_slugs().get(slug, out.get("path"))
    checked = parse_iso(rec.get("checked_at") or rec.get("fetched_at"))
    if source == "seed" or checked is None or time.time() - checked > STALE_AFTER:
        out["copied_at"] = rec.get("fetched_at")
    ov = store.load_overview(slug)
    if ov and ov.get("chunks"):
        out["overview"] = {k: ov.get(k) for k in ("chunks", "cites", "more", "more_cites", "sources", "followups", "generated_at")}
        out["overview"]["current"] = ov.get("for_sha") == rec.get("sha256")
    return 200, out


def head_for(store: PortalStore, path: str) -> dict | None:
    """{title, canonical} for index.html on a mirrored or embedded address (the canonical is HCDP's page)."""
    emb = routes.embed_for_path(path)
    if emb:
        return {"title": emb["title"], "canonical": routes.hcdp_url(emb["slug"])}
    base, _, query = (path or "").split("#", 1)[0].partition("?")
    if base.rstrip("/") == "/mesonet" and re.search(r"(^|&)(viewer|station|view)=", query):
        viewer = dict(p.split("=", 1) for p in query.split("&") if "=" in p).get("viewer", "live")
        if viewer == "nolo":
            return {"title": "Tropical Storm Nolo Mesonet Viewer", "canonical": routes.hcdp_url("nolo-mesonet-viewer")}
        if viewer == "app":
            return {"title": "Hawaiʻi Mesonet app", "canonical": "https://hawaiimesonet.app/"}
        return {"title": "Hawaiʻi Mesonet Live Data Access", "canonical": routes.hcdp_url("hawaii-mesonet-data")}
    slug = routes.slug_for_path(path)
    if slug is None:
        return None
    entry = (store.index().get("pages") or {}).get(slug) or (routes.seed_index(store.seed_dir).get("pages") or {}).get(slug) or {}
    return {"title": entry.get("title") or routes.TITLE_OVERRIDES.get(slug) or "", "canonical": routes.hcdp_url(slug)}


def _count(folder: Path, suffix: str = "") -> int:
    try:
        with os.scandir(folder) as it:
            return sum(1 for e in it if e.is_file() and e.name.endswith(suffix) and not e.name.startswith("."))
    except OSError:
        return 0


def _count_images(store: PortalStore) -> dict:
    """The picture cache as it is now (a pass can take a while; the index is refreshed only at its end)."""
    d = store.root / "img"
    return {"sources": _count(d / "src", ".bin"), "variants": _count(d / "var", ".webp"), "wanted": _count(d / "wanted")}


def health(store: PortalStore) -> dict:
    idx = store.index()
    pages = idx.get("pages") or {}
    seed = routes.seed_index(store.seed_dir)
    times = sorted(p["fetched_at"] for p in pages.values() if p.get("fetched_at"))
    day_ago = time.time() - 86400
    fails = [f for f in idx.get("failures") or [] if (parse_iso(f.get("at")) or 0) >= day_ago]
    return {
        "mirrored": len(routes.mirrored_slugs()), "cached": len(pages), "seed": len(seed.get("pages") or {}),
        "seed_generated_at": seed.get("generated_at"), "newest_fetched_at": times[-1] if times else None, "oldest_fetched_at": times[0] if times else None,
        "rest_at": idx.get("rest_at"), "sweep_at": idx.get("sweep_at"), "failures_24h": len(fails), "last_failure": (idx.get("failures") or [None])[0],
        "fetches": idx.get("fetches"), "images": _count_images(store), "overviews": _count(store.root / "overviews", ".json"),
        "app_overviews": sum(1 for p in routes.APP_OVERVIEWS if store.app_overview_file(p).exists()), "library_items": idx.get("library_items"),
        "library_at": idx.get("library_at"), "leader": idx.get("leader"),
    }


# ----- the endpoints -------------------------------------------------------------------------------------------------------
router = APIRouter()


def _store(request: Request) -> PortalStore:
    return request.app.state.portal


@router.get("/api/portal/page")
async def api_portal_page(request: Request, path: str = Query(..., max_length=400)):
    if not path.startswith("/"):
        raise HTTPException(400, "path must start with /")
    status, body = await asyncio.to_thread(page_payload, _store(request), path)
    if status != 200:
        return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})
    etag = '"' + sha1(f"{body.get('sha256')}|{body.get('source')}|{body.get('copied_at')}|{(body.get('overview') or {}).get('generated_at')}") + '"'
    headers = {"ETag": etag, "Cache-Control": PAGE_CACHE}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(body, headers=headers)


@router.get("/api/portal/overview")
async def api_portal_overview(request: Request, path: str = Query(..., max_length=400)):
    """The direct-load AI overview of an app page with no HCDP copy (18 Oct: the storm reports, the Monthly Climate
    Summary, the Mesonet's live and Nolo viewers, the Guam viewer): {path, overview} — `path` is the address it is kept
    under (a station or a month in the query shows the viewer's or the app's one overview); 404 until the job has written
    it, or for an address that has none (the page then shows no overview)."""
    if not path.startswith("/"):
        raise HTTPException(400, "path must start with /")
    key = routes.app_overview_path(path)
    ov = await asyncio.to_thread(_store(request).load_app_overview, key) if key else None
    if not ov or not ov.get("chunks"):
        detail = "The overview has not been written yet." if key else "This address has no app overview."
        return JSONResponse({"detail": detail, "path": key}, status_code=404, headers={"Cache-Control": "no-store"})
    body = {"path": key, "overview": {k: ov.get(k) for k in ("chunks", "cites", "more", "more_cites", "sources", "followups", "generated_at")}}
    etag = '"' + sha1(f"{key}|{ov.get('generated_at')}|{ov.get('for_sha')}") + '"'
    headers = {"ETag": etag, "Cache-Control": PAGE_CACHE}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(body, headers=headers)


@router.get("/api/portal/img")
async def api_portal_img(request: Request, u: str = Query(..., max_length=2000), w: int = Query(800, ge=1, le=4000)):
    url = upload_url(u)
    if not url:
        raise HTTPException(400, "only HCDP's own uploads")
    store = _store(request)
    w = ladder(min(w, IMG_LADDER[-1]))
    variant = store.img_variant(url, w)
    etag = '"' + sha1(f"{url}|{w}") + '"'
    if variant.exists():
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": IMMUTABLE})
        return FileResponse(variant, media_type="image/webp", headers={"Cache-Control": IMMUTABLE, "ETag": etag})
    bin_path, _ = store.img_src(url)
    if bin_path.exists():
        data = await asyncio.to_thread(make_variant, bin_path.read_bytes(), w)
        if data:
            await asyncio.to_thread(atomic_write, variant, data)
            return Response(data, media_type="image/webp", headers={"Cache-Control": IMMUTABLE, "ETag": etag})
    else:
        store.want_image(url)
    # Not on disk yet (or not convertible): the visitor's browser takes HCDP's own file; the job fills the cache.
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})


@router.get("/api/portal/library")
async def api_portal_library(request: Request):
    lib, source = await asyncio.to_thread(_store(request).load_library)
    if not lib:
        return JSONResponse({"detail": "The Library has not been copied yet.", "hcdp_url": routes.hcdp_url("publications-list")}, status_code=404)
    etag = '"' + sha1(f"{lib.get('fetched_at')}|{lib.get('total')}|{source}") + '"'
    headers = {"ETag": etag, "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(dict(lib, cache=source), headers=headers)


def setup(app, cache_dir: Path) -> None:
    """Wire the mirror into the app: the store (on the cache volume), the posts list for the route table, and — unless
    PORTAL_JOB=0 — the background job (it leads in one worker only)."""
    store = PortalStore(Path(cache_dir) / "portal")
    app.state.portal = store
    routes.set_posts_source(lambda: store.index().get("posts"))

    @app.on_event("startup")
    async def _start_portal_job():  # noqa: ANN202
        if os.environ.get("PORTAL_JOB", "1") == "0":
            return
        app.state.portal_task = asyncio.create_task(run_forever(store, lambda: getattr(app.state, "summarizer", None)))
