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

from llm import FOLLOWUPS_SYSTEM, SUMMARY_SYSTEM
from navigator import describe_view, parse_viewer_path, valid_internal_path

MAX_WORDS = 60
MAX_MORE_WORDS = 80
MAX_FOLLOWUPS = 3
MAX_FOLLOWUP_CHARS = 90
EMPTY = {"summary": "", "chunks": [], "cites": [], "more": [], "more_cites": [], "sources": [], "followups": []}
# Intents whose answer never gets a summary: the scope guard's reply and the hand-off to the AI interface.
NO_SUMMARY_INTENTS = {"off_topic", "analysis"}

# What kind of page the destination is, told to the model so "what to do next" fits it.
PAGE_HINTS = {
    "/data": "the Access Data page: what HCDP's data portal offers, the datasets, quick maps, and the Export form for downloading grids and station files",
    "/data/api": "the API page: how to get a token and where the documentation is",
    "/data/tutorials": "the tutorials page",
    "/mesonet": "the Hawaiʻi Mesonet page, with the live station viewer embedded (a station can be picked)",
    "/climate-summary": "the Monthly Climate Summary page, with the summary app embedded",
    "/pacific": "the Pacific Portal page (American Samoa, Guam and the wider Pacific)",
    "/extreme-events": "the Extreme Events page: every storm report and tracker, each with its official links and viewer maps",
    "/tools": "the Climate Tools page: a tile per tool, each opening the tool itself",
}
KIND_HINTS = {
    "event": "a storm's section on the Extreme Events page: the story, key figures, official HCDP links and viewer maps for its days",
    "tool": "a tool's tile on the Climate Tools page, with its description and the link that opens the tool",
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


def clean_text(text) -> str:
    """Plain words only: markdown marks, links and URLs gone, whitespace collapsed; citation markers kept."""
    if not isinstance(text, str):
        return ""
    t = _MD_RE.sub(lambda m: m.group(1) or "", text)
    t = _URL_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", t)


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


def clean_cited(text, max_words: int, n_sources: int = 0) -> tuple[list[str], list[list[int]]]:
    """The sentences of a model paragraph with their citations: markdown and URLs stripped, the markers pulled out
    (aligned lists), the whole trimmed to the word budget at a sentence boundary (the first sentence is always kept,
    cut hard if it alone is over budget)."""
    t = _MARK_AFTER_STOP_RE.sub(lambda m: m.group(2) + m.group(1), clean_text(text))
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
        chunks, cites = clean_cited(raw.get("summary"), MAX_WORDS, len(sources))
        if not chunks:
            return empty_summary()
        more, more_cites = clean_cited(raw.get("more"), MAX_MORE_WORDS, len(sources))
        return {"summary": " ".join(chunks), "chunks": chunks, "cites": cites, "more": more, "more_cites": more_cites,
                "sources": sources, "followups": clean_followups(raw.get("followups"))}

    # ----- follow-ups alone -------------------------------------------------
    def followups_for(self, path: str, context: dict | None = None) -> list[str]:
        """Three follow-up asks for a page, without a summary (the same model call shape, `followups` only). Reserved
        for the follow-ups-that-follow-the-view feature; empty for an invalid path or a failed call."""
        if not valid_internal_path(path or "") or self.llm is None or not getattr(self.llm, "configured", False):
            return []
        _, grounding = self.describe_destination(path, context)
        raw = self.llm.complete(FOLLOWUPS_SYSTEM, grounding, max_completion_tokens=200)
        return clean_followups((raw or {}).get("followups")) if isinstance(raw, dict) else []
