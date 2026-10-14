"""Turn one HCDP WordPress page into the clean, self-contained copy this site's mirrored pages render (14 Oct).

The user's rule: HCDP's subpages are replicated exactly; all we add is the AI overview at the top. So this module takes a
page's HTML as HCDP serves it, keeps `article .entry-content` (plus, for a post, its title, date and thumbnail) with its
block markup, classes and inline styles, and removes what cannot or must not travel: scripts, stylesheet links, meta tags,
comments, on* handlers, javascript: URLs, WordPress search forms, Zotpress blocks, the byline and tag footer of a post, and
the oEmbed iframes (their blockquote link stays). Content <style> blocks are kept minus the rules aimed at the whole
document (html, body, *, bare div/iframe/main/article), which the app-shell pages use to make the page one iframe.
Jetpack slideshows become a static list of figures.

Links go through the link map (portal_routes.path_for_url): HCDP pages this site has become our routes (same tab);
everything else keeps its address and opens in a new tab with an arrow; mailto:, tel: and #hash links stay as they are.
Images are routed through /api/portal/img (allow-listed to HCDP's uploads, resized to at most 800 px, cached), one source
per picture, in src and srcset; iframes survive only from the embed allow-list, lazily, with a title and fullscreen
allowed, sized by their own aspect ratio; the Google Form gets its full 1400 px or an "Open the form" button on phones.

The page's CSS (the head's per-page block styles plus the content <style> blocks) is rewritten for a shadow root by
`shadow_css` — the same transform the theme bundle gets (scripts/portal_theme.py): `html`/`:root` → `:host`, `body` →
`.hcdp-body` (the wrapper that carries HCDP's body classes) and `rem` → `var(--hcdp-rem)` multiples, so HCDP's root
size (16/15/14 px by breakpoint) holds inside our page whose own root stays 16 px.

Everything that leaves here has been through nh3's allow-list as the last step.
"""
from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlparse, urlunparse

import nh3
from bs4 import BeautifulSoup, Comment, NavigableString, Tag

PORTAL = "https://www.hawaii.edu/climate-data-portal"
PORTAL_HOSTS = {"www.hawaii.edu", "hawaii.edu"}
UPLOADS_PREFIX = f"{PORTAL}/wp-content/uploads/"
IMG_MAX_W = 800
IMG_SMALL_W = 400
IMG_PROXY = "/api/portal/img"
# Hosts whose iframes a mirrored page may keep (everything else becomes a link to the frame's address).
IFRAME_HOSTS = {
    "www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "player.vimeo.com", "docs.google.com", "drive.google.com",
    "wordwall.net", "uhm.maps.arcgis.com", "experience.arcgis.com", "cherryleh.github.io", "hcdp.github.io", "rainfall.ikewai.org",
    "ikewai.github.io",
}
GOOGLE_FORM_HEIGHT = 1400
NOT_FOUND_TITLES = ("page not found", "nothing found", "oops! that page can")
EXCERPT_CHARS = 2000
# Removed outright (chrome, scripts, plugins that need their JavaScript, the comment form, a post's byline and footer).
REMOVE_SELECTORS = [
    "script", "noscript", "link", "meta", "form", "input", "select", "textarea", "button", "template", "object", "embed", "applet",
    ".wp-block-search", ".search-form", ".zp-Library", ".zp-Browse", "[class*=zotpress]", "[id^=zotpress]", "a[name^=zotpress]",
    ".sharedaddy", ".jp-relatedposts", "#jp-post-flair", "img#wpstats", ".wp-block-jetpack-slideshow_button-prev",
    ".wp-block-jetpack-slideshow_button-next", ".wp-block-jetpack-slideshow_button-pause", ".wp-block-jetpack-slideshow_pagination",
    ".byline", ".comments-area", ".entry-footer", ".post-navigation", "iframe.wp-embedded-content", "time.updated", ".screen-reader-text.hide",
]
# Head <style> blocks that are the same on every page: the theme bundle carries them (scripts/portal_theme.py).
SITEWIDE_HEAD_STYLES = {
    "wp-img-auto-sizes-contain-inline-css", "wp-emoji-styles-inline-css", "classic-theme-styles-inline-css", "onepress-style-inline-css",
    "wp-custom-css", "jetpack-stats-inline-css",
}

# ----- CSS for a shadow root -----------------------------------------------------------------------------------------------
_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)


_REM_RE = re.compile(r"(?<![\w.#-])(-?(?:\d+\.?\d*|\.\d+))rem\b")
_DOC_SELECTOR = re.compile(r"^(?:html|body|\*|div|iframe|main|article|:root)(?:\s*[>~+]\s*\*|\s+\*)?$", re.I)
_DOC_PREFIX = re.compile(r"^(?:html|body|:root)\b", re.I)
_BAD_CSS = re.compile(r"expression\s*\(|javascript:|behavior\s*:|-moz-binding", re.I)


def rem_to_var(value: str) -> str:
    """'1.4rem' → 'calc(1.4 * var(--hcdp-rem, 16px))' in a declaration value (never inside a media query)."""
    return _REM_RE.sub(lambda m: f"calc({m.group(1)} * var(--hcdp-rem, 16px))", value)


def split_rules(css: str) -> list[tuple[str, str]]:
    """[(prelude, body)] for the top-level rules of a stylesheet (an @media body keeps its inner text; strings with
    braces inside are respected)."""
    out: list[tuple[str, str]] = []
    depth, start, prelude_start, i, n = 0, 0, 0, 0, len(css)
    prelude = ""
    quote_ch = ""
    while i < n:
        c = css[i]
        if quote_ch:
            if c == "\\":
                i += 2
                continue
            if c == quote_ch:
                quote_ch = ""
        elif c in "\"'":
            quote_ch = c
        elif c == "{":
            if depth == 0:
                prelude = css[prelude_start:i]
                start = i + 1
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                out.append((prelude.strip(), css[start:i]))
                prelude_start = i + 1
            elif depth < 0:
                depth = 0
                prelude_start = i + 1
        elif c == ";" and depth == 0:
            # a statement at-rule (@charset, @import …) — dropped
            prelude_start = i + 1
        i += 1
    return out


def _host_selector(sel: str) -> str | None:
    """One selector for a shadow root: the type selectors html and :root → :host, body → .hcdp-body (only at the top
    level — never inside [attribute] selectors or strings); None when it cannot apply there (html.has-modal-open,
    html[dir=rtl], :root:has(…) — document state a mirrored page never has)."""
    s = sel.strip()
    if not s:
        return None
    out: list[str] = []
    i, n, depth, q = 0, len(s), 0, ""
    while i < n:
        c = s[i]
        if q:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(s[i + 1])
                i += 2
                continue
            if c == q:
                q = ""
            i += 1
            continue
        if c in "\"'":
            q = c
            out.append(c)
            i += 1
            continue
        if c == "[":
            depth += 1
        elif c == "]":
            depth = max(0, depth - 1)
        if depth == 0:
            prev = s[i - 1] if i > 0 else " "
            low = s[i:i + 5].lower()
            if low == ":root" and not re.match(r"[\w-]", prev) and not re.match(r"[\w-]", s[i + 5:i + 6] or " "):
                if (s[i + 5:i + 6] or " ") in ".#[:":
                    return None
                out.append(":host")
                i += 5
                continue
            word = s[i:i + 4].lower()
            if word in ("html", "body") and not re.match(r"[\w.#:-]", prev) and not re.match(r"[\w-]", s[i + 4:i + 5] or " "):
                nxt = s[i + 4:i + 5] or " "
                if word == "html":
                    if nxt in ".#[:":
                        return None
                    out.append(":host")
                else:
                    out.append(".hcdp-body")
                i += 4
                continue
        out.append(c)
        i += 1
    return "".join(out)


def _declarations(body: str) -> str:
    return rem_to_var(body.strip())


def shadow_css(css: str, *, drop_document_rules: bool = False, keep_font_face: bool = False) -> str:
    """A stylesheet rewritten for a mirrored page's shadow root (see the module docstring). `drop_document_rules` also
    drops the rules aimed at the whole document (content <style> blocks). @import/@charset are dropped; @font-face too
    (fonts must be declared at document level), unless `keep_font_face`."""
    css = _COMMENT_RE.sub("", css or "")
    kept: list[str] = []
    for prelude, body in split_rules(css):
        if not prelude:
            continue
        low = prelude.lower()
        if low.startswith(("@import", "@charset", "@namespace")):
            continue
        if low.startswith("@font-face"):
            if keep_font_face:
                kept.append(f"@font-face{{{body.strip()}}}")
            continue
        if low.startswith(("@media", "@supports", "@container", "@layer", "@document")):
            inner = shadow_css(body, drop_document_rules=drop_document_rules, keep_font_face=keep_font_face)
            if inner.strip():
                kept.append(f"{prelude}{{{inner}}}")
            continue
        if low.startswith("@"):
            kept.append(f"{prelude}{{{body}}}")   # @keyframes, @page … as they are
            continue
        if _BAD_CSS.search(body):
            continue
        sels = [x for x in (s.strip() for s in _split_selectors(prelude)) if x]
        if drop_document_rules and any(_DOC_SELECTOR.match(re.sub(r"\s+", " ", s)) or _DOC_PREFIX.match(s) for s in sels):
            continue
        mapped = [m for m in (_host_selector(s) for s in sels) if m]
        if not mapped:
            continue
        decl = _declarations(body)
        root_px = re.search(r"(?:^|;)\s*font-size\s*:\s*(\d+(?:\.\d+)?)px", body)
        if mapped == [":host"] and root_px:
            # HCDP's root size (16/15/14 px by breakpoint) becomes the unit every rem in its CSS is measured in
            decl = decl.rstrip().rstrip(";") + f";--hcdp-rem:{root_px.group(1)}px"
        kept.append(f"{','.join(mapped)}{{{decl}}}")
    return "\n".join(kept)


def _split_selectors(prelude: str) -> list[str]:
    """Split a selector list on top-level commas (not those inside :is()/:where()/:not() parentheses)."""
    out, depth, cur = [], 0, []
    for ch in prelude:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return out


# ----- the nh3 allow-list ----------------------------------------------------------------------------------------------
_GLOBAL_ATTRS = {"class", "id", "style", "title", "lang", "dir", "role", "hidden", "translate", "tabindex"}
ALLOWED_TAGS = {
    "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code", "col", "colgroup",
    "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header",
    "hr", "i", "iframe", "img", "ins", "kbd", "li", "mark", "nav", "ol", "p", "picture", "pre", "q", "s", "samp", "section", "small",
    "source", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
    "video", "audio", "track", "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs", "desc",
}
ALLOWED_ATTRS = {
    "*": _GLOBAL_ATTRS,
    "a": {"href", "target", "rel", "name", "download", "hreflang", "type"},
    "img": {"src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"},
    "iframe": {"src", "title", "width", "height", "loading", "allow", "allowfullscreen", "referrerpolicy", "frameborder", "scrolling"},
    "time": {"datetime"},
    "ol": {"start", "reversed", "type"},
    "li": {"value"},
    "td": {"colspan", "rowspan", "headers"},
    "th": {"colspan", "rowspan", "headers", "scope", "abbr"},
    "col": {"span"},
    "colgroup": {"span"},
    "details": {"open"},
    "blockquote": {"cite"},
    "q": {"cite"},
    "del": {"cite", "datetime"},
    "ins": {"cite", "datetime"},
    "video": {"src", "controls", "poster", "preload", "loop", "muted", "playsinline", "width", "height"},
    "audio": {"src", "controls", "preload", "loop", "muted"},
    "source": {"src", "srcset", "type", "media", "sizes"},
    "track": {"src", "kind", "srclang", "label", "default"},
    "svg": {"viewbox", "xmlns", "width", "height", "fill", "stroke", "focusable", "preserveaspectratio"},
    "path": {"d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "opacity", "transform"},
    "g": {"fill", "stroke", "stroke-width", "transform", "opacity"},
    "circle": {"cx", "cy", "r", "fill", "stroke", "stroke-width"},
    "ellipse": {"cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width"},
    "rect": {"x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width"},
    "line": {"x1", "y1", "x2", "y2", "stroke", "stroke-width"},
    "polyline": {"points", "fill", "stroke", "stroke-width"},
    "polygon": {"points", "fill", "stroke", "stroke-width"},
}
URL_SCHEMES = {"http", "https", "mailto", "tel"}
_BAD_STYLE = re.compile(r"expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding|url\(\s*['\"]?\s*(?!https?:|/api/portal/img|data:image/)[^)]*\)", re.I)


def _attribute_filter(element: str, attribute: str, value: str):
    """The last word on attribute values: inline styles may not fetch or run anything."""
    if attribute == "style":
        return None if _BAD_STYLE.search(value or "") else value
    if attribute.lower().startswith("on"):
        return None
    return value


def nh3_clean(html: str) -> str:
    return nh3.clean(html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, url_schemes=URL_SCHEMES, link_rel=None, strip_comments=True,
                     generic_attribute_prefixes={"aria-", "data-"}, attribute_filter=_attribute_filter)


# ----- URLs -------------------------------------------------------------------------------------------------------------
def normalize_url(href: str, base: str = PORTAL + "/") -> str:
    """One spelling for a link: absolute, without utm_* keys. An HCDP portal address also gets https, the www host, its
    path's percent-escapes decoded and its trailing slash dropped (so the link map sees one form); any other address keeps
    its own scheme and path (http://weather.hawaii.edu/vmap/ has no https)."""
    raw = (href or "").strip()
    u = urlparse(urljoin(base, raw))
    query = urlencode([(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not k.lower().startswith("utm_")])
    host = (u.hostname or "").lower()
    if host in PORTAL_HOSTS:
        netloc = "www.hawaii.edu"
        path = unquote(u.path or "/")
        if len(path) > 1:
            path = path.rstrip("/")
        return urlunparse(("https", netloc, path, "", query, u.fragment))
    return urlunparse((u.scheme, u.netloc, u.path, u.params, query, u.fragment))


def external_href(href: str, base: str = PORTAL + "/") -> str:
    """The address an external link keeps: absolute, without utm_* keys, HCDP's own on https and its www host — its path as
    HCDP wrote it (the trailing slash saves the visitor a redirect)."""
    u = urlparse(urljoin(base, (href or "").strip()))
    query = urlencode([(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not k.lower().startswith("utm_")])
    if (u.hostname or "").lower() in PORTAL_HOSTS:
        return urlunparse(("https", "www.hawaii.edu", u.path, u.params, query, u.fragment))
    return urlunparse((u.scheme, u.netloc, u.path, u.params, query, u.fragment))


def upload_url(href: str, base: str = PORTAL + "/") -> str | None:
    """The canonical address of an HCDP upload (https, www, the path as served), or None for anything else."""
    u = urlparse(urljoin(base, (href or "").strip()))
    if (u.hostname or "").lower() not in PORTAL_HOSTS or u.scheme not in ("http", "https"):
        return None
    url = urlunparse(("https", "www.hawaii.edu", u.path, "", "", ""))
    return url if is_upload(url) else None


def is_upload(url: str) -> bool:
    return isinstance(url, str) and url.startswith(UPLOADS_PREFIX) and ".." not in url and "\\" not in url


def proxied_image(url: str, width: int | None = None) -> str:
    """The /api/portal/img address for an HCDP upload at a width (≤ IMG_MAX_W)."""
    w = max(16, min(int(width or IMG_MAX_W), IMG_MAX_W))
    return f"{IMG_PROXY}?u={quote(url, safe='')}&w={w}"


_SIZE_SUFFIX = re.compile(r"-(\d{2,5})x(\d{2,5})(?=\.[a-z0-9]+$)", re.I)


def _candidates(img: Tag, base: str) -> list[tuple[str, int | None]]:
    """(upload url, width or None) for src and every srcset candidate that is an HCDP upload."""
    out: list[tuple[str, int | None]] = []
    srcset = img.get("srcset") or ""
    for cand in re.split(r",\s+(?=\S)", srcset.strip()) if srcset.strip() else []:
        parts = cand.strip().split()
        if not parts:
            continue
        url = upload_url(parts[0], base)
        if not url:
            continue
        m = re.fullmatch(r"(\d+)w", parts[1]) if len(parts) > 1 else None
        out.append((url, int(m.group(1)) if m else None))
    src = upload_url(img.get("src") or img.get("data-src") or "", base)
    if src and not any(u == src for u, _ in out):
        w = _int(img.get("width"))
        m = _SIZE_SUFFIX.search(src)
        out.append((src, int(m.group(1)) if m else w))
    return out


def choose_source(cands: list[tuple[str, int | None]]) -> tuple[str, int | None] | None:
    """The one upload to fetch for a picture: the narrowest candidate at least IMG_MAX_W wide, else the widest; a
    candidate of unknown width (usually the full-size original) when no width is known at all."""
    if not cands:
        return None
    known = [(u, w) for u, w in cands if w]
    if not known:
        return cands[0]
    wide = [(u, w) for u, w in known if w >= IMG_MAX_W]
    if wide:
        return min(wide, key=lambda t: t[1])
    unknown = [(u, w) for u, w in cands if not w]
    return unknown[0] if unknown else max(known, key=lambda t: t[1])


_CSS_URL = re.compile(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)")


def rewrite_style(style: str, base: str, images: list[dict]) -> str:
    """An inline style for the shadow root: url(<HCDP upload>) → the proxy at 800 px (other url()s become none), and
    rem → var(--hcdp-rem) multiples."""
    def fix(m):
        raw = m.group(2).strip()
        if raw.startswith("data:image/"):
            return m.group(0)
        u = upload_url(raw, base)
        if u:
            _note_image(images, u, None)
            return f"url({proxied_image(u, IMG_MAX_W)})"
        return "none"
    return rem_to_var(_CSS_URL.sub(fix, style or ""))


def _note_image(images: list[dict], url: str, width: int | None) -> None:
    for it in images:
        if it["u"] == url:
            if width and not it.get("w"):
                it["w"] = width
            return
    images.append({"u": url, "w": width})


# ----- the page -----------------------------------------------------------------------------------------------------------
class SanitizeError(ValueError):
    """The page is not one we can mirror (no .entry-content, a 'Page not found' title …)."""


def _text(el: Tag | None) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)) if el is not None else ""


def page_title(soup: BeautifulSoup) -> str:
    t = soup.title.get_text() if soup.title else ""
    t = re.sub(r"\s*[–\-|]\s*Hawai.i Climate Data Portal\s*$", "", t.strip())
    return "" if re.fullmatch(r"Hawai.i Climate Data Portal", t.strip()) else t.strip()


def _remove(root: Tag, selectors: list[str]) -> None:
    for sel in selectors:
        for el in root.select(sel):
            el.decompose()


def _strip_comments(root: Tag) -> None:
    for c in root.find_all(string=lambda s: isinstance(s, Comment)):
        c.extract()


def _is_text_only_link(a: Tag) -> bool:
    return _text(a) != "" and a.find("img") is None and all(
        isinstance(c, NavigableString) or (isinstance(c, Tag) and c.name in ("span", "em", "strong", "b", "i", "u", "small", "sup", "sub", "code", "abbr", "br", "mark"))
        for c in a.children)


def _rewrite_links(root: Tag, page_url: str, resolve: Callable[[str], str | None], factory: BeautifulSoup) -> None:
    for a in root.find_all("a"):
        href = (a.get("href") or "").strip()
        if not href:
            a.attrs.pop("target", None)
            continue
        low = href.lower()
        if low.startswith(("javascript:", "data:", "vbscript:", "file:")):
            del a["href"]
            a.attrs.pop("target", None)
            continue
        if href.startswith("#"):
            a.attrs.pop("target", None)
            continue
        if low.startswith(("mailto:", "tel:")):
            continue
        url = normalize_url(href, page_url)
        internal = resolve(url)
        if internal:
            a["href"] = internal
            a.attrs.pop("target", None)
            a.attrs.pop("rel", None)
            a["data-mirror"] = "internal"
            continue
        if not urlparse(url).scheme.startswith("http"):
            del a["href"]
            continue
        a["href"] = external_href(href, page_url)
        a["target"] = "_blank"
        a["rel"] = "noopener noreferrer"
        a["data-mirror"] = "external"
        if _is_text_only_link(a) and not a.find(class_="hcdp-mirror-ext"):
            arrow = factory.new_tag("span")
            arrow["class"] = ["hcdp-mirror-ext"]
            arrow["aria-hidden"] = "true"
            arrow.string = " ↗"
            a.append(arrow)
            sr = factory.new_tag("span")
            sr["class"] = ["hcdp-mirror-sr"]
            sr.string = " (opens in a new tab)"
            a.append(sr)


def _rewrite_images(root: Tag, page_url: str, images: list[dict]) -> None:
    for img in root.find_all("img"):
        cands = _candidates(img, page_url)
        chosen = choose_source(cands)
        if chosen is None:
            src = normalize_url(img.get("src") or "", page_url) if img.get("src") else ""
            if not src.startswith("https://") or not re.match(r"^https://[^/]+/", src):
                img.decompose()
                continue
            img["src"] = src                       # a picture from elsewhere (a partner logo): as it is
            img.attrs.pop("srcset", None)
            img.attrs.pop("sizes", None)
        else:
            url, width = chosen
            _note_image(images, url, width)
            top = min(width or IMG_MAX_W, IMG_MAX_W)
            had_srcset = bool((img.get("srcset") or "").strip())
            img["src"] = proxied_image(url, top)
            if had_srcset and top > IMG_SMALL_W:
                img["srcset"] = f"{proxied_image(url, IMG_SMALL_W)} {IMG_SMALL_W}w, {proxied_image(url, top)} {top}w"
                if not img.get("sizes"):
                    img["sizes"] = f"(max-width: {top}px) 100vw, {top}px"
            else:
                img.attrs.pop("srcset", None)
                img.attrs.pop("sizes", None)
        img.attrs.pop("data-src", None)
        img.attrs.pop("data-srcset", None)
        img["loading"] = "lazy"
        img["decoding"] = "async"
        if img.get("alt") is None:
            img["alt"] = ""
    for el in root.find_all(style=True):
        el["style"] = rewrite_style(el["style"], page_url, images)


def _int(v) -> int | None:
    try:
        n = int(float(str(v or "").strip().rstrip("px")))
        return n if n > 0 else None
    except ValueError:
        return None


def _rewrite_iframes(root: Tag, page_url: str, embeds: list[dict], factory: BeautifulSoup) -> None:
    for frame in root.find_all("iframe"):
        raw = frame.get("src") or frame.get("data-src") or ""
        src = normalize_url(raw, page_url) if raw.strip() else ""
        host = (urlparse(src).hostname or "").lower()
        if not src or host not in IFRAME_HOSTS or not src.startswith("https://"):
            if src.startswith(("https://", "http://")):
                p = factory.new_tag("p")
                p["class"] = ["hcdp-mirror-embed-link"]
                a = factory.new_tag("a", href=src, target="_blank", rel="noopener noreferrer")
                a["data-mirror"] = "external"
                a.string = f"Open the embedded content from {host} ↗"
                p.append(a)
                frame.replace_with(p)
            else:
                frame.decompose()
            continue
        title = (frame.get("title") or "").strip()
        if not title:
            heading = frame.find_previous(["h1", "h2", "h3", "h4", "figcaption"])
            title = _text(heading)[:120] if heading is not None else ""
            title = title or f"Embedded content from {host}"
        width, height = _int(frame.get("width")), _int(frame.get("height"))
        frame.attrs = {"src": src, "title": title, "loading": "lazy", "allow": "fullscreen", "allowfullscreen": "",
                       "referrerpolicy": "strict-origin-when-cross-origin"}
        if host == "docs.google.com" and "/forms/" in src:
            frame["style"] = f"width:100%;height:{GOOGLE_FORM_HEIGHT}px;border:0"
            frame["class"] = ["hcdp-mirror-form-frame"]
            wrap = factory.new_tag("div")
            wrap["class"] = ["hcdp-mirror-form"]
            frame.wrap(wrap)
            p = factory.new_tag("p")
            p["class"] = ["hcdp-mirror-form-open"]
            a = factory.new_tag("a", href=src.replace("embedded=true", "").rstrip("?&"), target="_blank", rel="noopener noreferrer")
            a["class"] = ["btn", "btn-primary"]
            a["data-mirror"] = "external"
            a.string = "Open the form ↗"
            p.append(a)
            wrap.append(p)
            kind = "form"
        elif width and height:
            frame["width"] = str(width)
            frame["height"] = str(height)
            frame["style"] = f"width:100%;max-width:{width}px;height:auto;aspect-ratio:{width}/{height};border:0"
            frame["class"] = ["hcdp-mirror-iframe"]
            kind = "fixed"
        else:
            frame["class"] = ["hcdp-mirror-iframe", "hcdp-mirror-iframe-fluid"]
            kind = "fluid"
        embeds.append({"src": src, "host": host, "title": title, "width": width, "height": height, "kind": kind})


def _slideshows_to_figures(root: Tag, factory: BeautifulSoup) -> None:
    for show in root.select(".wp-block-jetpack-slideshow"):
        box = factory.new_tag("div")
        box["class"] = ["hcdp-mirror-slideshow", "wp-block-gallery", "has-nested-images", "columns-2", "is-cropped", "is-layout-flex",
                        "wp-block-gallery-is-layout-flex"]
        for slide in show.select("li.wp-block-jetpack-slideshow_slide, .swiper-slide"):
            img = slide.find("img")
            if img is None:
                continue
            fig = factory.new_tag("figure")
            fig["class"] = ["wp-block-image", "size-large"]
            cap = slide.find("figcaption")
            img.attrs.pop("class", None)
            fig.append(img.extract())
            if cap is not None and _text(cap):
                c = factory.new_tag("figcaption")
                c["class"] = ["wp-element-caption"]
                c.string = _text(cap)
                fig.append(c)
            box.append(fig)
        show.replace_with(box)


def page_css(soup: BeautifulSoup, content_styles: list[str]) -> str:
    """The page's own CSS for its shadow root: the head's per-page inline styles (block supports, the page's variant of
    the global styles, block style variations, …) and the content <style> blocks minus their document-wide rules."""
    parts: list[str] = []
    for st in soup.head.find_all("style") if soup.head else []:
        sid = st.get("id") or ""
        if not sid or sid in SITEWIDE_HEAD_STYLES:
            continue
        if sid.startswith("wp-block-") and sid.endswith("-inline-css") and sid != "wp-block-library-inline-css":
            continue   # each block's own stylesheet: the theme bundle has the whole block library
        parts.append(shadow_css(re.sub(r"/\*# sourceURL=[^*]*\*/", "", st.get_text())))
    parts.extend(shadow_css(c, drop_document_rules=True) for c in content_styles)
    return "\n".join(p.strip() for p in parts if p.strip())


def detect_kind(soup: BeautifulSoup, entry: Tag) -> str:
    """'post', 'vis' (an app shell: one iframe made to fill the window) or 'page'."""
    body_classes = set(soup.body.get("class") or []) if soup.body else set()
    content = soup.select_one("#content")
    if "single-post" in body_classes:
        return "post"
    if (content is not None and "vis-content-style" in (content.get("class") or [])) or any("template-hcdp-vis" in c for c in body_classes):
        return "vis"
    frames = entry.find_all("iframe")
    styles = " ".join(st.get_text() for st in entry.find_all("style"))
    if len(frames) == 1 and len(_text(entry)) < 40 and re.search(r"position\s*:\s*fixed", styles) and re.search(r"html\s*,\s*body", styles):
        return "vis"
    return "page"


def _h1_policy(wrapper: Tag, has_band: bool) -> bool:
    """One h1 per page: with a band (our shell draws it) every content h1 reads as level 2; without one the first stays
    the page's h1 and the rest read as level 2. Returns whether the content keeps an h1."""
    h1s = wrapper.find_all("h1")
    keep_first = not has_band and bool(h1s)
    for i, h in enumerate(h1s):
        if keep_first and i == 0:
            continue
        h["role"] = "heading"
        h["aria-level"] = "2"
    return keep_first


def sanitize_page(html: str, url: str, resolve: Callable[[str], str | None], *, slug: str | None = None) -> dict:
    """The mirrored copy of one HCDP page: {slug, url, title, band, kind, body_class, article_class, html, css, text,
    text_len, has_h1, embeds, images, sha256, post?, app?}. Raises SanitizeError when the page has no .entry-content or is
    a 'Page not found'."""
    soup = BeautifulSoup(html, "lxml")
    title = page_title(soup)
    if any(k in title.lower() for k in NOT_FOUND_TITLES):
        raise SanitizeError("page not found")
    article = soup.select_one("article")
    entry = (article.select_one(".entry-content") if article is not None else None) or soup.select_one(".entry-content")
    if entry is None:
        raise SanitizeError("no .entry-content")
    if article is None:
        article = entry.parent
    body_classes = soup.body.get("class") or [] if soup.body else []
    body_class = [c for c in body_classes if not c.startswith(("page-id-", "postid-", "wp-custom-logo", "wp-theme"))]
    article_class = [c for c in (article.get("class") or []) if not c.startswith(("post-", "page-"))] if article.name == "article" else ["page"]
    kind = detect_kind(soup, entry)
    header = soup.select_one("div.page-header")
    band = None
    if header is not None and "hiding-page-title" not in body_classes and kind != "vis":
        band = _text(header.select_one(".entry-title") or header) or None
    post = None
    if kind == "post":
        eh = article.select_one(".entry-header")
        h1 = eh.select_one(".entry-title") if eh is not None else None
        if h1 is not None and _text(h1):
            title = _text(h1)
        t = article.select_one("time.entry-date.published, time.published, time.entry-date")
        post = {"date": _text(t) or None, "date_iso": (t.get("datetime") if t is not None else None), "thumbnail": None}
    content_styles = [st.get_text() for st in entry.find_all("style")]
    app = None
    if kind == "vis":
        frame = entry.find("iframe")
        app = {"src": (frame.get("src") or "").strip() or None} if frame is not None else {"src": None}
    for st in entry.find_all("style"):
        st.decompose()

    # Assemble the fragment: a post keeps its header (title, date) and thumbnail; a page is its content alone.
    factory = BeautifulSoup("", "lxml")
    wrapper = factory.new_tag("div")
    wrapper["class"] = ["hcdp-mirror-article"]
    if kind == "post":
        eh = factory.new_tag("header")
        eh["class"] = ["entry-header"]
        h1 = factory.new_tag("h1")
        h1["class"] = ["entry-title"]
        h1.string = title
        eh.append(h1)
        if post and post["date"]:
            meta = factory.new_tag("div")
            meta["class"] = ["entry-meta"]
            span = factory.new_tag("span")
            span["class"] = ["posted-on"]
            span.append("Posted on ")
            tm = factory.new_tag("time")
            tm["class"] = ["entry-date", "published"]
            if post["date_iso"]:
                tm["datetime"] = post["date_iso"]
            tm.string = post["date"]
            span.append(tm)
            meta.append(span)
            eh.append(meta)
        wrapper.append(eh)
        thumb = article.select_one(".entry-thumbnail, .post-thumbnail")
        if thumb is not None:
            wrapper.append(thumb.extract())
    wrapper.append(entry.extract())

    _remove(wrapper, REMOVE_SELECTORS)
    _strip_comments(wrapper)
    for el in wrapper.find_all(True):
        for attr in list(el.attrs):
            if attr.lower().startswith("on") or attr.lower() in ("srcdoc", "formaction", "xlink:href", "ping", "contenteditable"):
                del el.attrs[attr]
    for bq in wrapper.select("blockquote.wp-embedded-content"):
        bq.attrs.pop("style", None)
        bq.attrs.pop("data-secret", None)
        bq["class"] = ["wp-embedded-content", "hcdp-mirror-embedded-link"]
    _slideshows_to_figures(wrapper, factory)
    images: list[dict] = []
    embeds: list[dict] = []
    _rewrite_images(wrapper, url, images)
    _rewrite_iframes(wrapper, url, embeds, factory)
    _rewrite_links(wrapper, url, resolve, factory)
    has_h1 = _h1_policy(wrapper, bool(band))
    if post is not None:
        th = wrapper.select_one(".entry-thumbnail img, .post-thumbnail img")
        post["thumbnail"] = th.get("src") if th is not None else None
    content = wrapper.select_one(".entry-content")
    text = _text(content if content is not None else wrapper)
    if not title:
        first = wrapper.find(["h1", "h2", "h3"])
        title = _text(first)[:120] if first is not None else ""
    clean = nh3_clean(str(wrapper))
    css = page_css(soup, content_styles)
    record = {
        "slug": slug if slug is not None else "",
        "url": url, "title": title, "band": band, "kind": kind, "body_class": body_class, "article_class": article_class,
        "html": clean, "css": css, "text": text[:EXCERPT_CHARS], "text_len": len(text), "has_h1": has_h1,
        "embeds": embeds, "images": images,
        "sha256": hashlib.sha256((clean + "\n" + css + "\n" + (band or "") + "\n" + title).encode("utf-8")).hexdigest(),
    }
    if post is not None:
        record["post"] = post
    if app is not None:
        record["app"] = app
    return record


def accept(record: dict | None, status: int, last_good: dict | None) -> str | None:
    """Why a freshly fetched copy must NOT replace the last good one — None when it may: a 200, a real title, content
    present, and at least half the text of the previous good copy (a half-rendered or emptied page never wins)."""
    if status != 200:
        return f"status {status}"
    if not record or not record.get("html"):
        return "no content"
    if any(k in (record.get("title") or "").lower() for k in NOT_FOUND_TITLES):
        return "page not found"
    if last_good and record.get("kind") != "vis":
        prev = int(last_good.get("text_len") or 0)
        if prev >= 100 and int(record.get("text_len") or 0) < prev * 0.5:
            return f"text shrank to {record.get('text_len')} of {prev} characters"
    return None
