"""
Stock data fetcher — drop-in replacement for BTCMarketsAPI.

Provides the same interface used by pt_trainer.py and pt_thinker.py:
  market.get_kline(ticker, timeframe, startAt, endAt)
  market.get_ticker(ticker)
  market.get_current_price(ticker)

Data sources:
  - vnstock: VNINDEX (VN-Index via VCI)
  - yfinance: Everything else (ASX *.AX, US ^GSPC, etc.)

Caching:
  - Downloaded data is cached to data/cache/{ticker}_{timeframe}.json
  - Subsequent calls serve from cache, only fetching new data if cache
    is stale (older than CACHE_MAX_AGE_SECONDS)
"""

import json
import time as _time
from datetime import datetime
from pathlib import Path

import yfinance as yf

# Tickers that must use vnstock (not available on yfinance)
VNSTOCK_TICKERS = {"VNINDEX"}

TIMEFRAME_MAP = {
    "1hour": "1h",
    "2hour": "1h",   # yfinance has no 2h; use 1h as closest
    "4hour": "1h",   # same — aggregate if needed
    "8hour": "1h",
    "12hour": "1h",
    "1day": "1d",
    "1week": "1wk",
}

VNSTOCK_INTERVAL_MAP = {
    "1hour": "1H",
    "1day": "1D",
    "1week": "1W",
}

# yfinance 1h data is limited to ~730 days; daily/weekly can go further
PERIOD_MAP = {
    "1hour": "730d",
    "2hour": "730d",
    "4hour": "730d",
    "8hour": "730d",
    "12hour": "730d",
    "1day": "max",
    "1week": "max",
}

# Re-fetch if cache is older than 6 hours (picks up today's new candle)
CACHE_MAX_AGE_SECONDS = 6 * 3600

# Cache directory relative to project root
_CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"


def _safe_name(ticker: str) -> str:
    return ticker.replace("^", "").replace(".", "_")


class _CandleCache:
    """Disk-backed candle cache per ticker/timeframe."""

    def __init__(self, cache_dir: Path):
        self._dir = cache_dir
        self._mem: dict[str, list] = {}  # in-memory copy keyed by "ticker_tf"

    def _path(self, ticker: str, timeframe: str) -> Path:
        return self._dir / f"{_safe_name(ticker)}_{timeframe}.json"

    def load(self, ticker: str, timeframe: str) -> list | None:
        """Load cached candles. Returns None if cache is missing or stale."""
        key = f"{ticker}_{timeframe}"
        if key in self._mem:
            return self._mem[key]

        path = self._path(ticker, timeframe)
        if not path.exists():
            return None

        # Check staleness
        age = _time.time() - path.stat().st_mtime
        if age > CACHE_MAX_AGE_SECONDS:
            return None

        try:
            with open(path) as f:
                candles = json.load(f)
            self._mem[key] = candles
            return candles
        except Exception:
            return None

    def save(self, ticker: str, timeframe: str, candles: list):
        """Save candles to disk and memory, merging with existing data."""
        key = f"{ticker}_{timeframe}"
        existing = self._mem.get(key)

        if existing:
            # Merge: deduplicate by timestamp
            by_ts = {c[0]: c for c in existing}
            for c in candles:
                by_ts[c[0]] = c
            merged = sorted(by_ts.values(), key=lambda c: c[0])
        else:
            merged = sorted(candles, key=lambda c: c[0])

        self._mem[key] = merged

        self._dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self._path(ticker, timeframe), "w") as f:
                json.dump(merged, f)
        except Exception:
            pass

    def filter(self, candles: list, startAt: int = None, endAt: int = None) -> list:
        """Filter candles to a time range."""
        result = candles
        if endAt:
            result = [c for c in result if c[0] <= endAt]
        if startAt:
            result = [c for c in result if c[0] >= startAt]
        return result


class StockDataFetcher:
    """Drop-in replacement for BTCMarketsAPI / BTCMarketsMarket."""

    def __init__(self):
        self._cache = _CandleCache(_CACHE_DIR)

    def get_kline(self, ticker: str, timeframe: str, startAt: int = None, endAt: int = None):
        """
        Fetch OHLC data with caching.
        Returns KuCoin-compatible format: [[timestamp, open, close, high, low, volume, 0], ...]
        """
        if timeframe not in TIMEFRAME_MAP:
            return []

        # Try cache first
        cached = self._cache.load(ticker, timeframe)
        if cached:
            filtered = self._cache.filter(cached, startAt, endAt)
            if filtered:
                return filtered

        # Cache miss — fetch all available data
        if ticker in VNSTOCK_TICKERS:
            candles = self._fetch_vnstock_all(ticker, timeframe)
        else:
            candles = self._fetch_yfinance_all(ticker, timeframe)

        if candles:
            self._cache.save(ticker, timeframe, candles)
            return self._cache.filter(candles, startAt, endAt)

        return []

    def _fetch_vnstock_all(self, ticker: str, timeframe: str) -> list:
        """Fetch all available data via vnstock."""
        interval = VNSTOCK_INTERVAL_MAP.get(timeframe)
        if not interval:
            return []

        try:
            from vnstock import Vnstock
            stock = Vnstock().stock(symbol=ticker, source='VCI')
            df = stock.quote.history(
                symbol=ticker,
                start="2000-01-01",
                end=datetime.now().strftime("%Y-%m-%d"),
                interval=interval,
            )
        except Exception:
            return []

        if df is None or df.empty:
            return []

        result = []
        for _, row in df.iterrows():
            try:
                ts = row.get("time") or row.get("date") or row.get("TradingDate")
                if ts is None:
                    continue
                if isinstance(ts, str):
                    ts = datetime.fromisoformat(ts)
                timestamp = int(ts.timestamp()) if hasattr(ts, 'timestamp') else int(_time.mktime(ts.timetuple()))
                result.append([
                    timestamp,
                    float(row.get("open", 0)),
                    float(row.get("close", 0)),
                    float(row.get("high", 0)),
                    float(row.get("low", 0)),
                    float(row.get("volume", 0)),
                    0,
                ])
            except Exception:
                continue
        return result

    def _fetch_yfinance_all(self, ticker: str, timeframe: str) -> list:
        """Fetch all available data via yfinance."""
        interval = TIMEFRAME_MAP[timeframe]
        period = PERIOD_MAP[timeframe]

        try:
            df = yf.download(ticker, interval=interval, period=period, progress=False)
        except Exception:
            return []

        if df is None or df.empty:
            return []

        result = []
        for ts, row in df.iterrows():
            try:
                timestamp = int(ts.timestamp())
                result.append([
                    timestamp,
                    float(row["Open"].iloc[0]) if hasattr(row["Open"], "iloc") else float(row["Open"]),
                    float(row["Close"].iloc[0]) if hasattr(row["Close"], "iloc") else float(row["Close"]),
                    float(row["High"].iloc[0]) if hasattr(row["High"], "iloc") else float(row["High"]),
                    float(row["Low"].iloc[0]) if hasattr(row["Low"], "iloc") else float(row["Low"]),
                    float(row["Volume"].iloc[0]) if hasattr(row["Volume"], "iloc") else float(row["Volume"]),
                    0,
                ])
            except Exception:
                continue
        return result

    def get_ticker(self, ticker: str) -> dict:
        """Get current price. Returns {"price": float} for compatibility."""
        return {"price": self.get_current_price(ticker)}

    def get_current_price(self, ticker: str) -> float:
        """Get latest close price."""
        data = self.get_kline(ticker, "1day")
        if data:
            return float(data[-1][2])  # last close
        return 0.0


# Global instance used by pt_trainer.py and pt_thinker.py
market = StockDataFetcher()
