"""
Stock data fetcher — drop-in replacement for BTCMarketsAPI.

Provides the same interface used by pt_trainer.py and pt_thinker.py:
  market.get_kline(ticker, timeframe, startAt, endAt)
  market.get_ticker(ticker)
  market.get_current_price(ticker)

Data sources:
  - yfinance: ASX (*.AX), US (^GSPC, etc.)
  - vnstock:  Vietnam (VNINDEX)
"""

import time as _time
from datetime import datetime, timezone

import yfinance as yf

# Tickers routed to vnstock instead of yfinance
VNSTOCK_TICKERS = {"VNINDEX"}

TIMEFRAME_MAP = {
    "1day": "1d",
    "1week": "1wk",
}

PERIOD_MAP = {
    "1day": "max",
    "1week": "max",
}


class StockDataFetcher:
    """Drop-in replacement for BTCMarketsAPI / BTCMarketsMarket."""

    def get_kline(self, ticker: str, timeframe: str, startAt: int = None, endAt: int = None):
        """
        Fetch OHLC data.
        Returns KuCoin-compatible format: [[timestamp, open, close, high, low, volume, "0"], ...]
        """
        if timeframe not in TIMEFRAME_MAP:
            return []

        if ticker in VNSTOCK_TICKERS:
            return self._fetch_vnstock(ticker, timeframe, startAt, endAt)
        return self._fetch_yfinance(ticker, timeframe, startAt, endAt)

    def _fetch_yfinance(self, ticker: str, timeframe: str, startAt: int = None, endAt: int = None):
        interval = TIMEFRAME_MAP[timeframe]
        kwargs = {"interval": interval, "progress": False}

        if startAt:
            kwargs["start"] = datetime.fromtimestamp(startAt, tz=timezone.utc).strftime("%Y-%m-%d")
        if endAt:
            kwargs["end"] = datetime.fromtimestamp(endAt, tz=timezone.utc).strftime("%Y-%m-%d")
        if not startAt and not endAt:
            kwargs["period"] = PERIOD_MAP[timeframe]

        try:
            df = yf.download(ticker, **kwargs)
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

    def _fetch_vnstock(self, ticker: str, timeframe: str, startAt: int = None, endAt: int = None):
        """Fetch VNINDEX data using vnstock library."""
        try:
            from vnstock import Vnstock
        except ImportError:
            print("WARNING: vnstock not installed. Cannot fetch VNINDEX data.")
            return []

        resolution = "1D" if timeframe == "1day" else "1W"
        start = datetime.fromtimestamp(startAt, tz=timezone.utc).strftime("%Y-%m-%d") if startAt else "2000-01-01"
        end = datetime.fromtimestamp(endAt, tz=timezone.utc).strftime("%Y-%m-%d") if endAt else datetime.now().strftime("%Y-%m-%d")

        try:
            stock = Vnstock().stock(symbol="VNINDEX", source="VCI")
            df = stock.quote.history(start=start, end=end, interval=resolution)
        except Exception as e:
            print(f"WARNING: vnstock fetch failed: {e}")
            return []

        if df is None or df.empty:
            return []

        result = []
        for _, row in df.iterrows():
            try:
                time_val = row.get("time", row.get("date", row.get("trading_date", "")))
                if hasattr(time_val, "timestamp"):
                    timestamp = int(time_val.timestamp())
                else:
                    timestamp = int(datetime.strptime(str(time_val)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
                result.append([
                    timestamp,
                    float(row["open"]),
                    float(row["close"]),
                    float(row["high"]),
                    float(row["low"]),
                    float(row.get("volume", 0)),
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
        if ticker in VNSTOCK_TICKERS:
            data = self._fetch_vnstock(ticker, "1day")
        else:
            data = self._fetch_yfinance(ticker, "1day")
        if data:
            return float(data[-1][2])  # last close
        return 0.0


# Global instance used by pt_trainer.py and pt_thinker.py
market = StockDataFetcher()
