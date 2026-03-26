import asyncio
from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.services.analysis_engine import analysis_engine
from app.services.analysis_db import AnalysisDB

router = APIRouter()

_db: AnalysisDB | None = None


def _get_db() -> AnalysisDB:
    global _db
    if _db is None:
        _db = AnalysisDB(settings.analysis_db_path)
    return _db


@router.post("/run/{ticker}")
async def run_analysis(ticker: str):
    """Trigger an on-demand analysis for a ticker."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    if not settings.llm_api_key:
        raise HTTPException(
            status_code=400,
            detail="LLM API key not configured. Set PT_LLM_API_KEY environment variable.",
        )

    if analysis_engine.is_running:
        raise HTTPException(
            status_code=409,
            detail=f"Analysis already in progress for {analysis_engine.current_ticker}",
        )

    # Run analysis as a background task
    async def _run():
        try:
            await analysis_engine.run_analysis(ticker)
        except Exception as e:
            # Log the error through the engine's callback system
            for cb in analysis_engine._log_callbacks:
                try:
                    cb(f"ERROR: {e}", ticker)
                except Exception:
                    pass
            # Ensure running state is reset
            analysis_engine._running = False
            analysis_engine._current_ticker = None

    asyncio.create_task(_run())
    return {"status": "started", "ticker": ticker}


@router.get("/status")
async def get_analysis_status():
    """Check if an analysis is currently running."""
    return {
        "running": analysis_engine.is_running,
        "ticker": analysis_engine.current_ticker,
    }


@router.get("/reports/{ticker}")
async def get_reports(
    ticker: str,
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Get paginated analysis history for a ticker."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    db = _get_db()
    reports, total = db.get_reports(ticker, limit, offset)
    return {"reports": reports, "total": total}


@router.get("/reports/{ticker}/latest")
async def get_latest_report(ticker: str):
    """Get the most recent analysis report for a ticker."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    db = _get_db()
    report = db.get_latest(ticker)
    return {"report": report}


@router.get("/report/{report_id}")
async def get_report(report_id: int):
    """Get a single analysis report by ID."""
    db = _get_db()
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report
