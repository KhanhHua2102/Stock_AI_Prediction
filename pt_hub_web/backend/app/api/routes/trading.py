from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List

from app.config import settings
from app.services.process_manager import process_manager
from app.services.file_watcher import file_watcher

router = APIRouter()


class CoinsRequest(BaseModel):
    coins: List[str]


@router.get("/processes")
async def get_process_status():
    """Get status of all running processes."""
    return process_manager.get_status()


@router.post("/start-all")
async def start_all(background_tasks: BackgroundTasks):
    """Start neural runner and trader (gated by runner_ready)."""
    # Check if already running
    status = process_manager.get_status()
    if status["neural"]["running"] or status["trader"]["running"]:
        raise HTTPException(status_code=400, detail="Processes already running")

    # Check if training is complete for selected coins
    selected_coins = file_watcher.read_selected_coins()
    if not selected_coins:
        selected_coins = settings.coins
        file_watcher.write_selected_coins(selected_coins)

    for coin in selected_coins:
        training_status = file_watcher.get_training_status(coin)
        if training_status != "TRAINED":
            raise HTTPException(
                status_code=400,
                detail=f"Coin {coin} is not trained. Please train first."
            )

    # Start neural runner
    if not process_manager.start_neural():
        raise HTTPException(status_code=500, detail="Failed to start neural runner")

    # Schedule trader start after runner is ready
    async def start_trader_when_ready():
        if await process_manager.wait_for_runner_ready(timeout=120.0):
            process_manager.start_trader()

    background_tasks.add_task(start_trader_when_ready)

    return {"status": "starting", "message": "Neural runner started, trader will start when ready"}


@router.post("/stop-all")
async def stop_all():
    """Stop all running processes."""
    process_manager.stop_all()
    # Clear selected coins
    file_watcher.write_selected_coins([])
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


@router.post("/start-trader")
async def start_trader():
    """Start trader only."""
    # Check if neural runner is ready
    runner_status = process_manager.get_runner_ready()
    if not runner_status.get("ready"):
        raise HTTPException(status_code=400, detail="Neural runner not ready")

    if process_manager.start_trader():
        return {"status": "started"}
    raise HTTPException(status_code=400, detail="Failed to start or already running")


@router.post("/stop-trader")
async def stop_trader():
    """Stop trader."""
    if process_manager.stop_trader():
        return {"status": "stopped"}
    raise HTTPException(status_code=400, detail="Not running")


@router.get("/positions")
async def get_positions():
    """Get current positions from trader_status.json."""
    status = file_watcher.read_trader_status()
    if not status:
        return {"positions": {}}
    return {"positions": status.get("positions", {})}


@router.get("/coins")
async def get_selected_coins():
    """Get currently selected trading coins."""
    coins = file_watcher.read_selected_coins()
    return {"coins": coins, "available": settings.coins}


@router.post("/coins")
async def set_selected_coins(request: CoinsRequest):
    """Set coins for trading."""
    # Validate coins are in available list
    for coin in request.coins:
        if coin not in settings.coins:
            raise HTTPException(status_code=400, detail=f"Invalid coin: {coin}")

    file_watcher.write_selected_coins(request.coins)
    return {"coins": request.coins}


@router.get("/logs/{source}")
async def get_logs(source: str, limit: int = 100, coin: str = None):
    """Get recent logs from a process."""
    if source not in ["runner", "trader", "trainer"]:
        raise HTTPException(status_code=400, detail="Invalid source")

    logs = process_manager.get_logs(source, limit, coin)
    return {"logs": logs}
