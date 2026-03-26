import csv
import io
import json
import sqlite3
import threading
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Optional


class PortfolioDB:
    def __init__(self, db_path: Path):
        self._path = db_path
        self._lock = threading.Lock()
        self._temp_files: dict[str, list[dict]] = {}  # file_id -> parsed rows
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _ensure_schema(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS portfolios (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL UNIQUE,
                    currency    TEXT NOT NULL DEFAULT 'AUD',
                    benchmark   TEXT NOT NULL DEFAULT 'URTH',
                    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS transactions (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    portfolio_id    INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
                    ticker          TEXT NOT NULL,
                    type            TEXT NOT NULL CHECK(type IN ('BUY','SELL','DIVIDEND','SPLIT')),
                    date            TEXT NOT NULL,
                    quantity        REAL NOT NULL,
                    price           REAL NOT NULL DEFAULT 0,
                    fees            REAL NOT NULL DEFAULT 0,
                    currency        TEXT,
                    notes           TEXT,
                    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_txn_portfolio ON transactions(portfolio_id);
                CREATE INDEX IF NOT EXISTS idx_txn_ticker ON transactions(ticker);
                CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);

                CREATE TABLE IF NOT EXISTS holdings_cache (
                    portfolio_id    INTEGER NOT NULL,
                    ticker          TEXT NOT NULL,
                    quantity        REAL NOT NULL,
                    cost_basis      REAL NOT NULL,
                    avg_cost        REAL NOT NULL,
                    realised_pnl    REAL NOT NULL DEFAULT 0,
                    total_dividends REAL NOT NULL DEFAULT 0,
                    currency        TEXT,
                    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
                    PRIMARY KEY (portfolio_id, ticker)
                );

                CREATE TABLE IF NOT EXISTS daily_snapshots (
                    portfolio_id    INTEGER NOT NULL,
                    date            TEXT NOT NULL,
                    total_value     REAL NOT NULL,
                    total_cost      REAL NOT NULL,
                    cash_flow       REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (portfolio_id, date)
                );
            """)
            # Migration: add currency column to existing tables
            for table in ("transactions", "holdings_cache"):
                try:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN currency TEXT")
                except sqlite3.OperationalError:
                    pass  # column already exists

    # ── Portfolio CRUD ──────────────────────────────────────────────

    def create_portfolio(self, name: str, currency: str = "AUD", benchmark: str = "URTH") -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO portfolios (name, currency, benchmark) VALUES (?, ?, ?)",
                (name, currency, benchmark),
            )
            return cur.lastrowid

    def get_portfolios(self) -> list[dict]:
        with self._lock, self._conn() as conn:
            rows = conn.execute("SELECT * FROM portfolios ORDER BY created_at DESC").fetchall()
            return [dict(r) for r in rows]

    def get_portfolio(self, portfolio_id: int) -> Optional[dict]:
        with self._lock, self._conn() as conn:
            row = conn.execute("SELECT * FROM portfolios WHERE id = ?", (portfolio_id,)).fetchone()
            return dict(row) if row else None

    def update_portfolio(self, portfolio_id: int, **kwargs) -> None:
        allowed = {"name", "currency", "benchmark"}
        fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        if not fields:
            return
        sets = ", ".join(f"{k} = ?" for k in fields)
        vals = list(fields.values()) + [portfolio_id]
        with self._lock, self._conn() as conn:
            conn.execute(
                f"UPDATE portfolios SET {sets}, updated_at = datetime('now') WHERE id = ?",
                vals,
            )

    def delete_portfolio(self, portfolio_id: int) -> None:
        with self._lock, self._conn() as conn:
            conn.execute("DELETE FROM portfolios WHERE id = ?", (portfolio_id,))
            conn.execute("DELETE FROM holdings_cache WHERE portfolio_id = ?", (portfolio_id,))
            conn.execute("DELETE FROM daily_snapshots WHERE portfolio_id = ?", (portfolio_id,))

    # ── Transaction CRUD ────────────────────────────────────────────

    def add_transaction(self, portfolio_id: int, txn: dict) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO transactions
                   (portfolio_id, ticker, type, date, quantity, price, fees, currency, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    portfolio_id,
                    txn["ticker"],
                    txn["type"],
                    txn["date"],
                    txn["quantity"],
                    txn.get("price", 0),
                    txn.get("fees", 0),
                    txn.get("currency"),
                    txn.get("notes"),
                ),
            )
            return cur.lastrowid

    def add_transactions_batch(self, portfolio_id: int, txns: list[dict]) -> int:
        with self._lock, self._conn() as conn:
            count = 0
            for txn in txns:
                conn.execute(
                    """INSERT INTO transactions
                       (portfolio_id, ticker, type, date, quantity, price, fees, currency, notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        portfolio_id,
                        txn["ticker"],
                        txn["type"],
                        txn["date"],
                        txn["quantity"],
                        txn.get("price", 0),
                        txn.get("fees", 0),
                        txn.get("currency"),
                        txn.get("notes"),
                    ),
                )
                count += 1
            return count

    def find_duplicate_indices(self, portfolio_id: int, txns: list[dict]) -> list[int]:
        """Return indices of txns that already exist in the DB (match on ticker+date+type+quantity+price)."""
        with self._lock, self._conn() as conn:
            existing = conn.execute(
                "SELECT ticker, date, type, quantity, price FROM transactions WHERE portfolio_id = ?",
                (portfolio_id,),
            ).fetchall()
            # Build a set of fingerprints for fast lookup
            fingerprints = set()
            for row in existing:
                # Round to avoid float precision issues
                fp = (row[0], row[1], row[2], round(float(row[3]), 6), round(float(row[4]), 6))
                fingerprints.add(fp)

            duplicates = []
            for i, txn in enumerate(txns):
                fp = (
                    txn["ticker"],
                    txn["date"],
                    txn["type"],
                    round(float(txn["quantity"]), 6),
                    round(float(txn.get("price", 0)), 6),
                )
                if fp in fingerprints:
                    duplicates.append(i)
            return duplicates

    def get_transactions(
        self, portfolio_id: int, ticker: Optional[str] = None, limit: int = 100, offset: int = 0
    ) -> tuple[list[dict], int]:
        with self._lock, self._conn() as conn:
            where = "WHERE portfolio_id = ?"
            params: list = [portfolio_id]
            if ticker:
                where += " AND ticker = ?"
                params.append(ticker)

            total = conn.execute(f"SELECT COUNT(*) FROM transactions {where}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM transactions {where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
                params + [limit, offset],
            ).fetchall()
            return [dict(r) for r in rows], total

    def delete_transaction(self, txn_id: int) -> Optional[int]:
        """Delete a transaction. Returns portfolio_id for rebuild, or None if not found."""
        with self._lock, self._conn() as conn:
            row = conn.execute("SELECT portfolio_id FROM transactions WHERE id = ?", (txn_id,)).fetchone()
            if not row:
                return None
            pid = row[0]
            conn.execute("DELETE FROM transactions WHERE id = ?", (txn_id,))
            return pid

    def delete_transactions_batch(self, txn_ids: list[int]) -> Optional[int]:
        """Delete multiple transactions. Returns portfolio_id for rebuild, or None if none found."""
        if not txn_ids:
            return None
        with self._lock, self._conn() as conn:
            placeholders = ",".join("?" for _ in txn_ids)
            row = conn.execute(
                f"SELECT DISTINCT portfolio_id FROM transactions WHERE id IN ({placeholders})",
                txn_ids,
            ).fetchone()
            if not row:
                return None
            pid = row[0]
            conn.execute(f"DELETE FROM transactions WHERE id IN ({placeholders})", txn_ids)
            return pid

    # ── Holdings Cache (FIFO) ──────────────────────────────────────

    def rebuild_holdings(self, portfolio_id: int) -> None:
        """Recompute holdings_cache using FIFO cost basis from all transactions."""
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY date ASC, id ASC",
                (portfolio_id,),
            ).fetchall()

            # FIFO lots per ticker: list of (qty, cost_per_share)
            lots: dict[str, list[list[float]]] = defaultdict(list)
            realised: dict[str, float] = defaultdict(float)
            dividends: dict[str, float] = defaultdict(float)
            total_invested: dict[str, float] = defaultdict(float)  # total cost ever bought
            currencies: dict[str, Optional[str]] = {}

            for r in rows:
                ticker = r["ticker"]
                txn_type = r["type"]
                qty = r["quantity"]
                price = r["price"]
                fees = r["fees"]
                # Track currency from first transaction for this ticker
                if ticker not in currencies:
                    currencies[ticker] = r["currency"] if "currency" in r.keys() else None

                if txn_type == "BUY":
                    # Cost includes fees spread across units
                    cost_per_share = price + (fees / qty if qty > 0 else 0)
                    lots[ticker].append([qty, cost_per_share])
                    # Track total amount ever invested for this ticker (for closed position %)
                    total_invested[ticker] = total_invested.get(ticker, 0) + qty * cost_per_share

                elif txn_type == "SELL":
                    sell_proceeds_per_share = price - (fees / qty if qty > 0 else 0)
                    remaining = qty
                    while remaining > 0 and lots[ticker]:
                        lot = lots[ticker][0]
                        if lot[0] <= remaining:
                            # Consume entire lot
                            realised[ticker] += (sell_proceeds_per_share - lot[1]) * lot[0]
                            remaining -= lot[0]
                            lots[ticker].pop(0)
                        else:
                            # Partial lot consumption
                            realised[ticker] += (sell_proceeds_per_share - lot[1]) * remaining
                            lot[0] -= remaining
                            remaining = 0
                    # Clean up floating-point residual lots (e.g., 2.27e-13 shares)
                    while lots[ticker] and lots[ticker][0][0] < 1e-8:
                        lots[ticker].pop(0)

                elif txn_type == "SPLIT":
                    # qty is the split ratio (e.g., 2.0 for 2-for-1)
                    ratio = qty
                    for lot in lots[ticker]:
                        lot[0] *= ratio
                        lot[1] /= ratio

                elif txn_type == "DIVIDEND":
                    # price * quantity = total dividend amount, or just use price as total
                    div_amount = price * qty if qty > 0 else price
                    dividends[ticker] += div_amount

            # Write to holdings_cache
            conn.execute("DELETE FROM holdings_cache WHERE portfolio_id = ?", (portfolio_id,))
            for ticker, ticker_lots in lots.items():
                total_qty = sum(lot[0] for lot in ticker_lots)
                total_cost = sum(lot[0] * lot[1] for lot in ticker_lots)
                avg_cost = total_cost / total_qty if total_qty > 0 else 0
                # For closed positions (qty ~ 0), use total_invested as cost_basis
                # so return % can be computed correctly
                stored_cost = total_cost if total_qty > 0.0001 else total_invested.get(ticker, 0)

                if total_qty > 0.0001 or realised.get(ticker, 0) != 0 or dividends.get(ticker, 0) != 0:
                    conn.execute(
                        """INSERT INTO holdings_cache
                           (portfolio_id, ticker, quantity, cost_basis, avg_cost, realised_pnl, total_dividends, currency)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            portfolio_id,
                            ticker,
                            round(total_qty, 6),
                            round(stored_cost, 2),
                            round(avg_cost, 4),
                            round(realised.get(ticker, 0), 2),
                            round(dividends.get(ticker, 0), 2),
                            currencies.get(ticker),
                        ),
                    )

            # Also include tickers that were fully sold but have realised P&L or dividends
            for ticker in set(list(realised.keys()) + list(dividends.keys())):
                if ticker not in lots or sum(lot[0] for lot in lots.get(ticker, [])) < 0.0001:
                    if ticker not in {t for t, _ in lots.items() if sum(l[0] for l in _) > 0.0001}:
                        # Check if already inserted
                        exists = conn.execute(
                            "SELECT 1 FROM holdings_cache WHERE portfolio_id = ? AND ticker = ?",
                            (portfolio_id, ticker),
                        ).fetchone()
                        if not exists:
                            # Store total_invested as cost_basis so closed positions can show return %
                            hist_cost = round(total_invested.get(ticker, 0), 2)
                            conn.execute(
                                """INSERT INTO holdings_cache
                                   (portfolio_id, ticker, quantity, cost_basis, avg_cost, realised_pnl, total_dividends, currency)
                                   VALUES (?, ?, 0, ?, 0, ?, ?, ?)""",
                                (portfolio_id, ticker, hist_cost, round(realised.get(ticker, 0), 2), round(dividends.get(ticker, 0), 2), currencies.get(ticker)),
                            )

    def get_holdings(self, portfolio_id: int) -> list[dict]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM holdings_cache WHERE portfolio_id = ? ORDER BY ticker",
                (portfolio_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    # ── Daily Snapshots ────────────────────────────────────────────

    def upsert_snapshot(self, portfolio_id: int, date: str, total_value: float, total_cost: float, cash_flow: float = 0) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """INSERT INTO daily_snapshots (portfolio_id, date, total_value, total_cost, cash_flow)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(portfolio_id, date) DO UPDATE SET
                       total_value = excluded.total_value,
                       total_cost = excluded.total_cost,
                       cash_flow = excluded.cash_flow""",
                (portfolio_id, date, total_value, total_cost, cash_flow),
            )

    def update_snapshot_cash_flow(self, portfolio_id: int, date: str, cash_flow: float) -> None:
        """Update only the cash_flow field on an existing snapshot."""
        with self._lock, self._conn() as conn:
            conn.execute(
                "UPDATE daily_snapshots SET cash_flow = ? WHERE portfolio_id = ? AND date = ?",
                (cash_flow, portfolio_id, date),
            )

    def delete_snapshots_from(self, portfolio_id: int, from_date: str) -> None:
        """Delete snapshots on or after a given date."""
        with self._lock, self._conn() as conn:
            conn.execute(
                "DELETE FROM daily_snapshots WHERE portfolio_id = ? AND date >= ?",
                (portfolio_id, from_date),
            )

    def get_snapshots(self, portfolio_id: int, start_date: Optional[str] = None, end_date: Optional[str] = None) -> list[dict]:
        with self._lock, self._conn() as conn:
            where = "WHERE portfolio_id = ?"
            params: list = [portfolio_id]
            if start_date:
                where += " AND date >= ?"
                params.append(start_date)
            if end_date:
                where += " AND date <= ?"
                params.append(end_date)
            rows = conn.execute(
                f"SELECT * FROM daily_snapshots {where} ORDER BY date ASC",
                params,
            ).fetchall()
            return [dict(r) for r in rows]

    # ── Import Helpers ─────────────────────────────────────────────

    # Known column mapping presets
    COLUMN_PRESETS = {
        "betashares": {
            "date": ["Trade Date", "Date", "Settlement Date", "Effective Date"],
            "ticker": ["Instrument Code", "Code", "Symbol", "Ticker"],
            "type": ["Transaction Type", "Type", "Action", "Activity Type"],
            "quantity": ["Quantity", "Units", "Qty", "Volume"],
            "price": ["Price in Dollars", "Price", "Unit Price", "Trade Price"],
            "fees": ["Brokerage", "Fees", "Commission", "Fee"],
            "amount": ["Gross", "Amount", "Net", "Total", "Value"],
        },
        "sharesight": {
            "date": ["Date", "Trade Date"],
            "ticker": ["Code", "Symbol", "Instrument Code"],
            "type": ["Type", "Transaction Type", "Action"],
            "quantity": ["Quantity", "Units", "Shares"],
            "price": ["Price", "Unit Price", "Price in Dollars"],
            "fees": ["Brokerage", "Fee", "Commission"],
            "amount": ["Amount", "Gross", "Total", "Value"],
        },
        "espp": {
            "date": ["Purchase Date", "Grant Date"],
            "ticker": ["SymbolTICKER", "Symbol"],
            "type": ["Record Type"],
            "quantity": ["Purchased Qty.", "Net Shares", "Sellable Qty."],
            "price": ["Purchase Price", "Purchase Date FMV"],
            "fees": [],
        },
    }

    def parse_file(self, file_bytes: bytes, filename: str) -> tuple[str, list[str], list[dict], int]:
        """Parse CSV or XLSX file. Returns (file_id, columns, sample_rows, total_rows)."""
        ext = Path(filename).suffix.lower()

        if ext == ".csv":
            rows = self._parse_csv(file_bytes)
        elif ext in (".xlsx", ".xls"):
            rows = self._parse_xlsx(file_bytes)
        else:
            raise ValueError(f"Unsupported file format: {ext}. Use .csv or .xlsx")

        if not rows:
            raise ValueError("File contains no data rows")

        columns = list(rows[0].keys())
        file_id = uuid.uuid4().hex[:12]
        self._temp_files[file_id] = rows

        return file_id, columns, rows, len(rows)

    def _parse_csv(self, data: bytes) -> list[dict]:
        # Try different encodings
        for encoding in ("utf-8", "utf-8-sig", "latin-1"):
            try:
                text = data.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError("Cannot decode CSV file")

        reader = csv.DictReader(io.StringIO(text))
        return [dict(row) for row in reader]

    def _parse_xlsx(self, data: bytes) -> list[dict]:
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)

        # First row = headers
        headers = [str(h).strip() if h else f"Column_{i}" for i, h in enumerate(next(rows_iter))]
        result = []
        for row in rows_iter:
            if all(v is None for v in row):
                continue
            result.append({headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(row)})
        wb.close()
        return result

    def auto_detect_mapping(self, columns: list[str]) -> dict[str, Optional[str]]:
        """Auto-detect column mapping based on known presets."""
        col_lower = {c.lower().strip(): c for c in columns}
        mapping: dict[str, Optional[str]] = {"date": None, "ticker": None, "type": None, "quantity": None, "price": None, "fees": None, "amount": None}

        # Try each preset
        for _preset_name, preset in self.COLUMN_PRESETS.items():
            matched = 0
            for field, candidates in preset.items():
                for candidate in candidates:
                    if candidate.lower() in col_lower:
                        mapping[field] = col_lower[candidate.lower()]
                        matched += 1
                        break
            if matched >= 3:
                break

        # Fallback: fuzzy match remaining unmapped fields
        for field in mapping:
            if mapping[field] is None:
                for col in columns:
                    cl = col.lower()
                    if field == "date" and any(k in cl for k in ("date", "time", "settlement")):
                        mapping[field] = col
                    elif field == "ticker" and any(k in cl for k in ("ticker", "symbol", "code", "instrument", "stock")):
                        mapping[field] = col
                    elif field == "type" and any(k in cl for k in ("type", "action", "side", "transaction")):
                        mapping[field] = col
                    elif field == "quantity" and any(k in cl for k in ("quantity", "qty", "units", "shares", "volume")):
                        mapping[field] = col
                    elif field == "price" and any(k in cl for k in ("price", "cost", "rate")):
                        mapping[field] = col
                    elif field == "fees" and any(k in cl for k in ("fee", "brokerage", "commission")):
                        mapping[field] = col
                    elif field == "amount" and any(k in cl for k in ("amount", "gross", "total", "net", "value")):
                        mapping[field] = col

        return mapping

    def apply_mapping(self, file_id: str, mapping: dict[str, str]) -> list[dict]:
        """Apply column mapping to parsed rows and return validated transactions."""
        rows = self._temp_files.get(file_id)
        if not rows:
            raise ValueError("Import session expired. Please re-upload the file.")

        transactions = []
        errors = []
        type_aliases = {
            "buy": "BUY", "purchase": "BUY", "b": "BUY",
            "sell": "SELL", "sale": "SELL", "s": "SELL",
            "dividend": "DIVIDEND", "div": "DIVIDEND", "distribution": "DIVIDEND",
            "split": "SPLIT",
        }

        for i, row in enumerate(rows, 1):
            try:
                # Extract mapped values
                raw_type = row.get(mapping.get("type", ""), "BUY").strip()
                txn_type = type_aliases.get(raw_type.lower(), raw_type.upper())
                if txn_type not in ("BUY", "SELL", "DIVIDEND", "SPLIT"):
                    txn_type = "BUY"  # default

                ticker = row.get(mapping.get("ticker", ""), "").strip().upper()
                if not ticker:
                    continue  # skip empty rows

                date_str = row.get(mapping.get("date", ""), "").strip()
                date_str = self._normalize_date(date_str)
                if not date_str:
                    errors.append(f"Row {i}: invalid date")
                    continue

                qty_str = row.get(mapping.get("quantity", ""), "0").strip().replace(",", "")
                price_str = row.get(mapping.get("price", ""), "0").strip().replace(",", "").replace("$", "")
                fees_str = row.get(mapping.get("fees", ""), "0").strip().replace(",", "").replace("$", "") if mapping.get("fees") else "0"
                amount_str = row.get(mapping.get("amount", ""), "0").strip().replace(",", "").replace("$", "") if mapping.get("amount") else "0"

                qty = float(qty_str) if qty_str else 0
                price = float(price_str) if price_str else 0
                fees = float(fees_str) if fees_str else 0
                amount = float(amount_str) if amount_str else 0

                # For dividends: if qty/price are zero but amount is available, use amount as price with qty=1
                if txn_type == "DIVIDEND" and qty == 0 and price == 0 and amount != 0:
                    qty = 1
                    price = abs(amount)

                transactions.append({
                    "ticker": ticker,
                    "type": txn_type,
                    "date": date_str,
                    "quantity": abs(qty),
                    "price": abs(price),
                    "fees": abs(fees),
                    "notes": f"Imported row {i}",
                })
            except (ValueError, KeyError) as e:
                errors.append(f"Row {i}: {e}")

        # Clean up temp file
        self._temp_files.pop(file_id, None)

        return transactions

    @staticmethod
    def _normalize_date(date_str: str) -> Optional[str]:
        """Try to parse various date formats into YYYY-MM-DD."""
        from datetime import datetime

        formats = [
            "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y",
            "%Y/%m/%d", "%d %b %Y", "%d %B %Y", "%d-%b-%Y", "%d-%B-%Y",
            "%b %d, %Y", "%Y-%m-%dT%H:%M:%S", "%d/%m/%y", "%m/%d/%y",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None

    def get_first_transaction_date(self, portfolio_id: int) -> Optional[str]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT MIN(date) as min_date FROM transactions WHERE portfolio_id = ?",
                (portfolio_id,),
            ).fetchone()
            return row["min_date"] if row and row["min_date"] else None

    def get_transaction_tickers(self, portfolio_id: int) -> list[str]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT DISTINCT ticker FROM transactions WHERE portfolio_id = ? ORDER BY ticker",
                (portfolio_id,),
            ).fetchall()
            return [r["ticker"] for r in rows]

    def get_dividend_transactions(self, portfolio_id: int) -> list[dict]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM transactions WHERE portfolio_id = ? AND type = 'DIVIDEND' ORDER BY date ASC",
                (portfolio_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_last_sell_dates(self, portfolio_id: int, tickers: list[str]) -> dict[str, str]:
        """Return {ticker: last_sell_date} for the given tickers."""
        if not tickers:
            return {}
        with self._lock, self._conn() as conn:
            placeholders = ",".join("?" for _ in tickers)
            rows = conn.execute(
                f"SELECT ticker, MAX(date) as last_date FROM transactions "
                f"WHERE portfolio_id = ? AND type = 'SELL' AND ticker IN ({placeholders}) GROUP BY ticker",
                [portfolio_id] + tickers,
            ).fetchall()
            return {r["ticker"]: r["last_date"] for r in rows}
