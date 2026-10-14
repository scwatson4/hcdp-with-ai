#!/usr/bin/env python3
"""Generate the committed seed snapshot of every mirrored HCDP page — backend/data/portal_seed/<slug>.json, index.json and
library.json (CONTRACT.md "Mirrored pages", 14 Oct). The site serves the seed only when it has no copy of its own yet
(a fresh volume) or never managed one; the background job (backend/portal.py) keeps the live copies current.

It uses the job's own fetcher, so every request to www.hawaii.edu goes out one at a time, at least 3 s after the previous
one ended (HCDP's robots.txt Crawl-delay), with the mirror's User-Agent and a 15 s timeout: the REST listing of pages and
posts (3 requests), then each mirrored page's HTML (about 110 requests, some 10 minutes). The Library comes from the public
Zotero group (api.zotero.org, 14 requests, a second apart).

    python3 scripts/portal_seed.py --raw <dir>            fetch everything, keep the raw HTML in <dir>
    python3 scripts/portal_seed.py --raw <dir> --from-raw  rebuild the seed from <dir> without fetching (after a sanitiser change)
    python3 scripts/portal_seed.py --only team,news        just these slugs (the index keeps the others)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import httpx  # noqa: E402

import portal  # noqa: E402
import portal_routes as routes  # noqa: E402
from portal_sanitize import SanitizeError, accept  # noqa: E402


async def main(args) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    raw = Path(args.raw) if args.raw else None
    if raw:
        raw.mkdir(parents=True, exist_ok=True)
    only = {s.strip() for s in (args.only or "").split(",") if s.strip()}
    fetcher = portal.Fetcher()
    job = portal.MirrorJob(portal.PortalStore(Path(tempfile.mkdtemp()), seed_dir=out), None, fetcher)
    listing_file = raw / "listing.json" if raw else None
    if args.from_raw and listing_file and listing_file.exists():
        listing = json.loads(listing_file.read_text())
    else:
        listing = await job.rest_listing()
        if listing is None:
            print("the REST listing did not answer", file=sys.stderr)
            return 1
        if listing_file:
            listing_file.write_text(json.dumps(listing, ensure_ascii=False, indent=1))
    posts = sorted(k for k, v in listing.items() if v["type"] == "post")
    routes.set_posts_source(lambda: posts)
    old_index = routes.seed_index(out) if only else {}
    pages = dict(old_index.get("pages") or {})
    failed = []
    for slug, path in job.work_list():
        if only and slug not in only:
            continue
        stem = routes.file_stem(slug)
        meta_file = raw / f"{stem}.meta.json" if raw else None
        if args.from_raw and meta_file and meta_file.exists():
            meta = json.loads(meta_file.read_text())
            html = (raw / f"{stem}.html").read_text(encoding="utf-8")
        else:
            status, body, _headers, final = await fetcher.get(routes.hcdp_url(slug))
            meta = {"status": status, "final_url": final, "fetched_at": portal.now_iso()}
            html = body.decode("utf-8", "replace")
            if raw:
                (raw / f"{stem}.html").write_text(html, encoding="utf-8")
                meta_file.write_text(json.dumps(meta))
        rec = None
        reason = None
        if meta["status"] == 200:
            try:
                rec = portal.build_record(html, slug=slug, path=path, final_url=meta["final_url"], fetched_at=meta["fetched_at"],
                                          modified_gmt=(listing.get(slug) or {}).get("modified_gmt"))
            except SanitizeError as e:
                reason = str(e)
        reason = reason or accept(rec, meta["status"], None)
        if reason:
            failed.append((slug, reason))
            print(f"  SKIP {slug}: {reason}", file=sys.stderr)
            continue
        portal.write_json(out / f"{stem}.json", rec)
        pages[slug] = {"path": path, "title": rec["title"], "band": rec.get("band"), "kind": rec["kind"], "fetched_at": rec["fetched_at"],
                       "modified_gmt": rec.get("modified_gmt"), "sha256": rec["sha256"], "bytes": len(rec["html"]) + len(rec["css"]),
                       "images": len(rec.get("images") or []), "embeds": len(rec.get("embeds") or [])}
        print(f"  ok   {slug:60} {rec['kind']:5} {len(rec['html']):>7} B html {len(rec['css']):>6} B css  band={rec.get('band')!r}", file=sys.stderr)
    index = {"generated_at": portal.now_iso(), "source": routes.HCDP, "posts": posts, "pages": pages,
             "rest": {k: v["modified_gmt"] for k, v in listing.items()}, "failed": failed}
    portal.write_json(out / "index.json", index)
    if not args.skip_library and not args.from_raw:
        async with httpx.AsyncClient(timeout=30) as client:
            items = await portal.fetch_library(client)
        if items is not None:
            lib = portal.library_payload(items, portal.now_iso())
            portal.write_json(out / "library.json", lib)
            print(f"  library: {lib['total']} items", file=sys.stderr)
        else:
            print("  library: Zotero did not answer (kept the old one)", file=sys.stderr)
    await fetcher.close()
    print(f"{len(pages)} pages in the seed ({len(failed)} skipped); {fetcher.count} requests to www.hawaii.edu", file=sys.stderr)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(routes.SEED_DIR))
    ap.add_argument("--raw", default=None, help="keep the raw HTML here (and read it back with --from-raw)")
    ap.add_argument("--from-raw", action="store_true")
    ap.add_argument("--only", default=None)
    ap.add_argument("--skip-library", action="store_true")
    sys.exit(asyncio.run(main(ap.parse_args())))
