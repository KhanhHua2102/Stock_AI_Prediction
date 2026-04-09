"""
Async HTTP client for financialdatasets.ai API with in-memory caching.

All functions return None gracefully when the API key is not configured
or when a request fails, enabling safe use in multi-agent pipelines.
"""

import time
import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# ── In-memory cache: key → (expires_at, data) ─────────────────────────────
_CACHE_TTL = 6 * 3600  # 6 hours in seconds
_cache: dict[str, tuple[float, object]] = {}


def _cache_get(key: str) -> Optional[object]:
    """Return cached value if still valid, else None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, data = entry
    if time.time() > expires_at:
        del _cache[key]
        return None
    return data


def _cache_set(key: str, data: object) -> None:
    """Store data in cache with a 6-hour TTL."""
    _cache[key] = (time.time() + _CACHE_TTL, data)


def _headers() -> dict[str, str]:
    """Build request headers with the API key."""
    return {"X-API-Key": settings.financial_datasets_api_key or ""}


def _available() -> bool:
    """Return True if the financialdatasets.ai API key is configured."""
    return bool(settings.financial_datasets_api_key)


# ── Fetch functions ────────────────────────────────────────────────────────

async def fetch_financial_metrics(ticker: str, limit: int = 10) -> Optional[list[dict]]:
    """
    Fetch TTM financial metrics for a ticker.

    GET /financial-metrics/?ticker=X&limit=N&period=ttm
    Returns list[dict] from response["financial_metrics"], or None on failure.
    """
    if not _available():
        return None

    cache_key = f"financial_metrics:{ticker}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    url = f"{settings.financial_datasets_api_base}/financial-metrics/"
    params = {"ticker": ticker, "limit": limit, "period": "ttm"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json().get("financial_metrics", [])
            _cache_set(cache_key, data)
            return data
    except Exception as exc:
        logger.warning("fetch_financial_metrics(%s) failed: %s", ticker, exc)
        return None


async def fetch_line_items(
    ticker: str,
    line_items: list[str],
    period: str = "annual",
    limit: int = 5,
) -> Optional[list[dict]]:
    """
    Search financial line items for a ticker via POST.

    POST /financials/search/line-items
    Returns list[dict] from response["search_results"], or None on failure.
    """
    if not _available():
        return None

    cache_key = f"line_items:{ticker}:{','.join(sorted(line_items))}:{period}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    url = f"{settings.financial_datasets_api_base}/financials/search/line-items"
    body = {
        "tickers": [ticker],
        "line_items": line_items,
        "period": period,
        "limit": limit,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=body, headers=_headers())
            resp.raise_for_status()
            data = resp.json().get("search_results", [])
            _cache_set(cache_key, data)
            return data
    except Exception as exc:
        logger.warning("fetch_line_items(%s) failed: %s", ticker, exc)
        return None


async def fetch_insider_trades(ticker: str, limit: int = 50) -> Optional[list[dict]]:
    """
    Fetch insider trade filings for a ticker.

    GET /insider-trades/?ticker=X&limit=N
    Returns list[dict] from response["insider_trades"], or None on failure.
    """
    if not _available():
        return None

    cache_key = f"insider_trades:{ticker}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    url = f"{settings.financial_datasets_api_base}/insider-trades/"
    params = {"ticker": ticker, "limit": limit}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json().get("insider_trades", [])
            _cache_set(cache_key, data)
            return data
    except Exception as exc:
        logger.warning("fetch_insider_trades(%s) failed: %s", ticker, exc)
        return None


async def fetch_company_news(ticker: str, limit: int = 20) -> Optional[list[dict]]:
    """
    Fetch recent company news for a ticker.

    GET /news/?ticker=X&limit=N
    Returns list[dict] from response["news"], or None on failure.
    """
    if not _available():
        return None

    cache_key = f"company_news:{ticker}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    url = f"{settings.financial_datasets_api_base}/news/"
    params = {"ticker": ticker, "limit": limit}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json().get("news", [])
            _cache_set(cache_key, data)
            return data
    except Exception as exc:
        logger.warning("fetch_company_news(%s) failed: %s", ticker, exc)
        return None


async def fetch_company_facts(ticker: str) -> Optional[dict]:
    """
    Fetch company facts for a ticker.

    GET /company/facts/?ticker=X
    Returns the full response dict, or None on failure.
    """
    if not _available():
        return None

    cache_key = f"company_facts:{ticker}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    url = f"{settings.financial_datasets_api_base}/company/facts/"
    params = {"ticker": ticker}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json()
            _cache_set(cache_key, data)
            return data
    except Exception as exc:
        logger.warning("fetch_company_facts(%s) failed: %s", ticker, exc)
        return None


async def fetch_prices(ticker: str, limit: int = 252) -> Optional[list[dict]]:
    """
    Fetch daily price history for a ticker.

    GET /prices/?ticker=X&interval=day&limit=N
    Returns list[dict] from response["prices"], or None on failure.
    """
    if not _available():
        return None

    cache_key = f"prices:{ticker}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    url = f"{settings.financial_datasets_api_base}/prices/"
    params = {"ticker": ticker, "interval": "day", "limit": limit}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json().get("prices", [])
            _cache_set(cache_key, data)
            return data
    except Exception as exc:
        logger.warning("fetch_prices(%s) failed: %s", ticker, exc)
        return None
