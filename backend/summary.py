"""The AI overview shown at the top of a destination page, and the follow-up asks (13 Oct).

After the navigator takes a visitor somewhere, the page opens with a short "AI Overview" block: the
real HCDP pages behind the destination (resolved from the catalog here, never by the model, and
numbered), two or three plain sentences from gpt-6-luna saying why they were brought here, what the
page shows and what to do next — each ending with the numbers of the sources it rests on, which are
stripped out here and returned as `cites` — a few "more" sentences for the Show more fold, and three
follow-up asks for the docked bar's carousel. The model only ever sees the ask, the navigator's
reply, the destination's catalog entry and the numbered source titles, so the text stays grounded;
everything it returns is validated and trimmed here. Any failure answers empty, and the client falls
back to its reply strip.
"""
from __future__ import annotations

import datetime as dt
import re

from llm import FOLLOWUPS_SYSTEM, PAGE_OVERVIEW_SYSTEM, SUMMARY_SYSTEM
from navigator import describe_view, parse_viewer_path, valid_internal_path

MAX_WORDS = 60
MAX_MORE_WORDS = 80
MAX_FOLLOWUPS = 3
MAX_FOLLOWUP_CHARS = 90
MAX_BOLD = 3            # key terms the model may wrap in **…** across the summary and the "more" sentences (14 Oct)
PAGE_EXCERPT_CHARS = 1500
EMPTY = {"summary": "", "chunks": [], "cites": [], "more": [], "more_cites": [], "sources": [], "followups": []}
# Intents whose answer never gets a summary: the scope guard's reply and the hand-off to the AI interface.
NO_SUMMARY_INTENTS = {"off_topic", "analysis"}

# What kind of page the destination is, told to the model so "what to do next" fits it.
PAGE_HINTS = {
    "/data": "the Access Data page: what HCDP's data portal offers, the datasets, quick maps, and the Export form for downloading grids and station files",
    "/data/api": "HCDP's API page (copied live from the portal): how to request an API token with the form, and where the documentation is",
    "/data/tutorials": "HCDP's Tutorials page (copied live from the portal): step-by-step guides to making a map, exploring station data and exporting data",
    "/mesonet": "HCDP's Hawaiʻi Mesonet page (copied live from the portal): what the statewide station network is, why it is needed, what each station measures and who pays for it, with a link to the live data",
    "/climate-summary": "the Monthly Climate Summary app, embedded full screen as on the portal (a month can be chosen in it)",
    "/pacific": "HCDP's Pacific Portal page (copied live from the portal): the Pacific Islands data, regional organizations, countries and territories, and tools",
    "/extreme-events": "HCDP's Extreme Events page (copied live from the portal): a card per storm report — Hurricane Nolo, Hurricane Lowell, Hurricane Lala and the two March 2026 Kona lows — each opening that report",
    "/tools": "HCDP's Climate Tools page (copied live from the portal): a picture tile per tool, each opening the tool itself",
    "/library": "HCDP's Library: the portal's publications list from its Zotero group, by year",
}
KIND_HINTS = {
    "event": "a storm's report: HCDP's interactive storm report embedded full screen, as on the portal (maps, charts and station data for the storm)",
    "tool": "a tool's tile on HCDP's Climate Tools page, with its description and the link that opens the tool",
    "page": "an information page",
    "api": "the API page",
    "atlas": "an atlas tool's tile on the Climate Tools page",
    "dataset": "the Access Data page",
}
VIEWER_HINT = ("an interactive climate map in this site's viewer: the visitor can change the dataset, period, date and island, "
               "the colours and layers, turn on the stations and pick one for its record, compare two dates, download the map and "
               "share the address")

_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
_MD_RE = re.compile(r"[*_`#>]+|\[([^\]\d,\s][^\]]*)\]\([^)]*\)")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZĀĒĪŌŪʻ(\"“0-9])")
# A citation marker: [1], [1, 2], [1][2]; moved inside the sentence's full stop before splitting, then pulled out.
_MARK_RE = re.compile(r"\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\]")
_MARK_AFTER_STOP_RE = re.compile(r"([.!?])((?:\s*\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\])+)")


_BOLD_RE = re.compile(r"\*\*\s*([^*\n]{1,60}?)\s*\*\*")
_B_OPEN, _B_CLOSE = "\x01", "\x02"


def keep_bold(text: str, budget: list[int] | None) -> str:
    """Up to budget[0] **key terms** (words with a letter, at most 60 characters) protected from the markdown cleaning;
    the rest unwrapped. `budget` is a one-item list shared by the summary and the "more" sentences; None keeps none."""
    def one(m):
        term = m.group(1).strip()
        if budget is not None and budget[0] > 0 and re.search(r"[A-Za-zĀĒĪŌŪāēīōūʻ]", term):
            budget[0] -= 1
            return f"{_B_OPEN}{term}{_B_CLOSE}"
        return term
    return _BOLD_RE.sub(one, text)


def clean_text(text, bold: list[int] | None = None) -> str:
    """Plain words only: markdown marks, links and URLs gone, whitespace collapsed; citation markers kept; up to
    `bold` key terms kept as **term** (the client renders them bold), every other asterisk stripped."""
    if not isinstance(text, str):
        return ""
    t = keep_bold(text, bold)
    t = _MD_RE.sub(lambda m: m.group(1) or "", t)
    t = _URL_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([.,;:!?])", r"\1", t)
    return t.replace(_B_OPEN, "**").replace(_B_CLOSE, "**")


def split_sentences(text: str) -> list[str]:
    """The sentences of a short plain paragraph (the client fades them in one by one)."""
    return [s.strip() for s in _SENTENCE_RE.split(text or "") if s.strip()]


def extract_cites(sentence: str, n_sources: int) -> tuple[str, list[int]]:
    """'… the storm [1, 2].' → ('… the storm.', [1, 2]); numbers outside 1..n_sources are dropped, duplicates too."""
    cites: list[int] = []
    for m in _MARK_RE.finditer(sentence):
        for num in re.findall(r"\d+", m.group(0)):
            k = int(num)
            if 1 <= k <= n_sources and k not in cites:
                cites.append(k)
    text = _MARK_RE.sub("", sentence)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return text, cites


def clean_cited(text, max_words: int, n_sources: int = 0, bold: list[int] | None = None) -> tuple[list[str], list[list[int]]]:
    """The sentences of a model paragraph with their citations: markdown and URLs stripped (up to `bold` key terms kept
    as **term**), the markers pulled out (aligned lists), the whole trimmed to the word budget at a sentence boundary (the
    first sentence is always kept, cut hard if it alone is over budget)."""
    t = _MARK_AFTER_STOP_RE.sub(lambda m: m.group(2) + m.group(1), clean_text(text, bold))
    chunks: list[str] = []
    cites: list[list[int]] = []
    words = 0
    for raw in split_sentences(t):
        s, c = extract_cites(raw, n_sources)
        if not s or not re.search(r"[A-Za-zĀĒĪŌŪāēīōūʻ0-9]", s):
            continue
        n = len(s.split())
        if chunks and words + n > max_words:
            break
        if not chunks and n > max_words:
            s = " ".join(s.split()[:max_words]).rstrip(",;:") + "…"
            if s.count("**") % 2:
                s = s.replace("**", "")   # the cut fell inside a key term: no half-bold
            n = max_words
        chunks.append(s)
        cites.append(c)
        words += n
    return chunks, cites


def clean_summary(text, max_words: int = MAX_WORDS) -> list[str]:
    """The summary's sentences without their markers (the chunks the client fades in)."""
    return clean_cited(text, max_words, 0)[0]


def clean_followups(items) -> list[str]:
    """Up to three distinct short asks, each a string of at most 90 characters, plain words only."""
    out: list[str] = []
    seen: set[str] = set()
    for it in items if isinstance(items, list) else []:
        s = clean_text(it)
        s = _MARK_RE.sub("", s).strip().strip("-•· ").strip()
        if not s or len(s) > MAX_FOLLOWUP_CHARS or s.lower() in seen:
            continue
        seen.add(s.lower())
        out.append(s)
        if len(out) == MAX_FOLLOWUPS:
            break
    return out


def page_hint(path: str, entry: dict | None) -> str:
    base = (path or "").split("#", 1)[0].partition("?")[0]
    if parse_viewer_path(path or ""):
        return VIEWER_HINT
    if base in PAGE_HINTS:
        return PAGE_HINTS[base]
    return KIND_HINTS.get((entry or {}).get("kind") or "", "a page on this site")


def empty_summary() -> dict:
    return {k: (list(v) if isinstance(v, list) else v) for k, v in EMPTY.items()}


class Summarizer:
    """Grounds and validates the model's overview and follow-ups. `nav` is the Navigator (its catalog resolves the
    destination and the sources); `llm` has `configured` and `complete(system, user) -> dict | None`."""

    def __init__(self, nav, llm):
        self.nav = nav
        self.llm = llm

    # ----- grounding --------------------------------------------------------
    def dates_line(self) -> str:
        """The latest available dates, so a follow-up that names one uses yesterday (daily) or the last complete month (monthly)."""
        today = self.nav.today()
        yesterday = today - dt.timedelta(days=1)
        last_month = (today.replace(day=1) - dt.timedelta(days=1))
        return f"Dates: today is {today.isoformat()}; the newest daily map is {yesterday.isoformat()} (yesterday); the newest monthly map and summary are for {last_month.strftime('%B %Y')} ({last_month.strftime('%Y-%m')}, the last complete month)."

    def describe_destination(self, path: str, context: dict | None = None) -> tuple[dict | None, str]:
        entry = self.nav.destination(path)
        lines = [f"Destination on this site: {path}", f"Page kind: {page_hint(path, entry)}", self.dates_line()]
        v = parse_viewer_path(path)
        if v:
            lines.append(f"The map shows: {describe_view(v)}")
        elif isinstance(context, dict) and isinstance(context.get("viewer"), dict):
            lines.append(f"Viewer state: {context['viewer']}")
        if entry:
            lines.append(f"Page title: {entry.get('title', '')}")
            if entry.get("summary"):
                lines.append(f"What it is: {entry['summary']}")
            if entry.get("when_to_use"):
                lines.append(f"When it is the answer: {entry['when_to_use']}")
        return entry, "\n".join(lines)

    # ----- the overview -----------------------------------------------------
    def summarize(self, message: str, reply: str, path: str, intent: str = "navigate") -> dict:
        """{summary, chunks, cites, more, more_cites, sources, followups}; everything empty when there is nothing to
        summarise (an off-topic or analysis answer, an invalid path) or when the model fails — the client then keeps
        its reply strip."""
        if (intent or "") in NO_SUMMARY_INTENTS or not valid_internal_path(path or ""):
            return empty_summary()
        if self.llm is None or not getattr(self.llm, "configured", False):
            return empty_summary()
        sources = self.nav.sources_for(path)
        _, grounding = self.describe_destination(path)
        numbered = "\n".join(f"{i}. {s['title']}" for i, s in enumerate(sources, 1)) or "(none)"
        user = "\n".join([f"Visitor's ask: {(message or '').strip()[:500]}", f"Navigator's reply: {(reply or '').strip()[:600]}", grounding, f"Sources (cite by number):\n{numbered}"])
        raw = self.llm.complete(SUMMARY_SYSTEM, user)
        if not isinstance(raw, dict):
            return empty_summary()
        return self._shape(raw, sources) or empty_summary()

    def _shape(self, raw: dict, sources: list[dict]) -> dict | None:
        """The model's {summary, more, followups} cleaned and aligned with the sources (None when it wrote no sentence)."""
        bold = [MAX_BOLD]
        chunks, cites = clean_cited(raw.get("summary"), MAX_WORDS, len(sources), bold)
        if not chunks:
            return None
        more, more_cites = clean_cited(raw.get("more"), MAX_MORE_WORDS, len(sources), bold)
        return {"summary": " ".join(chunks), "chunks": chunks, "cites": cites, "more": more, "more_cites": more_cites,
                "sources": sources, "followups": clean_followups(raw.get("followups"))}

    # ----- the direct-load overview of a mirrored page (QB-O1 B, 14 Oct) -----
    def page_sources(self, path: str, rec: dict, limit: int = 3) -> list[dict]:
        """The page's own HCDP address first (titled as the catalog names it, else as HCDP does), then up to two related
        catalog entries."""
        url = rec.get("url") or ""
        entry = self.nav.entry_for_url(url) or self.nav.destination(path)
        out = [{"title": str((entry or {}).get("title") or rec.get("title") or url)[:120], "url": url}] if url else []
        seen = {url}
        if entry:
            for e in self.nav.related_entries(entry, seen):
                if len(out) >= limit:
                    break
                u = e.get("url")
                if isinstance(u, str) and u not in seen and self.nav.allowed_url(u):
                    seen.add(u)
                    out.append({"title": str(e.get("title") or u)[:120], "url": u})
        return out[:limit]

    def page_overview(self, path: str, rec: dict) -> dict | None:
        """The overview a mirrored page shows when it is opened directly (no ask): written once per copy from the catalog
        entry and the page's own first ~1,500 characters, with three generic follow-ups. None when the model is not
        configured or wrote nothing usable."""
        if self.llm is None or not getattr(self.llm, "configured", False) or not isinstance(rec, dict):
            return None
        sources = self.page_sources(path, rec)
        entry, grounding = self.describe_destination(path)
        excerpt = re.sub(r"\s+", " ", rec.get("text") or "")[:PAGE_EXCERPT_CHARS]
        numbered = "\n".join(f"{i}. {s['title']}" for i, s in enumerate(sources, 1)) or "(none)"
        user = "\n".join([f"Page title: {rec.get('title') or ''}", f"Grey title band on HCDP: {rec.get('band') or '(none)'}", grounding,
                          f"The page's own text (its first part):\n{excerpt}", f"Sources (cite by number):\n{numbered}"])
        raw = self.llm.complete(PAGE_OVERVIEW_SYSTEM, user)
        return self._shape(raw, sources) if isinstance(raw, dict) else None

    # ----- follow-ups alone -------------------------------------------------
    def followups_for(self, path: str, context: dict | None = None) -> list[str]:
        """Three follow-up asks for a page, without a summary (the same model call shape, `followups` only). Reserved
        for the follow-ups-that-follow-the-view feature; empty for an invalid path or a failed call."""
        if not valid_internal_path(path or "") or self.llm is None or not getattr(self.llm, "configured", False):
            return []
        _, grounding = self.describe_destination(path, context)
        raw = self.llm.complete(FOLLOWUPS_SYSTEM, grounding, max_completion_tokens=200)
        return clean_followups((raw or {}).get("followups")) if isinstance(raw, dict) else []
