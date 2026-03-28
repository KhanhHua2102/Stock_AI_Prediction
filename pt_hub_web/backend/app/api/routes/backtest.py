from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import settings
from app.services.analysis_db import AnalysisDB
from app.services.backtest_engine import run_backtest

router = APIRouter()


class BacktestRunRequest(BaseModel):
    ticker: Optional[str] = None
    forward_days: int = 10


@router.post("/run")
async def trigger_backtest(body: BacktestRunRequest):
    """Run backtest evaluation on eligible historical reports."""
    try:
        summary = await run_backtest(
            ticker=body.ticker,
            forward_days=body.forward_days,
        )
        return {"status": "completed", "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/results")
async def get_results(
    ticker: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Get paginated backtest results."""
    db = AnalysisDB(settings.analysis_db_path)
    results, total = db.get_backtest_results(ticker=ticker, limit=limit, offset=offset)
    return {"results": results, "total": total}


@router.get("/summary")
async def get_summary(ticker: Optional[str] = Query(default=None)):
    """Get aggregate backtest statistics."""
    db = AnalysisDB(settings.analysis_db_path)
    summary = db.get_backtest_summary(ticker=ticker)
    return {"summary": summary}


@router.get("/results/{report_id}")
async def get_result_for_report(report_id: int):
    """Get backtest result for a specific analysis report."""
    db = AnalysisDB(settings.analysis_db_path)
    result = db.get_backtest_for_report(report_id)
    return {"result": result}
