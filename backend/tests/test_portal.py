"""The live mirror of HCDP's pages (backend/portal.py, portal_sanitize.py, portal_routes.py; CONTRACT.md "Mirrored pages").

Nothing here talks to www.hawaii.edu: the fetcher runs on httpx's MockTransport with a fake clock, the job on fake
fetchers, the endpoints on stores in tmp_path; the committed seed (backend/data/portal_seed) is read as it is."""
import asyncio
import datetime as dt
import io
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import portal  # noqa: E402
import portal_routes as routes  # noqa: E402
from navigator import valid_internal_path  # noqa: E402
from portal_sanitize import (IMG_PROXY, SanitizeError, accept, normalize_url, sanitize_page, shadow_css)  # noqa: E402
from summary import Summarizer, clean_cited  # noqa: E402

HCDP = "https://www.hawaii.edu/climate-data-portal"
UP = f"{HCDP}/wp-content/uploads"


def page_html(content="", *, title="Team", band=None, body="wp-singular page-template page-template-template-fullwidth page", head="",
              article="page type-page status-publish hentry", post_header="", footer=""):
    header = f'<div class="page-header"><div class="container"><h1 class="entry-title">{band}</h1></div></div>' if band else ""
    return f"""<!DOCTYPE html><html><head><title>{title} &#8211; Hawaiʻi Climate Data Portal</title>
<link rel='stylesheet' id='onepress-style-css' href='{HCDP}/wp-content/themes/onepress/style.css' media='all' />
<meta name="generator" content="WordPress" /><script>window.evil = 1</script>{head}</head>
<body class="{body}"><div id="page" class="hfeed site"><header id="masthead" class="site-header">MENU HOME ABOUT</header>{header}
<div id="content" class="site-content"><div id="content-inside" class="container no-sidebar"><div id="primary" class="content-area">
<main id="main" class="site-main" role="main"><article id="post-1" class="{article}">{post_header}<div class="entry-content">{content}</div>{footer}</article>
</main></div></div></div><footer id="colophon">FOOTER COPYRIGHT</footer></div><script src="x.js"></script></body></html>"""


def sanitize(content="", **kw):
    url = kw.pop("url", f"{HCDP}/team/")
    slug = kw.pop("slug", "team")
    return sanitize_page(page_html(content, **kw), url, routes.path_for_url, slug=slug)


# ----- the sanitiser ------------------------------------------------------------------------------------------------------
def test_keeps_the_content_and_drops_what_must_not_travel():
    rec = sanitize(
        '<!-- a comment --><p class="wp-block-paragraph has-text-align-center" style="color:#333">Hello <a href="javascript:alert(1)">x</a></p>'
        '<p onclick="steal()" onmouseover="x()">click</p><script>alert(2)</script><noscript>no</noscript>'
        '<form role="search" class="wp-block-search"><input name="s"><button type="submit">Search</button></form>'
        '<div class="zp-Library zp-Browse" id="zotpress-lib-1"><span class="ZP_API_USER_ID">2846077</span></div>'
        '<blockquote class="wp-embedded-content" data-secret="abc"><a href="https://www.soest.hawaii.edu/atmo/talk/">The talk</a></blockquote>'
        '<iframe class="wp-embedded-content" sandbox="allow-scripts" src="https://www.soest.hawaii.edu/atmo/talk/embed/"></iframe>'
        '<link rel="stylesheet" href="x.css"><meta name="a" content="b"><object data="x.swf"></object>'
        '<div style="background-image:url(javascript:alert(3))">bg</div>'
        '<style>html, body { height: 100%; overflow: hidden } body > * { margin: 0 } iframe { position: fixed } div { padding: 0 }'
        ' * { margin: 0 } .entry-content .card { border-radius: 10px; margin: 1.5rem 0 }</style>')
    html = rec["html"]
    for bad in ("<script", "onclick", "onmouseover", "javascript:", "<form", "<input", "<button", "zotpress", "ZP_API", "<link", "<meta", "<object",
                "<!--", "<style", "<noscript", "data-secret", "sandbox", "MENU", "FOOTER", "window.evil"):
        assert bad not in html, bad
    assert 'class="wp-block-paragraph has-text-align-center"' in html and 'style="color:#333"' in html   # block markup, classes, inline styles kept
    assert "The talk" in html and "https://www.soest.hawaii.edu/atmo/talk/" in html                      # the oEmbed's link stays
    assert "<iframe" not in html                                                                           # its iframe does not
    assert "bg" in html and "url(javascript" not in html
    css = rec["css"]
    assert ".entry-content .card{border-radius: 10px; margin: calc(1.5 * var(--hcdp-rem, 16px)) 0}" in css
    assert not re.search(r"(^|[\s,}]):host\{height|overflow: hidden|position: fixed|(^|\n)div\{|(^|\n)\*\{", css)   # rules aimed at the whole document are gone
    assert rec["kind"] == "page" and rec["title"] == "Team" and rec["text_len"] > 0


def test_jetpack_slideshow_becomes_a_static_list_of_figures():
    rec = sanitize('<div class="wp-block-jetpack-slideshow"><div class="wp-block-jetpack-slideshow_container swiper-container"><ul class="wp-block-jetpack-slideshow_swiper-wrapper">'
                   f'<li class="wp-block-jetpack-slideshow_slide swiper-slide"><figure><img src="{UP}/2024/01/a.jpg" class="wp-block-jetpack-slideshow_image"><figcaption>First</figcaption></figure></li>'
                   f'<li class="wp-block-jetpack-slideshow_slide swiper-slide"><figure><img src="{UP}/2024/01/b.jpg"></figure></li></ul>'
                   '<a class="wp-block-jetpack-slideshow_button-prev" role="button"></a><div class="wp-block-jetpack-slideshow_pagination"></div></div></div>')
    html = rec["html"]
    assert "hcdp-mirror-slideshow" in html and html.count("<figure") == 2 and "First" in html
    assert "swiper" not in html and "button-prev" not in html and "pagination" not in html
    assert [i["u"] for i in rec["images"]] == [f"{UP}/2024/01/a.jpg", f"{UP}/2024/01/b.jpg"]


def test_a_post_keeps_its_title_date_and_thumbnail_but_no_byline_comments_or_tags():
    post_header = ('<header class="entry-header"><h1 class="entry-title">A Century of Drought  in Hawai‘i</h1><div class="entry-meta"><span class="posted-on">Posted on '
                   f'<a href="{HCDP}/a-century-of-drought-in-hawaii/" rel="bookmark"><time class="entry-date published" datetime="2022-10-24T23:40:13+00:00">October 24, 2022</time>'
                   '<time class="updated hide" datetime="2023-10-13T20:12:16+00:00">October 13, 2023</time></a></span><span class="byline"> by <span class="author vcard">'
                   f'<a href="{HCDP}/author/x/">x@hawaii.edu</a></span></span></div></header>'
                   f'<div class="entry-thumbnail"><img width="800" height="832" src="{UP}/2022/10/s-985x1024.png" srcset="{UP}/2022/10/s-985x1024.png 985w, {UP}/2022/10/s-289x300.png 289w, {UP}/2022/10/s-768x798.png 768w" sizes="(max-width: 800px) 100vw, 800px"></div>')
    rec = sanitize("<p>Contributed by Abby Frazier</p>", title="A Century of Drought in Hawai‘i", body="single single-post postid-3287 single-format-standard",
                   article="post type-post status-publish hentry", post_header=post_header,
                   footer=f'<footer class="entry-footer"><span class="tags-links">Tagged <a href="{HCDP}/tag/drought/">drought</a></span></footer><div id="comments" class="comments-area">COMMENTS</div>',
                   slug="a-century-of-drought-in-hawaii", url=f"{HCDP}/a-century-of-drought-in-hawaii/")
    assert rec["kind"] == "post" and rec["title"] == "A Century of Drought in Hawai‘i"
    assert rec["post"]["date"] == "October 24, 2022" and rec["post"]["date_iso"] == "2022-10-24T23:40:13+00:00"
    html = rec["html"]
    assert '<h1 class="entry-title">' in html and "Posted on" in html and "October 24, 2022" in html and "October 13, 2023" not in html
    assert "byline" not in html and "x@hawaii.edu" not in html and "Tagged" not in html and "COMMENTS" not in html
    assert rec["post"]["thumbnail"].startswith(IMG_PROXY) and rec["has_h1"] is True and rec["band"] is None
    # the thumbnail has one source: the narrowest candidate at least 800 px wide
    assert rec["images"] == [{"u": f"{UP}/2022/10/s-985x1024.png", "w": 985}]


def test_the_grey_band_only_when_hcdp_draws_one():
    assert sanitize("<p>x</p>", band="HCDP History")["band"] == "HCDP History"
    assert sanitize("<p>x</p>", band="Team", body="page hiding-page-title")["band"] is None
    shell = sanitize('<style>html, body { height: 100%; } iframe { position: fixed; }</style><iframe src="https://cherryleh.github.io/climate-summary/#/hurricane-nolo"></iframe>',
                     band="Hurricane Nolo", body="page page-template-template-fullwidth")
    assert shell["kind"] == "vis" and shell["band"] is None and shell["app"]["src"].endswith("#/hurricane-nolo")


def test_one_h1_per_page():
    banded = sanitize("<h1>Inside</h1><h1>Again</h1>", band="Acknowledgements")
    assert banded["html"].count('<h1 aria-level="2" role="heading">') == 2 and banded["has_h1"] is False   # the band is the h1
    bare = sanitize("<h1>Team</h1><h1>Contributors</h1>", body="page hiding-page-title")
    assert bare["has_h1"] is True and bare["html"].count('aria-level="2"') == 1


def test_not_found_and_missing_content_raise():
    with pytest.raises(SanitizeError):
        sanitize_page(page_html("<p>x</p>", title="Page not found"), f"{HCDP}/nope/", routes.path_for_url)
    with pytest.raises(SanitizeError):
        sanitize_page("<html><head><title>Odd</title></head><body><main>no entry content</main></body></html>", f"{HCDP}/odd/", routes.path_for_url)


# ----- the link map -------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("url,path", [
    (f"{HCDP}/team/", "/about/team"),
    ("http://hawaii.edu/climate-data-portal/team", "/about/team"),                     # http, no www, no slash
    (f"{HCDP}/2339-2/", "/about/history"),
    (f"{HCDP}/how-to-cite-3/?utm_source=x", "/about/how-to-cite"),
    (f"{HCDP}/rainfall-mapping-history/", "/about/rainfall-mapping-history"),
    (f"{HCDP}/data-portal/", "/data"),
    (f"{HCDP}/hcdp-hawaii-mesonet-api/", "/data/api"),
    (f"{HCDP}/tutorials/", "/data/tutorials"),
    (f"{HCDP}/export-data-tutorial/", "/data/tutorials/export-data-tutorial"),
    (f"{HCDP}/hawaii-mesonet/", "/mesonet"),
    (f"{HCDP}/hawaii-mesonet-data/#/", "/mesonet?viewer=live"),
    (f"{HCDP}/hawaii-mesonet-data/#/dashboard?id=0115", "/mesonet?viewer=live&view=dashboard&station=0115"),
    (f"{HCDP}/hawaii-mesonet-data#/american-samoa", "/mesonet?viewer=live&view=american-samoa"),
    (f"{HCDP}/climate-summary/#/", "/climate-summary"),
    (f"{HCDP}/climate-summary/#/?year=2026&month=8", "/climate-summary?year=2026&month=8"),
    (f"{HCDP}/pacific-portal/", "/pacific"),
    (f"{HCDP}/americansamoaportal/", "/pacific/american-samoa"),
    (f"{HCDP}/2826-2/", "/pacific/countries-and-territories"),
    (f"{HCDP}/as-about/", "/pacific/as-about"),
    (f"{HCDP}/guam-data-viewer/", "/pacific/guam"),
    (f"{HCDP}/extreme-events/", "/extreme-events"),
    (f"{HCDP}/extreme-event/", "/extreme-events"),
    (f"{HCDP}/hurricane-nolo/", "/extreme-events/nolo"),
    (f"{HCDP}/hurricane-lowell/", "/extreme-events/lowell"),
    (f"{HCDP}/2026-kona-low-2", "/extreme-events/kona-low-2"),
    (f"{HCDP}/nolo-mesonet-viewer/", "/mesonet?viewer=nolo"),
    (f"{HCDP}/climate-tools/", "/tools"),
    (f"{HCDP}/news/", "/cultural-resources"),
    (f"{HCDP}/climate-glossary/", "/cultural-resources/climate-glossary"),
    (f"{HCDP}/publications-list/", "/library"),
    (f"{HCDP}/research-highlights/", "/research/highlights"),
    (f"{HCDP}/contact/", "/research/external-resources"),
    (f"{HCDP}/presentations/", "/research/presentations"),
    (f"{HCDP}/conditions-of-use/", "/conditions-of-use"),
    (f"{HCDP}/team/#ryan", "/about/team#ryan"),
    (f"{HCDP}/", "/"),
    (f"{HCDP}/a-century-of-drought-in-hawaii/", "/research/posts/a-century-of-drought-in-hawaii"),
    (f"{HCDP}/hawai%ca%bbi-groundwater-recharge-tool/", "/research/posts/hawaiʻi-groundwater-recharge-tool"),   # the ʻokina decoded
])
def test_link_map_to_our_routes(url, path):
    assert routes.path_for_url(normalize_url(url)) == path


@pytest.mark.parametrize("url", [
    f"{UP}/2026/02/2025-Climate-Report.pdf", f"{HCDP}/rainfall-atlas/", f"{HCDP}/evapotranspiration-atlas/", f"{HCDP}/solar-radiation-atlas/",
    f"{HCDP}/publications-search/", f"{HCDP}/?s=rain", f"{HCDP}/feed/", f"{HCDP}/tag/drought/", f"{HCDP}/hawaii-mesonet/qr/",
    f"{HCDP}/glossary-of-terms/", "https://www.hawaii.edu/news/2026/09/11/hurricane-lowell/", "https://example.org/",
])
def test_everything_else_stays_on_hcdp(url):
    assert routes.path_for_url(normalize_url(url)) is None


def test_links_in_the_copy():
    rec = sanitize(f'<a href="{HCDP}/team/">Team</a> <a href="{HCDP}/rainfall-atlas/">Atlas <em>of</em> Hawaiʻi</a> '
                   f'<a href="mailto:hcdp@hawaii.edu">mail</a> <a href="#top">top</a> <a href="http://weather.hawaii.edu/vmap/new/"><img src="{UP}/2026/10/v.png"></a>'
                   f'<a href="{HCDP}/hurricane-lowell/?utm_campaign=x" target="_blank">Lowell</a>')
    html = rec["html"]
    assert '<a data-mirror="internal" href="/about/team">Team</a>' in html
    assert ('<a data-mirror="external" href="https://www.hawaii.edu/climate-data-portal/rainfall-atlas/" rel="noopener noreferrer" target="_blank">Atlas <em>of</em> Hawaiʻi'
            '<span aria-hidden="true" class="hcdp-mirror-ext">&nbsp;↗</span><span class="hcdp-mirror-sr"> (opens in a new tab)</span></a>') in html   # HCDP's address as written, a new tab, ↗
    assert '<a href="mailto:hcdp@hawaii.edu">mail</a>' in html and '<a href="#top">top</a>' in html
    assert 'href="http://weather.hawaii.edu/vmap/new/"' in html and "↗</span></a>" not in html.split("vmap/new/")[1][:400]   # its own scheme; no arrow on a picture link
    assert '<a data-mirror="internal" href="/extreme-events/lowell">Lowell</a>' in html                                     # utm dropped, same tab


def test_pictures_go_through_the_proxy():
    rec = sanitize(f'<figure class="wp-block-image"><img width="1024" height="683" src="{UP}/2021/06/a-1024x683.jpg" '
                   f'srcset="{UP}/2021/06/a-1024x683.jpg 1024w, {UP}/2021/06/a-300x200.jpg 300w, {UP}/2021/06/a-768x512.jpg 768w, {UP}/2021/06/a.jpg 2048w" sizes="(max-width: 1024px) 100vw, 1024px"></figure>'
                   f'<img src="{UP}/2026/10/hurricane-nolo.webp" style="width: 100%; object-fit: cover">'
                   '<img src="https://partner.example.org/logo.png" srcset="https://partner.example.org/logo2.png 2x"><img src="data:image/gif;base64,R0lGOD">'
                   f'<div class="wp-block-cover" style="background-image:url({UP}/2024/01/cover.jpg);min-height:430px"></div>'
                   '<div style="background:url(https://evil.example.org/x.png)">e</div>')
    html = rec["html"]
    big = "/api/portal/img?u=https%3A%2F%2Fwww.hawaii.edu%2Fclimate-data-portal%2Fwp-content%2Fuploads%2F2021%2F06%2Fa-1024x683.jpg"
    assert f'src="{big}&amp;w=800"' in html
    assert f'srcset="{big}&amp;w=400 400w, {big}&amp;w=800 800w"' in html             # one source, our two widths
    assert 'width="1024"' in html and 'height="683"' in html and 'sizes="(max-width: 1024px) 100vw, 1024px"' in html
    assert html.count('loading="lazy"') == 3 and html.count('decoding="async"') == 3
    assert "%2F2026%2F10%2Fhurricane-nolo.webp&amp;w=800" in html and "object-fit: cover" in html
    assert 'src="https://partner.example.org/logo.png"' in html and "logo2" not in html     # a partner's picture stays, without its srcset
    assert "data:image/gif" not in html                                                      # not https: dropped
    assert "url(/api/portal/img?u=https%3A%2F%2Fwww.hawaii.edu%2Fclimate-data-portal%2Fwp-content%2Fuploads%2F2024%2F01%2Fcover.jpg&amp;w=800)" in html
    assert "evil.example.org" not in html
    assert [i["u"].rsplit("/", 1)[1] for i in rec["images"]] == ["a-1024x683.jpg", "hurricane-nolo.webp", "cover.jpg"]


def test_embeds_from_the_allow_list_only():
    rec = sanitize('<h3>Talk</h3><iframe width="560" height="315" src="https://www.youtube.com/embed/abc?feature=oembed" frameborder="0" allow="autoplay" onload="x()"></iframe>'
                   '<iframe src="https://evil.example.org/frame"></iframe>'
                   '<iframe src="https://docs.google.com/forms/d/e/1FAIp/viewform?embedded=true" width="640" height="1529"></iframe>'
                   '<iframe src="https://uhm.maps.arcgis.com/apps/dashboards/90e9"></iframe>')
    html = rec["html"]
    assert 'src="https://www.youtube.com/embed/abc?feature=oembed"' in html and 'title="Talk"' in html and 'loading="lazy"' in html and 'allow="fullscreen"' in html
    assert "aspect-ratio:560/315" in html and "onload" not in html and "autoplay" not in html
    assert "evil.example.org/frame" in html and "<iframe" not in html.split("evil.example.org")[0][-200:]   # a link, not a frame
    assert "Open the embedded content from evil.example.org" in html
    assert 'class="hcdp-mirror-form"' in html and "height:1400px" in html and "Open the form" in html
    assert [e["kind"] for e in rec["embeds"]] == ["fixed", "form", "fluid"]


def test_shadow_css():
    css = shadow_css("html{font-size:16px}@media (max-width:991px){html{font-size:15px}}:root{--a:1rem}body{margin:0}"
                     "body.single-post .x{color:red}html.has-modal-open{overflow:hidden}a[href$='.html']{color:blue}@import url(x.css);@font-face{font-family:x}")
    assert ":host{font-size:16px;--hcdp-rem:16px}" in css and "@media (max-width:991px){:host{font-size:15px;--hcdp-rem:15px}}" in css
    assert ":host{--a:calc(1 * var(--hcdp-rem, 16px))}" in css and ".hcdp-body{margin:0}" in css and ".hcdp-body.single-post .x{color:red}" in css
    assert "has-modal-open" not in css and "a[href$='.html']{color:blue}" in css and "@import" not in css and "@font-face" not in css


def test_acceptance():
    good = {"html": "<p>x</p>", "title": "Team", "text_len": 1000, "kind": "page"}
    assert accept(good, 200, None) is None
    assert accept(good, 503, None) == "status 503"
    assert accept(None, 200, None) == "no content"
    assert accept(dict(good, title="Page not found"), 200, None) == "page not found"
    assert accept(dict(good, text_len=400), 200, {"text_len": 1000}).startswith("text shrank")
    assert accept(dict(good, text_len=500), 200, {"text_len": 1000}) is None              # half is enough


# ----- the routes -------------------------------------------------------------------------------------------------------
def test_routes_and_navigator_paths():
    assert routes.slug_for_path("/about") == routes.slug_for_path("/about/history") == "2339-2"
    assert routes.slug_for_path("/pacific/american-samoa") == routes.slug_for_path("/pacific/americansamoaportal") == "americansamoaportal"
    assert routes.slug_for_path("/research/posts/hawaii-groundwater-recharge-tool") == "hawaiʻi-groundwater-recharge-tool"   # typed without the ʻokina
    assert routes.slug_for_path("/pacific/nope") is None and routes.slug_for_path("/tools/h-rip") is None
    for p in ["/about/climate-monitoring-history", "/pacific/guam", "/pacific/countries-and-territories", "/cultural-resources/climate-perspective",
              "/research/posts/a-century-of-drought-in-hawaii", "/data/tutorials/visualize-data-tutorial", "/library", "/conditions-of-use",
              "/tools/vmap-fire-weather", "/research/highlights", "/mesonet?viewer=live&view=american-samoa"]:
        assert valid_internal_path(p), p
    for p in ["/pacific/nope", "/research/posts/nope", "/cultural-resources/nope", "/data/tutorials/nope", "/library/x"]:
        assert not valid_internal_path(p), p
    assert len(routes.mirrored_slugs()) == 110


# ----- the committed seed -------------------------------------------------------------------------------------------------
SEED = routes.SEED_DIR


def test_the_seed_covers_every_mirrored_page_and_is_clean():
    index = routes.seed_index()
    assert index["generated_at"] and len(index["posts"]) >= 40
    assert set(index["pages"]) == set(routes.mirrored_slugs())
    for slug, path in routes.mirrored_slugs().items():
        rec = json.loads((SEED / f"{routes.file_stem(slug)}.json").read_text(encoding="utf-8"))
        assert rec["slug"] == slug and rec["path"] == path and rec["url"] == routes.hcdp_url(slug)
        assert accept(rec, 200, None) is None, slug
        assert "<script" not in rec["html"] and not re.search(r"\son[a-z]+=", rec["html"]) and "javascript:" not in rec["html"].lower(), slug
        assert rec["fetched_at"] and rec["sha256"] and rec["kind"] in ("page", "post"), slug
    assert json.loads((SEED / "extreme-events.json").read_text())["band"] == "Extreme Events"
    ee = json.loads((SEED / "extreme-events.json").read_text())["html"]
    assert ee.index("/extreme-events/nolo") < ee.index("/extreme-events/lowell")                       # Nolo first
    tools = json.loads((SEED / "climate-tools.json").read_text())["html"]
    assert tools.count("border-radius: 10px") == 12 and "vmap/new" in tools and "vmap/fireweather" in tools
    lib = json.loads((SEED / "library.json").read_text(encoding="utf-8"))
    assert lib["total"] == len(lib["items"]) > 1000 and all(it["title"] and it["key"] for it in lib["items"])


# ----- the fetch policy ---------------------------------------------------------------------------------------------------
def test_one_request_at_a_time_three_seconds_apart_redirects_included():
    clock = [100.0]
    starts, ends = [], []

    def handler(request):
        starts.append(clock[0])
        clock[0] += 1.5                       # a slow server
        ends.append(clock[0])
        assert request.headers["user-agent"] == portal.UA
        if request.url.path.endswith("/old/"):
            return httpx.Response(301, headers={"location": f"{HCDP}/new/"})
        return httpx.Response(200, text="ok")

    async def fake_sleep(s):
        clock[0] += s

    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler), headers={"User-Agent": portal.UA})
        f = portal.Fetcher(client=client, spacing=portal.Spacing(3.0, clock=lambda: clock[0], sleep=fake_sleep))
        out = [await f.get(f"{HCDP}/a/"), await f.get(f"{HCDP}/old/"), await f.get(f"{HCDP}/b/")]
        await f.close()
        return out, f.count

    out, count = asyncio.run(run())
    assert [o[0] for o in out] == [200, 200, 200] and out[1][3] == f"{HCDP}/new/" and count == 4
    assert all(starts[i] - ends[i - 1] >= 3.0 for i in range(1, len(starts)))   # every gap ≥ 3 s, the redirect hop too
    assert portal.TIMEOUT == 15 and "HCDP-with-AI mirror" in portal.UA


# ----- the store and the endpoints' answers ------------------------------------------------------------------------------
def rec_for(slug="team", text_len=1000, sha="s1", fetched=None, **kw):
    now = fetched or portal.now_iso()
    return dict({"slug": slug, "url": routes.hcdp_url(slug), "title": slug.title(), "band": None, "kind": "page", "html": "<div class=\"entry-content\"><p>x</p></div>",
                 "css": "", "text": "x " * 50, "text_len": text_len, "sha256": sha, "fetched_at": now, "checked_at": now, "path": routes.mirrored_slugs().get(slug)}, **kw)


def test_fallback_order_fresh_then_last_good_then_seed_then_hcdp(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()
    store = portal.PortalStore(tmp_path / "portal", seed_dir=seed)
    status, body = portal.page_payload(store, "/about/team")
    assert status == 404 and body["hcdp_url"] == f"{HCDP}/team/"                    # nothing anywhere: HCDP's address
    portal.write_json(seed / "team.json", rec_for(fetched="2026-10-01T00:00:00+00:00"))
    status, body = portal.page_payload(store, "/about/team")
    assert status == 200 and body["source"] == "seed" and body["copied_at"] == "2026-10-01T00:00:00+00:00" and "text" not in body
    store.save(rec_for())
    status, body = portal.page_payload(store, "/about/team")
    assert body["source"] == "cache" and "copied_at" not in body                     # fresh
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).isoformat(timespec="seconds")
    store.save(rec_for(fetched=old))
    status, body = portal.page_payload(store, "/about/team")
    assert body["source"] == "cache" and body["copied_at"] == old                   # last good, not confirmed for days
    assert portal.page_payload(store, "/nowhere")[1] == {"detail": "This address is not a mirrored page.", "hcdp_url": None}
    assert portal.page_payload(store, "/extreme-events/lowell")[1]["hcdp_url"] == f"{HCDP}/hurricane-lowell/"   # an embed: not a copy


def test_two_previous_copies_are_kept(tmp_path):
    store = portal.PortalStore(tmp_path)
    for sha in ("one", "two", "three", "four"):
        store.save(rec_for(sha=sha))
    assert [json.loads(store.page_file("team", v).read_text())["sha256"] for v in (0, 1, 2)] == ["four", "three", "two"]
    assert not store.page_file("team", 3).exists()


def test_the_overview_rides_with_the_page(tmp_path):
    store = portal.PortalStore(tmp_path, seed_dir=tmp_path / "none")
    store.save(rec_for(sha="s1"))
    store.save_overview("team", {"for_sha": "s1", "generated_at": "t", "chunks": ["The **Team** page. "], "cites": [[1]], "more": [], "more_cites": [],
                                 "sources": [{"title": "Team", "url": f"{HCDP}/team/"}], "followups": ["a", "b", "c"]})
    body = portal.page_payload(store, "/about/team")[1]
    assert body["overview"]["chunks"] == ["The **Team** page. "] and body["overview"]["current"] is True


# ----- the job ----------------------------------------------------------------------------------------------------------
class FakeFetcher:
    def __init__(self, responses):
        self.responses = responses
        self.urls = []
        self.count = 0

    async def get(self, url, headers=None):
        self.urls.append(url)
        self.count += 1
        r = self.responses.get(url)
        if callable(r):
            r = r(headers or {})
        return r if r else (404, b"", {}, url)


def listing(rows, total_pages=1):
    return (200, json.dumps(rows).encode(), {"X-WP-TotalPages": str(total_pages)}, "")


def test_rest_pass_fetches_only_what_changed_and_keeps_the_last_good_copy(tmp_path, monkeypatch):
    monkeypatch.setattr(portal.routes, "MIRRORED", {"/about/team": "team", "/about/acknowledgements": "acknowledgements", "/conditions-of-use": "conditions-of-use"})
    monkeypatch.setattr(portal.routes, "FAMILIES", {})
    monkeypatch.setattr(portal.routes, "post_slugs", lambda: [])
    monkeypatch.setattr(portal, "PRIORITY", ["team", "acknowledgements", "conditions-of-use"])
    seed = tmp_path / "seed"
    seed.mkdir()
    store = portal.PortalStore(tmp_path / "portal", seed_dir=seed)
    portal.write_json(seed / "team.json", rec_for("team", modified_gmt="2026-01-01T00:00:00"))
    store.save(rec_for("acknowledgements", text_len=4000, modified_gmt="2024-01-01T00:00:00", sha="ack-old"))
    pages = f"{portal.REST}/pages?_fields=id,slug,link,modified_gmt&per_page=100&page=1"
    posts = f"{portal.REST}/posts?_fields=id,slug,link,modified_gmt&per_page=100&page=1"
    fake = FakeFetcher({
        pages: listing([{"slug": "team", "modified_gmt": "2026-01-01T00:00:00"}, {"slug": "acknowledgements", "modified_gmt": "2026-10-01T00:00:00"},
                        {"slug": "conditions-of-use", "modified_gmt": "2021-02-11T00:00:00"}]),
        posts: listing([{"slug": "a-post", "modified_gmt": "2022-01-01T00:00:00"}]),
        f"{HCDP}/acknowledgements/": (200, page_html("<p>short</p>", title="Acknowledgements", band="Acknowledgements").encode(), {}, f"{HCDP}/acknowledgements/"),
        f"{HCDP}/conditions-of-use/": (200, page_html("<p>" + "Rainfall map images may be reproduced. " * 10 + "</p>", title="Conditions of Use", band="Conditions of Use").encode(), {}, f"{HCDP}/conditions-of-use/"),
    })
    job = portal.MirrorJob(store, None, fake)
    changed = asyncio.run(job.rest_pass())
    assert changed == ["acknowledgements", "conditions-of-use"]                       # team's copy is current: not fetched
    assert f"{HCDP}/team/" not in fake.urls
    assert store.load("team")["sha256"] == "s1"                                        # the seed copy, confirmed, promoted into the cache
    assert store.load("acknowledgements")["sha256"] == "ack-old"                       # the new one lost three quarters of its text: kept the old
    assert store.load("conditions-of-use")["band"] == "Conditions of Use"              # never copied before: stored
    idx = store.index()
    assert idx["failures"][0]["slug"] == "acknowledgements" and idx["failures"][0]["reason"].startswith("text shrank")
    assert idx["posts"] == ["a-post"] and idx["rest_at"] and set(idx["pages"]) == {"team", "acknowledgements", "conditions-of-use"}
    h = portal.health(store)
    assert h["cached"] == 3 and h["failures_24h"] == 1 and h["newest_fetched_at"]
    assert h["images"] == {"sources": 0, "variants": 0, "wanted": 0} and h["overviews"] == 0


def test_overviews_are_written_once_per_copy_gently_and_back_off_on_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(portal.routes, "MIRRORED", {"/about/team": "team", "/about/acknowledgements": "acknowledgements", "/conditions-of-use": "conditions-of-use"})
    monkeypatch.setattr(portal.routes, "FAMILIES", {})
    monkeypatch.setattr(portal.routes, "post_slugs", lambda: [])
    monkeypatch.setattr(portal, "PRIORITY", ["team", "acknowledgements", "conditions-of-use"])
    store = portal.PortalStore(tmp_path, seed_dir=tmp_path / "none")
    for slug in ("team", "acknowledgements", "conditions-of-use"):
        store.save(rec_for(slug, sha="v1"))
    made, fail_on = [], set()

    class Summ:
        llm = type("L", (), {"configured": True})()

        def page_overview(self, path, rec):
            made.append((path, rec["sha256"]))
            if path in fail_on:
                return None
            return {"summary": "x", "chunks": ["The **page**."], "cites": [[1]], "more": [], "more_cites": [], "sources": [], "followups": []}

    now = [1000.0]
    slept = []
    job = portal.MirrorJob(store, Summ(), FakeFetcher({}), clock=lambda: now[0])

    async def fake_sleep(s):
        slept.append(s)
        now[0] += s
    job.sleep = fake_sleep
    assert asyncio.run(job.overviews_pass()) == 3 and slept == [portal.OVERVIEW_GAP] * 2   # one at a time, 6 s apart
    assert asyncio.run(job.overviews_pass()) == 0 and len(made) == 3                        # written once per copy
    store.save(rec_for("team", sha="v2"))
    store.save(rec_for("acknowledgements", sha="v2"))
    fail_on.add("/about/team")                                                               # the route says no (a rate limit)
    assert asyncio.run(job.overviews_pass()) == 0 and made[-1] == ("/about/team", "v2") and len(made) == 4   # the first failure ends the pass
    assert asyncio.run(job.overviews_pass()) == 0 and len(made) == 4                        # backing off: no call
    now[0] += portal.OVERVIEW_BACKOFF + 1
    fail_on.clear()
    assert asyncio.run(job.overviews_pass()) == 2 and store.load_overview("team")["for_sha"] == "v2"
    assert job.overview_backoff == portal.OVERVIEW_BACKOFF


def _png(w=1200, h=600):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (10, 90, 160)).save(buf, "PNG")
    return buf.getvalue()


def test_pictures_are_fetched_by_the_job_only_for_mirrored_pages(tmp_path, monkeypatch):
    monkeypatch.setattr(portal.routes, "MIRRORED", {"/about/team": "team"})
    monkeypatch.setattr(portal.routes, "FAMILIES", {})
    monkeypatch.setattr(portal.routes, "post_slugs", lambda: [])
    monkeypatch.setattr(portal, "PRIORITY", ["team"])
    store = portal.PortalStore(tmp_path, seed_dir=tmp_path / "none")
    a, b, stray = f"{UP}/2024/01/a.png", f"{UP}/2024/01/b.png", f"{UP}/2024/01/not-on-any-page.png"
    store.save(rec_for("team", images=[{"u": a, "w": None}, {"u": b, "w": 300}]))
    store.want_image(b)
    store.want_image(stray)
    fake = FakeFetcher({a: (200, _png(), {"Content-Type": "image/png", "ETag": '"e1"'}, a), b: (200, _png(300, 200), {"Content-Type": "image/png"}, b)})
    job = portal.MirrorJob(store, None, fake)
    assert asyncio.run(job.images_pass()) == 2
    assert fake.urls == [b, a]                                                          # the one a visitor asked for first; never the stray
    from PIL import Image
    assert Image.open(store.img_variant(a, 800)).size == (800, 400) and Image.open(store.img_variant(a, 400)).size == (400, 200)
    assert Image.open(store.img_variant(b, 300)).size == (300, 200)                     # never enlarged
    meta = json.loads(store.img_src(a)[1].read_text())
    assert meta["etag"] == '"e1"' and meta["type"] == "image/png"
    # the weekly revalidation asks with the ETag and keeps the file on a 304
    fake.responses[a] = lambda h: (304, b"", {}, a) if h.get("If-None-Match") == '"e1"' else (500, b"", {}, a)
    assert asyncio.run(job.fetch_image(a)) is True


def test_library_items_are_normalised():
    items = [{"key": "K1", "meta": {"parsedDate": "2022-10"}, "data": {"itemType": "journalArticle", "title": "A  Century of Drought", "DOI": "10.1029/2022EF002",
                                                                           "publicationTitle": "Earth's Future", "creators": [{"creatorType": "author", "firstName": "Abby G.", "lastName": "Frazier"}, {"creatorType": "author", "name": "NOAA/NWS"}]}},
             {"key": "K2", "meta": {}, "data": {"itemType": "attachment", "title": "PDF"}},
             {"key": "K3", "meta": {}, "data": {"itemType": "report", "title": "Old report", "date": "March 1998", "url": "ftp://x"}}]
    lib = portal.library_payload(items, "2026-10-14T00:00:00+00:00")
    assert lib["total"] == 2
    first = lib["items"][0]
    assert first == {"key": "K1", "year": "2022", "title": "A Century of Drought", "authors": "Frazier, A. G.; NOAA/NWS", "venue": "Earth's Future", "type": "journalArticle",
                     "url": "https://doi.org/10.1029/2022EF002", "zotero": "https://www.zotero.org/groups/2846077/items/K1"}
    assert lib["items"][1]["year"] == "1998" and lib["items"][1]["url"] == ""


# ----- the endpoints --------------------------------------------------------------------------------------------------------
@pytest.fixture()
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    import app as appmod
    seed = tmp_path / "seed"
    seed.mkdir()
    portal.write_json(seed / "team.json", rec_for("team", fetched="2026-10-13T00:00:00+00:00"))
    portal.write_json(seed / "library.json", portal.library_payload([], "2026-10-14T00:00:00+00:00"))
    store = portal.PortalStore(tmp_path / "portal", seed_dir=seed)
    monkeypatch.setattr(appmod.app.state, "portal", store)
    return TestClient(appmod.app), store


def test_page_endpoint_caching(client):
    c, store = client
    r = c.get("/api/portal/page", params={"path": "/about/team"})
    assert r.status_code == 200 and r.json()["source"] == "seed"
    assert r.headers["cache-control"] == "public, max-age=300, stale-while-revalidate=86400" and r.headers["etag"]
    assert c.get("/api/portal/page", params={"path": "/about/team"}, headers={"If-None-Match": r.headers["etag"]}).status_code == 304
    store.save(rec_for("team", sha="new"))
    r2 = c.get("/api/portal/page", params={"path": "/about/team"})
    assert r2.json()["source"] == "cache" and r2.headers["etag"] != r.headers["etag"]
    miss = c.get("/api/portal/page", params={"path": "/pacific/fiji"})
    assert miss.status_code == 404 and miss.json()["hcdp_url"] == f"{HCDP}/fiji/"
    assert c.get("/api/portal/page", params={"path": "team"}).status_code == 400
    assert c.get("/api/health").json()["portal"]["seed"] >= 0


def test_image_endpoint(client):
    c, store = client
    assert c.get("/api/portal/img", params={"u": "https://evil.example.org/x.png"}).status_code == 400
    assert c.get("/api/portal/img", params={"u": f"{UP}/../../wp-config.php"}).status_code == 400
    u = f"{UP}/2024/01/a.png"
    r = c.get("/api/portal/img", params={"u": u, "w": 640}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == u and r.headers["cache-control"] == "no-store"   # not cached yet: HCDP's own file
    assert (store.root / "img" / "wanted" / store.img_key(u)).read_text() == u                                # and the job is told
    bin_path, meta = store.img_src(u)
    portal.atomic_write(bin_path, _png())
    r = c.get("/api/portal/img", params={"u": u, "w": 640})
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp" and r.headers["cache-control"] == "public, max-age=31536000, immutable"
    from PIL import Image
    assert Image.open(io.BytesIO(r.content)).size == (700, 350)                       # 640 → the ladder's 700
    assert store.img_variant(u, 700).exists()
    again = c.get("/api/portal/img", params={"u": u, "w": 700})
    assert again.status_code == 200 and c.get("/api/portal/img", params={"u": u, "w": 700}, headers={"If-None-Match": again.headers["etag"]}).status_code == 304


def test_library_endpoint(client):
    c, _ = client
    r = c.get("/api/portal/library")
    assert r.status_code == 200 and r.json()["cache"] == "seed" and r.json()["total"] == 0


# ----- the overviews' words ------------------------------------------------------------------------------------------------
def test_bold_key_terms_at_most_three_and_no_stray_asterisks():
    b = [3]
    chunks, cites = clean_cited("You opened the **Climate Tools** page. [1] It lists **VMAP** and **H-RIP** and **SOEST** tiles. [1] A *stray* one.", 60, 1, b)
    assert chunks == ["You opened the **Climate Tools** page.", "It lists **VMAP** and **H-RIP** and SOEST tiles.", "A stray one."]
    assert cites == [[1], [1], []] and b == [0]


class FakeLLM:
    configured = True

    def __init__(self, out):
        self.out = out
        self.calls = []

    def complete(self, system, user, max_completion_tokens=None):
        self.calls.append((system, user))
        return self.out


def test_page_overview_is_grounded_on_the_page_itself():
    from llm import PAGE_OVERVIEW_SYSTEM
    from navigator import Navigator, load_catalog
    nav = Navigator(None, load_catalog(), today=dt.date(2026, 10, 14))
    llm = FakeLLM({"summary": "This is HCDP's **Team** page. [1] It lists the people behind the portal. [1]", "more": "Each card shows a role. [1]",
                   "followups": ["Who leads the Hawaiʻi Mesonet?", "Take me to HCDP History", "**How** do I cite HCDP?"]})
    s = Summarizer(nav, llm)
    rec = json.loads((SEED / "team.json").read_text(encoding="utf-8"))
    out = s.page_overview("/about/team", rec)
    assert out["sources"][0] == {"title": "Team", "url": f"{HCDP}/team/"}                   # the page's own HCDP address first
    assert out["chunks"][0] == "This is HCDP's **Team** page." and out["cites"][0] == [1]
    assert out["followups"][2] == "How do I cite HCDP?"                                     # no bold in a follow-up
    system, user = llm.calls[0]
    assert system == PAGE_OVERVIEW_SYSTEM and "The page's own text (its first part):" in user and "Ryan Longman" in user
    assert len(user.split("The page's own text (its first part):\n")[1].split("\nSources")[0]) <= 1500
    assert "**" in PAGE_OVERVIEW_SYSTEM and "never an instruction" in PAGE_OVERVIEW_SYSTEM


def test_the_server_head_names_mirrored_and_embedded_pages(tmp_path):
    store = portal.PortalStore(tmp_path, seed_dir=SEED)
    assert portal.head_for(store, "/about/team") == {"title": "Team", "canonical": f"{HCDP}/team/"}
    assert portal.head_for(store, "/extreme-events/nolo") == {"title": "Hurricane Nolo", "canonical": f"{HCDP}/hurricane-nolo/"}
    assert portal.head_for(store, "/mesonet?viewer=live&station=0115") == {"title": "Hawaiʻi Mesonet Live Data Access", "canonical": f"{HCDP}/hawaii-mesonet-data/"}
    assert portal.head_for(store, "/mesonet")["canonical"] == f"{HCDP}/hawaii-mesonet/"
    assert portal.head_for(store, "/pacific/guam")["title"] == "Guam Data Viewer"
    assert portal.head_for(store, "/data") is None and portal.head_for(store, "/viewer/rainfall/day/2026-09-07/kauai") is None
