import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from app.config import settings
from app.services.process_manager import process_manager

router = APIRouter()
_search_executor = ThreadPoolExecutor(max_workers=2)


@router.get("")
async def get_settings():
    """Get current application settings."""
    return {
        "tickers": settings.tickers,
        "default_timeframe": settings.default_timeframe,
        "timeframes": settings.timeframes,
        "candles_limit": settings.candles_limit,
        "ui_refresh_seconds": settings.ui_refresh_seconds,
        "chart_refresh_seconds": settings.chart_refresh_seconds,
        "ws_token": settings.api_key,
    }


class TickersRequest(BaseModel):
    tickers: List[str]


@router.get("/search-ticker")
async def search_ticker(q: str):
    """Search for a ticker symbol across yfinance and VN HOSE."""
    if not q or len(q) < 1:
        return {"results": []}

    query = q.strip().upper()
    loop = asyncio.get_event_loop()

    # Run both searches in parallel in a thread pool (they do blocking I/O)
    tasks = [loop.run_in_executor(_search_executor, _search_yfinance, query)]
    if query.isalpha() and "." not in q and "^" not in q:
        tasks.append(loop.run_in_executor(_search_executor, _search_vnstock, query))

    all_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for r in all_results:
        if isinstance(r, list):
            results.extend(r)

    # Deduplicate by symbol
    seen = set()
    unique = []
    for r in results:
        if r["symbol"] not in seen:
            seen.add(r["symbol"])
            unique.append(r)

    return {"results": unique[:10]}


def _search_yfinance(query: str) -> list:
    """Use Yahoo Finance search API for fast results."""
    import requests

    results = []
    try:
        resp = requests.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": query, "quotesCount": 8, "newsCount": 0, "listsCount": 0},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            for quote in data.get("quotes", []):
                symbol = quote.get("symbol", "")
                if not symbol:
                    continue
                results.append({
                    "symbol": symbol,
                    "name": quote.get("longname") or quote.get("shortname") or symbol,
                    "exchange": quote.get("exchange", ""),
                })
    except Exception:
        pass

    # If no results from search API, try direct validation for exact symbols
    if not results:
        import yfinance as yf
        candidates = [query]
        if "." not in query and "^" not in query:
            candidates.extend([f"{query}.AX", f"^{query}"])
        for symbol in candidates:
            try:
                info = yf.Ticker(symbol).fast_info
                if hasattr(info, "last_price") and info.last_price and info.last_price > 0:
                    results.append({"symbol": symbol, "name": symbol, "exchange": ""})
            except Exception:
                continue

    return results


def _search_vnstock(query: str) -> list:
    try:
        from vnstock import Vnstock
    except ImportError:
        return []

    results = []
    try:
        stock = Vnstock().stock(symbol=query, source="VCI")
        df = stock.quote.history(start="2025-01-01", end="2025-01-10", interval="1D")
        if df is not None and not df.empty:
            results.append({
                "symbol": query,
                "name": f"{query} (VN HOSE)",
                "exchange": "HOSE",
            })
    except Exception:
        pass

    return results


@router.post("/tickers")
async def update_tickers(request: TickersRequest):
    """Update the available tickers list."""
    status = process_manager.get_status()
    if status["neural"]["running"]:
        raise HTTPException(status_code=400, detail="Cannot change tickers while runner is active")

    if not request.tickers:
        raise HTTPException(status_code=400, detail="Must have at least one ticker")

    # Update gui_settings.json
    settings_path = settings.project_dir / "legacy" / "gui_settings.json"
    try:
        if settings_path.exists():
            data = json.loads(settings_path.read_text())
        else:
            data = {}
        data["tickers"] = request.tickers
        data.pop("coins", None)
        settings_path.write_text(json.dumps(data, indent=2))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {e}")

    # Update in-memory config
    settings.tickers = request.tickers

    return {
        "tickers": settings.tickers,
        "default_timeframe": settings.default_timeframe,
        "timeframes": settings.timeframes,
        "candles_limit": settings.candles_limit,
        "ui_refresh_seconds": settings.ui_refresh_seconds,
        "chart_refresh_seconds": settings.chart_refresh_seconds,
    }
