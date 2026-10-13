"""Wrong-page feedback (P4 A, 13 Oct).

At the bottom of an AI overview the visitor can say "Wrong page?" and pick the page they wanted — one of the
answer's alternatives, or "Other…" with a line of text. Each report is one row here: the ask, the navigator's
reply, the destination it opened, the overview's request id, and what was wanted. Within the next ten minutes
the client attaches the next navigation the visitor made (`chose_path`), once. The admin reads the rows (and a
CSV) behind ADMIN_KEY. Nothing about the visitor is stored: no address, no user agent, no cookie, no id.

SQLite at FEEDBACK_DB (/app/data/feedback.sqlite in the container, on the `feedback_data` volume; backend/cache/
feedback.sqlite in development), WAL, one short-lived connection per call behind a lock — two uvicorn workers
share the file safely at this volume.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import re
import sqlite3
import threading
import uuid
from pathlib import Path

ID_RE = re.compile(r"^[0-9a-f]{32}$")
COLUMNS = ["id", "created_at", "ask", "reply", "destination", "overview_id", "wanted_title", "wanted_url", "wanted_text", "chose_path", "chose_at"]
CSV_HEADER = ["id", "when", "ask", "reply", "destination", "overview_id", "wanted_title", "wanted_url", "wanted_text", "chose_instead", "chose_at"]
MAX_ROWS = 500


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(self.path, timeout=5)
        c.row_factory = sqlite3.Row
        return c

    # ----- writes -----------------------------------------------------------
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

    # ----- reads (the admin) ------------------------------------------------
    def rows(self, limit: int = MAX_ROWS) -> list[dict]:
        with self._lock, self._connect() as c:
            cur = c.execute(f"SELECT {', '.join(COLUMNS)} FROM wrong_page ORDER BY created_at DESC, rowid DESC LIMIT ?", (max(1, min(int(limit), 5000)),))
            return [dict(r) for r in cur.fetchall()]

    def count(self) -> int:
        with self._lock, self._connect() as c:
            return int(c.execute("SELECT COUNT(*) FROM wrong_page").fetchone()[0])

    def csv(self) -> str:
        """Every row, newest first, with a header (Excel-friendly: a BOM first)."""
        out = io.StringIO()
        out.write("﻿")
        w = csv.writer(out, lineterminator="\r\n")
        w.writerow(CSV_HEADER)
        for r in self.rows(5000):
            w.writerow([r[k] if r[k] is not None else "" for k in COLUMNS])
        return out.getvalue()
