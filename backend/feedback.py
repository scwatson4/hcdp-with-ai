"""Feedback (P4 A "Wrong page?", 13 Oct; the review-period feedback feature, F1–F5, 13 Oct).

Two tables in one SQLite file:

`wrong_page` (P4 A) — at the bottom of an AI overview the visitor can say "Wrong page?" and pick the page they wanted:
one of the answer's alternatives, or "Other…" with a line of text. Each report is one row: the ask, the navigator's
reply, the destination it opened, the overview's request id, and what was wanted. Within the next ten minutes the
client attaches the next navigation the visitor made (`chose_path`), once.

`feedback` (F1–F5) — everything the HCDP team's reviewers say about the site: a thumbs up or down on an AI answer or
an AI overview (`kind` thumbs, with the exchange attached), a note on a selected passage (`kind` selection, with the
quote), a note from the right-edge "Give feedback" tab (`kind` tab, with a feature picked), or a 👎 that named the page
that was wanted (`kind` thumbs, `rating` down, `wanted`). Every row carries the page (path + title), the feature it is
about, the free text, the reviewer's name (a review-period convenience — the browser remembers it; it is not an
identity) and the team's triage: `status` new | reviewed | fixed | wontfix and an `admin_note`.

The admin reads both tables as ONE review list (`review`), with a CSV and an export of the 👎 / wrong-page rows that
named a page as navigator eval cases shaped like backend/data/usecases.json entries. Nothing about the visitor is
stored: no address, no user agent, no cookie, no id.

SQLite at FEEDBACK_DB (/app/data/feedback.sqlite in the container, on the `feedback_data` volume; backend/cache/
feedback.sqlite in development), WAL, one short-lived connection per call behind a lock — two uvicorn workers
share the file safely at this volume.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import sqlite3
import threading
import uuid
from pathlib import Path

ID_RE = re.compile(r"^[0-9a-f]{32}$")
COLUMNS = ["id", "created_at", "ask", "reply", "destination", "overview_id", "wanted_title", "wanted_url", "wanted_text", "chose_path", "chose_at"]
CSV_HEADER = ["id", "when", "ask", "reply", "destination", "overview_id", "wanted_title", "wanted_url", "wanted_text", "chose_instead", "chose_at"]
MAX_ROWS = 500

# ── the review-period feedback (F1–F5) ───────────────────────────────────────
KINDS = ("thumbs", "selection", "tab", "wrong_page")
RATINGS = ("up", "down")
# The feature picker: AI answer · Navigation result · AI Overview · Maps viewer · Downloads · Feedback itself · A page · Other
FEATURES = ("answer", "navigation", "overview", "viewer", "downloads", "feedback", "page", "other")
FEATURE_LABELS = {"answer": "AI answer", "navigation": "Navigation result", "overview": "AI Overview", "viewer": "Maps viewer", "downloads": "Downloads",
                  "feedback": "Feedback itself", "page": "A page", "other": "Other"}
STATUSES = ("new", "reviewed", "fixed", "wontfix")
FEEDBACK_COLUMNS = ["id", "created_at", "kind", "rating", "feature", "page_path", "page_title", "quote", "ask", "reply", "overview_id", "wanted", "text",
                    "reviewer_name", "status", "admin_note", "updated_at"]
# The unified review row (both tables), and its CSV header.
REVIEW_COLUMNS = ["id", "created_at", "kind", "rating", "feature", "page_path", "page_title", "quote", "ask", "reply", "overview_id", "wanted_title", "wanted_url",
                  "wanted_text", "chose_path", "text", "reviewer_name", "status", "admin_note", "updated_at"]
REVIEW_CSV_HEADER = ["id", "when", "kind", "rating", "feature", "page_path", "page_title", "quote", "ask", "reply", "overview_id", "wanted_title", "wanted_url",
                     "wanted_text", "chose_instead", "text", "reviewer_name", "status", "admin_note", "updated_at"]
TITLE_LEN = 80


def _now() -> str:
    # milliseconds, so the review list can interleave the two tables newest first (rows written before 14 Oct carry seconds)
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _when_key(ts) -> str:
    """A sort key that orders second- and millisecond-precision stamps together ("…:05Z" reads as "…:05.000")."""
    t = str(ts or "").rstrip("Z")
    return t + ".000" if len(t) == 19 else t


def _wanted_from(title, url, text) -> dict | None:
    if url:
        return {"title": title or None, "url": url}
    if text:
        return {"text": text}
    return None


def _wanted_json(wanted: dict | None) -> str | None:
    if not isinstance(wanted, dict):
        return None
    if wanted.get("url"):
        return json.dumps({"title": wanted.get("title") or None, "url": wanted["url"]}, ensure_ascii=False)
    if wanted.get("text"):
        return json.dumps({"text": wanted["text"]}, ensure_ascii=False)
    return None


def _wanted_parse(raw) -> dict | None:
    if not raw:
        return None
    try:
        w = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return w if isinstance(w, dict) and (w.get("url") or w.get("text")) else None


def item_title(row: dict) -> str:
    """One line that names a row without naming anyone: its text, else its quote, else what kind of thing it was."""
    for k in ("text", "quote"):
        v = (row.get(k) or "").strip()
        if v:
            v = " ".join(v.split())
            return v if len(v) <= TITLE_LEN else v[: TITLE_LEN - 1].rstrip() + "…"
    w = row.get("wanted") if isinstance(row.get("wanted"), dict) else None
    if row.get("kind") == "wrong_page" or (row.get("kind") == "thumbs" and row.get("rating") == "down" and w):
        want = (w or {}).get("title") or (w or {}).get("text") or (w or {}).get("url") or "another page"
        return f"Wrong page — wanted {want}"[:TITLE_LEN]
    feature = FEATURE_LABELS.get(row.get("feature") or "", "the site")
    if row.get("kind") == "thumbs":
        return f"Thumbs {'up' if row.get('rating') == 'up' else 'down'} on {'an' if feature[:1].lower() in 'aeiou' else 'a'} {feature}"
    return f"Feedback on {feature}"


def _catalog_ids_for(catalog: list[dict], ref: str | None) -> list[str]:
    """Catalog ids whose url or internal_path is `ref` (a viewer address matches its template), in catalog order."""
    if not isinstance(ref, str) or not ref:
        return []
    r = ref.rstrip("/")
    base = r.split("#", 1)[0]
    ids: list[str] = []
    for e in catalog or []:
        hit = False
        u = e.get("url")
        if isinstance(u, str) and u and u.rstrip("/") == r:
            hit = True
        ip = e.get("internal_path")
        if isinstance(ip, str) and ip:
            if "{" in ip:
                head = ip.split("{")[0]
                if head and base.startswith(head):
                    hit = True
            elif ip in (r, base) or ip.split("#", 1)[0] == base:
                hit = True
        if hit and e.get("id") and e["id"] not in ids:
            ids.append(e["id"])
    return ids


def eval_cases(rows: list[dict], catalog: list[dict] | None = None) -> list[dict]:
    """The 👎 and wrong-page rows that named a PAGE they wanted, as navigator eval cases shaped like the entries of
    backend/data/usecases.json ({id, persona, query, expected_intent, expected_ids, expected_path_prefix, notes}),
    ready to paste. Rows without an ask or without a wanted page are left out."""
    out = []
    for r in rows:
        w = r.get("wanted") if isinstance(r.get("wanted"), dict) else None
        wrong = r.get("kind") == "wrong_page" or (r.get("kind") == "thumbs" and r.get("rating") == "down")
        ask = (r.get("ask") or "").strip()
        if not wrong or not w or not w.get("url") or not ask:
            continue
        url = w["url"]
        # every usecases.json entry carries expected_ids (eval_usecases.py judges by it or by expected_path_prefix); an
        # HCDP url the catalog does not know keeps it empty and says what was wanted in expected_url
        case = {"id": f"feedback-{r['id'][:8]}", "persona": "reviewer", "query": ask, "expected_intent": "navigate",
                "expected_ids": _catalog_ids_for(catalog or [], url)}
        ids = case["expected_ids"]
        if url.startswith("/"):
            case["expected_path_prefix"] = url.split("#", 1)[0]
        elif not ids:
            case["expected_url"] = url
        opened = r.get("page_path") or ""
        bits = [f"Reviewer feedback {str(r.get('created_at') or '')[:10]}".strip()]
        if opened:
            bits.append(f"the assistant opened {opened}")
        bits.append(f"wanted {w.get('title') or url}")
        text = (r.get("text") or "").strip()
        if text:
            bits.append(f"note: {text}")
        case["notes"] = "; ".join(bits) + "."
        out.append(case)
    return out


class FeedbackStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        with self._lock, self._connect() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute(
                "CREATE TABLE IF NOT EXISTS wrong_page (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ask TEXT, reply TEXT, destination TEXT, "
                "overview_id TEXT, wanted_title TEXT, wanted_url TEXT, wanted_text TEXT, chose_path TEXT, chose_at TEXT)"
            )
            # F3 A: the wrong-page reports are reviewed in the same list as everything else, so they carry the triage columns too.
            have = {r["name"] for r in c.execute("PRAGMA table_info(wrong_page)").fetchall()}
            for col, decl in (("status", "TEXT NOT NULL DEFAULT 'new'"), ("admin_note", "TEXT"), ("updated_at", "TEXT")):
                if col not in have:
                    c.execute(f"ALTER TABLE wrong_page ADD COLUMN {col} {decl}")
            c.execute(
                "CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL, rating TEXT, feature TEXT, page_path TEXT, "
                "page_title TEXT, quote TEXT, ask TEXT, reply TEXT, overview_id TEXT, wanted TEXT, text TEXT, reviewer_name TEXT, status TEXT NOT NULL DEFAULT 'new', "
                "admin_note TEXT, updated_at TEXT)"
            )
            c.execute("CREATE INDEX IF NOT EXISTS feedback_reviewer ON feedback (reviewer_name)")

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(self.path, timeout=5)
        c.row_factory = sqlite3.Row
        return c

    # ----- writes (wrong page) --------------------------------------------------
    def record(self, ask: str, reply: str, destination: str, overview_id: str | None, wanted: dict) -> str:
        """One "wrong page" report; returns its id (32 hex characters)."""
        fid = uuid.uuid4().hex
        with self._lock, self._connect() as c:
            c.execute(
                "INSERT INTO wrong_page (id, created_at, ask, reply, destination, overview_id, wanted_title, wanted_url, wanted_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (fid, _now(), ask or "", reply or "", destination or "", overview_id or None, wanted.get("title") or None, wanted.get("url") or None, wanted.get("text") or None),
            )
        return fid

    def attach_choice(self, fid: str, path: str) -> bool:
        """The page the visitor went to next — attached once; False for an unknown id or a report that already has one."""
        if not ID_RE.match(fid or ""):
            return False
        with self._lock, self._connect() as c:
            cur = c.execute("UPDATE wrong_page SET chose_path = ?, chose_at = ? WHERE id = ? AND chose_path IS NULL", (path, _now(), fid))
            return cur.rowcount == 1

    # ----- reads (the admin, wrong page) -----------------------------------------
    def rows(self, limit: int = MAX_ROWS) -> list[dict]:
        with self._lock, self._connect() as c:
            cur = c.execute(f"SELECT {', '.join(COLUMNS)} FROM wrong_page ORDER BY created_at DESC, rowid DESC LIMIT ?", (max(1, min(int(limit), 5000)),))
            return [dict(r) for r in cur.fetchall()]

    def count(self) -> int:
        with self._lock, self._connect() as c:
            return int(c.execute("SELECT COUNT(*) FROM wrong_page").fetchone()[0])

    def csv(self) -> str:
        """Every wrong-page row, newest first, with a header (Excel-friendly: a BOM first)."""
        out = io.StringIO()
        out.write("﻿")
        w = csv.writer(out, lineterminator="\r\n")
        w.writerow(CSV_HEADER)
        for r in self.rows(5000):
            w.writerow([r[k] if r[k] is not None else "" for k in COLUMNS])
        return out.getvalue()

    # ----- writes (feedback, F1–F5) ----------------------------------------------
    def add(self, item: dict) -> str:
        """One feedback item (validated by the endpoint); returns its id. `wanted` is {title, url} | {text} | None."""
        fid = uuid.uuid4().hex
        with self._lock, self._connect() as c:
            c.execute(
                "INSERT INTO feedback (id, created_at, kind, rating, feature, page_path, page_title, quote, ask, reply, overview_id, wanted, text, reviewer_name, status) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')",
                (fid, _now(), item.get("kind") or "tab", item.get("rating") or None, item.get("feature") or "other", item.get("page_path") or None,
                 item.get("page_title") or None, item.get("quote") or None, item.get("ask") or None, item.get("reply") or None, item.get("overview_id") or None,
                 _wanted_json(item.get("wanted")), item.get("text") or None, (item.get("reviewer_name") or "").strip() or None),
            )
        return fid

    def rename(self, old: str, new: str) -> int:
        """The reviewer changed their name: every item under the old name (case-insensitive) is relabelled. Returns the count."""
        old, new = (old or "").strip(), (new or "").strip()
        if not old or not new:
            return 0
        with self._lock, self._connect() as c:
            cur = c.execute("UPDATE feedback SET reviewer_name = ?, updated_at = ? WHERE lower(reviewer_name) = lower(?)", (new, _now(), old))
            return cur.rowcount

    def set_status(self, fid: str, status: str | None = None, admin_note: str | None = None) -> dict | None:
        """The team's triage on one row of either table; returns the unified row, or None for an unknown id."""
        if not ID_RE.match(fid or "") or (status is not None and status not in STATUSES):
            return None
        sets, args = ["updated_at = ?"], [_now()]
        if status is not None:
            sets.append("status = ?"); args.append(status)
        if admin_note is not None:
            sets.append("admin_note = ?"); args.append(admin_note.strip() or None)
        with self._lock, self._connect() as c:
            for table in ("feedback", "wrong_page"):
                cur = c.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE id = ?", (*args, fid))
                if cur.rowcount == 1:
                    break
            else:
                return None
        return self.find(fid)

    def delete(self, fid: str) -> bool:
        """Remove one row of either table for good (an admin action, meant for smoke-test and sample entries);
        True when a row went."""
        if not ID_RE.match(fid or ""):
            return False
        with self._lock, self._connect() as c:
            for table in ("feedback", "wrong_page"):
                if c.execute(f"DELETE FROM {table} WHERE id = ?", (fid,)).rowcount == 1:
                    return True
        return False

    # ----- reads (feedback) --------------------------------------------------------
    def _feedback_rows(self, c: sqlite3.Connection, where: str = "", args: tuple = (), limit: int = MAX_ROWS) -> list[dict]:
        cur = c.execute(f"SELECT {', '.join(FEEDBACK_COLUMNS)} FROM feedback {where} ORDER BY created_at DESC, rowid DESC LIMIT ?", (*args, max(1, min(int(limit), 5000))))
        out = []
        for r in cur.fetchall():
            d = dict(r)
            d["wanted"] = _wanted_parse(d.get("wanted"))
            d["chose_path"] = None
            out.append(d)
        return out

    def _wrong_rows(self, c: sqlite3.Connection, limit: int = MAX_ROWS) -> list[dict]:
        cur = c.execute(f"SELECT {', '.join(COLUMNS)}, status, admin_note, updated_at FROM wrong_page ORDER BY created_at DESC, rowid DESC LIMIT ?", (max(1, min(int(limit), 5000)),))
        out = []
        for r in cur.fetchall():
            d = dict(r)
            out.append({
                "id": d["id"], "created_at": d["created_at"], "kind": "wrong_page", "rating": None, "feature": "navigation", "page_path": d.get("destination"),
                "page_title": None, "quote": None, "ask": d.get("ask"), "reply": d.get("reply"), "overview_id": d.get("overview_id"),
                "wanted": _wanted_from(d.get("wanted_title"), d.get("wanted_url"), d.get("wanted_text")), "chose_path": d.get("chose_path"), "text": None,
                "reviewer_name": None, "status": d.get("status") or "new", "admin_note": d.get("admin_note"), "updated_at": d.get("updated_at"),
            })
        return out

    def count_items(self) -> int:
        with self._lock, self._connect() as c:
            return int(c.execute("SELECT COUNT(*) FROM feedback").fetchone()[0])

    def find(self, fid: str) -> dict | None:
        """One unified row from either table."""
        if not ID_RE.match(fid or ""):
            return None
        with self._lock, self._connect() as c:
            rows = self._feedback_rows(c, "WHERE id = ?", (fid,), 1)
            if rows:
                return rows[0]
            return next((r for r in self._wrong_rows(c, 5000) if r["id"] == fid), None)

    def mine(self, name: str, limit: int = 200) -> list[dict]:
        """The reviewer's own items (by name, case-insensitive), newest first — without the team's note."""
        name = (name or "").strip()
        if not name:
            return []
        with self._lock, self._connect() as c:
            rows = self._feedback_rows(c, "WHERE lower(reviewer_name) = lower(?)", (name,), limit)
        for r in rows:
            r.pop("admin_note", None)
            r["title"] = item_title(r)
        return rows

    def names(self, limit: int = 50) -> list[str]:
        """The reviewer names already saved with feedback (most recent first, case-insensitive duplicates folded), for
        the panel's name picker (15 Oct)."""
        with self._lock, self._connect() as c:
            cur = c.execute("SELECT reviewer_name, MAX(created_at) AS last FROM feedback WHERE reviewer_name IS NOT NULL AND trim(reviewer_name) != '' "
                            "GROUP BY lower(trim(reviewer_name)) ORDER BY last DESC LIMIT ?", (max(1, min(int(limit), 500)),))
            return [str(r[0]).strip() for r in cur.fetchall()]

    def others(self, exclude_name: str | None = None, limit: int = 200) -> list[dict]:
        """Everyone else's items as titles and statuses only — no names, no text, no quotes beyond the title line; the
        anonymous wrong-page reports count as others."""
        ex = (exclude_name or "").strip()
        with self._lock, self._connect() as c:
            if ex:
                rows = self._feedback_rows(c, "WHERE reviewer_name IS NULL OR lower(reviewer_name) != lower(?)", (ex,), limit)
            else:
                rows = self._feedback_rows(c, "", (), limit)
            rows = rows + self._wrong_rows(c, limit)
        rows.sort(key=lambda r: _when_key(r["created_at"]), reverse=True)
        return [{"id": r["id"], "created_at": r["created_at"], "kind": r["kind"], "rating": r["rating"], "feature": r["feature"], "page_path": r["page_path"],
                 "title": item_title(r), "status": r["status"]} for r in rows[: max(1, min(int(limit), 5000))]]

    def review(self, kind: str | None = None, feature: str | None = None, status: str | None = None, limit: int = MAX_ROWS) -> list[dict]:
        """The admin's unified list over both tables, newest first, optionally filtered by kind, feature and status."""
        with self._lock, self._connect() as c:
            rows = self._feedback_rows(c, "", (), 5000) + self._wrong_rows(c, 5000)
        if kind:
            rows = [r for r in rows if r["kind"] == kind]
        if feature:
            rows = [r for r in rows if r["feature"] == feature]
        if status:
            rows = [r for r in rows if r["status"] == status]
        rows.sort(key=lambda r: _when_key(r["created_at"]), reverse=True)
        return rows[: max(1, min(int(limit), 5000))]

    def review_counts(self) -> dict:
        """Totals for the admin page: everything, and by status, kind and feature."""
        rows = self.review(limit=5000)
        by = lambda key: {k: sum(1 for r in rows if (r.get(key) or "") == k) for k in sorted({r.get(key) or "" for r in rows}) if k}  # noqa: E731
        thumbs = [r for r in rows if r.get("kind") == "thumbs"]
        return {"total": len(rows), "by_status": by("status"), "by_kind": by("kind"), "by_feature": by("feature"),
                # the thumbs verdicts (the AI interface's ▲ up · ▼ down), overall and by feature (answer / overview)
                "thumbs": {"up": sum(1 for r in thumbs if r.get("rating") == "up"), "down": sum(1 for r in thumbs if r.get("rating") == "down"),
                           "by_feature": {f: {"up": sum(1 for r in thumbs if r.get("feature") == f and r.get("rating") == "up"),
                                              "down": sum(1 for r in thumbs if r.get("feature") == f and r.get("rating") == "down")}
                                          for f in sorted({r.get("feature") or "" for r in thumbs}) if f}}}

    @staticmethod
    def review_csv(rows: list[dict]) -> str:
        """The unified rows as CSV with a header (a BOM first, for Excel)."""
        out = io.StringIO()
        out.write("﻿")
        w = csv.writer(out, lineterminator="\r\n")
        w.writerow(REVIEW_CSV_HEADER)
        for r in rows:
            wd = r.get("wanted") if isinstance(r.get("wanted"), dict) else {}
            flat = {**r, "wanted_title": wd.get("title"), "wanted_url": wd.get("url"), "wanted_text": wd.get("text")}
            w.writerow([flat.get(k) if flat.get(k) is not None else "" for k in REVIEW_COLUMNS])
        return out.getvalue()
