import asyncio
import json
from typing import Dict, Set, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from dataclasses import dataclass, field

from app.services.process_manager import process_manager
from app.services.file_watcher import file_watcher

router = APIRouter()


@dataclass
class ConnectionManager:
    """Manages WebSocket connections and broadcasts."""

    active_connections: Set[WebSocket] = field(default_factory=set)
    subscriptions: Dict[WebSocket, Set[str]] = field(default_factory=dict)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        self.subscriptions[websocket] = set()

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        self.subscriptions.pop(websocket, None)

    def subscribe(self, websocket: WebSocket, channels: list):
        if websocket in self.subscriptions:
            self.subscriptions[websocket].update(channels)

    async def broadcast(self, channel: str, message: dict):
        """Broadcast message to all subscribers of a channel."""
        disconnected = []
        for ws in self.active_connections:
            if channel in self.subscriptions.get(ws, set()) or channel == "all":
                try:
                    await ws.send_json(message)
                except Exception:
                    disconnected.append(ws)

        for ws in disconnected:
            self.disconnect(ws)

    async def send_personal(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            self.disconnect(websocket)


manager = ConnectionManager()


# Background task for periodic status updates
async def status_broadcast_task():
    """Periodically broadcast status updates."""
    while True:
        try:
            # Broadcast process status
            status = process_manager.get_status()
            await manager.broadcast("process_status", {
                "type": "process_status",
                "data": status
            })

            # Broadcast trader status if available
            trader_status = file_watcher.read_trader_status()
            if trader_status:
                await manager.broadcast("trader_status", {
                    "type": "trader_status",
                    "data": trader_status
                })

        except Exception:
            pass

        await asyncio.sleep(1.0)


# Start background task on module load
_broadcast_task: Optional[asyncio.Task] = None
_event_loop: Optional[asyncio.AbstractEventLoop] = None


def start_broadcast_task():
    global _broadcast_task, _event_loop
    _event_loop = asyncio.get_event_loop()
    if _broadcast_task is None or _broadcast_task.done():
        _broadcast_task = asyncio.create_task(status_broadcast_task())


def _schedule_broadcast(coro):
    """Schedule a coroutine to run, handling both async and thread contexts."""
    try:
        loop = asyncio.get_running_loop()
        # We're in an async context, use create_task
        asyncio.create_task(coro)
    except RuntimeError:
        # We're in a thread, use the saved event loop
        if _event_loop is not None:
            asyncio.run_coroutine_threadsafe(coro, _event_loop)


# Register callbacks with process manager
def on_log_message(source: str, message: str, coin: Optional[str] = None):
    """Callback for log messages from processes."""
    _schedule_broadcast(manager.broadcast("logs", {
        "type": "log",
        "source": source,
        "coin": coin,
        "message": message,
    }))


def on_status_change(status: dict):
    """Callback for process status changes."""
    _schedule_broadcast(manager.broadcast("process_status", {
        "type": "process_status",
        "data": status
    }))


process_manager.register_log_callback(on_log_message)
process_manager.register_status_callback(on_status_change)


# Register file watcher callbacks
def on_file_change(event_type: str, file_path: str):
    """Callback for file changes in hub_data."""
    if event_type == "trader_status":
        status = file_watcher.read_trader_status()
        if status:
            _schedule_broadcast(manager.broadcast("trader_status", {
                "type": "trader_status",
                "data": status
            }))
    elif event_type == "trade_history":
        trades = file_watcher.read_trade_history(1)
        if trades:
            _schedule_broadcast(manager.broadcast("trades", {
                "type": "trade_executed",
                "data": trades[-1]
            }))
    elif event_type == "runner_ready":
        status = process_manager.get_runner_ready()
        _schedule_broadcast(manager.broadcast("process_status", {
            "type": "runner_ready",
            "data": status
        }))


file_watcher.on_change("trader_status", on_file_change)
file_watcher.on_change("trade_history", on_file_change)
file_watcher.on_change("runner_ready", on_file_change)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)

    # Start broadcast task if not running
    start_broadcast_task()

    # Send initial state
    await manager.send_personal(websocket, {
        "type": "connected",
        "message": "Connected to PowerTrader Hub"
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "subscribe":
                channels = data.get("channels", [])
                manager.subscribe(websocket, channels)
                await manager.send_personal(websocket, {
                    "type": "subscribed",
                    "channels": channels
                })

            elif msg_type == "refresh":
                target = data.get("target")
                if target == "trader_status":
                    status = file_watcher.read_trader_status()
                    if status:
                        await manager.send_personal(websocket, {
                            "type": "trader_status",
                            "data": status
                        })
                elif target == "process_status":
                    await manager.send_personal(websocket, {
                        "type": "process_status",
                        "data": process_manager.get_status()
                    })

            elif msg_type == "ping":
                await manager.send_personal(websocket, {"type": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
