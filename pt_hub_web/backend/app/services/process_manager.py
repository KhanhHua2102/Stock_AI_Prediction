import os
import sys
import shutil
import json
import subprocess
import threading
import queue
import asyncio
import psutil
from pathlib import Path
from typing import Dict, Optional, Callable, List
from dataclasses import dataclass, field

from app.config import settings


def get_python_executable() -> str:
    """Get the Python executable to use for running scripts.

    Prefers the project's venv Python which has all required dependencies.
    """
    # Try project venv first
    project_venv = Path(__file__).parent.parent.parent.parent / "venv" / "bin" / "python"
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
    log_queue: queue.Queue = field(default_factory=queue.Queue)
    reader_thread: Optional[threading.Thread] = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    @property
    def pid(self) -> Optional[int]:
        return self.process.pid if self.process else None


class ProcessManager:
    """
    Manages pt_trader.py, pt_thinker.py, and pt_trainer.py processes.
    Mirrors subprocess management from pt_hub.py.
    """

    def __init__(self):
        self.project_dir = settings.project_dir
        self.hub_data_dir = settings.hub_data_dir

        # Process handles
        self.neural: ProcessInfo = ProcessInfo()
        self.trader: ProcessInfo = ProcessInfo()
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

    def _broadcast_log(self, source: str, message: str, coin: Optional[str] = None):
        """Broadcast log message to all registered callbacks."""
        for callback in self._log_callbacks:
            try:
                callback(source, message, coin)
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

    def _read_process_output(self, proc_info: ProcessInfo, source: str, coin: Optional[str] = None):
        """Read process stdout and broadcast lines."""
        process = proc_info.process
        if not process or not process.stdout:
            return

        for line in iter(process.stdout.readline, ""):
            if not line:
                break
            line = line.rstrip("\n\r")
            proc_info.log_queue.put(line)
            self._broadcast_log(source, line, coin)

    def _reset_runner_ready(self):
        """Reset runner_ready.json before starting neural runner."""
        ready_path = self.hub_data_dir / "runner_ready.json"
        try:
            ready_path.write_text(json.dumps({
                "ready": False,
                "stage": "starting",
                "ready_coins": [],
                "total_coins": len(settings.coins)
            }))
        except Exception:
            pass

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

    def start_trader(self) -> bool:
        """Start pt_trader.py."""
        if self.trader.running:
            return False

        env = os.environ.copy()
        env["POWERTRADER_HUB_DIR"] = str(self.hub_data_dir)

        script_path = self.project_dir / settings.script_trader
        if not script_path.exists():
            return False

        try:
            self.trader.process = subprocess.Popen(
                [get_python_executable(), "-u", str(script_path)],
                cwd=str(self.project_dir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            self.trader.reader_thread = threading.Thread(
                target=self._read_process_output,
                args=(self.trader, "trader"),
                daemon=True
            )
            self.trader.reader_thread.start()

            self._broadcast_status()
            return True
        except Exception as e:
            self._broadcast_log("trader", f"Failed to start: {e}")
            return False

    def stop_trader(self) -> bool:
        """Stop trader process."""
        if not self.trader.running:
            return False

        try:
            self.trader.process.terminate()
            self.trader.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.trader.process.kill()
        except Exception:
            pass

        self.trader.process = None
        self._broadcast_status()
        return True

    def start_trainer(self, coin: str) -> bool:
        """Start pt_trainer.py for a specific coin."""
        if coin in self.trainers and self.trainers[coin].running:
            return False

        env = os.environ.copy()
        env["POWERTRADER_HUB_DIR"] = str(self.hub_data_dir)
        env["TRAIN_COIN"] = coin

        script_path = self.project_dir / settings.script_trainer
        if not script_path.exists():
            return False

        try:
            proc_info = ProcessInfo()
            proc_info.process = subprocess.Popen(
                [get_python_executable(), "-u", str(script_path), coin],
                cwd=str(self.project_dir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            proc_info.reader_thread = threading.Thread(
                target=self._read_process_output,
                args=(proc_info, "trainer", coin),
                daemon=True
            )
            proc_info.reader_thread.start()

            self.trainers[coin] = proc_info
            self._broadcast_status()
            return True
        except Exception as e:
            self._broadcast_log("trainer", f"Failed to start trainer for {coin}: {e}", coin)
            return False

    def stop_trainer(self, coin: str) -> bool:
        """Stop trainer for a specific coin."""
        if coin not in self.trainers or not self.trainers[coin].running:
            return False

        try:
            self.trainers[coin].process.terminate()
            self.trainers[coin].process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.trainers[coin].process.kill()
        except Exception:
            pass

        del self.trainers[coin]
        self._broadcast_status()
        return True

    def stop_all(self):
        """Stop all running processes."""
        self.stop_neural()
        self.stop_trader()
        for coin in list(self.trainers.keys()):
            self.stop_trainer(coin)

    def get_runner_ready(self) -> dict:
        """Read runner_ready.json to check neural runner status."""
        ready_path = self.hub_data_dir / "runner_ready.json"
        try:
            if ready_path.exists():
                return json.loads(ready_path.read_text())
        except Exception:
            pass
        return {
            "ready": False,
            "stage": "unknown",
            "ready_coins": [],
            "total_coins": 0
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
            "trader": {
                "running": self.trader.running,
                "pid": self.trader.pid
            },
            "trainers": {
                coin: {
                    "running": info.running,
                    "pid": info.pid
                }
                for coin, info in self.trainers.items()
            },
            "runner_ready": self.get_runner_ready()
        }

    def get_logs(self, source: str, limit: int = 100, coin: Optional[str] = None) -> List[str]:
        """Get recent logs from a process."""
        logs = []
        if source == "runner":
            q = self.neural.log_queue
        elif source == "trader":
            q = self.trader.log_queue
        elif source == "trainer" and coin and coin in self.trainers:
            q = self.trainers[coin].log_queue
        else:
            return logs

        # Drain queue to list
        temp_logs = []
        try:
            while True:
                temp_logs.append(q.get_nowait())
        except queue.Empty:
            pass

        # Put back and return last N
        for log in temp_logs:
            q.put(log)

        return temp_logs[-limit:]


# Singleton instance
process_manager = ProcessManager()
