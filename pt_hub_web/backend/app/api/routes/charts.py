from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.config import settings
from app.services.file_watcher import file_watcher

router = APIRouter()

TIMEFRAME_MAP = {
    "1day": "1d",
    "1week": "1wk",
}


@router.get("/candles/{ticker}")
async def get_candles(
    ticker: str,
    timeframe: str = Query(default="1day"),
    limit: int = Query(default=120, le=1000),
):
    """Get OHLC candle data via yfinance/vnstock."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    try:
        import yfinance as yf

        interval = TIMEFRAME_MAP[timeframe]

        # For VNINDEX, try vnstock first
        if ticker == "VNINDEX":
            candles = _fetch_vnindex_candles(limit)
            if candles:
                return {"candles": candles, "pair": ticker, "timeframe": timeframe}

        df = yf.download(ticker, period="2y", interval=interval, progress=False)
        if df is None or df.empty:
            return {"candles": [], "pair": ticker, "timeframe": timeframe}

        candles = []
        for ts, row in df.tail(limit).iterrows():
            try:
                candles.append({
                    "time": int(ts.timestamp()),
                    "open": float(row["Open"].iloc[0]) if hasattr(row["Open"], "iloc") else float(row["Open"]),
                    "high": float(row["High"].iloc[0]) if hasattr(row["High"], "iloc") else float(row["High"]),
                    "low": float(row["Low"].iloc[0]) if hasattr(row["Low"], "iloc") else float(row["Low"]),
                    "close": float(row["Close"].iloc[0]) if hasattr(row["Close"], "iloc") else float(row["Close"]),
                    "volume": float(row["Volume"].iloc[0]) if hasattr(row["Volume"], "iloc") else float(row["Volume"]),
                })
            except (IndexError, ValueError):
                continue

        candles.sort(key=lambda x: x["time"])
        return {"candles": candles, "pair": ticker, "timeframe": timeframe}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch candles: {e}")


def _fetch_vnindex_candles(limit: int):
    """Try fetching VNINDEX via vnstock."""
    try:
        from vnstock import Vnstock
        from datetime import datetime, timedelta

        stock = Vnstock().stock(symbol="VNINDEX", source="VCI")
        start = (datetime.now() - timedelta(days=730)).strftime("%Y-%m-%d")
        end = datetime.now().strftime("%Y-%m-%d")
        df = stock.quote.history(start=start, end=end, interval="1D")

        if df is None or df.empty:
            return []

        candles = []
        for _, row in df.tail(limit).iterrows():
            try:
                time_val = row.get("time", row.get("date", row.get("trading_date", "")))
                if hasattr(time_val, "timestamp"):
                    ts = int(time_val.timestamp())
                else:
                    ts = int(datetime.strptime(str(time_val)[:10], "%Y-%m-%d").timestamp())
                candles.append({
                    "time": ts,
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row.get("volume", 0)),
                })
            except Exception:
                continue
        return candles
    except Exception:
        return []


@router.get("/neural-levels/{ticker}")
async def get_neural_levels(ticker: str):
    """Get neural price levels for chart overlays."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    levels = {"long": [], "short": []}

    safe_name = ticker.upper().replace("^", "").replace(".", "_")
    low_path = settings.project_dir / "data" / "training" / safe_name / "low_bound_prices.html"
    high_path = settings.project_dir / "data" / "training" / safe_name / "high_bound_prices.html"

    try:
        if low_path.exists():
            for line in low_path.read_text().split("\n"):
                line = line.strip()
                if line and line.replace(".", "").replace("-", "").isdigit():
                    levels["long"].append(float(line))
    except Exception:
        pass

    try:
        if high_path.exists():
            for line in high_path.read_text().split("\n"):
                line = line.strip()
                if line and line.replace(".", "").replace("-", "").isdigit():
                    levels["short"].append(float(line))
    except Exception:
        pass

    return levels


@router.get("/overlays/{ticker}")
async def get_chart_overlays(ticker: str):
    """Get all overlay data for a ticker's chart."""
    if ticker not in settings.tickers:
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    levels = {"long": [], "short": []}
    safe_name = ticker.upper().replace("^", "").replace(".", "_")
    low_path = settings.project_dir / "data" / "training" / safe_name / "low_bound_prices.html"
    high_path = settings.project_dir / "data" / "training" / safe_name / "high_bound_prices.html"

    try:
        if low_path.exists():
            for line in low_path.read_text().split("\n"):
                line = line.strip()
                if line and line.replace(".", "").replace("-", "").isdigit():
                    levels["long"].append(float(line))
    except Exception:
        pass

    try:
        if high_path.exists():
            for line in high_path.read_text().split("\n"):
                line = line.strip()
                if line and line.replace(".", "").replace("-", "").isdigit():
                    levels["short"].append(float(line))
    except Exception:
        pass

    return {
        "neural_levels": levels,
        "ask_price": 0,
        "bid_price": 0,
        "trail_line": 0,
        "dca_line": 0,
        "trades": [],
    }
