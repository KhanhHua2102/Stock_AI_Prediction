import asyncio
from fastapi import APIRouter, HTTPException
from typing import Dict

from app.config import settings
from app.services.process_manager import process_manager
from app.services.file_watcher import file_watcher

router = APIRouter()


@router.get("/status")
async def get_training_status():
    """Get training status for all coins."""
    statuses: Dict[str, str] = {}
    for coin in settings.coins:
        statuses[coin] = file_watcher.get_training_status(coin)

    # Add running trainers
    process_status = process_manager.get_status()
    for coin, trainer_info in process_status.get("trainers", {}).items():
        if trainer_info.get("running"):
            statuses[coin] = "TRAINING"

    return {"status": statuses}


@router.post("/start/{coin}")
async def start_training(coin: str):
    """Start training for a specific coin."""
    if coin not in settings.coins:
        raise HTTPException(status_code=400, detail=f"Invalid coin: {coin}")

    if process_manager.start_trainer(coin):
        # Wait a bit and check if process is still running
        await asyncio.sleep(0.5)
        status = process_manager.get_status()
        trainer_info = status.get("trainers", {}).get(coin, {})
        print(f"[DEBUG] start_training({coin}) - trainer_info: {trainer_info}")

        # If process crashed, try to get error from logs
        if not trainer_info.get("running"):
            logs = process_manager.get_logs("trainer", 10, coin)
            print(f"[DEBUG] Trainer logs: {logs}")

        return {
            "status": "started",
            "coin": coin,
            "process_status": status
        }
    raise HTTPException(status_code=400, detail="Failed to start or already running")


@router.post("/stop/{coin}")
async def stop_training(coin: str):
    """Stop training for a specific coin."""
    if process_manager.stop_trainer(coin):
        # Return process status so frontend can update immediately
        return {
            "status": "stopped",
            "coin": coin,
            "process_status": process_manager.get_status()
        }
    raise HTTPException(status_code=400, detail="Not running")


@router.post("/clear")
async def clear_training():
    """Clear all training data (stop trainers and optionally remove models)."""
    # Stop all trainers
    process_status = process_manager.get_status()
    for coin in list(process_status.get("trainers", {}).keys()):
        process_manager.stop_trainer(coin)

    return {"status": "cleared"}


@router.get("/neural-signals")
async def get_neural_signals():
    """Get neural signal levels for all coins."""
    signals: Dict[str, dict] = {}
    for coin in settings.coins:
        signal_data = file_watcher.read_neural_signals(coin)
        if signal_data:
            signals[coin] = signal_data
        else:
            signals[coin] = {"long_signal": 0, "short_signal": 0}

    return {"signals": signals}


@router.get("/neural-signals/{coin}")
async def get_coin_neural_signals(coin: str):
    """Get neural signal levels for a specific coin."""
    if coin not in settings.coins:
        raise HTTPException(status_code=400, detail=f"Invalid coin: {coin}")

    signal_data = file_watcher.read_neural_signals(coin)
    if signal_data:
        return signal_data
    return {"long_signal": 0, "short_signal": 0}


@router.get("/logs/{coin}")
async def get_trainer_logs(coin: str, limit: int = 100):
    """Get training logs for a specific coin."""
    logs = process_manager.get_logs("trainer", limit, coin)
    return {"logs": logs, "coin": coin}
