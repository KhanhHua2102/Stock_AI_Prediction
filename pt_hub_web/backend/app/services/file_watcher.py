import json
import asyncio
from pathlib import Path
from typing import Callable, Dict, List, Optional, Any
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent
import threading

from app.config import settings


class HubDataHandler(FileSystemEventHandler):
    """Handler for file system events in hub_data directory."""

    WATCHED_FILES = {
        "trader_status.json": "trader_status",
        "trade_history.jsonl": "trade_history",
        "pnl_ledger.json": "pnl",
        "account_value_history.jsonl": "account_history",
        "runner_ready.json": "runner_ready",
        "selected_trading_coins.json": "selected_coins",
    }

    def __init__(self, watcher: "FileWatcher"):
        self.watcher = watcher

    def on_modified(self, event):
        if event.is_directory:
            return
        self._handle_file_event(event.src_path)

    def on_created(self, event):
        if event.is_directory:
            return
        self._handle_file_event(event.src_path)

    def _handle_file_event(self, file_path: str):
        filename = Path(file_path).name
        if filename in self.WATCHED_FILES:
            event_type = self.WATCHED_FILES[filename]
            self.watcher._trigger_callback(event_type, file_path)


class FileWatcher:
    """
    Watches hub_data/ directory for changes and triggers callbacks.
    Replaces the polling-based refresh in pt_hub.py.
    """

    def __init__(self):
        self.hub_data_dir = settings.hub_data_dir
        self.callbacks: Dict[str, List[Callable]] = {}
        self._observer: Optional[Observer] = None
        self._mtimes: Dict[str, float] = {}
        self._lock = threading.Lock()

    def on_change(self, event_type: str, callback: Callable):
        """Register callback for specific file changes."""
        if event_type not in self.callbacks:
            self.callbacks[event_type] = []
        self.callbacks[event_type].append(callback)

    def _trigger_callback(self, event_type: str, file_path: str):
        """Trigger callbacks for an event type."""
        if event_type not in self.callbacks:
            return

        # Check mtime to avoid duplicate events
        try:
            mtime = Path(file_path).stat().st_mtime
            with self._lock:
                if self._mtimes.get(file_path) == mtime:
                    return
                self._mtimes[file_path] = mtime
        except Exception:
            return

        for callback in self.callbacks[event_type]:
            try:
                callback(event_type, file_path)
            except Exception:
                pass

    def start(self):
        """Start watching the hub_data directory."""
        if self._observer is not None:
            return

        # Ensure directory exists
        self.hub_data_dir.mkdir(parents=True, exist_ok=True)

        self._observer = Observer()
        handler = HubDataHandler(self)
        self._observer.schedule(handler, str(self.hub_data_dir), recursive=False)
        self._observer.start()

    def stop(self):
        """Stop watching."""
        if self._observer:
            self._observer.stop()
            self._observer.join()
            self._observer = None

    def read_trader_status(self) -> Optional[dict]:
        """Read trader_status.json."""
        path = self.hub_data_dir / "trader_status.json"
        try:
            if path.exists():
                return json.loads(path.read_text())
        except Exception:
            pass
        return None

    def read_trade_history(self, limit: int = 250) -> List[dict]:
        """Read trade_history.jsonl (last N entries)."""
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
        """Read pnl_ledger.json."""
        path = self.hub_data_dir / "pnl_ledger.json"
        try:
            if path.exists():
                return json.loads(path.read_text())
        except Exception:
            pass
        return {"total_realized_profit_aud": 0.0}

    def read_account_history(self, limit: int = 500) -> List[dict]:
        """Read account_value_history.jsonl."""
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

    def read_selected_tickers(self) -> List[str]:
        """Read selected_trading_coins.json."""
        path = self.hub_data_dir / "selected_trading_coins.json"
        try:
            if path.exists():
                data = json.loads(path.read_text())
                return data.get("tickers", data.get("coins", []))
        except Exception:
            pass
        return []

    def write_selected_tickers(self, tickers: List[str]):
        """Write selected_trading_coins.json."""
        path = self.hub_data_dir / "selected_trading_coins.json"
        path.write_text(json.dumps({"tickers": tickers}))

    def read_neural_signals(self, ticker: str) -> Optional[dict]:
        """Read neural signal levels for a ticker."""
        signal_path = self.hub_data_dir / f"neural_signal_{ticker}.json"
        try:
            if signal_path.exists():
                return json.loads(signal_path.read_text())
        except Exception:
            pass
        return None

    def get_training_status(self, ticker: str) -> str:
        """Check if a ticker has trained models."""
        safe_ticker = ticker.replace("^", "").replace(".", "_")
        ticker_dir = settings.project_dir / "data" / "training" / safe_ticker

        status_file = ticker_dir / "trainer_status.json"
        if status_file.exists():
            try:
                status_data = json.loads(status_file.read_text())
                if status_data.get("state") == "FINISHED":
                    return "TRAINED"
            except Exception:
                pass

        if ticker_dir.exists() and any(ticker_dir.glob("memory_weights_*.txt")):
            return "TRAINED"

        return "NOT_TRAINED"


# Singleton instance
file_watcher = FileWatcher()
