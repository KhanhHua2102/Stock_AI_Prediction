from fastapi import APIRouter, HTTPException, Query
import httpx
import hashlib
import hmac
import base64
import time
import urllib.parse
from typing import Dict, Any, Optional, List
from datetime import datetime
import asyncio

from app.config import settings
from app.services.file_watcher import file_watcher

router = APIRouter()

# Nonce counter to ensure unique nonces even for rapid calls
_nonce_counter = 0
_nonce_lock = asyncio.Lock()


async def get_unique_nonce() -> int:
    """Generate a unique nonce that always increases."""
    global _nonce_counter
    async with _nonce_lock:
        # Use microseconds + counter to ensure uniqueness
        base_nonce = int(time.time() * 1000000)
        _nonce_counter += 1
        return base_nonce + _nonce_counter

# Kraken asset name mapping
KRAKEN_ASSET_MAP = {
    "XXBT": "BTC",
    "XBT": "BTC",
    "XETH": "ETH",
    "ETH": "ETH",
    "XLTC": "LTC",
    "LTC": "LTC",
    "XXRP": "XRP",
    "XRP": "XRP",
    "XDOGE": "DOGE",
    "DOGE": "DOGE",
    "ZAUD": "AUD",
    "ZUSD": "USD",
    "AUD": "AUD",
}

# Reverse mapping for Kraken pair lookup
ASSET_TO_KRAKEN = {
    "BTC": "XBT",
    "ETH": "ETH",
    "LTC": "LTC",
    "XRP": "XRP",
    "DOGE": "DOGE",
}


def get_kraken_signature(urlpath: str, data: dict, secret: str) -> str:
    """Generate Kraken API signature."""
    postdata = urllib.parse.urlencode(data)
    encoded = (str(data["nonce"]) + postdata).encode()
    message = urlpath.encode() + hashlib.sha256(encoded).digest()
    mac = hmac.new(base64.b64decode(secret), message, hashlib.sha512)
    return base64.b64encode(mac.digest()).decode()


@router.get("/status")
async def get_trader_status():
    """Get current trader status from trader_status.json."""
    status = file_watcher.read_trader_status()
    if not status:
        return {
            "timestamp": None,
            "account": None,
            "positions": {}
        }
    return status


@router.get("/portfolio")
async def get_portfolio():
    """Fetch live portfolio from Kraken API."""
    if not settings.kraken_key or not settings.kraken_secret:
        raise HTTPException(status_code=400, detail="Kraken API credentials not configured")

    try:
        # Get balance from Kraken
        nonce = await get_unique_nonce()
        data = {"nonce": nonce}
        urlpath = "/0/private/Balance"

        headers = {
            "API-Key": settings.kraken_key,
            "API-Sign": get_kraken_signature(urlpath, data, settings.kraken_secret),
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.kraken.com{urlpath}",
                headers=headers,
                data=data,
            )
            result = response.json()

        if result.get("error"):
            raise HTTPException(status_code=400, detail=str(result["error"]))

        balances = result.get("result", {})

        # Convert to standard format - only care about BTC and AUD
        portfolio = []
        btc_price = None

        for kraken_asset, balance_str in balances.items():
            balance = float(balance_str)
            if balance <= 0:
                continue

            asset = KRAKEN_ASSET_MAP.get(kraken_asset, kraken_asset)

            # Only include BTC and AUD
            if asset not in ("BTC", "AUD"):
                continue

            value_aud = 0.0

            if asset == "AUD":
                value_aud = balance
            elif asset == "BTC":
                # Only fetch BTC price once
                if btc_price is None:
                    btc_price = await get_kraken_price("BTC")
                value_aud = balance * btc_price if btc_price else 0.0

            portfolio.append({
                "asset": asset,
                "balance": balance,
                "value_aud": value_aud,
            })

        return {"portfolio": portfolio, "timestamp": time.time()}

    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch portfolio: {e}")


async def get_kraken_price(asset: str, retries: int = 3) -> float:
    """Get current price of an asset in AUD from Kraken with retry logic."""
    pair = f"{asset}AUD"
    if asset == "BTC":
        pair = "XBTAUD"

    for attempt in range(retries):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"https://api.kraken.com/0/public/Ticker?pair={pair}"
                )
                result = response.json()

            if result.get("error"):
                error_msg = str(result["error"])
                if "Rate limit" in error_msg or "EAPI:Rate limit" in error_msg:
                    # Exponential backoff on rate limit
                    wait_time = (2 ** attempt) * 1.0
                    await asyncio.sleep(wait_time)
                    continue
                return 0.0

            ticker = result.get("result", {})
            for key, data in ticker.items():
                # "c" is the last trade closed [price, lot volume]
                return float(data.get("c", [0])[0])
        except Exception:
            if attempt < retries - 1:
                await asyncio.sleep(0.5)
                continue
            return 0.0

    return 0.0


@router.get("/pnl")
async def get_pnl():
    """Get realized PnL from pnl_ledger.json."""
    return file_watcher.read_pnl_ledger()


@router.get("/history")
async def get_account_history(limit: int = 500):
    """Get account value history."""
    history = file_watcher.read_account_history(limit)
    return {"history": history}


@router.get("/trades")
async def get_trade_history(limit: int = 250):
    """Get trade history."""
    trades = file_watcher.read_trade_history(limit)
    return {"trades": trades}


@router.get("/kraken-trades")
async def get_kraken_trades():
    """Fetch trade history directly from Kraken API."""
    if not settings.kraken_key or not settings.kraken_secret:
        raise HTTPException(status_code=400, detail="Kraken API credentials not configured")

    try:
        nonce = await get_unique_nonce()
        data = {"nonce": nonce}
        urlpath = "/0/private/TradesHistory"

        headers = {
            "API-Key": settings.kraken_key,
            "API-Sign": get_kraken_signature(urlpath, data, settings.kraken_secret),
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.kraken.com{urlpath}",
                headers=headers,
                data=data,
                timeout=15.0,
            )
            result = response.json()

        if result.get("error"):
            raise HTTPException(status_code=400, detail=str(result["error"]))

        trades_data = result.get("result", {}).get("trades", {})

        # Convert to list format
        trades = []
        for trade_id, trade in trades_data.items():
            pair = trade.get("pair", "")
            # Extract asset from pair (e.g., "XBTAUD" -> "BTC")
            asset = None
            for kraken_code, std_code in KRAKEN_ASSET_MAP.items():
                if pair.startswith(kraken_code):
                    asset = std_code
                    break

            if asset and asset != "AUD":
                trades.append({
                    "id": trade_id,
                    "asset": asset,
                    "pair": pair,
                    "time": float(trade.get("time", 0)),
                    "type": trade.get("type", ""),  # buy or sell
                    "price": float(trade.get("price", 0)),
                    "vol": float(trade.get("vol", 0)),
                    "cost": float(trade.get("cost", 0)),
                    "fee": float(trade.get("fee", 0)),
                })

        # Sort by time ascending
        trades.sort(key=lambda x: x["time"])

        return {"trades": trades}

    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch trades: {e}")


async def fetch_all_kraken_trades() -> dict:
    """Fetch all trade history from Kraken using pagination."""
    all_trades = {}
    offset = 0

    while True:
        # Small delay between API calls to avoid nonce issues
        await asyncio.sleep(0.1)

        nonce = await get_unique_nonce()
        data = {"nonce": nonce, "ofs": offset}
        urlpath = "/0/private/TradesHistory"

        headers = {
            "API-Key": settings.kraken_key,
            "API-Sign": get_kraken_signature(urlpath, data, settings.kraken_secret),
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.kraken.com{urlpath}",
                headers=headers,
                data=data,
                timeout=30.0,
            )
            result = response.json()

        if result.get("error"):
            # Propagate the error instead of silently breaking
            raise HTTPException(status_code=400, detail=str(result["error"]))

        trades_data = result.get("result", {}).get("trades", {})
        if not trades_data:
            break

        all_trades.update(trades_data)
        count = result.get("result", {}).get("count", 0)

        # Move to next page
        offset += len(trades_data)
        if offset >= count:
            break

    return all_trades


@router.get("/holding-history/{asset}")
async def get_holding_history(
    asset: str,
    interval: int = Query(default=240, description="OHLC interval in minutes (15, 60, 240, 1440)"),
):
    """
    Get holding balance history for a specific asset.
    Uses Kraken trade history to calculate balance changes over time,
    and historical prices to calculate AUD value.
    Fetches ALL data from the beginning.
    """
    if not settings.kraken_key or not settings.kraken_secret:
        raise HTTPException(status_code=400, detail="Kraken API credentials not configured")

    try:
        # 1. Get current balance
        nonce = await get_unique_nonce()
        data = {"nonce": nonce}
        urlpath = "/0/private/Balance"

        headers = {
            "API-Key": settings.kraken_key,
            "API-Sign": get_kraken_signature(urlpath, data, settings.kraken_secret),
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.kraken.com{urlpath}",
                headers=headers,
                data=data,
                timeout=15.0,
            )
            balance_result = response.json()

        if balance_result.get("error"):
            raise HTTPException(status_code=400, detail=str(balance_result["error"]))

        # Find current balance for this asset
        balances = balance_result.get("result", {})
        current_balance = 0.0
        for kraken_asset, balance_str in balances.items():
            mapped_asset = KRAKEN_ASSET_MAP.get(kraken_asset, kraken_asset)
            if mapped_asset == asset:
                current_balance = float(balance_str)
                break

        # 2. Get ALL trade history for this asset
        # Small delay to avoid nonce issues after Balance call
        await asyncio.sleep(0.1)
        all_trades_data = await fetch_all_kraken_trades()

        # Filter trades for this asset
        asset_trades = []
        earliest_trade_time = None
        for trade_id, trade in all_trades_data.items():
            pair = trade.get("pair", "")
            trade_asset = None
            for kraken_code, std_code in KRAKEN_ASSET_MAP.items():
                if pair.startswith(kraken_code):
                    trade_asset = std_code
                    break

            if trade_asset == asset:
                trade_time = float(trade.get("time", 0))
                asset_trades.append({
                    "time": trade_time,
                    "type": trade.get("type", ""),
                    "vol": float(trade.get("vol", 0)),
                    "price": float(trade.get("price", 0)),
                })
                if earliest_trade_time is None or trade_time < earliest_trade_time:
                    earliest_trade_time = trade_time

        # Sort trades by time descending (most recent first) for balance calculation
        asset_trades.sort(key=lambda x: x["time"], reverse=True)

        # 3. Get historical OHLC data - fetch from earliest trade time
        kraken_pair = f"{ASSET_TO_KRAKEN.get(asset, asset)}AUD"

        # Use the earliest trade time as "since" parameter, or default to 720 candles back
        since_param = int(earliest_trade_time) if earliest_trade_time else None

        async with httpx.AsyncClient() as client:
            params = {"pair": kraken_pair, "interval": interval}
            if since_param:
                params["since"] = since_param
            response = await client.get(
                "https://api.kraken.com/0/public/OHLC",
                params=params,
                timeout=30.0,
            )
            ohlc_result = response.json()

        if ohlc_result.get("error"):
            # Try alternative pair format
            kraken_pair = f"X{ASSET_TO_KRAKEN.get(asset, asset)}ZAUD"
            async with httpx.AsyncClient() as client:
                params = {"pair": kraken_pair, "interval": interval}
                if since_param:
                    params["since"] = since_param
                response = await client.get(
                    "https://api.kraken.com/0/public/OHLC",
                    params=params,
                    timeout=30.0,
                )
                ohlc_result = response.json()

        # Extract OHLC data
        ohlc_data = []
        for key, value in ohlc_result.get("result", {}).items():
            if key != "last" and isinstance(value, list):
                ohlc_data = value
                break

        # 4. Build balance history by working backwards from current balance
        # For each OHLC candle, calculate what the balance was at that time
        history_points = []

        if ohlc_data:
            # Sort OHLC data by time ascending first
            ohlc_data.sort(key=lambda x: int(x[0]))

            for candle in ohlc_data:
                candle_time = int(candle[0])
                close_price = float(candle[4])

                # Calculate balance at this point by working backwards through trades
                balance_at_time = current_balance
                for trade in asset_trades:
                    if trade["time"] > candle_time:
                        # This trade happened after this candle, reverse it
                        if trade["type"] == "buy":
                            balance_at_time -= trade["vol"]
                        else:  # sell
                            balance_at_time += trade["vol"]

                # Calculate AUD value at this time
                value_aud = max(0, balance_at_time) * close_price

                history_points.append({
                    "time": candle_time,
                    "balance": max(0, balance_at_time),
                    "price": close_price,
                    "value": value_aud,
                })

        # Ensure history points are sorted by time ascending
        history_points.sort(key=lambda x: x["time"])

        # Also add trade markers, sorted by time ascending
        trade_markers = []
        for trade in asset_trades:
            trade_markers.append({
                "time": int(trade["time"]),
                "side": trade["type"],
                "price": trade["price"],
                "qty": trade["vol"],
            })
        trade_markers.sort(key=lambda x: x["time"])

        return {
            "asset": asset,
            "current_balance": current_balance,
            "data": history_points,
            "trades": trade_markers,
        }

    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch holding history: {e}")
