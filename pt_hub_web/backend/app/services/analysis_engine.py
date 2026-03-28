import asyncio
import json
import logging
from typing import Callable, List, Optional

import httpx
from app.config import settings
from app.services.analysis_db import AnalysisDB

logger = logging.getLogger(__name__)


async def _fetch_reddit_sentiment(ticker: str) -> Optional[dict]:
    """Fetch Reddit sentiment from Tradestie API."""
    try:
        async with httpx.AsyncClient(verify=False) as client:
            response = await client.get("https://api.tradestie.com/v1/apps/reddit", timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                for item in data:
                    if item.get("ticker") == ticker:
                        return {
                            "no_of_comments": item.get("no_of_comments"),
                            "sentiment": item.get("sentiment"),
                            "sentiment_score": item.get("sentiment_score"),
                        }
    except Exception as e:
        logger.warning(f"Failed to fetch Reddit sentiment for {ticker}: {e}")
    return None


async def _fetch_stocktwits_sentiment(ticker: str) -> Optional[dict]:
    """Fetch sentiment from StockTwits community."""
    try:
        url = f"https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json"
        async with httpx.AsyncClient(verify=False) as client:
            response = await client.get(url, timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                symbol = data.get("symbol", {})
                # Overall sentiment from StockTwits
                sentiment_info = symbol.get("sentiment") or {}
                basic = sentiment_info.get("basic") or {}
                # Count bullish/bearish from recent messages
                messages = data.get("messages", [])
                bullish = sum(1 for m in messages if (m.get("entities", {}).get("sentiment", {}).get("basic") == "Bullish"))
                bearish = sum(1 for m in messages if (m.get("entities", {}).get("sentiment", {}).get("basic") == "Bearish"))
                return {
                    "sentiment": basic.get("sentiment", "Unknown"),
                    "bullish_count": bullish,
                    "bearish_count": bearish,
                    "total_messages": len(messages),
                }
    except Exception as e:
        logger.warning(f"Failed to fetch StockTwits sentiment for {ticker}: {e}")
    return None


async def _fetch_fear_greed_index() -> Optional[dict]:
    """Fetch CNN Fear & Greed Index for overall market sentiment."""
    try:
        url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://edition.cnn.com/",
        }
        async with httpx.AsyncClient(verify=False) as client:
            response = await client.get(url, timeout=10.0, headers=headers)
            if response.status_code == 200:
                data = response.json()
                fg = data.get("fear_and_greed", {})
                prev = data.get("fear_and_greed_historical", {}).get("previousClose", {})
                return {
                    "score": round(fg.get("score", 0), 1),
                    "rating": fg.get("rating", "Unknown"),
                    "previous_close": round(prev.get("score", 0), 1) if prev else None,
                }
    except Exception as e:
        logger.warning(f"Failed to fetch Fear & Greed Index: {e}")
    return None


_cik_cache: dict = {}


async def _get_cik(ticker: str) -> Optional[str]:
    """Map ticker to CIK using SEC's company_tickers.json."""
    global _cik_cache
    if ticker in _cik_cache:
        return _cik_cache[ticker]

    try:
        headers = {"User-Agent": settings.sec_user_agent}
        async with httpx.AsyncClient() as client:
            response = await client.get("https://www.sec.gov/files/company_tickers.json", headers=headers)
            if response.status_code == 200:
                data = response.json()
                for item in data.values():
                    if item.get("ticker") == ticker:
                        cik = str(item.get("cik_str")).zfill(10)
                        _cik_cache[ticker] = cik
                        return cik
    except Exception as e:
        logger.warning(f"Failed to map ticker {ticker} to CIK: {e}")
    return None


async def _fetch_sec_filings(cik: str) -> List[dict]:
    """Fetch recent filings for a CIK."""
    try:
        headers = {"User-Agent": settings.sec_user_agent}
        async with httpx.AsyncClient() as client:
            response = await client.get(f"https://data.sec.gov/submissions/CIK{cik}.json", headers=headers)
            if response.status_code == 200:
                data = response.json()
                recent = data.get("filings", {}).get("recent", {})
                filings = []
                # Columnar format: map by index
                forms = recent.get("form", [])
                dates = recent.get("filingDate", [])
                for i in range(min(5, len(forms))):
                    filings.append({
                        "form": forms[i],
                        "date": dates[i],
                    })
                return filings
    except Exception as e:
        logger.warning(f"Failed to fetch SEC filings for CIK {cik}: {e}")
    return []


async def _fetch_finnhub_recommendations(ticker: str) -> Optional[dict]:
    """Fetch analyst recommendations from Finnhub."""
    if not settings.finnhub_api_key:
        return None
    try:
        url = f"https://finnhub.io/api/v1/stock/recommendation?symbol={ticker}&token={settings.finnhub_api_key}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    latest = data[0]
                    return {
                        "strongBuy": latest.get("strongBuy", 0),
                        "buy": latest.get("buy", 0),
                        "hold": latest.get("hold", 0),
                        "sell": latest.get("sell", 0),
                        "strongSell": latest.get("strongSell", 0),
                        "period": latest.get("period", ""),
                    }
    except Exception as e:
        logger.warning(f"Failed to fetch Finnhub recommendations for {ticker}: {e}")
    return None


_NEWS_SEARCH_QUERIES: dict = {
    "VNINDEX": "Vietnam stock market VNINDEX",
    "^GSPC": "S&P 500 stock market",
    "^DJI": "Dow Jones stock market",
    "^IXIC": "Nasdaq composite stock market",
}


async def _fetch_ticker_news(ticker: str) -> List[dict]:
    """Fetch recent news relevant to a ticker via Google News RSS + Finnhub fallback."""
    import html as html_mod
    import re
    import urllib.parse
    from datetime import datetime
    from email.utils import parsedate_to_datetime

    # Build a search query relevant to the ticker
    query = _NEWS_SEARCH_QUERIES.get(ticker)
    if not query:
        # For .AX ETFs / individual stocks, search by ticker + exchange context
        if ticker.endswith(".AX"):
            query = f"{ticker} ASX"
        else:
            query = f"{ticker} stock"

    try:
        rss_url = (
            f"https://news.google.com/rss/search"
            f"?q={urllib.parse.quote(query)}&hl=en&gl=US&ceid=US:en"
        )
        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(
                rss_url, timeout=10.0,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if response.status_code == 200:
                text = response.text
                # Parse RSS items
                titles = re.findall(r"<title><!\[CDATA\[(.*?)\]\]></title>", text)
                if not titles:
                    titles = re.findall(r"<title>(.*?)</title>", text)
                sources = re.findall(r"<source[^>]*>(.*?)</source>", text)
                dates = re.findall(r"<pubDate>(.*?)</pubDate>", text)
                links = re.findall(r"<link/>\s*<guid[^>]*>(.*?)</guid>", text)
                if not links:
                    links = re.findall(r"<link>(.*?)</link>", text)

                articles = []
                # Skip first title (feed title) — items start at index 1
                for i in range(1, min(6, len(titles))):
                    headline = html_mod.unescape(titles[i])
                    # Skip the "Google News" placeholder title
                    if headline == "Google News":
                        continue
                    source = html_mod.unescape(sources[i - 1]) if i - 1 < len(sources) else ""
                    url = links[i] if i < len(links) else ""

                    ts = 0
                    if i - 1 < len(dates):
                        try:
                            ts = int(parsedate_to_datetime(dates[i - 1]).timestamp())
                        except Exception:
                            pass

                    articles.append({
                        "headline": headline,
                        "source": source,
                        "datetime": ts,
                        "url": url,
                    })

                if articles:
                    return articles[:5]
    except Exception as e:
        logger.warning(f"Failed to fetch Google News for {ticker}: {e}")

    # Fallback: Finnhub company news (works well for US large-caps)
    if settings.finnhub_api_key and not ticker.startswith("^") and ticker != "VNINDEX":
        try:
            from datetime import timedelta
            today = datetime.now().strftime("%Y-%m-%d")
            from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
            url = (
                f"https://finnhub.io/api/v1/company-news"
                f"?symbol={ticker}&from={from_date}&to={today}&token={settings.finnhub_api_key}"
            )
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=10.0)
                if resp.status_code == 200:
                    data = resp.json()
                    return [
                        {
                            "headline": item.get("headline", ""),
                            "source": item.get("source", ""),
                            "datetime": item.get("datetime", 0),
                            "url": item.get("url", ""),
                        }
                        for item in data[:5]
                    ]
        except Exception as e:
            logger.warning(f"Failed to fetch Finnhub news for {ticker}: {e}")

    return []


async def _fetch_price_target(ticker: str) -> Optional[dict]:
    """Fetch analyst price targets from Twelve Data."""
    if not settings.twelvedata_api_key:
        return None
    try:
        url = f"https://api.twelvedata.com/price_target?symbol={ticker}&apikey={settings.twelvedata_api_key}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok" and data.get("price_target"):
                    pt = data["price_target"]
                    return {
                        "high": pt.get("high"),
                        "low": pt.get("low"),
                        "average": pt.get("average"),
                        "median": pt.get("median"),
                        "current": pt.get("current"),
                    }
    except Exception as e:
        logger.warning(f"Failed to fetch price target for {ticker}: {e}")
    return None


async def _fetch_fmp_valuation(ticker: str) -> Optional[dict]:
    """Fetch DCF fair value and key financial ratios from Financial Modeling Prep."""
    if not settings.fmp_api_key:
        return None
    # FMP coverage is primarily US stocks
    if ticker == "VNINDEX" or ticker.endswith(".AX"):
        return None
    try:
        base = "https://financialmodelingprep.com/stable"
        key = settings.fmp_api_key

        async def _get(path: str) -> Optional[dict]:
            async with httpx.AsyncClient() as client:
                resp = await client.get(f"{base}/{path}?symbol={ticker}&apikey={key}", timeout=10.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list) and data:
                        return data[0]
                    return data if isinstance(data, dict) else None
            return None

        dcf_data, ratios_data = await asyncio.gather(
            _get("discounted-cash-flow"),
            _get("ratios-ttm"),
        )

        result = {}
        if dcf_data:
            result["dcf"] = dcf_data.get("dcf")
            result["stock_price"] = dcf_data.get("Stock Price")
        if ratios_data:
            result["pe_ratio"] = ratios_data.get("priceToEarningsRatioTTM")
            result["net_profit_margin"] = ratios_data.get("netProfitMarginTTM")
            result["current_ratio"] = ratios_data.get("currentRatioTTM")
            result["debt_equity_ratio"] = ratios_data.get("debtEquityRatioTTM")
            result["roe"] = ratios_data.get("returnOnEquityTTM")

        return result if result else None
    except Exception as e:
        logger.warning(f"Failed to fetch FMP valuation for {ticker}: {e}")
    return None


async def _fetch_treasury_rates() -> Optional[dict]:
    """Fetch US Treasury average interest rates from the Fed Treasury fiscal data API."""
    try:
        url = (
            "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
            "v2/accounting/od/avg_interest_rates"
            "?sort=-record_date&page[size]=20"
            "&filter=security_desc:in:(Treasury Bills,Treasury Notes,Treasury Bonds)"
        )
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            if response.status_code == 200:
                data = response.json().get("data", [])
                if not data:
                    return None
                # Group by security type, take the most recent entry for each
                rates = {}
                record_date = data[0].get("record_date", "")
                for entry in data:
                    desc = entry.get("security_desc", "")
                    rate = entry.get("avg_interest_rate_amt")
                    if rate and desc not in rates:
                        rates[desc] = float(rate)
                return {
                    "date": record_date,
                    "bills": rates.get("Treasury Bills"),
                    "notes": rates.get("Treasury Notes"),
                    "bonds": rates.get("Treasury Bonds"),
                }
    except Exception as e:
        logger.warning(f"Failed to fetch treasury rates: {e}")
    return None


async def _fetch_fred_series(series_id: str) -> Optional[tuple]:
    """Fetch latest observation from FRED API."""
    if not settings.fred_api_key:
        return None
    try:
        url = (
            f"https://api.stlouisfed.org/fred/series/observations"
            f"?series_id={series_id}&api_key={settings.fred_api_key}"
            f"&file_type=json&limit=1&sort_order=desc"
        )
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            if response.status_code == 200:
                obs = response.json().get("observations", [])
                if obs and obs[0].get("value") != ".":
                    return {"latest": float(obs[0]["value"]), "date": obs[0]["date"]}
    except Exception as e:
        logger.warning(f"Failed to fetch FRED {series_id}: {e}")
    return None


async def _fetch_macro_indicators(ticker: str) -> Optional[dict]:
    """Fetch macroeconomic indicators. Uses FRED for US (if key available), Econdb for AU/VN."""
    if ticker == "VNINDEX":
        region = "Vietnam"
    elif ticker.endswith(".AX"):
        region = "Australia"
    else:
        region = "US"

    # US with FRED key: use authoritative FRED data
    if region == "US" and settings.fred_api_key:
        fred_series = {
            "cpi": "CPIAUCSL",
            "unemployment": "UNRATE",
            "fed_funds_rate": "FEDFUNDS",
        }
        results = await asyncio.gather(*[
            _fetch_fred_series(series_id)
            for series_id in fred_series.values()
        ])
        indicators = {"region": "US", "source": "FRED"}
        has_data = False
        for name, result in zip(fred_series.keys(), results):
            if result is not None:
                indicators[name] = result
                has_data = True
        if has_data:
            return indicators
        # Fall through to Econdb if FRED fails

    # Econdb fallback (AU, VN, or FRED failure)
    if ticker == "VNINDEX":
        series_map = {"cpi": "CPIVN"}
    elif ticker.endswith(".AX"):
        series_map = {"cpi": "CPIAUS", "gdp_growth": "RGDPAU"}
    else:
        series_map = {"cpi": "CPIUS", "gdp_growth": "RGDPUS", "unemployment": "URATEUS"}

    async def _fetch_econdb(name: str, econdb_ticker: str) -> tuple:
        try:
            url = f"https://www.econdb.com/api/series/{econdb_ticker}/?format=json"
            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=10.0)
                if response.status_code == 200:
                    body = response.json()
                    data = body.get("data", {})
                    dates = data.get("dates", [])
                    values = data.get("values", [])
                    if dates and values:
                        return (name, {"latest": values[-1], "date": dates[-1][:10]})
        except Exception as e:
            logger.warning(f"Failed to fetch Econdb {econdb_ticker}: {e}")
        return (name, None)

    results = await asyncio.gather(*[
        _fetch_econdb(name, econ_ticker)
        for name, econ_ticker in series_map.items()
    ])

    indicators = {"region": region}
    has_data = False
    for name, value in results:
        if value is not None:
            indicators[name] = value
            has_data = True

    return indicators if has_data else None


def _fetch_candles(ticker: str, limit: int = 200) -> list:
    """Fetch OHLCV candles via yfinance/vnstock. Returns list of dicts."""
    if ticker == "VNINDEX":
        candles = _fetch_vnindex(limit)
        if candles:
            return candles

    import yfinance as yf

    df = yf.download(ticker, period="2y", interval="1d", progress=False)
    if df is None or df.empty:
        return []

    candles = []
    for ts, row in df.tail(limit).iterrows():
        try:
            candles.append({
                "time": ts.strftime("%Y-%m-%d"),
                "open": float(row["Open"].iloc[0]) if hasattr(row["Open"], "iloc") else float(row["Open"]),
                "high": float(row["High"].iloc[0]) if hasattr(row["High"], "iloc") else float(row["High"]),
                "low": float(row["Low"].iloc[0]) if hasattr(row["Low"], "iloc") else float(row["Low"]),
                "close": float(row["Close"].iloc[0]) if hasattr(row["Close"], "iloc") else float(row["Close"]),
                "volume": float(row["Volume"].iloc[0]) if hasattr(row["Volume"], "iloc") else float(row["Volume"]),
            })
        except (IndexError, ValueError):
            continue
    return candles


def _fetch_vnindex(limit: int) -> list:
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
            time_val = row.get("time", row.get("date", row.get("trading_date", "")))
            candles.append({
                "time": str(time_val)[:10],
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume", 0)),
            })
        return candles
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Technical indicator computation (pure Python)
# ---------------------------------------------------------------------------

def _sma(closes: list, period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _rsi(closes: list, period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _ema(values: list, period: int) -> list:
    if len(values) < period:
        return []
    k = 2 / (period + 1)
    ema_vals = [sum(values[:period]) / period]
    for v in values[period:]:
        ema_vals.append(v * k + ema_vals[-1] * (1 - k))
    return ema_vals


def _macd(closes: list) -> dict:
    if len(closes) < 35:
        return {"signal": None, "histogram": None, "direction": "unknown"}
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    min_len = min(len(ema12), len(ema26))
    macd_line = [ema12[-(min_len - i)] - ema26[-(min_len - i)] for i in range(min_len)]
    if len(macd_line) < 9:
        return {"signal": None, "histogram": None, "direction": "unknown"}
    signal_line = _ema(macd_line, 9)
    histogram = macd_line[-1] - signal_line[-1] if signal_line else 0
    direction = "bullish" if histogram > 0 else "bearish"
    return {
        "signal": round(signal_line[-1], 4) if signal_line else None,
        "histogram": round(histogram, 4),
        "direction": direction,
    }


def _pivot_support_resistance(candles: list, window: int = 5) -> dict:
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    supports, resistances = [], []

    for i in range(window, len(candles) - window):
        if all(lows[i] <= lows[i - j] for j in range(1, window + 1)) and \
           all(lows[i] <= lows[i + j] for j in range(1, window + 1)):
            supports.append(lows[i])
        if all(highs[i] >= highs[i - j] for j in range(1, window + 1)) and \
           all(highs[i] >= highs[i + j] for j in range(1, window + 1)):
            resistances.append(highs[i])

    supports = sorted(set(round(s, 2) for s in supports))[-3:]
    resistances = sorted(set(round(r, 2) for r in resistances))[-3:]
    return {"support": supports, "resistance": resistances}


def compute_indicators(candles: list) -> dict:
    closes = [c["close"] for c in candles]
    volumes = [c["volume"] for c in candles]

    sma20 = _sma(closes, 20)
    sma50 = _sma(closes, 50)
    sma200 = _sma(closes, 200)

    if sma20 and sma50 and sma200:
        if sma20 > sma50 > sma200:
            alignment = "bullish"
        elif sma20 < sma50 < sma200:
            alignment = "bearish"
        else:
            alignment = "mixed"
    else:
        alignment = "insufficient_data"

    rsi_val = _rsi(closes)
    rsi_zone = "neutral"
    if rsi_val is not None:
        if rsi_val >= 70:
            rsi_zone = "overbought"
        elif rsi_val <= 30:
            rsi_zone = "oversold"

    macd_data = _macd(closes)

    vol_avg = sum(volumes[-20:]) / min(len(volumes), 20) if volumes else 0
    vol_current = volumes[-1] if volumes else 0
    vol_ratio = round(vol_current / vol_avg, 2) if vol_avg > 0 else 0

    sr = _pivot_support_resistance(candles)

    all_closes = closes
    high_52w = max(c["high"] for c in candles[-min(252, len(candles)):])
    low_52w = min(c["low"] for c in candles[-min(252, len(candles)):])

    return {
        "ma_alignment": {
            "sma20": round(sma20, 2) if sma20 else None,
            "sma50": round(sma50, 2) if sma50 else None,
            "sma200": round(sma200, 2) if sma200 else None,
            "status": alignment,
        },
        "rsi": {
            "value": round(rsi_val, 1) if rsi_val else None,
            "zone": rsi_zone,
        },
        "macd": macd_data,
        "volume": {
            "current": vol_current,
            "average": round(vol_avg, 0),
            "ratio": vol_ratio,
        },
        "support": sr["support"],
        "resistance": sr["resistance"],
        "price_range_52w": {
            "high": round(high_52w, 2),
            "low": round(low_52w, 2),
        },
    }


# ---------------------------------------------------------------------------
# LLM prompt
# ---------------------------------------------------------------------------
def build_prompt(
    ticker: str,
    current_price: float,
    indicators: dict,
    sentiment: Optional[dict] = None,
    filings: List[dict] = [],
    macro: Optional[dict] = None,
    treasury: Optional[dict] = None,
    analyst: Optional[dict] = None,
    news: List[dict] = [],
    price_target: Optional[dict] = None,
    valuation: Optional[dict] = None,
    stocktwits: Optional[dict] = None,
    fear_greed: Optional[dict] = None,
    strategy_instructions: str = "",
    market_context: str = "",
) -> str:
    ma = indicators["ma_alignment"]
    rsi = indicators["rsi"]
    macd = indicators["macd"]
    vol = indicators["volume"]

    sentiment_parts = []
    if sentiment:
        sentiment_parts.append(f"""### Reddit (r/WallStreetBets)
- Status: {sentiment['sentiment']}
- Sentiment Score: {sentiment['sentiment_score']}
- Number of Comments: {sentiment['no_of_comments']}""")
    if stocktwits:
        sentiment_parts.append(f"""### StockTwits Community
- Overall Sentiment: {stocktwits['sentiment']}
- Bullish Posts: {stocktwits['bullish_count']} | Bearish Posts: {stocktwits['bearish_count']}
- Total Messages Sampled: {stocktwits['total_messages']}""")
    if fear_greed:
        prev_str = f" (prev close: {fear_greed['previous_close']})" if fear_greed.get('previous_close') else ""
        sentiment_parts.append(f"""### Market Fear & Greed Index (CNN)
- Score: {fear_greed['score']}/100 ({fear_greed['rating']}){prev_str}""")

    sentiment_section = ""
    if sentiment_parts:
        sentiment_section = "## Social Intelligence\n" + "\n".join(sentiment_parts) + "\n"

    filings_section = ""
    if filings:
        filings_str = "\n".join([f"- {f['date']}: {f['form']}" for f in filings])
        filings_section = f"""## Recent SEC Filings
{filings_str}
"""

    macro_section = ""
    if macro:
        source = macro.get("source", "Econdb")
        lines = [f"## Macroeconomic Context ({macro.get('region', 'N/A')}) — via {source}"]
        if "cpi" in macro:
            lines.append(f"- CPI (Inflation): {macro['cpi']['latest']} ({macro['cpi']['date']})")
        if "gdp_growth" in macro:
            lines.append(f"- GDP Growth: {macro['gdp_growth']['latest']} ({macro['gdp_growth']['date']})")
        if "unemployment" in macro:
            lines.append(f"- Unemployment Rate: {macro['unemployment']['latest']}% ({macro['unemployment']['date']})")
        if "fed_funds_rate" in macro:
            lines.append(f"- Federal Funds Rate: {macro['fed_funds_rate']['latest']}% ({macro['fed_funds_rate']['date']})")
        macro_section = "\n".join(lines) + "\n"

    treasury_section = ""
    if treasury:
        lines = [f"## Interest Rate Environment (as of {treasury.get('date', 'N/A')})"]
        if treasury.get("bills") is not None:
            lines.append(f"- Treasury Bills: {treasury['bills']}%")
        if treasury.get("notes") is not None:
            lines.append(f"- Treasury Notes: {treasury['notes']}%")
        if treasury.get("bonds") is not None:
            lines.append(f"- Treasury Bonds: {treasury['bonds']}%")
        treasury_section = "\n".join(lines) + "\n"

    analyst_section = ""
    if analyst:
        total = analyst['strongBuy'] + analyst['buy'] + analyst['hold'] + analyst['sell'] + analyst['strongSell']
        analyst_section = f"""## Analyst Consensus (Finnhub, {analyst['period']})
- Strong Buy: {analyst['strongBuy']} | Buy: {analyst['buy']} | Hold: {analyst['hold']} | Sell: {analyst['sell']} | Strong Sell: {analyst['strongSell']}
- Total Analysts: {total}
"""

    price_target_section = ""
    if price_target:
        price_target_section = f"""## Analyst Price Targets (Twelve Data)
- Average Target: ${price_target['average']} | Median: ${price_target['median']}
- High: ${price_target['high']} | Low: ${price_target['low']}
- Current Price: ${price_target['current']}
"""

    news_section = ""
    if news:
        from datetime import datetime
        news_lines = []
        for item in news:
            ts = item.get("datetime", 0)
            date_str = datetime.fromtimestamp(ts).strftime("%m/%d") if ts else ""
            news_lines.append(f"- [{item['source']}] {item['headline']} ({date_str})")
        news_section = "## Recent News Headlines\n" + "\n".join(news_lines) + "\n"

    valuation_section = ""
    if valuation:
        lines = ["## Fundamental Valuation (FMP)"]
        if valuation.get("dcf") is not None and valuation.get("stock_price") is not None:
            dcf = valuation["dcf"]
            price = valuation["stock_price"]
            pct = round((price - dcf) / dcf * 100, 1) if dcf else 0
            label = "overvalued" if pct > 0 else "undervalued"
            lines.append(f"- DCF Fair Value: ${dcf:.2f} vs Current: ${price:.2f} ({abs(pct)}% {label})")
        if valuation.get("pe_ratio") is not None:
            lines.append(f"- P/E Ratio (TTM): {valuation['pe_ratio']:.1f}")
        if valuation.get("net_profit_margin") is not None:
            lines.append(f"- Net Profit Margin: {valuation['net_profit_margin']*100:.1f}%")
        if valuation.get("current_ratio") is not None:
            lines.append(f"- Current Ratio: {valuation['current_ratio']:.2f}")
        if valuation.get("debt_equity_ratio") is not None:
            lines.append(f"- Debt/Equity: {valuation['debt_equity_ratio']:.2f}")
        if valuation.get("roe") is not None:
            lines.append(f"- ROE: {valuation['roe']*100:.1f}%")
        valuation_section = "\n".join(lines) + "\n"

    strategy_section = ""
    if strategy_instructions:
        strategy_section = f"""## Strategy Focus
{strategy_instructions}
Apply this strategic lens when evaluating the data above.

"""

    market_overview_section = ""
    if market_context:
        market_overview_section = f"## Market Overview\n{market_context}\n"

    return f"""You are a senior technical analyst. Analyze the following market data for {ticker} and provide a structured trading decision.

{market_overview_section}## Market Data
- Current Price: {current_price}
- 52-Week Range: {indicators['price_range_52w']['low']} - {indicators['price_range_52w']['high']}

{sentiment_section}
{filings_section}
{analyst_section}
{price_target_section}
{news_section}
{valuation_section}
{macro_section}
{treasury_section}
## Technical Indicators
...

- MA Alignment: SMA20={ma['sma20']}, SMA50={ma['sma50']}, SMA200={ma['sma200']} ({ma['status']})
- RSI(14): {rsi['value']} ({rsi['zone']})
- MACD: Signal={macd['signal']}, Histogram={macd['histogram']} ({macd['direction']})
- Volume: Current={vol['current']:,.0f} vs Avg={vol['average']:,.0f} ({vol['ratio']}x average)
- Key Support Levels: {indicators['support']}
- Key Resistance Levels: {indicators['resistance']}

{strategy_section}## Instructions
Provide your analysis in EXACTLY this JSON format (no markdown, no code fences, just raw JSON):
{{
  "decision": "BUY" or "HOLD" or "SELL",
  "score": <0-100 confidence integer>,
  "conclusion": "<2-3 sentence summary of your analysis>",
  "price_levels": {{
    "support": [<up to 3 key support levels as floats>],
    "resistance": [<up to 3 key resistance levels as floats>],
    "target": <price target as float>,
    "stop_loss": <stop loss level as float>
  }},
  "checklist": [
    {{"item": "<criterion description>", "passed": true or false}},
    {{"item": "<criterion description>", "passed": true or false}},
    {{"item": "<criterion description>", "passed": true or false}},
    {{"item": "<criterion description>", "passed": true or false}},
    {{"item": "<criterion description>", "passed": true or false}}
  ]
}}"""


# ---------------------------------------------------------------------------
# Analysis engine
# ---------------------------------------------------------------------------

class AnalysisEngine:
    def __init__(self):
        self._running = False
        self._current_ticker: Optional[str] = None
        self._log_callbacks: List[Callable] = []
        self._complete_callbacks: List[Callable] = []
        self._db: Optional[AnalysisDB] = None

    def _get_db(self) -> AnalysisDB:
        if self._db is None:
            self._db = AnalysisDB(settings.analysis_db_path)
        return self._db

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def current_ticker(self) -> Optional[str]:
        return self._current_ticker

    def register_log_callback(self, cb: Callable):
        self._log_callbacks.append(cb)

    def register_complete_callback(self, cb: Callable):
        self._complete_callbacks.append(cb)

    def _log(self, message: str):
        logger.info(f"[Analysis] {message}")
        for cb in self._log_callbacks:
            try:
                cb(message, self._current_ticker)
            except Exception:
                pass

    def _on_complete(self, report: dict):
        for cb in self._complete_callbacks:
            try:
                cb(report)
            except Exception:
                pass

    async def run_analysis(self, ticker: str, strategy: str = "default") -> dict:
        if self._running:
            raise RuntimeError("Analysis already in progress")

        self._running = True
        self._current_ticker = ticker
        try:
            return await self._execute(ticker, strategy)
        finally:
            self._running = False
            self._current_ticker = None

    async def _execute(self, ticker: str, strategy: str = "default") -> dict:
        self._log(f"Starting analysis for {ticker}...")

        # 1. Fetch candles
        self._log("Fetching market data...")
        candles = await asyncio.to_thread(_fetch_candles, ticker, 200)
        if not candles:
            raise RuntimeError(f"No market data available for {ticker}")
        self._log(f"Fetched {len(candles)} candles")

        # 2. Compute indicators
        self._log("Computing technical indicators...")
        indicators = compute_indicators(candles)
        current_price = candles[-1]["close"]
        prev_price = candles[-2]["close"] if len(candles) > 1 else current_price
        price_change_pct = round((current_price - prev_price) / prev_price * 100, 2)

        self._log(
            f"Price: {current_price} | MA: {indicators['ma_alignment']['status']} | "
            f"RSI: {indicators['rsi']['value']} | MACD: {indicators['macd']['direction']}"
        )

        # 2.5 Fetch Reddit sentiment
        sentiment = None
        if ticker != "VNINDEX":
            self._log("Fetching social sentiment from Reddit...")
            sentiment = await _fetch_reddit_sentiment(ticker)
            if sentiment:
                self._log(f"Reddit sentiment: {sentiment['sentiment']} (score: {sentiment['sentiment_score']})")
            else:
                self._log("No Reddit sentiment data found.")

        # 2.6 Fetch SEC filings
        filings = []
        if ticker != "VNINDEX":
            self._log("Checking for recent SEC filings...")
            cik = await _get_cik(ticker)
            if cik:
                filings = await _fetch_sec_filings(cik)
                if filings:
                    self._log(f"Found {len(filings)} recent SEC filings.")
                else:
                    self._log("No recent SEC filings found.")
            else:
                self._log("Could not map ticker to CIK for SEC data.")

        # 2.7 Fetch enrichment data in parallel
        self._log("Fetching macro, analyst, and market intelligence data...")
        enrichment = await asyncio.gather(
            _fetch_macro_indicators(ticker),
            _fetch_treasury_rates(),
            _fetch_finnhub_recommendations(ticker) if ticker != "VNINDEX" else asyncio.sleep(0),
            _fetch_ticker_news(ticker),
            _fetch_price_target(ticker) if ticker != "VNINDEX" else asyncio.sleep(0),
            _fetch_fmp_valuation(ticker),
            _fetch_stocktwits_sentiment(ticker) if ticker != "VNINDEX" else asyncio.sleep(0),
            _fetch_fear_greed_index(),
        )
        macro = enrichment[0]
        treasury = enrichment[1]
        analyst = enrichment[2] if isinstance(enrichment[2], dict) else None
        news = enrichment[3] if isinstance(enrichment[3], list) else []
        price_target = enrichment[4] if isinstance(enrichment[4], dict) else None
        valuation = enrichment[5] if isinstance(enrichment[5], dict) else None
        stocktwits = enrichment[6] if isinstance(enrichment[6], dict) else None
        fear_greed = enrichment[7] if isinstance(enrichment[7], dict) else None

        if macro:
            self._log(f"Macro data: {macro.get('region', 'N/A')} region via {macro.get('source', 'Econdb')}")
        if treasury:
            self._log(f"Treasury rates as of {treasury.get('date', 'N/A')}")
        if analyst:
            total = analyst['strongBuy'] + analyst['buy'] + analyst['hold'] + analyst['sell'] + analyst['strongSell']
            self._log(f"Analyst consensus: {total} analysts ({analyst['period']})")
        if news:
            self._log(f"Fetched {len(news)} recent news headlines")
        if price_target:
            self._log(f"Price targets: avg=${price_target['average']} high=${price_target['high']} low=${price_target['low']}")
        if valuation:
            dcf_str = f"DCF=${valuation.get('dcf', 'N/A')}" if valuation.get('dcf') else ""
            pe_str = f"P/E={valuation.get('pe_ratio', 'N/A'):.1f}" if valuation.get('pe_ratio') else ""
            self._log(f"FMP valuation: {dcf_str} {pe_str}".strip())
        if stocktwits:
            self._log(f"StockTwits: {stocktwits['sentiment']} (bull:{stocktwits['bullish_count']} bear:{stocktwits['bearish_count']})")
        if fear_greed:
            self._log(f"Fear & Greed Index: {fear_greed['score']}/100 ({fear_greed['rating']})")

        # 2.8 Fetch market context (if available)
        market_ctx = ""
        try:
            from app.services.market_review import get_market_context_for_prompt
            market_ctx = await get_market_context_for_prompt()
            if market_ctx:
                self._log("Injecting market context into analysis")
        except Exception:
            pass

        # 3. Call LLM
        from app.services.strategies import get_strategy
        strat = get_strategy(strategy)
        if strategy != "default":
            self._log(f"Using strategy: {strat['name']}")
        self._log("Sending to LLM for analysis...")
        prompt = build_prompt(
            ticker, current_price, indicators, sentiment, filings,
            macro, treasury, analyst, news, price_target, valuation,
            stocktwits, fear_greed, strat["prompt_instructions"], market_ctx,
        )
        raw_response = await self._call_llm(prompt)

        # 4. Parse response
        self._log("Parsing LLM response...")
        analysis = self._parse_response(raw_response)

        # 5. Build report
        report = {
            "ticker": ticker,
            "current_price": current_price,
            "price_change_pct": price_change_pct,
            "indicators": indicators,
            "decision": analysis["decision"],
            "score": analysis["score"],
            "conclusion": analysis["conclusion"],
            "price_levels": analysis["price_levels"],
            "checklist": analysis["checklist"],
            "raw_reasoning": raw_response,
            "model_used": settings.llm_model,
            "news": news,
            "strategy": strategy,
        }

        # 6. Store in DB
        db = self._get_db()
        report_id = db.insert_report(report)
        report["id"] = report_id
        stored = db.get_report(report_id)

        self._log(f"Analysis complete: {analysis['decision']} (score: {analysis['score']})")
        self._on_complete(stored)
        return stored

    async def _call_llm(self, prompt: str) -> str:
        import httpx as _httpx
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            base_url=settings.llm_api_base,
            api_key=settings.llm_api_key,
            timeout=_httpx.Timeout(120.0, connect=30.0),
        )

        models = [settings.llm_model] + settings.llm_fallback_models
        last_error = None

        for model in models:
            try:
                self._log(f"Trying model: {model}")
                chunks = []
                stream = await client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=settings.llm_max_tokens,
                    stream=True,
                )

                async for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta and delta.content:
                        chunks.append(delta.content)
                        for cb in self._log_callbacks:
                            try:
                                cb(delta.content, self._current_ticker)
                            except Exception:
                                pass

                return "".join(chunks)
            except Exception as e:
                last_error = e
                self._log(f"Model {model} failed: {e}, trying fallback...")

        raise RuntimeError(f"All models failed. Last error: {last_error}")

    @staticmethod
    def _parse_response(raw: str) -> dict:
        """Parse LLM JSON response with fallback."""
        # Strip markdown code fences if present
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:])
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        try:
            data = json.loads(text)
            # Validate required fields
            return {
                "decision": str(data.get("decision", "HOLD")).upper(),
                "score": int(data.get("score", 50)),
                "conclusion": str(data.get("conclusion", "")),
                "price_levels": data.get("price_levels", {"support": [], "resistance": [], "target": 0, "stop_loss": 0}),
                "checklist": data.get("checklist", []),
            }
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.warning(f"Failed to parse LLM response: {e}")
            return {
                "decision": "HOLD",
                "score": 50,
                "conclusion": f"Analysis completed but response parsing failed. Raw output available.",
                "price_levels": {"support": [], "resistance": [], "target": 0, "stop_loss": 0},
                "checklist": [],
            }


analysis_engine = AnalysisEngine()
