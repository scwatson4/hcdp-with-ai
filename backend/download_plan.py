"""AI-prepared data downloads (gallery picks D1–D5, 13 Oct).

A visitor's data ask ("I need rainfall data from Hurricane Lowell") becomes a PLAN: a plain-English reading of the ask and
a checklist of packages HCDP's export can build — gridded maps, station data, and the storm report's pages for context —
each verified against HCDP's own file listing before it is offered, then one zip through HCDP's instant genzip with an
AI-written README.md, or HCDP's emailed package when the list is too long for a direct download.

    plan     = DownloadPlanner(llm, navigator).plan(ask, ranges, hints, extra, previous, context)   # the model, validated
    verified = await verify_items(plan, lister)        # HCDP /files/production/list per item: exact counts, missing dates
    readme   = readme_text(plan, items, package_url, analyze_url, site)
    zip      = await fetch_zip(client, genzip_payload(items, email), max_bytes, tmp_dir); add_readme(zip, readme)

Everything the model proposes is checked here against export.py's recipes (products, periods, files, fills, extents, dates)
and the viewer's datasets; dates are clamped to the published range; an item that does not exist is not offered — it is
named in `dropped` with the closest alternative. app.py owns the HTTP clients (the server's HCDP token for the listing, the
VISITOR's API key for the genzip request — never the server's), the rate limits and the routes. The visitor's key is never
stored, logged or echoed: it lives in one request's Authorization header and nowhere else.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import re
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx

from export import (ANONYMOUS_EMAIL, EMAIL_MAX_FILES, EXTENT_CODES, INSTANT_MAX_FILES, PRODUCT_BY_ID, PRODUCTS, ExportError,
                    options as export_options, package_group, periods_between, valid_email, validate as export_validate)
from llm import PLANNER_SYSTEM
from navigator import DATASETS, DATASET_ALIASES, EXTENT_ALIASES, EXTENTS, canonical_viewer_path, describe_view, parse_viewer_path
from summary import clean_text

HST = ZoneInfo("Pacific/Honolulu")
GROUPS = ("grid", "station", "report")
GROUP_LABELS = {"grid": "Gridded maps", "station": "Station data", "report": "From the storm report"}
MAX_ITEMS = 8
MAX_REPORT_LINKS = 3
MAX_READING_WORDS = 120
MAX_WHY_CHARS = 160
LIST_TTL = 600                     # the HCDP file listing is cached this long (seconds)
LIST_CONCURRENCY = 4
LIST_TIMEOUT = 25.0
EXTENT_LABELS = {"statewide": "Statewide", "hawaii": "Hawaiʻi Island", "maui": "Maui County", "molokai": "Maui County", "lanai": "Maui County", "oahu": "Oʻahu", "kauai": "Kauaʻi"}
CODE_EXTENT = {"statewide": "statewide", "bi": "hawaii", "mn": "maui", "oa": "oahu", "ka": "kauai"}
FILE_TAGS = ("data_map", "se", "anom", "anom_se", "metadata", "station_data")
UNIT_WORDS = {"mm": "millimetres (mm)", "c": "degrees Celsius (°C)"}
# Bytes per file for the size estimate, by type and extent code. Measured 13 Oct from real HCDP zips fetched by the e2e test
# (test_download_e2e.py): a statewide monthly rainfall GeoTIFF 1,808,305 B, a Kauaʻi daily one 121,338–123,233 B, metadata text
# 2,732–4,088 B, the yearly file of monthly station values 42,019 B. The other islands scale with their grid's footprint; the
# monthly file of daily station values holds 31 columns instead of 12, hence the larger figure. It is an estimate ("about").
SIZE_BYTES = {
    "tif": {"statewide": 1_850_000, "bi": 950_000, "mn": 600_000, "oa": 150_000, "ka": 125_000},
    "txt": 3_000,
    "csv": {"day": 110_000, "month": 45_000},
}
HCDP_HOME = "https://www.hawaii.edu/climate-data-portal/"
HOW_TO_CITE = "https://www.hawaii.edu/climate-data-portal/how-to-cite-3/"
LICENCE = "https://creativecommons.org/licenses/by-nc-nd/4.0/"
HCDP_CITATION = ("Longman, R. J., M. P. Lucas, J. Mclean, S. Cleveland, K. Kodama, A. G. Frazier, K. Kamelamela, A. Schriber, M. Dodge, "
                 "G. Jacobs and T. W. Giambelluca. 2024. “Hawaiʻi Climate Data Portal (HCDP).” Bulletin of the American Meteorological Society.")
_DATE_IN_LINK = re.compile(r"_(\d{4})(?:_(\d{2}))?(?:_(\d{2}))?\.(tif|txt|csv)$")
_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class PlanError(ValueError):
    """A request that cannot become a plan: the message is for the visitor."""


class PrepareError(Exception):
    """The zip or the email request could not be made; `status` is the HTTP status to answer with, `detail` the visitor's words."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


# ----- dates ------------------------------------------------------------------------
def today_hst() -> dt.date:
    return dt.datetime.now(HST).date()


def step(date: str, n: int, period: str) -> str:
    if period == "day":
        return (dt.date.fromisoformat(date) + dt.timedelta(days=n)).isoformat()
    y, m = int(date[:4]), int(date[5:7])
    k = y * 12 + (m - 1) + n
    return f"{k // 12:04d}-{k % 12 + 1:02d}"


def dates_between(start: str, end: str, period: str, limit: int = 20000) -> list[str]:
    out, d = [], start
    while d <= end and len(out) < limit:
        out.append(d)
        d = step(d, 1, period)
    return out


def fmt_date(date: str, period: str | None = None) -> str:
    """'7 Sep 2026' for a day, 'Sep 2026' for a month."""
    if len(date) == 10 and period != "month":
        d = dt.date.fromisoformat(date)
        return f"{d.day} {d.strftime('%b %Y')}"
    d = dt.date.fromisoformat(date[:7] + "-01")
    return d.strftime("%b %Y")


def fmt_span(start: str, end: str, period: str) -> str:
    if start == end:
        return fmt_date(start, period)
    if period == "day":
        a, b = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
        if a.year == b.year and a.month == b.month:
            return f"{a.day}–{b.day} {b.strftime('%b %Y')}"
        if a.year == b.year:
            return f"{a.day} {a.strftime('%b')} – {b.day} {b.strftime('%b %Y')}"
    return f"{fmt_date(start, period)} – {fmt_date(end, period)}"


def _coerce_date(text, period: str) -> str | None:
    s = str(text or "").strip()[:10]
    try:
        if period == "day":
            if len(s) == 7:
                return None
            return dt.date.fromisoformat(s).isoformat()
        s = s[:7]
        if len(s) != 7:
            return None
        dt.date.fromisoformat(s + "-01")
        return s
    except ValueError:
        return None


# ----- the model's items → checked items ------------------------------------------------
def _slug_list(value) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    out = []
    for x in value:
        if isinstance(x, str) and x.strip():
            s = x.strip().lower()
            if s not in out:
                out.append(s)
    return out


def canonical_product(text) -> str | None:
    s = str(text or "").strip().lower()
    if s in PRODUCT_BY_ID:
        return s
    alias = DATASET_ALIASES.get(s)
    return alias if alias in PRODUCT_BY_ID else None


def canonical_extent(text) -> str | None:
    s = str(text or "").strip().lower()
    e = s if s in EXTENTS else EXTENT_ALIASES.get(s)
    if e in ("molokai", "lanai"):
        e = "maui"
    return e if e in EXTENTS else None


def item_id(req: dict, group: str) -> str:
    """A deterministic id for an item's content, so a shared /download?picks= address survives a re-plan of the same ask."""
    key = json.dumps([group, req["product"]["id"], req["period"], req["start"], req["end"], req["extents"], req["grid_files"], req["station_fills"]], sort_keys=True)
    return f"{group}-{req['product']['id']}-{req['period']}-{hashlib.sha1(key.encode()).hexdigest()[:6]}"


def item_label(req: dict, group: str) -> str:
    p = req["product"]
    when = fmt_span(req["start"], req["end"], req["period"])
    period_word = "Daily" if req["period"] == "day" else "Monthly"
    what = p["label"].lower() if p["id"] != "rainfall-legacy" else "legacy rainfall"
    if group == "station":
        fills = " and ".join({"partial": "partial-filled", "raw": "unfilled"}.get(f, f) for f in req["station_fills"])
        return f"{period_word} {what} station data ({fills}), {when}"
    files = [f for f in req["grid_files"] if f != "metadata"]
    names = {"se": "standard error", "anom": "anomaly", "anom_se": "anomaly standard error"}
    extras = [names.get(f, f) for f in files if f != "data_map"]
    extents = ", ".join(dict.fromkeys(EXTENT_LABELS.get(e, e) for e in req["extents"]))
    if not files:
        return f"{period_word} {what} metadata, {when}, {extents}"
    if "data_map" in files:
        kinds = "maps" + (f" with {' and '.join(extras)}" if extras else "")
    else:
        kinds = f"{' and '.join(extras)} maps"
    return f"{period_word} {what} {kinds}, {when}, {extents}"


def formula_files(req: dict) -> int:
    """hcdp_v2's estimate (periods × (extents × grid files + station files)); the listing replaces it with the exact count."""
    return int(req["files"])


def estimate_bytes(req: dict, n_files: int | None = None) -> int:
    """A size estimate from SIZE_BYTES: GeoTIFFs by extent, text metadata, one station CSV per month of days or year of months."""
    n = periods_between(req["start"], req["end"], req["period"])
    total = 0
    tifs = [f for f in req["grid_files"] if f != "metadata"]
    for e in req["extents"]:
        code = EXTENT_CODES[e]
        total += n * len(tifs) * SIZE_BYTES["tif"][code]
        if "metadata" in req["grid_files"]:
            total += n * SIZE_BYTES["txt"]
    if req["station_fills"]:
        if req["period"] == "day":
            months = len({d[:7] for d in dates_between(req["start"], req["end"], "day")})
            total += months * len(req["station_fills"]) * SIZE_BYTES["csv"]["day"]
        else:
            years = len({d[:4] for d in dates_between(req["start"], req["end"], "month")})
            total += years * len(req["station_fills"]) * SIZE_BYTES["csv"]["month"]
    return int(total)


def _range_for(ranges: dict | None, product: str, period: str) -> tuple[str, str] | None:
    if not ranges:
        return None
    r = ranges.get((product, period)) or ranges.get(f"{product}|{period}")
    if not r or len(r) < 2 or not r[0] or not r[1]:
        return None
    first, last = str(r[0]), str(r[1])
    return (first[:10], last[:10]) if period == "day" else (first[:7], last[:7])


def _period_noun(period: str, plural: bool = False) -> str:
    return ("days" if plural else "day") if period == "day" else ("months" if plural else "month")


def normalize_item(raw: dict, ranges: dict | None = None, strict: bool = False) -> tuple[list[dict], list[dict]]:
    """One of the model's items → zero, one or two checked items (a grid one and a station one) plus the dropped notes.
    `strict` (the prepare step) refuses dates outside the published range instead of clamping them."""
    dropped: list[dict] = []
    if not isinstance(raw, dict):
        return [], dropped
    product = canonical_product(raw.get("product") or raw.get("dataset"))
    if not product:
        return [], dropped
    p = PRODUCT_BY_ID[product]
    period = str(raw.get("period") or "").strip().lower()
    period = {"daily": "day", "monthly": "month"}.get(period, period)
    if period not in p["periods"]:
        return [], dropped
    why = clean_text(raw.get("why"))[:MAX_WHY_CHARS]
    ticked = bool(raw.get("ticked", True))
    start, end = _coerce_date(raw.get("start"), period), _coerce_date(raw.get("end"), period)
    if not start or not end:
        return [], dropped
    if start > end:
        start, end = end, start
    label_what = p["label"].lower()
    note = None
    rng = _range_for(ranges, product, period)
    if rng:
        first, last = rng
        if start > last:
            dropped.append({"id": f"{product}-{period}-{start}", "group": "grid" if raw.get("files") else "station",
                            "label": f"{'Daily' if period == 'day' else 'Monthly'} {label_what}, {fmt_span(start, end, period)}",
                            "why": f"no {'daily' if period == 'day' else 'monthly'} {label_what} for {fmt_date(start, period)} yet — the last {_period_noun(period)} published is {fmt_date(last, period)}",
                            "alternative": {"product": product, "period": period, "start": last, "end": last}})
            return [], dropped
        if end < first:
            dropped.append({"id": f"{product}-{period}-{start}", "group": "grid" if raw.get("files") else "station",
                            "label": f"{'Daily' if period == 'day' else 'Monthly'} {label_what}, {fmt_span(start, end, period)}",
                            "why": f"HCDP's {label_what} by {_period_noun(period)} starts in {fmt_date(first, period)}",
                            "alternative": {"product": product, "period": period, "start": first, "end": first}})
            return [], dropped
        if end > last:
            if strict:
                raise PlanError(f"no {'daily' if period == 'day' else 'monthly'} {label_what} for {fmt_date(end, period)} yet — the last {_period_noun(period)} published is {fmt_date(last, period)}")
            note = f"no {'daily' if period == 'day' else 'monthly'} {label_what} for {fmt_span(step(last, 1, period), end, period)} yet — the last {_period_noun(period)} published is {fmt_date(last, period)}"
            end = last
        if start < first:
            if strict:
                raise PlanError(f"HCDP's {label_what} by {_period_noun(period)} starts in {fmt_date(first, period)}")
            note = f"HCDP's {label_what} by {_period_noun(period)} starts in {fmt_date(first, period)}, so the window starts there"
            start = first
    asked_files = _slug_list(raw.get("files"))
    asked_fills = _slug_list(raw.get("station_fills") or raw.get("fills") or raw.get("station_files"))
    files = [f for f in asked_files if f in p["grid_files"]]
    fills = [f for f in asked_fills if f in p["station_fills"].get(period, [])]
    extents = [e for e in (canonical_extent(x) for x in _slug_list(raw.get("extents") or raw.get("extent"))) if e]
    extents = [e for e in dict.fromkeys(extents) if e in p["extents"]]
    group = str(raw.get("group") or "").strip().lower()
    if asked_fills and not fills:
        # station data was asked for a product and period HCDP has none for (mean temperature; raw monthly rainfall …)
        allowed = p["station_fills"].get(period, [])
        hint = " HCDP publishes station temperature as daily and monthly maximum and minimum only." if product == "temperature-mean" else (f" HCDP has {', '.join(allowed)} station data for it." if allowed else "")
        dropped.append({"id": f"{product}-{period}-station", "group": "station", "label": f"{'Daily' if period == 'day' else 'Monthly'} {label_what} station data, {fmt_span(start, end, period)}",
                        "why": f"HCDP has no {' or '.join(asked_fills)} station data for {label_what} by {_period_noun(period)}.{hint}".strip(), "alternative": None})
    if asked_files and not files:
        dropped.append({"id": f"{product}-{period}-grid", "group": "grid", "label": f"{'Daily' if period == 'day' else 'Monthly'} {label_what} {', '.join(asked_files)}, {fmt_span(start, end, period)}",
                        "why": f"{p['label']} has no {' or '.join(asked_files)} files; HCDP publishes {', '.join(p['grid_files'])}", "alternative": None})
    if not files and not fills:
        if asked_files or asked_fills:
            return [], dropped
        if group == "station" and p["station_fills"].get(period):
            fills = [p["station_fills"][period][0]]
        elif group != "station" and p["grid_files"]:
            files = [p["grid_files"][0]]
        else:
            return [], dropped
    if files and not extents:
        extents = ["statewide"]
    out: list[dict] = []
    for grp, body in (("grid", {"dataset": product, "period": period, "start": start, "end": end, "extents": extents, "files": files}),
                      ("station", {"dataset": product, "period": period, "start": start, "end": end, "station_files": fills})):
        if (grp == "grid" and not files) or (grp == "station" and not fills):
            continue
        try:
            req = export_validate(body)
        except ExportError as e:
            dropped.append({"id": f"{product}-{period}-{grp}", "group": grp, "label": f"{label_what} ({grp})", "why": str(e), "alternative": None})
            continue
        out.append({"id": item_id(req, grp), "group": grp, "product": product, "label": item_label(req, grp), "period": period,
                    "start": req["start"], "end": req["end"], "extents": list(req["extents"]), "files": list(req["grid_files"]),
                    "station_fills": list(req["station_fills"]), "ticked": ticked, "why": why, "note": note,
                    "status": "pending", "count": formula_files(req), "bytes": estimate_bytes(req), "units": p["units"]})
    return out, dropped


def request_of(item: dict) -> dict:
    """export.validate's description for a checked item (the shape package_group / payload take)."""
    body = {"dataset": item["product"], "period": item["period"], "start": item["start"], "end": item["end"]}
    if item.get("group") == "station":
        body["station_files"] = list(item.get("station_fills") or [])
    else:
        body["extents"] = list(item.get("extents") or [])
        body["files"] = list(item.get("files") or [])
    return export_validate(body)


def normalize_items(raws, ranges: dict | None = None, strict: bool = False) -> tuple[list[dict], list[dict]]:
    """Every model item checked, split and deduplicated; at most MAX_ITEMS; the dropped ones named."""
    items: list[dict] = []
    dropped: list[dict] = []
    seen: set[str] = set()
    for raw in raws if isinstance(raws, list) else []:
        got, gone = normalize_item(raw, ranges, strict)
        dropped.extend(gone)
        for it in got:
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            items.append(it)
    return items[:MAX_ITEMS], dropped[:MAX_ITEMS]


def default_reading(ask: str, items: list[dict], event: str | None, place: str | None) -> str:
    """A plain paragraph when the model wrote none: what was asked, how it was read, what is ticked."""
    ticked = [i for i in items if i.get("ticked")]
    rest = [i for i in items if not i.get("ticked")]
    bits = [f"You asked for {clean_text(ask)[:160] or 'HCDP data'}."]
    read = []
    if event:
        read.append(event)
    if place:
        read.append(place)
    if items:
        span = fmt_span(min(i["start"] for i in items), max(i["end"] for i in items), items[0]["period"])
        read.append(span)
    if read:
        bits.append("I read this as " + ", ".join(read) + ".")
    lc = lambda s: s[:1].lower() + s[1:]  # noqa: E731 - only the first letter: month and island names keep their case
    if ticked:
        bits.append("I ticked " + "; ".join(lc(i["label"]) for i in ticked[:3]) + ".")
    if rest:
        bits.append("Left unticked as context: " + "; ".join(lc(i["label"]) for i in rest[:3]) + ".")
    return " ".join(bits)


def trim_words(text: str, limit: int) -> str:
    words = text.split()
    return text if len(words) <= limit else " ".join(words[:limit]).rstrip(",;:") + "…"


class DownloadPlanner:
    """Grounds the model (the products HCDP can package with their published ranges, the catalogued storms, today's date),
    asks it for a plan and validates everything it answers. `llm` has `configured` and `complete(system, user) -> dict | None`;
    `nav` is the Navigator (its catalog names the storms and the real HCDP pages behind them)."""

    def __init__(self, llm, nav, today: dt.date | None = None):
        self.llm = llm
        self.nav = nav
        self._today = today

    def today(self) -> dt.date:
        return self._today or today_hst()

    # ----- grounding --------------------------------------------------------
    def events(self) -> list[dict]:
        return [e for e in (self.nav.catalog if self.nav else []) if e.get("kind") == "event" and (e.get("dates") or {}).get("start")]

    def event_entry(self, event_id: str | None, ask: str = "") -> dict | None:
        events = self.events()
        if event_id:
            eid = str(event_id).strip().lower()
            for e in events:
                if e.get("id") == eid:
                    return e
        low = (ask or "").lower()
        for e in events:
            name = re.sub(r"[^a-z0-9]", "", str(e.get("id") or ""))
            if name and name in re.sub(r"[^a-z0-9]", "", low):
                return e
        return None

    @staticmethod
    def event_islands(e: dict) -> list[str]:
        tags = {t.lower() for t in (e.get("tags") or [])}
        out = []
        for slug, words in (("kauai", {"kauai", "kauaʻi"}), ("oahu", {"oahu", "oʻahu", "honolulu"}), ("maui", {"maui", "molokai", "molokaʻi", "lanai", "lānaʻi"}), ("hawaii", {"big island", "hawaiʻi island", "hilo", "kona"})):
            if tags & words:
                out.append(slug)
        return out

    def products_text(self, ranges: dict | None) -> str:
        lines = []
        for p in PRODUCTS:
            fills = "; ".join(f"{per} {', '.join(v) if v else 'none'}" for per, v in p["station_fills"].items())
            pub = []
            for per in p["periods"]:
                r = _range_for(ranges, p["id"], per)
                if r:
                    pub.append(f"{per} {r[0]} → {r[1]}")
            lines.append(f"- {p['id']} ({p['label']}, {p['units']}): periods {', '.join(p['periods'])}; grid files {', '.join(p['grid_files'])}; "
                         f"extents {', '.join(p['extents'])}; station data by period: {fills}" + (f"; published: {'; '.join(pub)}" if pub else ""))
        return "\n".join(lines)

    def events_text(self) -> str:
        lines = []
        for e in self.events():
            d = e.get("dates") or {}
            islands = ", ".join(self.event_islands(e)) or "see the summary"
            lines.append(f"- {e['id']}: {e.get('title', '')} — {d.get('start')} → {d.get('end') or 'ongoing'}; islands: {islands}; {clean_text(e.get('summary'))[:220]}")
        return "\n".join(lines)

    def user_message(self, ask: str, ranges: dict | None, hints: dict | None = None, extra: str = "", previous: list | None = None, context: dict | None = None) -> str:
        today = self.today()
        parts = [f"Today in Hawaiʻi: {today.isoformat()} (daily maps usually run to one or two days ago; monthly maps to the last complete month).",
                 "PRODUCTS HCDP CAN PACKAGE (the only products you may use):", self.products_text(ranges),
                 "STORMS IN THE CATALOG (id: title — dates; islands hit):", self.events_text() or "(none)"]
        if isinstance(context, dict) and context.get("path"):
            parts.append(f"The visitor is on page {str(context['path'])[:200]}.")
        if isinstance(hints, dict) and hints:
            safe = {k: v for k, v in hints.items() if isinstance(k, str) and isinstance(v, (str, int, float, list)) and len(json.dumps(v)) < 200}
            if safe:
                parts.append("HINTS FROM THE NAVIGATOR (its quick reading; check them): " + json.dumps(safe, ensure_ascii=False)[:600])
        if previous:
            keep = [{k: it.get(k) for k in ("id", "group", "product", "period", "start", "end", "extents", "files", "station_fills", "ticked")} for it in previous if isinstance(it, dict)][:MAX_ITEMS]
            parts.append("ITEMS ALREADY PLANNED (keep them as they are, then add what the extra wish asks for): " + json.dumps(keep, ensure_ascii=False)[:3000])
        parts.append(f"VISITOR'S ASK: {clean_text(ask)[:500]}")
        if extra:
            parts.append(f"EXTRA WISH (something else the visitor wants in the package): {clean_text(extra)[:300]}")
        return "\n".join(parts)

    # ----- the plan ---------------------------------------------------------
    def plan(self, ask: str, ranges: dict | None = None, hints: dict | None = None, extra: str = "", previous: list | None = None, context: dict | None = None) -> dict | None:
        """The model's plan, validated; None when the model is not configured or did not answer."""
        if self.llm is None or not getattr(self.llm, "configured", False):
            return None
        raw = self.llm.complete(PLANNER_SYSTEM, self.user_message(ask, ranges, hints, extra, previous, context))
        if not isinstance(raw, dict):
            return None
        return self.normalize(raw, ask, ranges, previous)

    def report_items(self, event: dict | None) -> list[dict]:
        """The storm report's pages as context items (no files; their links go into the README): the report itself ticked,
        up to two related catalog pages unticked. Only real catalog URLs."""
        if not event or not self.nav:
            return []
        out = []
        seen = set()

        def add(e: dict, ticked: bool, why: str) -> None:
            u = e.get("url")
            if not isinstance(u, str) or not u or u in seen or not self.nav.allowed_url(u) or len(out) >= MAX_REPORT_LINKS:
                return
            seen.add(u)
            out.append({"id": f"report-{re.sub(r'[^a-z0-9-]', '', str(e.get('id') or 'page').lower())}", "group": "report", "label": str(e.get("title") or u)[:120], "url": u,
                        "why": clean_text(why)[:MAX_WHY_CHARS], "ticked": ticked, "status": "ok", "count": 0, "bytes": 0, "note": None})

        add(event, True, "the storm's story, key figures and HCDP's official downloads, linked in the README")
        for e in self.nav.related_entries(event, seen):
            first = re.split(r"(?<=[.!?])\s+", clean_text(e.get("summary") or e.get("when_to_use") or ""), maxsplit=1)[0]
            add(e, False, first)
        return out

    def normalize(self, raw: dict, ask: str, ranges: dict | None = None, previous: list | None = None) -> dict:
        items, dropped = normalize_items(raw.get("items"), ranges)
        # a re-plan keeps what was already ticked (by content id) and adds the new items
        if previous:
            kept, _ = normalize_items(previous, ranges)
            ids = {i["id"] for i in items}
            for it in kept:
                if it["id"] not in ids:
                    items.append(it)
            items = items[:MAX_ITEMS]
        event = self.event_entry(raw.get("event_id"), ask)
        event_name = clean_text(raw.get("event"))[:80] or (event.get("title", "").replace(" report", "") if event else "")
        place = clean_text(raw.get("place"))[:60] or None
        reports = self.report_items(event)
        all_items = items + reports
        period = str(raw.get("period") or "").lower()
        if period not in ("day", "month"):
            period = items[0]["period"] if items else "day"
        starts = [i["start"] for i in items] or [None]
        ends = [i["end"] for i in items] or [None]
        extents = [e for e in (canonical_extent(x) for x in _slug_list(raw.get("extents"))) if e] or (list(items[0]["extents"]) if items and items[0]["extents"] else [])
        reading = trim_words(clean_text(raw.get("reading")), MAX_READING_WORDS)
        if not reading or len(reading.split()) < 8:
            reading = default_reading(ask, items, event_name or None, place)
        primary = self.primary_view(raw.get("primary_view"), items, ranges)
        return {"ask": clean_text(ask)[:500], "reading": reading, "event": event_name or None, "event_id": event.get("id") if event else None,
                "event_url": event.get("url") if event else None, "place": place, "period": period,
                "start": min(s for s in starts if s) if items else None, "end": max(e for e in ends if e) if items else None,
                "extents": extents, "items": all_items, "dropped": dropped,
                "groups": [{"id": g, "label": GROUP_LABELS[g]} for g in GROUPS if any(i["group"] == g for i in all_items)],
                "primary_view": primary, "primary_view_label": describe_view_path(primary), "instant_max_files": INSTANT_MAX_FILES}

    @staticmethod
    def primary_view(raw, items: list[dict], ranges: dict | None) -> str | None:
        """The one viewer map for the plan: the model's if the grammar accepts it (and its date is published), else the first
        ticked grid item's last date on its first extent, else the first item's."""
        candidates = []
        if isinstance(raw, dict):
            ds = str(raw.get("dataset") or "").lower()
            ds = ds if ds in DATASETS else DATASET_ALIASES.get(ds)
            ext = canonical_extent(raw.get("extent")) or (canonical_extent((raw.get("extents") or [None])[0]) if isinstance(raw.get("extents"), list) else None)
            per = str(raw.get("period") or "").lower()
            date = _coerce_date(raw.get("date"), per) if per in ("day", "month") else None
            if ds and ext and date:
                r = _range_for(ranges, ds, per)
                if r and date > r[1]:
                    date = r[1]
                candidates.append(f"/viewer/{ds}/{per}/{date}/{ext}")
        for it in sorted([i for i in items if i["group"] == "grid"], key=lambda i: not i.get("ticked")) + sorted([i for i in items if i["group"] == "station"], key=lambda i: not i.get("ticked")):
            ext = it["extents"][0] if it.get("extents") else "statewide"
            candidates.append(f"/viewer/{it['product']}/{it['period']}/{it['end']}/{ext}")
        for c in candidates:
            v = canonical_viewer_path(c)
            if v:
                return v
        return None


def describe_view_path(path: str | None) -> str | None:
    v = parse_viewer_path(path) if path else None
    return describe_view(v) if v else None


# ----- verification against HCDP's file listing (D4) ----------------------------------------
_LIST_CACHE: dict[str, tuple[float, list[str] | None]] = {}


def listing_data(item: dict) -> list[dict]:
    """The `data` array HCDP's /files/production/list and /genzip take for one item (export.py's package group)."""
    return [package_group(request_of(item))]


def _cache_key(data: list[dict]) -> str:
    return hashlib.sha1(json.dumps(data, sort_keys=True).encode()).hexdigest()


def clear_listing_cache() -> None:
    _LIST_CACHE.clear()


def parse_link(link: str) -> dict | None:
    """'…/rainfall/new/day/ka/data_map/2026/09/rainfall_new_day_ka_data_map_2026_09_06.tif' → {tag, extent, date, ext}."""
    m = _DATE_IN_LINK.search(link)
    if not m:
        return None
    y, mo, d, ext = m.groups()
    date = y + (f"-{mo}" if mo else "") + (f"-{d}" if d else "")
    segs = link.split("/")
    tag = next((s for s in reversed(segs) if s in FILE_TAGS), None)
    extent = next((CODE_EXTENT[s] for s in segs if s in CODE_EXTENT), None)
    return {"tag": tag, "extent": extent, "date": date, "ext": ext}


def apply_listing(item: dict, links: list[str] | None, ranges: dict | None = None) -> dict:
    """The item with its verification: status ok | partial | missing | unverified, the exact file count, the size estimate,
    and — when the newest or oldest dates are not published — the window shrunk to what exists, with a note."""
    it = dict(item)
    if links is None:
        it.update(status="unverified", note=it.get("note") or "HCDP's file listing did not answer; the file count is an estimate")
        return it
    parsed = [p for p in (parse_link(l) for l in links) if p]
    it["count"] = len(links)
    if not links:
        it["status"] = "missing"
        return it
    period = it["period"]
    expected = dates_between(it["start"], it["end"], period)
    if it["group"] == "station":
        # one CSV per month of days (per year of months): present when a file covers the period's month/year
        covered = {p["date"] for p in parsed if p["ext"] == "csv"}
        key = (lambda d: d[:7]) if period == "day" else (lambda d: d[:4])
        present = [d for d in expected if key(d) in covered]
    else:
        ref = next((f for f in it["files"] if f != "metadata"), it["files"][0] if it["files"] else "data_map")
        by: dict[tuple[str, str], set[str]] = {}
        for p in parsed:
            if p["tag"] and p["extent"]:
                by.setdefault((p["extent"], p["tag"]), set()).add(p["date"])
        present = [d for d in expected if all(d in by.get((e, ref), set()) for e in it["extents"])]
    if not present:
        it["status"] = "missing"
        return it
    missing = [d for d in expected if d not in set(present)]
    if not missing:
        it["status"] = "ok"
    else:
        label_what = PRODUCT_BY_ID[it["product"]]["label"].lower()
        noun = "map" if it["group"] == "grid" else "station file"
        tail = [d for d in expected if d > present[-1]]
        head = [d for d in expected if d < present[0]]
        if tail and set(missing) == set(tail):
            it["note"] = f"no {'daily' if period == 'day' else 'monthly'} {label_what} {noun} for {fmt_span(tail[0], tail[-1], period)} yet — the last {_period_noun(period)} published is {fmt_date(present[-1], period)}"
            it["end"] = present[-1]
            it["status"] = "ok"
        elif head and set(missing) == set(head):
            it["note"] = f"HCDP's {label_what} {noun}s start on {fmt_date(present[0], period)}"
            it["start"] = present[0]
            it["status"] = "ok"
        elif tail and head and set(missing) == set(tail) | set(head):
            it["note"] = f"HCDP has {label_what} {noun}s for {fmt_span(present[0], present[-1], period)} only"
            it["start"], it["end"] = present[0], present[-1]
            it["status"] = "ok"
        else:
            it["status"] = "partial"
            it["note"] = f"{len(present)} of {len(expected)} {_period_noun(period, True)} have {noun}s; {len(missing)} {'is' if len(missing) == 1 else 'are'} not published"
        if it["status"] == "ok":
            req = request_of(it)
            it["id"], it["label"] = item_id(req, it["group"]), item_label(req, it["group"])
    try:
        it["bytes"] = estimate_bytes(request_of(it))
    except ExportError:
        pass
    return it


async def verify_items(items: list[dict], lister, concurrency: int = LIST_CONCURRENCY) -> tuple[list[dict], list[dict]]:
    """Every grid and station item checked against HCDP's file listing (`lister(data) -> list[str] | None`, async; the
    server's token, app.py's client), a few in flight, cached LIST_TTL seconds. Returns (offered items, dropped items)."""
    sem = asyncio.Semaphore(max(1, concurrency))

    async def one(it: dict) -> dict:
        if it.get("group") == "report":
            return dict(it, status="ok")
        try:
            data = listing_data(it)
        except ExportError:
            return dict(it, status="missing")
        key = _cache_key(data)
        hit = _LIST_CACHE.get(key)
        now = time.time()
        if hit and now - hit[0] < LIST_TTL:
            links = hit[1]
        else:
            async with sem:
                try:
                    links = await lister(data)
                except Exception:  # noqa: BLE001 - a listing that fails leaves the item unverified, never breaks the plan
                    links = None
            if links is not None:
                if len(_LIST_CACHE) > 500:
                    for k in [k for k, v in _LIST_CACHE.items() if now - v[0] >= LIST_TTL]:
                        del _LIST_CACHE[k]
                _LIST_CACHE[key] = (now, links)
        return apply_listing(it, links)

    verified = await asyncio.gather(*(one(it) for it in items))
    offered, dropped = [], []
    for it in verified:
        if it["status"] == "missing":
            label_what = PRODUCT_BY_ID[it["product"]]["label"].lower() if it.get("product") in PRODUCT_BY_ID else "data"
            dropped.append({"id": it["id"], "group": it["group"], "label": it["label"],
                            "why": f"HCDP has no {label_what} {'station files' if it['group'] == 'station' else 'maps'} for {fmt_span(it['start'], it['end'], it['period'])}" + (f" ({', '.join(EXTENT_LABELS.get(e, e) for e in it['extents'])})" if it.get("extents") else "") + " — nothing to package",
                            "alternative": None})
        else:
            offered.append(it)
    return offered, dropped


def estimate(items: list[dict], picked: set[str] | None = None) -> dict:
    """{files, bytes, over_instant} over the ticked (or picked) items."""
    chosen = [i for i in items if ((i["id"] in picked) if picked is not None else bool(i.get("ticked")))]
    files = sum(int(i.get("count") or 0) for i in chosen)
    return {"files": files, "bytes": sum(int(i.get("bytes") or 0) for i in chosen), "over_instant": files > INSTANT_MAX_FILES}


# ----- the package address, the README, the genzip payload ------------------------------------
def package_path(ask: str, picks: list[str]) -> str:
    ids = ",".join(p for p in picks if isinstance(p, str) and _ID_RE.match(p))
    return f"/download?ask={quote(clean_text(ask)[:500], safe='')}" + (f"&picks={ids}" if ids else "")


def analyze_ask(ask: str, package_url: str) -> str:
    """The question the AI data analysis tool opens with: the ask, then the package address as its context."""
    return f"{clean_text(ask)[:240]} (HCDP data package: {package_url})"


def genzip_payload(items: list[dict], email: str, log_email: str = ANONYMOUS_EMAIL) -> dict:
    """{email, data: [one package group per item]} — hcdp_v2's shape, several groups in one request."""
    groups = [package_group(request_of(it)) for it in items if it.get("group") in ("grid", "station")]
    if not groups:
        raise PlanError("nothing to package: tick at least one map or station file")
    return {"email": email if valid_email(email) else (log_email or ANONYMOUS_EMAIL), "data": groups}


def zip_name(items: list[dict], event: str | None = None) -> str:
    data = [i for i in items if i.get("group") in ("grid", "station")]
    if not data:
        return "hcdp_package.zip"
    start, end = min(i["start"] for i in data), max(i["end"] for i in data)
    slug = re.sub(r"[^a-z0-9]+", "-", (event or "-".join(dict.fromkeys(i["product"] for i in data))).lower()).strip("-")[:40] or "hcdp"
    return f"hcdp_{slug}_{start}_{end}.zip"


def readme_text(plan: dict, items: list[dict], package_url: str, analyze_url: str, site: str = "", now: dt.datetime | None = None) -> str:
    """The README.md added to the zip: what is inside, the ask, how the AI read it, file naming, units, the citation, the
    package address and the Analyze-with-AI link. Plain Markdown; nothing but what the plan and HCDP's own words support."""
    now = now or dt.datetime.now(HST)
    data = [i for i in items if i.get("group") in ("grid", "station")]
    reports = [i for i in items if i.get("group") == "report"]
    lines = ["# HCDP data package — prepared with AI", "",
             f"Prepared {now.strftime('%-d %B %Y, %H:%M')} Hawaiʻi time by the Hawaiʻi Climate Data Portal website's AI download planner"
             + (f" ({site})" if site else "") + ". The data files are HCDP's, unchanged; only this README was added.", "",
             "## What you asked", "", plan.get("ask") or "(no question recorded)", "",
             "## How the AI read it", "", plan.get("reading") or "", ""]
    if plan.get("event") or plan.get("place"):
        bits = [b for b in (plan.get("event"), plan.get("place")) if b]
        lines += [f"Event or place: {' · '.join(bits)}.", ""]
    lines += ["## What is inside", ""]
    total = 0
    for it in data:
        n = int(it.get("count") or 0)
        total += n
        extents = ", ".join(dict.fromkeys(EXTENT_LABELS.get(e, e) + f" ({EXTENT_CODES[e]})" for e in it.get("extents") or [])) if it.get("extents") else "statewide station list"
        parts = []
        if it.get("group") == "station":
            parts.append("station CSV: " + ", ".join({"partial": "partial-filled (quality-controlled, gaps estimated)", "raw": "unfilled (as reported)"}.get(f, f) for f in it.get("station_fills") or []))
        else:
            parts.append("files: " + ", ".join(it.get("files") or []))
        lines.append(f"- **{it['label']}** — {n:,} file{'s' if n != 1 else ''}; {'; '.join(parts)}; extent {extents}; dates {it['start']} to {it['end']} by {it['period']}."
                     + (f" {it['why'][0].upper() + it['why'][1:]}." if it.get("why") else "") + (f" Note: {it['note']}." if it.get("note") else ""))
    lines += ["", f"About {total:,} data files in all." if total else "", ""]
    if reports:
        lines += ["## From the storm report", ""] + [f"- {r['label']}: {r.get('url', '')}" + (f" — {r['why']}" if r.get("why") else "") for r in reports] + [""]
    lines += ["## File naming", "",
              "HCDP names every file after what it is: `<datatype>_<production or aggregation>_<period>_<extent>_<file>_<YYYY>[_<MM>[_<DD>]]`, "
              "for example `rainfall_new_day_ka_data_map_2026_09_07.tif` is the contemporary (\"new\") daily rainfall map for Kauaʻi County on 7 September 2026. "
              "Folders follow the same order. Extent codes: statewide; bi = Hawaiʻi Island; mn = Maui County (Maui, Molokaʻi, Lānaʻi); oa = Oʻahu; ka = Kauaʻi. "
              "Files: data_map = the gridded estimate (GeoTIFF); se = its standard error; anom = the anomaly against the long-term mean; anom_se = the anomaly's standard error; "
              "metadata = production notes and error metrics (text); station_data = the station values as CSV (one file per month for daily data, per year for monthly data; "
              "partial = quality-controlled with some gaps estimated, raw = as the stations reported them). HCDP adds its licence file to emailed packages.", "",
              "## Units", ""]
    lines += [", ".join(f"{PRODUCT_BY_ID[p]['label']}: {UNIT_WORDS.get(PRODUCT_BY_ID[p]['units'], PRODUCT_BY_ID[p]['units'])}" for p in dict.fromkeys(it["product"] for it in data)) + "." if data else "", "",
              "GeoTIFFs are georeferenced rasters readable in QGIS, ArcGIS, rasterio or GDAL; station CSVs are plain text tables.", ""]
    lines += ["## How to cite", "", f"Data: Hawaiʻi Climate Data Portal (HCDP), {HCDP_HOME}", "", HCDP_CITATION, "",
              f"Each product's own citation is on HCDP's How to Cite page: {HOW_TO_CITE}. Licence: CC BY-NC-ND 4.0 ({LICENCE}).", "",
              "## This package", "", f"Re-open or share this list: {package_url}", "", f"Analyze with AI: {analyze_url}", "",
              "Prepared by HCDP with AI. If something is missing, re-open the list above and tick more, or ask the AI for something else.", ""]
    return "\n".join(lines)


# ----- the zip (instant) and the emailed package --------------------------------------------
def hcdp_refusal(status: int, text: str) -> PrepareError:
    said = " ".join((text or "").split())
    said = "" if not said or said.startswith("<") else said[:300]
    if status in (401, 403):
        return PrepareError(401, f"HCDP did not accept that API key (it answered {status}). Check the key, or request one on HCDP's API page.")
    return PrepareError(502, f"HCDP returned {status} for this package" + (f": {said}" if said else ""))


async def fetch_zip(client: httpx.AsyncClient, payload: dict, max_bytes: int, tmp_dir: Path) -> Path:
    """POST HCDP /genzip/instant/content with `client` (the VISITOR's key in its headers) and spool the zip to a temp file,
    stopping at `max_bytes`; the caller adds the README and streams the file back, then deletes it. Memory stays bounded."""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        resp = await client.send(client.build_request("POST", "/genzip/instant/content", json=payload), stream=True)
    except httpx.HTTPError as e:
        raise PrepareError(502, f"HCDP did not answer ({type(e).__name__})") from None
    try:
        if resp.status_code != 200:
            await resp.aread()
            raise hcdp_refusal(resp.status_code, resp.text)
        length = resp.headers.get("content-length")
        if length and length.isdigit() and int(length) > max_bytes:
            raise PrepareError(413, f"this package is {int(length) / 1048576:,.0f} MB, more than this site streams ({max_bytes / 1048576:,.0f} MB) — have it emailed instead")
        fd = tempfile.NamedTemporaryFile(prefix="hcdp-ai-", suffix=".zip", dir=tmp_dir, delete=False)
        path = Path(fd.name)
        size = 0
        try:
            with fd:
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise PrepareError(413, f"this package passed {max_bytes / 1048576:,.0f} MB, more than this site streams — have it emailed instead")
                    fd.write(chunk)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    finally:
        await resp.aclose()
    if size == 0:
        path.unlink(missing_ok=True)
        raise PrepareError(502, "HCDP found no files for this package (it answered with an empty zip); the dates may not be published yet")
    if not zipfile.is_zipfile(path):
        path.unlink(missing_ok=True)
        raise PrepareError(502, "HCDP sent something that is not a zip file")
    return path


def add_readme(path: Path, text: str, name: str = "README.md") -> None:
    """Append README.md to a zip in place (Python rewrites only the central directory; the data stays where it is)."""
    with zipfile.ZipFile(path, "a", compression=zipfile.ZIP_DEFLATED) as z:
        info = zipfile.ZipInfo(name, date_time=dt.datetime.now(HST).timetuple()[:6])
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, text.encode("utf-8"))


async def email_request(client: httpx.AsyncClient, payload: dict) -> None:
    """POST HCDP /genzip/email with the visitor's key; HCDP zips on its side and mails a link (valid three days)."""
    try:
        r = await client.post("/genzip/email", json=payload)
    except httpx.HTTPError as e:
        raise PrepareError(502, f"HCDP did not answer ({type(e).__name__})") from None
    if r.status_code not in (200, 202):
        raise hcdp_refusal(r.status_code, r.text)


def check_email_size(files: int) -> None:
    if files > EMAIL_MAX_FILES:
        raise PrepareError(413, f"about {files:,} files is more than one package can hold ({EMAIL_MAX_FILES:,}); narrow the dates or the files")
