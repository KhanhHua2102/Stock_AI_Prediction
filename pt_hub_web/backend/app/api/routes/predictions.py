from fastapi import APIRouter, HTTPException

from app.config import settings, runtime_db

router = APIRouter()


def _safe_name(ticker: str) -> str:
    """Sanitize ticker for DB key: ^GSPC -> GSPC, GLOB.AX -> GLOB_AX"""
    return ticker.upper().replace("^", "").replace(".", "_")


@router.get("/{ticker}")
async def get_predictions(ticker: str):
    """Get prediction signals for a ticker across all timeframes."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    safe = _safe_name(ticker)
    signals_row = runtime_db.get_signals(safe)

    signals = {}
    for tf in settings.timeframes:
        if signals_row:
            high_bounds = signals_row.get("high_bound_prices", [])
            low_bounds = signals_row.get("low_bound_prices", [])
            signals[tf] = {
                "long": signals_row.get("long_dca_signal", 0),
                "short": signals_row.get("short_dca_signal", 0),
                "high_bound": high_bounds[-1] if high_bounds else 0.0,
                "low_bound": low_bounds[-1] if low_bounds else 0.0,
            }
        else:
            signals[tf] = {
                "long": 0,
                "short": 0,
                "high_bound": 0.0,
                "low_bound": 0.0,
            }

    # Get current price from the latest signal data or bound prices
    current_price = 0.0
    try:
        from legacy.stock_data_fetcher import market
        current_price = market.get_current_price(ticker)
    except Exception:
        pass

    return {
        "signals": signals,
        "current_price": current_price,
    }
