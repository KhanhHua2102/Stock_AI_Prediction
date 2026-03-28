import os
import sys
import shutil
import json
import subprocess
import threading
import asyncio
import psutil
from pathlib import Path
from typing import Dict, Optional, Callable, List
from dataclasses import dataclass, field

from app.config import settings, runtime_db


def get_python_executable() -> str:
    """Get the Python executable to use for running scripts.

    Prefers the project's venv Python which has all required dependencies.
    """
    # Try project venv first (project root, not pt_hub_web)
    project_venv = settings.project_dir / "venv" / "bin" / "python"
    if project_venv.exists():
        return str(project_venv)

    # Try common system Python locations as fallback
    for python_path in ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]:
        if os.path.exists(python_path):
            return python_path
    # Fall back to current Python
    return sys.executable


@dataclass
class ProcessInfo:
    """Information about a running process."""
    process: Optional[subprocess.Popen] = None
    log_list: List[str] = field(default_factory=list)
    _log_lock: threading.Lock = field(default_factory=threading.Lock)
    reader_thread: Optional[threading.Thread] = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    @property
    def pid(self) -> Optional[int]:
        return self.process.pid if self.process else None

    def append_log(self, line: str):
        with self._log_lock:
            self.log_list.append(line)

    def get_logs(self, limit: int) -> List[str]:
        with self._log_lock:
            return self.log_list[-limit:]


class ProcessManager:
    """
    Manages pt_thinker.py and pt_trainer.py processes.
    Mirrors subprocess management from pt_hub.py.
    """

    def __init__(self):
        self.project_dir = settings.project_dir
        self.hub_data_dir = settings.hub_data_dir

        # Process handles
        self.neural: ProcessInfo = ProcessInfo()
        # self.trader removed — no trading execution in stock prediction mode
        self.trainers: Dict[str, ProcessInfo] = {}

        # Callbacks for WebSocket broadcasting
        self._log_callbacks: List[Callable] = []
        self._status_callbacks: List[Callable] = []

    def register_log_callback(self, callback: Callable):
        """Register callback for log messages."""
        self._log_callbacks.append(callback)

    def register_status_callback(self, callback: Callable):
        """Register callback for status changes."""
        self._status_callbacks.append(callback)

    def _broadcast_log(self, source: str, message: str, ticker: Optional[str] = None):
        """Broadcast log message to all registered callbacks."""
        for callback in self._log_callbacks:
            try:
                callback(source, message, ticker)
            except Exception:
                pass

    def _broadcast_status(self):
        """Broadcast status change to all registered callbacks."""
        status = self.get_status()
        for callback in self._status_callbacks:
            try:
                callback(status)
            except Exception:
                pass

    def _read_process_output(self, proc_info: ProcessInfo, source: str, ticker: Optional[str] = None):
        """Read process stdout and broadcast lines."""
        process = proc_info.process
        if not process or not process.stdout:
            return

        for line in iter(process.stdout.readline, ""):
            if not line:
                break
            line = line.rstrip("\n\r")
            proc_info.append_log(line)
            self._broadcast_log(source, line, ticker)

        # When a trainer finishes, auto-start pt_thinker if all tickers are trained
        if source == "trainer" and ticker:
            self._on_trainer_finished(ticker)

    def _on_trainer_finished(self, ticker: str):
        """Called when a trainer process exits. Auto-starts/restarts pt_thinker
        so that newly trained tickers get neural signals immediately.
        pt_thinker already skips untrained tickers internally."""
        # Lazy import to avoid circular dependency
        from app.services.file_watcher import file_watcher

        self._broadcast_status()
        self._broadcast_log("trainer", f"Training finished for {ticker}", ticker)

        # No remaining trainers running — (re)start neural runner so it
        # picks up the freshly-trained ticker.  pt_thinker skips any
        # ticker that isn't trained, so partial training is fine.
        any_training = any(info.running for info in self.trainers.values())
        if any_training:
            return

        trained = [
            t for t in settings.tickers
            if file_watcher.get_training_status(t) in ("TRAINED", "PARTIAL")
        ]
        if not trained:
            return

        # Restart neural runner so it picks up updated training weights
        if self.neural.running:
            self._broadcast_log("runner", "Restarting neural runner with updated training")
            self.stop_neural()

        file_watcher.write_selected_tickers(settings.tickers)
        self._broadcast_log("runner", f"Starting neural runner ({len(trained)}/{len(settings.tickers)} tickers trained)")
        self.start_neural()

    def _reset_runner_ready(self):
        """Reset runner_ready state in database."""
        runtime_db.set_status("runner_ready", {
            "ready": False,
            "stage": "starting",
            "ready_tickers": [],
            "total_tickers": len(settings.tickers),
        })

    def start_neural(self) -> bool:
        """Start pt_thinker.py (neural runner)."""
        if self.neural.running:
            print(f"[DEBUG] Neural already running")
            return False

        self._reset_runner_ready()

        env = os.environ.copy()
        env["POWERTRADER_HUB_DIR"] = str(self.hub_data_dir)

        script_path = self.project_dir / settings.script_neural_runner
        print(f"[DEBUG] Script path: {script_path}, exists: {script_path.exists()}")
        if not script_path.exists():
            print(f"[DEBUG] Script does not exist!")
            return False

        python_exe = get_python_executable()
        print(f"[DEBUG] Python executable: {python_exe}")

        try:
            self.neural.process = subprocess.Popen(
                [python_exe, "-u", str(script_path)],
                cwd=str(self.project_dir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            print(f"[DEBUG] Process started with PID: {self.neural.process.pid}")

            self.neural.reader_thread = threading.Thread(
                target=self._read_process_output,
                args=(self.neural, "runner"),
                daemon=True
            )
            self.neural.reader_thread.start()

            self._broadcast_status()
            return True
        except Exception as e:
            print(f"[DEBUG] Exception: {e}")
            self._broadcast_log("runner", f"Failed to start: {e}")
            return False

    def stop_neural(self) -> bool:
        """Stop neural runner process."""
        if not self.neural.running:
            return False

        try:
            self.neural.process.terminate()
            self.neural.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.neural.process.kill()
        except Exception:
            pass

        self.neural.process = None
        self._broadcast_status()
        return True

    def start_trainer(self, ticker: str) -> bool:
        """Start pt_trainer.py for a specific ticker."""
        if ticker in self.trainers and self.trainers[ticker].running:
            return False

        env = os.environ.copy()
        env["POWERTRADER_HUB_DIR"] = str(self.hub_data_dir)
        env["TRAIN_COIN"] = ticker

        script_path = self.project_dir / settings.script_trainer
        if not script_path.exists():
            return False

        try:
            proc_info = ProcessInfo()
            proc_info.process = subprocess.Popen(
                [get_python_executable(), "-u", str(script_path), ticker],
                cwd=str(self.project_dir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            proc_info.reader_thread = threading.Thread(
                target=self._read_process_output,
                args=(proc_info, "trainer", ticker),
                daemon=True
            )
            proc_info.reader_thread.start()

            self.trainers[ticker] = proc_info
            self._broadcast_status()
            return True
        except Exception as e:
            self._broadcast_log("trainer", f"Failed to start trainer for {ticker}: {e}", ticker)
            return False

    def stop_trainer(self, ticker: str) -> bool:
        """Stop trainer for a specific ticker."""
        if ticker not in self.trainers or not self.trainers[ticker].running:
            return False

        try:
            self.trainers[ticker].process.terminate()
            self.trainers[ticker].process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.trainers[ticker].process.kill()
        except Exception:
            pass

        del self.trainers[ticker]
        self._broadcast_status()
        return True

    def stop_all(self):
        """Stop all running processes."""
        self.stop_neural()
        for ticker in list(self.trainers.keys()):
            self.stop_trainer(ticker)

    def get_runner_ready(self) -> dict:
        """Read runner_ready state from database."""
        data = runtime_db.get_status("runner_ready")
        if data:
            return data
        return {
            "ready": False,
            "stage": "unknown",
            "ready_tickers": [],
            "total_tickers": 0,
        }

    async def wait_for_runner_ready(self, timeout: float = 60.0) -> bool:
        """Wait for neural runner to be ready before starting trader."""
        start_time = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start_time < timeout:
            status = self.get_runner_ready()
            if status.get("ready"):
                return True
            await asyncio.sleep(0.25)
        return False

    def get_status(self) -> dict:
        """Get status of all processes."""
        return {
            "neural": {
                "running": self.neural.running,
                "pid": self.neural.pid
            },
            "trainers": {
                ticker: {
                    "running": info.running,
                    "pid": info.pid
                }
                for ticker, info in self.trainers.items()
            },
            "runner_ready": self.get_runner_ready()
        }

    def get_logs(self, source: str, limit: int = 100, ticker: Optional[str] = None) -> List[str]:
        """Get recent logs from a process."""
        if source == "runner":
            return self.neural.get_logs(limit)
        elif source == "trainer" and ticker and ticker in self.trainers:
            return self.trainers[ticker].get_logs(limit)
        return []


# Singleton instance
process_manager = ProcessManager()
