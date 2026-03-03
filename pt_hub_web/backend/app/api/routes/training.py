import asyncio
import shutil
from fastapi import APIRouter, HTTPException
from typing import Dict

from app.config import settings
from app.services.process_manager import process_manager
from app.services.file_watcher import file_watcher

router = APIRouter()


@router.get("/status")
async def get_training_status():
    """Get training status for all tickers."""
    statuses: Dict[str, str] = {}
    for ticker in settings.tickers:
        statuses[ticker] = file_watcher.get_training_status(ticker)

    # Add running trainers
    process_status = process_manager.get_status()
    for ticker, trainer_info in process_status.get("trainers", {}).items():
        if trainer_info.get("running"):
            statuses[ticker] = "TRAINING"

    return {"status": statuses}


@router.post("/start/{ticker}")
async def start_training(ticker: str):
    """Start training for a specific ticker."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    if process_manager.start_trainer(ticker):
        # Wait a bit and check if process is still running
        await asyncio.sleep(0.5)
        status = process_manager.get_status()
        trainer_info = status.get("trainers", {}).get(ticker, {})
        print(f"[DEBUG] start_training({ticker}) - trainer_info: {trainer_info}")

        # If process crashed, try to get error from logs
        if not trainer_info.get("running"):
            logs = process_manager.get_logs("trainer", 10, ticker)
            print(f"[DEBUG] Trainer logs: {logs}")

        return {
            "status": "started",
            "ticker": ticker,
            "process_status": status
        }
    raise HTTPException(status_code=400, detail="Failed to start or already running")


@router.post("/stop/{ticker}")
async def stop_training(ticker: str):
    """Stop training for a specific ticker."""
    if process_manager.stop_trainer(ticker):
        return {
            "status": "stopped",
            "ticker": ticker,
            "process_status": process_manager.get_status()
        }
    raise HTTPException(status_code=400, detail="Not running")


@router.post("/clear")
async def clear_training():
    """Clear all training data — stop trainers and remove training dirs."""
    process_status = process_manager.get_status()
    for ticker in list(process_status.get("trainers", {}).keys()):
        process_manager.stop_trainer(ticker)

    training_dir = settings.project_dir / "data" / "training"
    if training_dir.exists():
        for child in training_dir.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)

    return {"status": "cleared"}


@router.get("/neural-signals")
async def get_neural_signals():
    """Get neural signal levels for all tickers."""
    signals: Dict[str, dict] = {}
    for ticker in settings.tickers:
        signal_data = file_watcher.read_neural_signals(ticker)
        if signal_data:
            signals[ticker] = signal_data
        else:
            signals[ticker] = {"long_signal": 0, "short_signal": 0}

    return {"signals": signals}


@router.get("/neural-signals/{ticker}")
async def get_ticker_neural_signals(ticker: str):
    """Get neural signal levels for a specific ticker."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    signal_data = file_watcher.read_neural_signals(ticker)
    if signal_data:
        return signal_data
    return {"long_signal": 0, "short_signal": 0}


@router.get("/logs/{ticker}")
async def get_trainer_logs(ticker: str, limit: int = 100):
    """Get training logs for a specific ticker."""
    logs = process_manager.get_logs("trainer", limit, ticker)
    return {"logs": logs, "ticker": ticker}
