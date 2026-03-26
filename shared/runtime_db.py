"""
Shared SQLite database for runtime status, trading signals, trainer state,
and neural training data.  Replaces flat JSON / TXT file IPC.

Usage (backend):
    from shared.runtime_db import RuntimeDB
    db = RuntimeDB(settings.runtime_db_path)

Usage (legacy scripts):
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from shared.runtime_db import RuntimeDB
    db = RuntimeDB(Path(os.path.dirname(BASE_DIR)) / "data" / "runtime.db")
"""

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional


class RuntimeDB:
    def __init__(self, db_path: Path):
        self._path = db_path
        self._lock = threading.Lock()
        self._ensure_schema()

    # ------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), timeout=5.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=3000")
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_status (
                    key         TEXT PRIMARY KEY,
                    value       TEXT NOT NULL,
                    updated_at  REAL NOT NULL DEFAULT (unixepoch('subsec'))
                );

                CREATE TABLE IF NOT EXISTS ticker_signals (
                    ticker              TEXT PRIMARY KEY,
                    long_dca_signal     INTEGER NOT NULL DEFAULT 0,
                    short_dca_signal    INTEGER NOT NULL DEFAULT 0,
                    long_onoff          TEXT NOT NULL DEFAULT 'OFF',
                    short_onoff         TEXT NOT NULL DEFAULT 'OFF',
                    long_profit_margin  REAL NOT NULL DEFAULT 0.25,
                    short_profit_margin REAL NOT NULL DEFAULT 0.25,
                    alerts_version      TEXT NOT NULL DEFAULT '',
                    low_bound_prices    TEXT NOT NULL DEFAULT '[]',
                    high_bound_prices   TEXT NOT NULL DEFAULT '[]',
                    updated_at          REAL NOT NULL DEFAULT (unixepoch('subsec'))
                );

                CREATE TABLE IF NOT EXISTS trainer_status (
                    ticker              TEXT PRIMARY KEY,
                    state               TEXT NOT NULL DEFAULT 'NOT_TRAINED',
                    started_at          INTEGER,
                    finished_at         INTEGER,
                    last_start_time     INTEGER,
                    last_training_time  INTEGER,
                    updated_at          REAL NOT NULL DEFAULT (unixepoch('subsec'))
                );

                CREATE TABLE IF NOT EXISTS training_memory (
                    ticker              TEXT NOT NULL,
                    timeframe           TEXT NOT NULL,
                    memories            TEXT NOT NULL DEFAULT '',
                    weights             TEXT NOT NULL DEFAULT '',
                    weights_high        TEXT NOT NULL DEFAULT '',
                    weights_low         TEXT NOT NULL DEFAULT '',
                    perfect_threshold   REAL NOT NULL DEFAULT 0.0,
                    updated_at          REAL NOT NULL DEFAULT (unixepoch('subsec')),
                    PRIMARY KEY (ticker, timeframe)
                );
            """)

    # ------------------------------------------------------------------
    # runtime_status  (key-value store for singleton objects)
    # ------------------------------------------------------------------

    def set_status(self, key: str, value: dict) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """INSERT INTO runtime_status (key, value, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET
                       value = excluded.value,
                       updated_at = excluded.updated_at""",
                (key, json.dumps(value), time.time()),
            )

    def get_status(self, key: str) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM runtime_status WHERE key = ?", (key,)
            ).fetchone()
            return json.loads(row["value"]) if row else None

    # ------------------------------------------------------------------
    # ticker_signals
    # ------------------------------------------------------------------

    def upsert_signals(self, ticker: str, **kwargs) -> None:
        allowed = {
            "long_dca_signal", "short_dca_signal",
            "long_onoff", "short_onoff",
            "long_profit_margin", "short_profit_margin",
            "alerts_version", "low_bound_prices", "high_bound_prices",
        }
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return

        # Serialize list values to JSON strings
        for k in ("low_bound_prices", "high_bound_prices"):
            if k in updates and isinstance(updates[k], list):
                updates[k] = json.dumps(updates[k])

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        cols = ", ".join(["ticker"] + list(updates.keys()) + ["updated_at"])
        placeholders = ", ".join(["?"] * (len(updates) + 2))
        values = [ticker] + list(updates.values()) + [time.time()]

        with self._lock, self._conn() as conn:
            conn.execute(
                f"""INSERT INTO ticker_signals ({cols})
                    VALUES ({placeholders})
                    ON CONFLICT(ticker) DO UPDATE SET
                        {set_clause}, updated_at = ?""",
                values + list(updates.values()) + [time.time()],
            )

    def get_signals(self, ticker: str) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM ticker_signals WHERE ticker = ?", (ticker,)
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            for k in ("low_bound_prices", "high_bound_prices"):
                if d.get(k):
                    try:
                        d[k] = json.loads(d[k])
                    except (json.JSONDecodeError, TypeError):
                        d[k] = []
            return d

    # ------------------------------------------------------------------
    # trainer_status
    # ------------------------------------------------------------------

    def upsert_trainer(self, ticker: str, **kwargs) -> None:
        allowed = {
            "state", "started_at", "finished_at",
            "last_start_time", "last_training_time",
        }
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        cols = ", ".join(["ticker"] + list(updates.keys()) + ["updated_at"])
        placeholders = ", ".join(["?"] * (len(updates) + 2))
        values = [ticker] + list(updates.values()) + [time.time()]

        with self._lock, self._conn() as conn:
            conn.execute(
                f"""INSERT INTO trainer_status ({cols})
                    VALUES ({placeholders})
                    ON CONFLICT(ticker) DO UPDATE SET
                        {set_clause}, updated_at = ?""",
                values + list(updates.values()) + [time.time()],
            )

    def get_trainer(self, ticker: str) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM trainer_status WHERE ticker = ?", (ticker,)
            ).fetchone()
            return dict(row) if row else None

    def get_all_trainers(self) -> Dict[str, dict]:
        with self._lock, self._conn() as conn:
            rows = conn.execute("SELECT * FROM trainer_status").fetchall()
            return {row["ticker"]: dict(row) for row in rows}

    # ------------------------------------------------------------------
    # training_memory
    # ------------------------------------------------------------------

    def upsert_memory(self, ticker: str, timeframe: str, **kwargs) -> None:
        allowed = {
            "memories", "weights", "weights_high", "weights_low",
            "perfect_threshold",
        }
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        cols = ", ".join(["ticker", "timeframe"] + list(updates.keys()) + ["updated_at"])
        placeholders = ", ".join(["?"] * (len(updates) + 3))
        values = [ticker, timeframe] + list(updates.values()) + [time.time()]

        with self._lock, self._conn() as conn:
            conn.execute(
                f"""INSERT INTO training_memory ({cols})
                    VALUES ({placeholders})
                    ON CONFLICT(ticker, timeframe) DO UPDATE SET
                        {set_clause}, updated_at = ?""",
                values + list(updates.values()) + [time.time()],
            )

    def get_memory(self, ticker: str, timeframe: str) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM training_memory WHERE ticker = ? AND timeframe = ?",
                (ticker, timeframe),
            ).fetchone()
            return dict(row) if row else None
