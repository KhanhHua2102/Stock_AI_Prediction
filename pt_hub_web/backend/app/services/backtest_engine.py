"""Backtest engine — evaluates past analysis predictions against actual outcomes."""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from app.config import settings
from app.services.analysis_db import AnalysisDB
from app.services.analysis_engine import _fetch_candles

logger = logging.getLogger(__name__)


def evaluate_report(report: dict, forward_days: int = 10) -> Optional[dict]:
    """Evaluate a single analysis report against actual price movement.

    Returns a backtest result dict, or None if insufficient data.
    """
    ticker = report["ticker"]
    entry_price = report["current_price"]
    decision = report["decision"]
    price_levels = report.get("price_levels", {})
    target_price = price_levels.get("target", 0)
    stop_loss = price_levels.get("stop_loss", 0)
    analysis_date = report["created_at"][:10]  # YYYY-MM-DD

    if not entry_price or entry_price <= 0:
        return None
    if not target_price or not stop_loss:
        return None

    # Fetch candles and find the analysis date
    candles = _fetch_candles(ticker, 200)
    if not candles:
        return None

    # Find the index of the analysis date in candles
    start_idx = None
    for i, c in enumerate(candles):
        if c["time"] >= analysis_date:
            start_idx = i
            break

    if start_idx is None:
        return None

    # Get forward candles (trading days after the analysis)
    forward = candles[start_idx + 1: start_idx + 1 + forward_days]
    if len(forward) < 3:  # Need at least 3 days of forward data
        return None

    # Walk forward day by day
    target_hit = False
    stop_hit = False
    exit_price = forward[-1]["close"]  # Default: close on last day
    exit_date = forward[-1]["time"]
    days_held = len(forward)

    for i, candle in enumerate(forward):
        if decision == "BUY":
            if candle["high"] >= target_price and not target_hit:
                target_hit = True
                if not stop_hit:
                    exit_price = target_price
                    exit_date = candle["time"]
                    days_held = i + 1
                    break
            if candle["low"] <= stop_loss and not stop_hit:
                stop_hit = True
                if not target_hit:
                    exit_price = stop_loss
                    exit_date = candle["time"]
                    days_held = i + 1
                    break
            # Both hit same day — conservative: assume stop hit first
            if target_hit and stop_hit:
                exit_price = stop_loss
                break
        elif decision == "SELL":
            # For SELL: target is below entry, stop is above
            if candle["low"] <= target_price and not target_hit:
                target_hit = True
                if not stop_hit:
                    exit_price = target_price
                    exit_date = candle["time"]
                    days_held = i + 1
                    break
            if candle["high"] >= stop_loss and not stop_hit:
                stop_hit = True
                if not target_hit:
                    exit_price = stop_loss
                    exit_date = candle["time"]
                    days_held = i + 1
                    break
            if target_hit and stop_hit:
                exit_price = stop_loss
                break
        else:
            # HOLD — just track direction
            pass

    return_pct = round((exit_price - entry_price) / entry_price * 100, 2)

    # Direction correctness
    if decision == "BUY":
        direction_correct = exit_price > entry_price
    elif decision == "SELL":
        direction_correct = exit_price < entry_price
    else:  # HOLD
        direction_correct = abs(return_pct) < 2.0  # Neutral band

    # Outcome determination
    if target_hit and not stop_hit:
        outcome = "WIN"
    elif stop_hit and not target_hit:
        outcome = "LOSS"
    else:
        # Neither or both hit — use return
        if abs(return_pct) < 2.0:
            outcome = "NEUTRAL"
        elif (decision == "BUY" and return_pct > 0) or (decision == "SELL" and return_pct < 0):
            outcome = "WIN"
        else:
            outcome = "LOSS"

    return {
        "report_id": report["id"],
        "ticker": ticker,
        "analysis_date": analysis_date,
        "evaluation_date": exit_date,
        "entry_price": entry_price,
        "exit_price": round(exit_price, 2),
        "target_price": target_price,
        "stop_loss": stop_loss,
        "decision": decision,
        "target_hit": target_hit,
        "stop_hit": stop_hit,
        "direction_correct": direction_correct,
        "return_pct": return_pct,
        "days_held": days_held,
        "outcome": outcome,
    }


async def run_backtest(
    ticker: Optional[str] = None,
    forward_days: int = 10,
) -> dict:
    """Evaluate all eligible reports and return summary stats."""
    db = AnalysisDB(settings.analysis_db_path)

    eligible = db.get_eligible_reports(ticker=ticker, min_age_days=forward_days)
    logger.info(f"Backtest: {len(eligible)} eligible reports to evaluate")

    evaluated = 0
    errors = 0

    for report in eligible:
        try:
            result = await asyncio.to_thread(evaluate_report, report, forward_days)
            if result:
                db.insert_backtest_result(result)
                evaluated += 1
        except Exception as e:
            logger.warning(f"Backtest evaluation failed for report {report['id']}: {e}")
            errors += 1

    summary = db.get_backtest_summary(ticker=ticker)
    summary["newly_evaluated"] = evaluated
    summary["errors"] = errors

    return summary
