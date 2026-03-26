import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional


class AnalysisDB:
    def __init__(self, db_path: Path):
        self._path = db_path
        self._lock = threading.Lock()
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS analysis_reports (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker          TEXT NOT NULL,
                    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                    current_price   REAL NOT NULL,
                    price_change_pct REAL,
                    indicators      TEXT NOT NULL,
                    decision        TEXT NOT NULL,
                    score           INTEGER NOT NULL,
                    conclusion      TEXT NOT NULL,
                    price_levels    TEXT NOT NULL,
                    checklist       TEXT NOT NULL,
                    raw_reasoning   TEXT,
                    model_used      TEXT,
                    news            TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_reports_ticker
                    ON analysis_reports(ticker);
                CREATE INDEX IF NOT EXISTS idx_reports_created
                    ON analysis_reports(created_at DESC);
            """)
            # Migrate: add news column if missing (existing DBs)
            cols = [r[1] for r in conn.execute("PRAGMA table_info(analysis_reports)").fetchall()]
            if "news" not in cols:
                conn.execute("ALTER TABLE analysis_reports ADD COLUMN news TEXT")

    def insert_report(self, report: dict) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO analysis_reports
                   (ticker, current_price, price_change_pct, indicators,
                    decision, score, conclusion, price_levels, checklist,
                    raw_reasoning, model_used, news)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    report["ticker"],
                    report["current_price"],
                    report.get("price_change_pct"),
                    json.dumps(report["indicators"]),
                    report["decision"],
                    report["score"],
                    report["conclusion"],
                    json.dumps(report["price_levels"]),
                    json.dumps(report["checklist"]),
                    report.get("raw_reasoning"),
                    report.get("model_used"),
                    json.dumps(report.get("news", [])),
                ),
            )
            return cur.lastrowid

    def get_reports(self, ticker: str, limit: int = 20, offset: int = 0) -> tuple:
        with self._lock, self._conn() as conn:
            total = conn.execute(
                "SELECT COUNT(*) FROM analysis_reports WHERE ticker = ?",
                (ticker,),
            ).fetchone()[0]
            rows = conn.execute(
                """SELECT * FROM analysis_reports
                   WHERE ticker = ? ORDER BY created_at DESC
                   LIMIT ? OFFSET ?""",
                (ticker, limit, offset),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows], total

    def get_latest(self, ticker: str) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                """SELECT * FROM analysis_reports
                   WHERE ticker = ? ORDER BY created_at DESC LIMIT 1""",
                (ticker,),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def get_report(self, report_id: int) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM analysis_reports WHERE id = ?",
                (report_id,),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        for key in ("indicators", "price_levels", "checklist", "news"):
            if d.get(key):
                d[key] = json.loads(d[key])
        if "news" not in d or d["news"] is None:
            d["news"] = []
        return d
