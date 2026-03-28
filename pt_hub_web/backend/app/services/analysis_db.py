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
            # Migrate: add columns if missing (existing DBs)
            cols = [r[1] for r in conn.execute("PRAGMA table_info(analysis_reports)").fetchall()]
            if "news" not in cols:
                conn.execute("ALTER TABLE analysis_reports ADD COLUMN news TEXT")
            if "strategy" not in cols:
                conn.execute("ALTER TABLE analysis_reports ADD COLUMN strategy TEXT DEFAULT 'default'")

            # Market reviews table
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS market_reviews (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    date        TEXT NOT NULL UNIQUE,
                    indices     TEXT NOT NULL,
                    sectors     TEXT NOT NULL,
                    summary     TEXT NOT NULL,
                    fear_greed  TEXT,
                    model_used  TEXT,
                    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS backtest_results (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    report_id         INTEGER NOT NULL UNIQUE,
                    ticker            TEXT NOT NULL,
                    analysis_date     TEXT NOT NULL,
                    evaluation_date   TEXT NOT NULL,
                    entry_price       REAL NOT NULL,
                    exit_price        REAL NOT NULL,
                    target_price      REAL NOT NULL,
                    stop_loss         REAL NOT NULL,
                    decision          TEXT NOT NULL,
                    target_hit        INTEGER NOT NULL DEFAULT 0,
                    stop_hit          INTEGER NOT NULL DEFAULT 0,
                    direction_correct INTEGER NOT NULL DEFAULT 0,
                    return_pct        REAL NOT NULL,
                    days_held         INTEGER NOT NULL,
                    outcome           TEXT NOT NULL,
                    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (report_id) REFERENCES analysis_reports(id)
                );
                CREATE INDEX IF NOT EXISTS idx_backtest_ticker
                    ON backtest_results(ticker);
                CREATE INDEX IF NOT EXISTS idx_backtest_report
                    ON backtest_results(report_id);
            """)

    def insert_report(self, report: dict) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO analysis_reports
                   (ticker, current_price, price_change_pct, indicators,
                    decision, score, conclusion, price_levels, checklist,
                    raw_reasoning, model_used, news, strategy)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                    report.get("strategy", "default"),
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

    # --- Market reviews ---

    def insert_market_review(self, review: dict) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                """INSERT OR REPLACE INTO market_reviews
                   (date, indices, sectors, summary, fear_greed, model_used)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    review["date"],
                    json.dumps(review["indices"]),
                    json.dumps(review["sectors"]),
                    review["summary"],
                    json.dumps(review.get("fear_greed")),
                    review.get("model_used"),
                ),
            )
            return cur.lastrowid

    def get_market_review(self, date: str) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM market_reviews WHERE date = ?", (date,)
            ).fetchone()
            return self._market_row_to_dict(row) if row else None

    def get_latest_market_review(self) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM market_reviews ORDER BY date DESC LIMIT 1"
            ).fetchone()
            return self._market_row_to_dict(row) if row else None

    # --- Backtest results ---

    def backtest_exists(self, report_id: int) -> bool:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM backtest_results WHERE report_id = ?", (report_id,)
            ).fetchone()
            return row is not None

    def insert_backtest_result(self, result: dict) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO backtest_results
                   (report_id, ticker, analysis_date, evaluation_date,
                    entry_price, exit_price, target_price, stop_loss,
                    decision, target_hit, stop_hit, direction_correct,
                    return_pct, days_held, outcome)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    result["report_id"], result["ticker"], result["analysis_date"],
                    result["evaluation_date"], result["entry_price"], result["exit_price"],
                    result["target_price"], result["stop_loss"], result["decision"],
                    int(result["target_hit"]), int(result["stop_hit"]),
                    int(result["direction_correct"]), result["return_pct"],
                    result["days_held"], result["outcome"],
                ),
            )
            return cur.lastrowid

    def get_backtest_results(self, ticker: Optional[str] = None, limit: int = 50, offset: int = 0) -> tuple:
        with self._lock, self._conn() as conn:
            where = "WHERE ticker = ?" if ticker else ""
            params: tuple = (ticker,) if ticker else ()
            total = conn.execute(
                f"SELECT COUNT(*) FROM backtest_results {where}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"""SELECT * FROM backtest_results {where}
                    ORDER BY analysis_date DESC LIMIT ? OFFSET ?""",
                params + (limit, offset),
            ).fetchall()
            return [dict(r) for r in rows], total

    def get_backtest_summary(self, ticker: Optional[str] = None) -> dict:
        with self._lock, self._conn() as conn:
            where = "WHERE ticker = ?" if ticker else ""
            params: tuple = (ticker,) if ticker else ()
            rows = conn.execute(
                f"SELECT * FROM backtest_results {where}", params
            ).fetchall()

            if not rows:
                return {"total": 0, "win_rate": None, "direction_accuracy": None, "avg_return": None}

            results = [dict(r) for r in rows]
            total = len(results)
            wins = sum(1 for r in results if r["outcome"] == "WIN")
            losses = sum(1 for r in results if r["outcome"] == "LOSS")
            win_loss = wins + losses
            direction_correct = sum(1 for r in results if r["direction_correct"])
            avg_return = sum(r["return_pct"] for r in results) / total

            # Per-decision breakdown
            by_decision: dict = {}
            for decision in ("BUY", "HOLD", "SELL"):
                subset = [r for r in results if r["decision"] == decision]
                if subset:
                    d_wins = sum(1 for r in subset if r["outcome"] == "WIN")
                    d_losses = sum(1 for r in subset if r["outcome"] == "LOSS")
                    d_wl = d_wins + d_losses
                    by_decision[decision] = {
                        "count": len(subset),
                        "win_rate": round(d_wins / d_wl * 100, 1) if d_wl else None,
                        "avg_return": round(sum(r["return_pct"] for r in subset) / len(subset), 2),
                    }

            return {
                "total": total,
                "win_rate": round(wins / win_loss * 100, 1) if win_loss else None,
                "direction_accuracy": round(direction_correct / total * 100, 1),
                "avg_return": round(avg_return, 2),
                "wins": wins,
                "losses": losses,
                "neutrals": total - wins - losses,
                "by_decision": by_decision,
            }

    def get_backtest_for_report(self, report_id: int) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM backtest_results WHERE report_id = ?", (report_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_eligible_reports(self, ticker: Optional[str] = None, min_age_days: int = 10) -> list:
        """Get reports old enough for backtesting that don't have results yet."""
        with self._lock, self._conn() as conn:
            where_parts = [
                "created_at <= datetime('now', ? || ' days')",
                "id NOT IN (SELECT report_id FROM backtest_results)",
            ]
            params: list = [f"-{int(min_age_days)}"]
            if ticker:
                where_parts.append("ticker = ?")
                params.append(ticker)

            where = "WHERE " + " AND ".join(where_parts)
            rows = conn.execute(
                f"SELECT * FROM analysis_reports {where} ORDER BY created_at DESC",
                tuple(params),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    @staticmethod
    def _market_row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        for key in ("indices", "sectors", "fear_greed"):
            if d.get(key):
                d[key] = json.loads(d[key])
        return d

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        for key in ("indicators", "price_levels", "checklist", "news"):
            if d.get(key):
                d[key] = json.loads(d[key])
        if "news" not in d or d["news"] is None:
            d["news"] = []
        return d
