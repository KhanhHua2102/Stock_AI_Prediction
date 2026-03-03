from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from app.config import settings
from app.services.process_manager import process_manager
from app.services.file_watcher import file_watcher

router = APIRouter()


class TickersRequest(BaseModel):
    tickers: List[str]


@router.get("/processes")
async def get_process_status():
    """Get status of all running processes."""
    return process_manager.get_status()


@router.post("/start-all")
async def start_all():
    """Start neural runner (prediction mode only, no trader)."""
    status = process_manager.get_status()
    if status["neural"]["running"]:
        raise HTTPException(status_code=400, detail="Neural runner already running")

    selected_tickers = file_watcher.read_selected_tickers()
    if not selected_tickers:
        selected_tickers = settings.tickers
        file_watcher.write_selected_tickers(selected_tickers)

    for ticker in selected_tickers:
        training_status = file_watcher.get_training_status(ticker)
        if training_status != "TRAINED":
            raise HTTPException(
                status_code=400,
                detail=f"Ticker {ticker} is not trained. Please train first."
            )

    if not process_manager.start_neural():
        raise HTTPException(status_code=500, detail="Failed to start neural runner")

    return {"status": "starting", "message": "Neural runner started (prediction mode)"}


@router.post("/stop-all")
async def stop_all():
    """Stop all running processes."""
    process_manager.stop_all()
    file_watcher.write_selected_tickers([])
    return {"status": "stopped"}


@router.post("/start-neural")
async def start_neural():
    """Start neural runner only."""
    if process_manager.start_neural():
        return {"status": "started"}
    raise HTTPException(status_code=400, detail="Failed to start or already running")


@router.post("/stop-neural")
async def stop_neural():
    """Stop neural runner."""
    if process_manager.stop_neural():
        return {"status": "stopped"}
    raise HTTPException(status_code=400, detail="Not running")


@router.get("/tickers")
async def get_selected_tickers():
    """Get currently selected tickers."""
    tickers = file_watcher.read_selected_tickers()
    return {"tickers": tickers, "available": settings.tickers}


@router.post("/tickers")
async def set_selected_tickers(request: TickersRequest):
    """Set tickers for prediction."""
    for ticker in request.tickers:
        if ticker not in settings.tickers:
            raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    file_watcher.write_selected_tickers(request.tickers)
    return {"tickers": request.tickers}


@router.get("/logs/{source}")
async def get_logs(source: str, limit: int = 100, ticker: str = None):
    """Get recent logs from a process."""
    if source not in ["runner", "trainer"]:
        raise HTTPException(status_code=400, detail="Invalid source")

    logs = process_manager.get_logs(source, limit, ticker)
    return {"logs": logs}
