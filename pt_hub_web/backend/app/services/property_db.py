import sqlite3
import threading
from pathlib import Path
from typing import Optional


class PropertyDB:
    def __init__(self, db_path: Path):
        self._path = db_path
        self._lock = threading.Lock()
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _ensure_schema(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._conn() as conn:
            # Migrate: add projection_params column if missing
            cols = [r[1] for r in conn.execute("PRAGMA table_info(properties)").fetchall()]
            if "projection_params" not in cols and "properties" in [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]:
                conn.execute("ALTER TABLE properties ADD COLUMN projection_params TEXT")

            # Migrate: recreate tables if CHECK constraints are outdated
            for table, marker in [("suburb_metrics", "annual_growth_house"), ("property_valuations", "openagent")]:
                row = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()
                if row and row[0] and marker not in row[0]:
                    conn.execute(f"ALTER TABLE {table} RENAME TO _{table}_old")
                    # Will be recreated below with the new CHECK, then data copied back

            conn.executescript("""
                CREATE TABLE IF NOT EXISTS properties (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    name                TEXT NOT NULL,
                    address             TEXT NOT NULL,
                    suburb              TEXT NOT NULL,
                    state               TEXT NOT NULL CHECK(state IN ('NSW','VIC','QLD','WA','SA','TAS','ACT','NT')),
                    postcode            TEXT NOT NULL,
                    property_type       TEXT NOT NULL CHECK(property_type IN ('house','apartment','townhouse','land','villa','unit')),
                    bedrooms            INTEGER NOT NULL DEFAULT 0,
                    bathrooms           INTEGER NOT NULL DEFAULT 0,
                    parking             INTEGER NOT NULL DEFAULT 0,
                    land_size_sqm       REAL,
                    purchase_date       TEXT,
                    purchase_price      REAL,
                    current_estimate    REAL,
                    rental_income_weekly REAL NOT NULL DEFAULT 0,
                    loan_amount         REAL NOT NULL DEFAULT 0,
                    loan_rate_pct       REAL NOT NULL DEFAULT 0,
                    notes               TEXT,
                    projection_params   TEXT,
                    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS property_valuations (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    property_id     INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
                    date            TEXT NOT NULL,
                    estimated_value REAL NOT NULL,
                    source          TEXT NOT NULL DEFAULT 'manual'
                                    CHECK(source IN ('manual','domain','corelogic','proptrack','openagent')),
                    notes           TEXT,
                    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_val_property ON property_valuations(property_id);
                CREATE INDEX IF NOT EXISTS idx_val_date ON property_valuations(date);

                CREATE TABLE IF NOT EXISTS suburb_metrics (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    suburb          TEXT NOT NULL,
                    state           TEXT NOT NULL,
                    postcode        TEXT NOT NULL,
                    date            TEXT NOT NULL,
                    metric_type     TEXT NOT NULL CHECK(metric_type IN (
                        'median_house_price','median_unit_price',
                        'median_rent_house','median_rent_unit',
                        'population','vacancy_rate',
                        'days_on_market','auction_clearance','yield_gross',
                        'annual_growth_house','annual_growth_unit'
                    )),
                    value           REAL NOT NULL,
                    source          TEXT NOT NULL DEFAULT 'manual',
                    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_sm_suburb ON suburb_metrics(suburb, state);
                CREATE INDEX IF NOT EXISTS idx_sm_date ON suburb_metrics(date);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_sm_unique
                    ON suburb_metrics(suburb, state, date, metric_type, source);

                CREATE TABLE IF NOT EXISTS favorite_suburbs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    suburb      TEXT NOT NULL,
                    state       TEXT NOT NULL CHECK(state IN ('NSW','VIC','QLD','WA','SA','TAS','ACT','NT')),
                    postcode    TEXT NOT NULL,
                    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_fav_suburb_unique
                    ON favorite_suburbs(suburb, state);
            """)

            # Copy data back from renamed tables if migration occurred
            for table, cols in [
                ("suburb_metrics", "suburb, state, postcode, date, metric_type, value, source, created_at"),
                ("property_valuations", "property_id, date, estimated_value, source, notes, created_at"),
            ]:
                old_name = f"_{table}_old"
                if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (old_name,)).fetchone():
                    conn.executescript(f"""
                        INSERT OR IGNORE INTO {table} ({cols})
                        SELECT {cols} FROM {old_name};
                        DROP TABLE {old_name};
                    """)

    # ── Property CRUD ─────────────────────────────────────────────

    def create_property(self, data: dict) -> int:
        fields = [
            "name", "address", "suburb", "state", "postcode", "property_type",
            "bedrooms", "bathrooms", "parking", "land_size_sqm",
            "purchase_date", "purchase_price", "current_estimate",
            "rental_income_weekly", "loan_amount", "loan_rate_pct", "notes",
        ]
        cols = [f for f in fields if f in data]
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(cols)
        values = [data[c] for c in cols]
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                f"INSERT INTO properties ({col_names}) VALUES ({placeholders})",
                values,
            )
            return cur.lastrowid

    def _enrich_with_suburb_estimate(self, properties: list[dict], conn) -> list[dict]:
        """Fill current_estimate from latest valuation or suburb median price."""
        for p in properties:
            if p.get("current_estimate"):
                p["estimate_source"] = None
                continue
            # First try: latest valuation
            val = conn.execute(
                "SELECT estimated_value FROM property_valuations "
                "WHERE property_id = ? ORDER BY date DESC LIMIT 1",
                (p["id"],),
            ).fetchone()
            if val:
                p["current_estimate"] = val["estimated_value"]
                p["estimate_source"] = "valuation"
                continue
            # Second try: suburb median price
            ptype = p.get("property_type", "house")
            metric = "median_unit_price" if ptype in ("apartment", "unit") else "median_house_price"
            row = conn.execute(
                "SELECT value FROM suburb_metrics "
                "WHERE suburb = ? AND state = ? AND metric_type = ? "
                "ORDER BY date DESC LIMIT 1",
                (p["suburb"].upper(), p["state"].upper(), metric),
            ).fetchone()
            if row:
                p["current_estimate"] = row["value"]
                p["estimate_source"] = "suburb_research"
            else:
                p["estimate_source"] = None
        return properties

    def get_properties(self) -> list[dict]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM properties ORDER BY created_at DESC"
            ).fetchall()
            properties = [dict(r) for r in rows]
            return self._enrich_with_suburb_estimate(properties, conn)

    def get_property(self, property_id: int) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM properties WHERE id = ?", (property_id,)
            ).fetchone()
            if not row:
                return None
            props = self._enrich_with_suburb_estimate([dict(row)], conn)
            return props[0]

    _UPDATABLE = {
        "name", "address", "suburb", "state", "postcode", "property_type",
        "bedrooms", "bathrooms", "parking", "land_size_sqm",
        "purchase_date", "purchase_price", "current_estimate",
        "rental_income_weekly", "loan_amount", "loan_rate_pct", "notes",
        "projection_params",
    }

    def update_property(self, property_id: int, **kwargs) -> None:
        updates = {k: v for k, v in kwargs.items() if k in self._UPDATABLE and v is not None}
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [property_id]
        with self._lock, self._conn() as conn:
            conn.execute(
                f"UPDATE properties SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
                values,
            )

    def delete_property(self, property_id: int) -> None:
        with self._lock, self._conn() as conn:
            conn.execute("DELETE FROM properties WHERE id = ?", (property_id,))

    # ── Valuations ────────────────────────────────────────────────

    def add_valuation(
        self, property_id: int, date: str, value: float,
        source: str = "manual", notes: str = None,
    ) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO property_valuations (property_id, date, estimated_value, source, notes) "
                "VALUES (?, ?, ?, ?, ?)",
                (property_id, date, value, source, notes),
            )
            # Update current_estimate to the latest valuation by date
            latest = conn.execute(
                "SELECT estimated_value FROM property_valuations "
                "WHERE property_id = ? ORDER BY date DESC LIMIT 1",
                (property_id,),
            ).fetchone()
            if latest:
                conn.execute(
                    "UPDATE properties SET current_estimate = ?, updated_at = datetime('now') WHERE id = ?",
                    (latest["estimated_value"], property_id),
                )
            return cur.lastrowid

    def get_valuations(self, property_id: int, limit: int = 100) -> list[dict]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM property_valuations WHERE property_id = ? "
                "ORDER BY date DESC LIMIT ?",
                (property_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def delete_valuation(self, valuation_id: int) -> Optional[int]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT property_id FROM property_valuations WHERE id = ?",
                (valuation_id,),
            ).fetchone()
            if not row:
                return None
            conn.execute("DELETE FROM property_valuations WHERE id = ?", (valuation_id,))
            return row["property_id"]

    # ── Suburb Metrics ────────────────────────────────────────────

    def upsert_suburb_metric(
        self, suburb: str, state: str, postcode: str,
        date: str, metric_type: str, value: float, source: str = "manual",
    ) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO suburb_metrics (suburb, state, postcode, date, metric_type, value, source) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(suburb, state, date, metric_type, source) "
                "DO UPDATE SET value = excluded.value, postcode = excluded.postcode",
                (suburb, state, postcode, date, metric_type, value, source),
            )

    def get_suburb_metrics(
        self, suburb: str, state: str,
        metric_type: Optional[str] = None, limit: int = 60,
    ) -> list[dict]:
        with self._lock, self._conn() as conn:
            if metric_type:
                rows = conn.execute(
                    "SELECT * FROM suburb_metrics WHERE suburb = ? AND state = ? AND metric_type = ? "
                    "ORDER BY date DESC LIMIT ?",
                    (suburb, state, metric_type, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM suburb_metrics WHERE suburb = ? AND state = ? "
                    "ORDER BY date DESC LIMIT ?",
                    (suburb, state, limit),
                ).fetchall()
            return [dict(r) for r in rows]

    def get_suburb_summary(self, suburb: str, state: str) -> dict:
        """Get latest value for each metric type in a suburb."""
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                """
                SELECT m.* FROM suburb_metrics m
                INNER JOIN (
                    SELECT metric_type, MAX(date) as max_date
                    FROM suburb_metrics
                    WHERE suburb = ? AND state = ?
                    GROUP BY metric_type
                ) latest ON m.metric_type = latest.metric_type AND m.date = latest.max_date
                WHERE m.suburb = ? AND m.state = ?
                """,
                (suburb, state, suburb, state),
            ).fetchall()
            metrics = {}
            for r in rows:
                r = dict(r)
                metrics[r["metric_type"]] = {
                    "value": r["value"],
                    "date": r["date"],
                    "source": r["source"],
                }
            return {"suburb": suburb, "state": state, "metrics": metrics}

    # ── Favorite Suburbs ───────────────────────────────────────────

    def get_favorite_suburbs(self) -> list[dict]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM favorite_suburbs ORDER BY created_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def add_favorite_suburb(self, suburb: str, state: str, postcode: str) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "INSERT OR IGNORE INTO favorite_suburbs (suburb, state, postcode) VALUES (?, ?, ?)",
                (suburb, state, postcode),
            )
            return cur.lastrowid

    def remove_favorite_suburb(self, suburb: str, state: str) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                "DELETE FROM favorite_suburbs WHERE suburb = ? AND state = ?",
                (suburb, state),
            )

    # ── Dashboard Aggregation ─────────────────────────────────────

    def get_dashboard_summary(self) -> dict:
        with self._lock, self._conn() as conn:
            rows = conn.execute("SELECT * FROM properties").fetchall()
            properties = [dict(r) for r in rows]
            properties = self._enrich_with_suburb_estimate(properties, conn)

        total_purchase = sum(p.get("purchase_price") or 0 for p in properties)
        total_estimate = sum(p.get("current_estimate") or 0 for p in properties)
        total_loan = sum(p.get("loan_amount") or 0 for p in properties)
        total_weekly_rent = sum(p.get("rental_income_weekly") or 0 for p in properties)
        total_annual_rent = total_weekly_rent * 52

        # Weekly loan repayment (simple interest approximation: monthly = loan * rate / 12)
        total_loan_monthly = sum(
            (p.get("loan_amount") or 0) * (p.get("loan_rate_pct") or 0) / 100 / 12
            for p in properties
        )

        return {
            "total_properties": len(properties),
            "total_purchase_value": round(total_purchase, 2),
            "total_current_estimate": round(total_estimate, 2),
            "total_equity": round(total_estimate - total_loan, 2),
            "total_weekly_rent": round(total_weekly_rent, 2),
            "gross_yield_pct": round(total_annual_rent / total_estimate * 100, 2) if total_estimate else 0,
            "total_loan_amount": round(total_loan, 2),
            "total_loan_repayment_monthly": round(total_loan_monthly, 2),
        }
