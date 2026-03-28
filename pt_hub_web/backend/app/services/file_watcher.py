import json
from pathlib import Path
from typing import List, Optional

from app.config import settings, runtime_db


class FileWatcher:
    """
    Reads runtime state from SQLite.
    Retains the same public API so consumers (websocket.py, routes) need no changes.
    """

    def __init__(self):
        self.hub_data_dir = settings.hub_data_dir

    # ------------------------------------------------------------------
    # Trader status  (runtime_status key = "trader_status")
    # ------------------------------------------------------------------

    def read_trader_status(self) -> Optional[dict]:
        return runtime_db.get_status("trader_status")

    # ------------------------------------------------------------------
    # Trade history / PnL / Account history
    # These are append-only JSONL files that are NOT migrated to SQLite.
    # Keep reading from flat files.
    # ------------------------------------------------------------------

    def read_trade_history(self, limit: int = 250) -> List[dict]:
        path = self.hub_data_dir / "trade_history.jsonl"
        trades = []
        try:
            if path.exists():
                lines = path.read_text().strip().split("\n")
                for line in lines[-limit:]:
                    if line:
                        trades.append(json.loads(line))
        except Exception:
            pass
        return trades

    def read_pnl_ledger(self) -> dict:
        path = self.hub_data_dir / "pnl_ledger.json"
        try:
            if path.exists():
                return json.loads(path.read_text())
        except Exception:
            pass
        return {"total_realized_profit_aud": 0.0}

    def read_account_history(self, limit: int = 500) -> List[dict]:
        path = self.hub_data_dir / "account_value_history.jsonl"
        history = []
        try:
            if path.exists():
                lines = path.read_text().strip().split("\n")
                for line in lines[-limit:]:
                    if line:
                        history.append(json.loads(line))
        except Exception:
            pass
        return history

    # ------------------------------------------------------------------
    # Selected tickers  (runtime_status key = "selected_tickers")
    # ------------------------------------------------------------------

    def read_selected_tickers(self) -> List[str]:
        data = runtime_db.get_status("selected_tickers")
        if data:
            return data.get("tickers", data.get("coins", []))
        return []

    def write_selected_tickers(self, tickers: List[str]):
        runtime_db.set_status("selected_tickers", {"tickers": tickers})

    # ------------------------------------------------------------------
    # Neural signals  (ticker_signals table)
    # ------------------------------------------------------------------

    def read_neural_signals(self, ticker: str) -> Optional[dict]:
        safe = ticker.upper().replace("^", "").replace(".", "_")
        return runtime_db.get_signals(safe)

    # ------------------------------------------------------------------
    # Training status  (trainer_status table)
    # ------------------------------------------------------------------

    def get_training_status(self, ticker: str) -> str:
        safe_ticker = ticker.replace("^", "").replace(".", "_")
        row = runtime_db.get_trainer(safe_ticker)

        if not row or row.get("state") == "NOT_TRAINED":
            # Fallback: check for memory weight files on disk (backward compat)
            ticker_dir = settings.project_dir / "data" / "training" / safe_ticker
            if ticker_dir.exists() and any(ticker_dir.glob("memory_weights_*.txt")):
                return "TRAINED"
            return "NOT_TRAINED"

        if row.get("state") == "TRAINING":
            return "TRAINING"

        # state == FINISHED — verify all timeframes actually have weights
        all_trained = True
        for tf in settings.timeframes:
            mem = runtime_db.get_memory(safe_ticker, tf)
            if not mem or (not mem.get("weights_high") and not mem.get("weights_low")):
                all_trained = False
                break

        if all_trained:
            return "TRAINED"

        # Trainer exited but not all timeframes done — partial training
        return "PARTIAL"


# Singleton instance
file_watcher = FileWatcher()
