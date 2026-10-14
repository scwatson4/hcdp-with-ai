#!/usr/bin/env python3
"""Build the mirrored pages' theme bundle (CONTRACT.md "Mirrored pages", 14 Oct).

Downloads, once, the stylesheets HCDP's WordPress theme (OnePress 2.2.7, HCDP-edited, on Bootstrap 4-alpha) loads on
every page — bootstrap.min.css, the theme's style.css, Font Awesome 4.7's classes, the full block-library CSS — and the
sitewide inline styles of its <head> (classic-theme-styles, global-styles, the theme's customizer CSS, wp-custom-css, the
emoji/auto-sizes helpers), adds the `.wrapper` helper HCDP's pages use for responsive embeds, rewrites the lot for a
shadow root with the sanitiser's own transform (portal_sanitize.shadow_css: html/:root → :host, body → .hcdp-body,
rem → var(--hcdp-rem), HCDP's root font sizes become --hcdp-rem; @font-face and @import dropped — Font Awesome's font is
declared on the document by the frontend when a page uses it) and writes ONE versioned file,
frontend/public/portal/theme.<hash>.css (committed, immutable), plus frontend/src/portal/theme.json naming it.
animate.css, lightgallery and zotpress are skipped on purpose (nothing mirrored needs them).

Every fetch of www.hawaii.edu goes through the mirror's own fetcher: one at a time, at least 3 s after the previous one
ended (HCDP's robots.txt Crawl-delay), with the mirror's User-Agent and a 15 s timeout.  Run:  python3 scripts/portal_theme.py
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import portal  # noqa: E402
from portal_sanitize import shadow_css  # noqa: E402

PORTAL = "https://www.hawaii.edu/climate-data-portal"
OUT_DIR = ROOT / "frontend" / "public" / "portal"
META = ROOT / "frontend" / "src" / "portal" / "theme.json"
LINKS = ["onepress-bootstrap", "onepress-fa", "onepress-style"]
SITEWIDE_INLINE = ["wp-img-auto-sizes-contain-inline-css", "wp-emoji-styles-inline-css", "classic-theme-styles-inline-css",
                   "global-styles-inline-css", "onepress-style-inline-css", "wp-custom-css"]
WRAPPER_HELPER = ".wrapper{position:relative;padding-bottom:56.25%;padding-top:25px;height:0}.wrapper iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}"


def absolutize(css: str, base: str) -> str:
    """url(../x) and url(x) relative to the stylesheet's own address → absolute; data:, http(s): and // left alone."""
    def fix(m):
        q, u = m.group(1) or "", m.group(2).strip()
        if re.match(r"^(data:|https?:|//|#)", u):
            return m.group(0)
        return f"url({q}{urljoin(base, u)}{q})"
    return re.sub(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", fix, css)


async def main() -> int:
    fetcher = portal.Fetcher()
    status, body, _, _ = await fetcher.get(PORTAL + "/")
    if status != 200:
        print("could not fetch the HCDP home page", file=sys.stderr)
        return 1
    html = body.decode("utf-8", "replace")
    links = {m.group(1): m.group(2).replace("&#038;", "&") for m in re.finditer(r"<link[^>]+id='([^']+)-css'[^>]+href='([^']+)'", html)}
    inline = {m.group(1): m.group(2) for m in re.finditer(r"<style[^>]*id=\"([^\"]+)\"[^>]*>(.*?)</style>", html, re.S)}
    ver = re.search(r"ver=([0-9.]+)", links.get("onepress-style", ""))
    wp_ver = ver.group(1) if ver else ""
    sources = [(name, links.get(name)) for name in LINKS]
    sources.insert(2, ("wp-block-library", f"{PORTAL}/wp-includes/css/dist/block-library/style.min.css" + (f"?ver={wp_ver}" if wp_ver else "")))
    parts: list[tuple[str, str]] = []
    for name, url in sources:
        if not url:
            print(f"no stylesheet {name} on the home page", file=sys.stderr)
            return 1
        st, css, _, final = await fetcher.get(url)
        print(f"  {st} {len(css):>8} B  {url}", file=sys.stderr)
        if st != 200:
            print(f"failed: {url}", file=sys.stderr)
            return 1
        parts.append((name, shadow_css(absolutize(css.decode("utf-8", "replace"), final.split("?")[0]))))
    for sid in SITEWIDE_INLINE:
        if sid in inline:
            parts.append((sid, shadow_css(re.sub(r"/\*# sourceURL=[^*]*\*/", "", inline[sid]))))
    parts.append(("wrapper-helper", WRAPPER_HELPER))
    await fetcher.close()
    bundle = "".join(f"\n/* ===== {name} ===== */\n{css.strip()}\n" for name, css in parts)
    digest = hashlib.sha1(bundle.encode("utf-8")).hexdigest()[:10]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("theme.*.css"):
        old.unlink()
    out = OUT_DIR / f"theme.{digest}.css"
    out.write_text(bundle, encoding="utf-8")
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({"file": f"/portal/theme.{digest}.css", "hash": digest, "bytes": len(bundle.encode("utf-8")),
                                "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "wordpress": wp_ver,
                                "sources": [n for n, _ in parts], "requests": fetcher.count}, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(bundle)} chars, {fetcher.count} requests) and {META}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
