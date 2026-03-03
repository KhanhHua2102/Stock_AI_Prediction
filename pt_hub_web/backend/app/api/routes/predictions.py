from fastapi import APIRouter, HTTPException
from pathlib import Path

from app.config import settings

router = APIRouter()


def _safe_name(ticker: str) -> str:
    """Sanitize ticker for filesystem: ^GSPC -> GSPC, GLOB.AX -> GLOB_AX"""
    return ticker.upper().replace("^", "").replace(".", "_")


def _read_signal(path: Path) -> int:
    """Read a signal file (long_dca_signal.txt or short_dca_signal.txt) and return int value."""
    try:
        if path.exists():
            val = path.read_text().strip()
            if val:
                return int(float(val))
    except Exception:
        pass
    return 0


def _read_float(path: Path) -> float:
    """Read a file containing a single float value."""
    try:
        if path.exists():
            val = path.read_text().strip()
            if val:
                return float(val)
    except Exception:
        pass
    return 0.0


def _read_bound_prices(path: Path) -> float:
    """Read bound prices HTML file, return the last valid price."""
    try:
        if path.exists():
            lines = path.read_text().strip().split("\n")
            for line in reversed(lines):
                line = line.strip()
                if line and line.replace(".", "").replace("-", "").isdigit():
                    return float(line)
    except Exception:
        pass
    return 0.0


@router.get("/{ticker}")
async def get_predictions(ticker: str):
    """Get prediction signals for a ticker across all timeframes."""
    if ticker not in settings.coins:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    safe = _safe_name(ticker)
    training_dir = settings.project_dir / "data" / "training" / safe

    signals = {}
    for tf in settings.timeframes:
        tf_dir = training_dir  # signal files are in the ticker's training dir

        signals[tf] = {
            "long": _read_signal(tf_dir / "long_dca_signal.txt"),
            "short": _read_signal(tf_dir / "short_dca_signal.txt"),
            "high_bound": _read_bound_prices(tf_dir / "high_bound_prices.html"),
            "low_bound": _read_bound_prices(tf_dir / "low_bound_prices.html"),
        }

    # Get current price from the latest signal data or bound prices
    current_price = 0.0
    try:
        # Try reading from the ticker data using yfinance
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.fast_info
        current_price = float(info.get("lastPrice", 0) or info.get("regularMarketPrice", 0) or 0)
    except Exception:
        pass

    return {
        "signals": signals,
        "current_price": current_price,
    }
