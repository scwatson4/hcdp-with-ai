"""Where each HCDP page lives on this site (CONTRACT.md "Mirrored pages", 14 Oct) — the one table the mirror job, the
sanitiser's link map, the page endpoint, the navigator's route check and the seed script all read.

The user's rule (13 Oct): HCDP's subpages are replicated exactly; all this site adds is the AI overview at the top, and
asks about maps and data go to that exact map or data. So every HCDP page is one of:
- MIRRORED — a block page copied live into this site at one of our addresses (``MIRRORED``, the families, the posts);
- EMBEDS — an app shell (a page that is one full-screen iframe) rebuilt here as a native embed of the same app;
- NATIVE — a page this site answers with its own native page (Access Data, the Mesonet viewer, the landing);
- everything else keeps its HCDP address and opens in a new tab.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlparse

HCDP = "https://www.hawaii.edu/climate-data-portal"
PORTAL_HOSTS = {"www.hawaii.edu", "hawaii.edu"}
SEED_DIR = Path(__file__).resolve().parent / "data" / "portal_seed"

# Mirrored at a fixed address: our path → HCDP slug.
MIRRORED: dict[str, str] = {
    "/about": "2339-2",
    "/about/history": "2339-2",
    "/about/team": "team",
    "/about/acknowledgements": "acknowledgements",
    "/about/how-to-cite": "how-to-cite-3",
    "/about/rainfall-mapping-history": "rainfall-mapping-history",
    "/about/climate-monitoring-history": "climate-monitoring-history",
    "/data/api": "hcdp-hawaii-mesonet-api",
    "/data/tutorials": "tutorials",
    "/mesonet": "hawaii-mesonet",
    "/pacific": "pacific-portal",
    "/extreme-events": "extreme-events",
    "/tools": "climate-tools",
    "/cultural-resources": "news",
    "/library": "publications-list",
    "/research/highlights": "research-highlights",
    "/research/external-resources": "contact",
    "/research/presentations": "presentations",
    "/conditions-of-use": "conditions-of-use",
}
# The address a link to an HCDP page lands on when several of ours show it.
CANONICAL = {"2339-2": "/about/history"}

# Families: our prefix + the HCDP slug (or its friendlier alias below).
TUTORIALS = ("visualize-data-tutorial", "visualize-data-tutorial-explore-station-data", "export-data-tutorial")
PACIFIC = (
    # the Pacific Portal's own pages
    "pacific-islands-data", "pacific-portal-regional-partners", "2826-2", "pacific-islands-tools-and-resources",
    "pacific-islands-regional-documents", "pacific-portal-ngos", "video-resources", "pacific-marine-national-monuments-weather-stations",
    # its country and territory pages
    "guam-draft", "republic-of-marshall-islands", "federated-states-of-micronesia", "kiribati", "fiji", "tonga", "nauru", "palau",
    "commonwealth-of-the-northern-mariana-islands", "cook-islands", "tokelau", "papua-new-guinea", "solomon-islands", "vanuatu",
    "new-caledonia-draft", "tuvalu", "samoa-draft", "american-samoa-draft", "niue-draft", "french-polynesia",
    # the American Samoa Climate Data Portal
    "americansamoaportal", "as-about", "american-samoa-explore-data", "future-climate-projections", "as-live-climate-data",
    "as-historical-climate-data", "crag-coral-reef-advisory-group-library", "american-samoa-climate-data-portal-guide",
)
CULTURAL = (
    "external-resources-publications", "educational-resources-video-resources", "educational-resources-books", "hawaiian-connection",
    "climate-glossary", "educational-resources-web", "dryland-agriculture", "hawaiian-lunar-calendar", "climate-perspective",
    "educational-resources-courses",
)
FAMILIES: dict[str, tuple[str, ...]] = {"/data/tutorials/": TUTORIALS, "/pacific/": PACIFIC, "/cultural-resources/": CULTURAL}
POSTS_PREFIX = "/research/posts/"
# Friendlier names for two HCDP slugs (the HCDP slug itself is accepted too).
ALIASES = {"/pacific/american-samoa": "americansamoaportal", "/pacific/countries-and-territories": "2826-2"}

# App shells → native embeds of the same app (our path → the app's address and the HCDP page that frames it).
_SUMMARY_APP = "https://cherryleh.github.io/climate-summary/"
EMBEDS: dict[str, dict] = {
    "/extreme-events/nolo": {"src": _SUMMARY_APP + "#/hurricane-nolo", "slug": "hurricane-nolo", "title": "Hurricane Nolo"},
    "/extreme-events/lowell": {"src": _SUMMARY_APP + "#/hurricane-lowell", "slug": "hurricane-lowell", "title": "Hurricane Lowell"},
    "/extreme-events/lala": {"src": _SUMMARY_APP + "#/hurricane-lala", "slug": "hurricane-lala", "title": "Hurricane Lala"},
    "/extreme-events/kona-low-1": {"src": _SUMMARY_APP + "#/storm-viewer", "slug": "2026-kona-low-1", "title": "Kona Low Storm (#1)"},
    "/extreme-events/kona-low-2": {"src": _SUMMARY_APP + "#/storm-viewer-march2026-2", "slug": "2026-kona-low-2", "title": "Kona Low Storm (#2)"},
    "/pacific/guam": {"src": "https://hcdp.github.io/gcdp/", "slug": "guam-data-viewer", "title": "Guam Data Viewer"},
    "/climate-summary": {"src": _SUMMARY_APP + "#/", "slug": "climate-summary", "title": "Monthly Climate Summary"},
}
# HCDP pages this site answers with its own native page.
NATIVE = {
    "": "/", "data-portal": "/data", "hawaii-mesonet-data": "/mesonet?viewer=live", "hawaii-mesonet-data-access": "/mesonet?viewer=live",
    "nolo-mesonet-viewer": "/mesonet?viewer=nolo", "extreme-event": "/extreme-events",
}
# The document title where HCDP's own is a working title or empty.
TITLE_OVERRIDES = {
    "pacific-portal": "Pacific Portal", "guam-data-viewer": "Guam Data Viewer", "future-climate-projections": "Future Climate Projections",
    "2026-kona-low-1": "Kona Low Storm (#1)", "2026-kona-low-2": "Kona Low Storm (#2)",
}
# Mesonet views the live app has (its #/<view> routes); anything else falls back to the dashboard.
MESONET_VIEW_RE = re.compile(r"^[a-z0-9-]{1,40}$")


def fold(slug: str) -> str:
    """A slug compared loosely: percent-escapes decoded, lowercase, the ʻokina and diacritics dropped."""
    s = unicodedata.normalize("NFKD", unquote(slug or "").strip().lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[ʻ‘’']", "", s)


def file_stem(slug: str) -> str:
    """The on-disk name of a slug's copy: WordPress's own percent-encoded form, lowercase (ʻ → %ca%bb)."""
    from urllib.parse import quote
    return quote(unquote(slug or ""), safe="-_").lower() or "home"


# ----- the posts (dynamic: read from the live index when the job has one, else the committed seed) -----------------------
_posts_source = None   # a callable returning the live post slugs (portal.py installs one)


def set_posts_source(fn) -> None:
    global _posts_source
    _posts_source = fn


_seed_cache: dict[str, tuple[float, dict]] = {}


def seed_index(seed_dir: Path | None = None) -> dict:
    """The committed seed's index.json (cached until the file changes)."""
    p = (seed_dir or SEED_DIR) / "index.json"
    try:
        m = p.stat().st_mtime
    except OSError:
        return {}
    hit = _seed_cache.get(str(p))
    if hit and hit[0] == m:
        return hit[1]
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    _seed_cache[str(p)] = (m, data)
    return data


def post_slugs() -> list[str]:
    """Every HCDP post this site mirrors at /research/posts/<slug> (decoded slugs)."""
    live = None
    if _posts_source is not None:
        try:
            live = _posts_source()
        except Exception:  # noqa: BLE001
            live = None
    if live:
        return list(live)
    return list(seed_index().get("posts") or [])


# ----- our path → HCDP ---------------------------------------------------------------------------------------------------
def _clean_path(path: str) -> str:
    p = (path or "").split("#", 1)[0].partition("?")[0]
    p = unquote(p)
    return p.rstrip("/") or "/"


def slug_for_path(path: str) -> str | None:
    """The HCDP slug one of our mirrored addresses shows (decoded), or None for an address that mirrors nothing."""
    p = _clean_path(path)
    if p in MIRRORED:
        return MIRRORED[p]
    if p in ALIASES:
        return ALIASES[p]
    for prefix, slugs in FAMILIES.items():
        if p.startswith(prefix):
            want = fold(p[len(prefix):])
            return next((s for s in slugs if fold(s) == want), None)
    if p.startswith(POSTS_PREFIX):
        want = fold(p[len(POSTS_PREFIX):])
        return next((s for s in post_slugs() if fold(s) == want), None)
    return None


def embed_for_path(path: str) -> dict | None:
    return EMBEDS.get(_clean_path(path))


def hcdp_url(slug: str) -> str:
    return f"{HCDP}/{slug}/" if slug else f"{HCDP}/"


def mirrored_slugs() -> dict[str, str]:
    """{HCDP slug: our canonical path} for every page this site mirrors (the job's work list)."""
    out: dict[str, str] = {}
    for path, slug in MIRRORED.items():
        out.setdefault(slug, CANONICAL.get(slug, path))
    alias_of = {v: k for k, v in ALIASES.items()}
    for prefix, slugs in FAMILIES.items():
        for s in slugs:
            out.setdefault(s, alias_of.get(s, prefix + s))
    for s in post_slugs():
        out.setdefault(s, POSTS_PREFIX + s)
    return out


def family_paths() -> list[str]:
    """Every family address (for the navigator's route check): /pacific/<slug>, aliases, embeds, posts."""
    paths = [prefix + s for prefix, slugs in FAMILIES.items() for s in slugs]
    paths += list(ALIASES) + [p for p in EMBEDS if p.count("/") > 1] + [POSTS_PREFIX + s for s in post_slugs()]
    return paths


# ----- the link map: an HCDP address → ours ------------------------------------------------------------------------------
def portal_rest(url: str) -> tuple[str, str, str] | None:
    """(slug path, query, fragment) of an HCDP portal address, or None for any other address. The slug path is decoded,
    without the portal prefix and without slashes at either end ('' for the portal's home)."""
    try:
        u = urlparse((url or "").strip())
    except ValueError:
        return None
    if (u.hostname or "").lower() not in PORTAL_HOSTS:
        return None
    path = unquote(u.path or "/")
    if path.rstrip("/") == "/climate-data-portal":
        return "", u.query, u.fragment
    if not path.startswith("/climate-data-portal/"):
        return None
    return path[len("/climate-data-portal/"):].strip("/"), u.query, u.fragment


def _mesonet_from_hash(fragment: str) -> str:
    """'#/dashboard?id=0115' → '/mesonet?viewer=live&view=dashboard&station=0115' (unknown shapes → the viewer)."""
    frag = (fragment or "").lstrip("#")
    route, _, q = frag.lstrip("/").partition("?")
    view = route.strip("/").split("/")[0]
    params = [("viewer", "live")]
    if view and MESONET_VIEW_RE.match(view):
        params.append(("view", view))
    station = dict(parse_qsl(q)).get("id")
    if station and re.match(r"^[A-Za-z0-9_.-]{1,20}$", station):
        params.append(("station", station))
    return "/mesonet?" + urlencode(params)


def _summary_from_hash(fragment: str) -> str:
    """'#/?year=2026&month=8' → '/climate-summary?year=2026&month=8'; any other app route → '/climate-summary'."""
    frag = (fragment or "").lstrip("#").lstrip("/")
    route, _, q = frag.partition("?")
    if not route.strip("/"):
        qs = dict(parse_qsl(q))
        y, m = qs.get("year", ""), qs.get("month", "")
        if re.fullmatch(r"\d{4}", y) and re.fullmatch(r"1[0-2]|[1-9]", m):
            return f"/climate-summary?year={y}&month={m}"
    return "/climate-summary"


def path_for_url(url: str) -> str | None:
    """Our address for an HCDP page (the link map) — None when it stays on HCDP (a new tab). PDFs and other uploads,
    the atlases, the Library's search, unmirrored posts, searches (?s=) and feeds stay on HCDP."""
    rest = portal_rest(url)
    if rest is None:
        return None
    slug, query, fragment = rest
    if slug.startswith(("wp-content", "wp-json", "wp-admin", "wp-includes", "feed", "tag/", "category/", "author/", "page/")) or slug.endswith("/feed"):
        return None
    if "s" in dict(parse_qsl(query)):
        return None
    key = fold(slug)
    if "/" in slug:
        return None   # a child page (hawaii-mesonet/qr) is not mirrored
    if key == "hawaii-mesonet-data":
        return _mesonet_from_hash(fragment) if fragment.strip("#/") else "/mesonet?viewer=live"
    if key == "climate-summary":
        return _summary_from_hash(fragment)
    for native_slug, target in NATIVE.items():
        if fold(native_slug) == key and (native_slug or not slug):
            return target
    for path, emb in EMBEDS.items():
        if fold(emb["slug"]) == key:
            return path
    mirrored = mirrored_slugs()
    for s, path in mirrored.items():
        if fold(s) == key:
            return path + (f"#{fragment}" if fragment and not fragment.startswith("/") else "")
    return None


def title_for(slug: str, hcdp_title: str) -> str:
    return TITLE_OVERRIDES.get(slug) or (hcdp_title or "").strip()
