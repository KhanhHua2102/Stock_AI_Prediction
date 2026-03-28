import logging
import math
import time
from collections import defaultdict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# FX rate cache: (rate, timestamp)
_fx_cache: dict[str, tuple[float, float]] = {}
_FX_CACHE_TTL = 300  # 5 minutes


def fetch_fx_rate(from_ccy: str, to_ccy: str) -> float:
    """Fetch live FX rate using yfinance. Returns how many units of to_ccy per 1 unit of from_ccy."""
    if from_ccy == to_ccy:
        return 1.0

    cache_key = f"{from_ccy}{to_ccy}"
    cached = _fx_cache.get(cache_key)
    if cached and (time.time() - cached[1]) < _FX_CACHE_TTL:
        return cached[0]

    import yfinance as yf
    pair = f"{from_ccy}{to_ccy}=X"
    try:
        hist = yf.Ticker(pair).history(period="1d")
        if hist is not None and not hist.empty:
            rate = float(hist["Close"].iloc[-1])
            _fx_cache[cache_key] = (rate, time.time())
            return rate
    except Exception as e:
        logger.warning(f"Failed to fetch FX rate for {pair}: {e}")

    # Fallback: return cached value if available, else 1.0
    if cached:
        return cached[0]
    return 1.0

# Broker exports often use ":AU" but yfinance needs ".AX" for ASX tickers
_EXCHANGE_SUFFIX_MAP = {
    ":AU": ".AX",
    ":US": "",
    ":NZ": ".NZ",
    ":HK": ".HK",
    ":LN": ".L",
}


def normalize_ticker(ticker: str) -> str:
    """Convert broker-format tickers to yfinance-compatible format."""
    for suffix, replacement in _EXCHANGE_SUFFIX_MAP.items():
        if ticker.endswith(suffix):
            return ticker[: -len(suffix)] + replacement
    return ticker


_events_cache: dict[str, tuple[float, list[dict]]] = {}
_EVENTS_TTL = 3600  # cache for 1 hour

_betashares_cache: tuple[float, dict[str, list[dict]]] | None = None
_BETASHARES_TTL = 86400  # cache for 24 hours


def _fetch_betashares_calendar() -> dict[str, list[dict]]:
    """Scrape BetaShares distribution calendar. Returns {ticker: [events]}."""
    global _betashares_cache
    if _betashares_cache and (time.time() - _betashares_cache[0]) < _BETASHARES_TTL:
        return _betashares_cache[1]

    import re
    import urllib.request
    from datetime import date

    url = "https://www.betashares.com.au/distributions-drp/"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        html = urllib.request.urlopen(req, timeout=15).read().decode()
    except Exception as e:
        logger.warning("Failed to fetch BetaShares calendar: %s", e)
        return {}

    tables = re.findall(r"<table>(.*?)</table>", html, re.DOTALL)
    today = date.today()
    result: dict[str, list[dict]] = {}

    # Tables come in pairs: ticker-list table, then distribution-calendar table
    i = 0
    while i < len(tables) - 1:
        table = tables[i]
        headers = re.findall(r"<th>(.*?)</th>", table)
        if "ASX Code" in headers:
            # Parse ticker list (strip asterisks)
            raw_tickers = re.findall(r"<tr>\s*<td>(.*?)</td>", table, re.DOTALL)
            group_tickers = [t.strip().rstrip("*") for t in raw_tickers]

            # Next table should be the calendar
            cal_table = tables[i + 1]
            cal_headers = re.findall(r"<th>(.*?)</th>", cal_table)
            if "Ex-Date" in cal_headers:
                rows = re.findall(r"<tr>\s*(<td>.*?</td>(?:\s*<td>.*?</td>)*)\s*</tr>", cal_table, re.DOTALL)
                for row in rows:
                    cells = re.findall(r"<td>(.*?)</td>", row)
                    if len(cells) >= 7:
                        try:
                            ex_date = datetime.strptime(cells[2], "%d-%b-%y").date()
                            record_date = datetime.strptime(cells[4], "%d-%b-%y").date()
                            payment_date = datetime.strptime(cells[6], "%d-%b-%y").date()
                            if ex_date >= today:
                                event = {
                                    "type": "distribution",
                                    "date": ex_date.isoformat(),
                                    "ex_date": ex_date.isoformat(),
                                    "record_date": record_date.isoformat(),
                                    "payment_date": payment_date.isoformat(),
                                    "detail": None,
                                }
                                for ticker in group_tickers:
                                    result.setdefault(ticker, []).append(event)
                        except (ValueError, IndexError):
                            continue
                i += 2
                continue
        i += 1

    _betashares_cache = (time.time(), result)
    return result


def _estimate_distribution(yf_ticker: str, quantity: float, per_share_rate: float | None = None) -> float | None:
    """Estimate distribution amount from last 3 dividends avg * quantity.
    If per_share_rate is provided (e.g. from yfinance detail), use that directly."""
    if quantity <= 0:
        return None
    if per_share_rate is not None:
        return round(per_share_rate * quantity, 2)
    try:
        import yfinance as yf
        divs = yf.Ticker(yf_ticker).dividends
        if divs is not None and len(divs) > 0:
            recent = divs.tail(3)
            avg = float(recent.mean())
            if avg > 0:
                return round(avg * quantity, 2)
    except Exception as e:
        logger.warning("Failed to estimate distribution for %s: %s", yf_ticker, e)
    return None


def fetch_upcoming_events(tickers: list[str], holdings: dict[str, float] | None = None) -> list[dict]:
    """Fetch upcoming earnings, dividends, splits for tickers via yfinance.
    Returns a flat list of events sorted by date (nearest first).
    If holdings is provided ({ticker: quantity}), enriches events with est_amount."""
    import yfinance as yf
    from datetime import date

    holdings = holdings or {}
    cache_key = ",".join(sorted(tickers)) + ";" + ",".join(f"{k}={v}" for k, v in sorted(holdings.items()))
    if cache_key in _events_cache:
        ts, cached = _events_cache[cache_key]
        if time.time() - ts < _EVENTS_TTL:
            return cached

    today = date.today()
    events: list[dict] = []

    # Fetch BetaShares calendar for ASX tickers
    betashares_data = _fetch_betashares_calendar()
    betashares_found: set[str] = set()
    for ticker in tickers:
        # Strip :AU suffix for BetaShares lookup
        bs_key = ticker.replace(":AU", "")
        if bs_key in betashares_data:
            betashares_found.add(ticker)
            for ev in betashares_data[bs_key]:
                events.append({**ev, "ticker": ticker})

    for ticker in tickers:
        yf_ticker = normalize_ticker(ticker)
        try:
            t = yf.Ticker(yf_ticker)
            cal = t.calendar if hasattr(t, "calendar") else {}
            if not isinstance(cal, dict):
                cal = {}
            info = t.info or {}

            # Earnings date
            earnings_dates = cal.get("Earnings Date")
            if earnings_dates:
                for ed in (earnings_dates if isinstance(earnings_dates, list) else [earnings_dates]):
                    d = ed if isinstance(ed, date) else None
                    if d and d >= today:
                        events.append({
                            "ticker": ticker,
                            "type": "earnings",
                            "date": d.isoformat(),
                            "detail": f"EPS est. {cal.get('Earnings Average', 'N/A')}",
                        })

            # Skip yfinance dividend lookup if BetaShares already provided data
            if ticker in betashares_found:
                pass
            else:
                # Ex-dividend date from yfinance
                ex_div = cal.get("Ex-Dividend Date")
                if isinstance(ex_div, date) and ex_div >= today:
                    rate = info.get("dividendRate")
                    events.append({
                        "ticker": ticker,
                        "type": "ex-dividend",
                        "date": ex_div.isoformat(),
                        "detail": f"${rate:.2f}/share" if rate else None,
                    })
                elif isinstance(ex_div, str):
                    try:
                        d = date.fromisoformat(ex_div)
                        if d >= today:
                            rate = info.get("dividendRate")
                            events.append({
                                "ticker": ticker,
                                "type": "ex-dividend",
                                "date": d.isoformat(),
                                "detail": f"${rate:.2f}/share" if rate else None,
                            })
                    except ValueError:
                        pass

                # Dividend payment date
                div_date = cal.get("Dividend Date")
                if isinstance(div_date, date) and div_date >= today:
                    events.append({
                        "ticker": ticker,
                        "type": "dividend",
                        "date": div_date.isoformat(),
                        "detail": None,
                    })
                elif isinstance(div_date, str):
                    try:
                        d = date.fromisoformat(div_date)
                        if d >= today:
                            events.append({
                                "ticker": ticker,
                                "type": "dividend",
                                "date": d.isoformat(),
                                "detail": None,
                            })
                    except ValueError:
                        pass

        except Exception as e:
            logger.warning("Failed to fetch events for %s: %s", ticker, e)

    # Enrich distribution/dividend events with estimated amounts
    if holdings:
        tickers_with_div_event: set[str] = set()
        for ev in events:
            if ev["type"] in ("distribution", "ex-dividend", "dividend"):
                tickers_with_div_event.add(ev["ticker"])
                ticker = ev["ticker"]
                qty = holdings.get(ticker, 0)
                if qty > 0:
                    # Parse per-share rate from detail if available (e.g. "$0.26/share")
                    per_share = None
                    detail = ev.get("detail") or ""
                    if "/share" in detail:
                        try:
                            per_share = float(detail.replace("$", "").replace("/share", ""))
                        except ValueError:
                            pass
                    yf_ticker = normalize_ticker(ticker)
                    ev["est_amount"] = _estimate_distribution(yf_ticker, qty, per_share)

        # For tickers that have no upcoming dividend event but do pay dividends,
        # attach est_amount to their other events (e.g. earnings)
        for ev in events:
            if ev["ticker"] not in tickers_with_div_event and ev.get("est_amount") is None:
                ticker = ev["ticker"]
                qty = holdings.get(ticker, 0)
                if qty > 0:
                    yf_ticker = normalize_ticker(ticker)
                    est = _estimate_distribution(yf_ticker, qty)
                    if est is not None:
                        ev["est_amount"] = est

    events.sort(key=lambda e: e["date"])
    _events_cache[cache_key] = (time.time(), events)
    return events


def compute_portfolio_summary(holdings: list[dict], live_prices: dict[str, float], display_currency: str = "AUD") -> dict:
    """Compute full portfolio summary with live prices, converting foreign currencies."""
    # Determine which FX rates we need
    fx_rates: dict[str, float] = {}
    for h in holdings:
        ccy = h.get("currency")
        if ccy and ccy != display_currency and ccy not in fx_rates:
            fx_rates[ccy] = fetch_fx_rate(ccy, display_currency)

    total_value = 0.0
    total_cost = 0.0
    total_realised = 0.0
    total_dividends = 0.0
    enriched = []

    for h in holdings:
        ticker = h["ticker"]
        qty = h["quantity"]
        cost_basis = h["cost_basis"]
        avg_cost = h["avg_cost"]
        ccy = h.get("currency")
        fx = fx_rates.get(ccy, 1.0) if ccy else 1.0

        price = live_prices.get(ticker, avg_cost)
        # price and cost are in original currency — convert to display currency
        market_value = qty * price * fx
        cost_basis_display = cost_basis * fx
        avg_cost_display = avg_cost * fx
        realised_display = h.get("realised_pnl", 0) * fx
        dividends_display = h.get("total_dividends", 0) * fx

        unrealised = market_value - cost_basis_display if qty > 0 else 0
        unrealised_pct = (unrealised / cost_basis_display * 100) if cost_basis_display > 0 else 0

        total_realised += realised_display
        total_dividends += dividends_display

        # Only include active positions in total_value / total_cost (closed have market_value=0)
        if qty > 0.0001:
            total_value += market_value
            total_cost += cost_basis_display
        else:
            continue

        enriched.append({
            "ticker": ticker,
            "quantity": qty,
            "cost_basis": round(cost_basis_display, 2),
            "avg_cost": round(avg_cost_display, 4),
            "current_price": round(price * fx, 2),
            "market_value": round(market_value, 2),
            "unrealised_pnl": round(unrealised, 2),
            "unrealised_pnl_pct": round(unrealised_pct, 2),
            "realised_pnl": round(realised_display, 2),
            "total_dividends": round(dividends_display, 2),
            "currency": ccy,
            "fx_rate": round(fx, 4) if ccy and ccy != display_currency else None,
            "weight_pct": 0,  # filled below
        })

    # Compute weights
    for item in enriched:
        if total_value > 0:
            item["weight_pct"] = round(item["market_value"] / total_value * 100, 2)

    unrealised_total = total_value - total_cost
    unrealised_pct = (unrealised_total / total_cost * 100) if total_cost > 0 else 0

    return {
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "unrealised_pnl": round(unrealised_total, 2),
        "unrealised_pnl_pct": round(unrealised_pct, 2),
        "realised_pnl": round(total_realised, 2),
        "total_dividends": round(total_dividends, 2),
        "holdings": sorted(enriched, key=lambda x: x["market_value"], reverse=True),
    }


def compute_twr_returns(snapshots: list[dict]) -> list[dict]:
    """Compute time-weighted return series from daily snapshots.

    Uses cash_flow (cumulative deposits) to adjust for deposits/withdrawals
    so returns reflect actual investment performance, not just cash movement.
    """
    if len(snapshots) < 2:
        return []

    base_value = snapshots[0]["total_value"]
    if base_value <= 0:
        return []

    result = []
    cumulative = 1.0
    for i in range(1, len(snapshots)):
        prev = snapshots[i - 1]
        curr = snapshots[i]

        prev_val = prev["total_value"]
        curr_val = curr["total_value"]

        # cash_flow stores cumulative deposits — compute daily delta
        curr_cf = curr.get("cash_flow") or 0
        prev_cf = prev.get("cash_flow") or 0
        daily_flow = curr_cf - prev_cf

        # Sub-period return: adjust starting value for the cash flow
        adjusted_prev = prev_val + daily_flow
        if adjusted_prev > 0:
            period_return = curr_val / adjusted_prev
        else:
            period_return = 1.0

        cumulative *= period_return

        result.append({
            "date": curr["date"],
            "cumulative_return": round((cumulative - 1) * 100, 4),
            "value": curr["total_value"],
        })

    return result


def compute_benchmark_returns(benchmark_ticker: str, start_date: str, end_date: str) -> list[dict]:
    """Fetch benchmark prices and compute cumulative return series."""
    import yfinance as yf

    try:
        df = yf.download(benchmark_ticker, start=start_date, end=end_date, interval="1d", progress=False)
        if df is None or df.empty:
            return []

        closes = df["Close"].squeeze()
        if hasattr(closes, "iloc"):
            base = float(closes.iloc[0])
            if base <= 0:
                return []
            result = []
            for date, price in closes.items():
                result.append({
                    "date": date.strftime("%Y-%m-%d"),
                    "cumulative_return": round((float(price) / base - 1) * 100, 4),
                })
            return result
    except Exception as e:
        logger.warning(f"Failed to fetch benchmark {benchmark_ticker}: {e}")
    return []



def compute_annualised_return(start_value: float, end_value: float, days: int) -> float:
    """Compute annualised return from start/end values and number of days."""
    if start_value <= 0 or days <= 0:
        return 0.0
    ratio = end_value / start_value
    if ratio <= 0:
        return -100.0
    return round((ratio ** (365.0 / days) - 1) * 100, 2)


def compute_sharpe_ratio(daily_returns: list[float], risk_free_rate: float = 0.0) -> float:
    """Compute annualised Sharpe ratio from daily returns."""
    if len(daily_returns) < 2:
        return 0.0
    mean_ret = sum(daily_returns) / len(daily_returns)
    variance = sum((r - mean_ret) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
    std_dev = math.sqrt(variance)
    if std_dev == 0:
        return 0.0
    daily_rf = risk_free_rate / 252
    return round((mean_ret - daily_rf) / std_dev * math.sqrt(252), 2)


def compute_portfolio_beta(portfolio_returns: list[float], benchmark_returns: list[float]) -> float:
    """Compute portfolio beta against a benchmark from daily returns."""
    n = min(len(portfolio_returns), len(benchmark_returns))
    if n < 10:
        return 0.0
    pr = portfolio_returns[-n:]
    br = benchmark_returns[-n:]
    mean_p = sum(pr) / n
    mean_b = sum(br) / n
    cov = sum((pr[i] - mean_p) * (br[i] - mean_b) for i in range(n)) / (n - 1)
    var_b = sum((br[i] - mean_b) ** 2 for i in range(n)) / (n - 1)
    if var_b == 0:
        return 0.0
    return round(cov / var_b, 2)


def compute_max_drawdown(values: list[float]) -> float:
    """Compute max drawdown from a list of values."""
    if not values:
        return 0.0
    running_max = 0.0
    max_dd = 0.0
    for val in values:
        running_max = max(running_max, val)
        dd = (val - running_max) / running_max if running_max > 0 else 0
        max_dd = min(max_dd, dd)
    return round(max_dd * 100, 2)


def compute_monthly_returns(snapshots: list[dict]) -> list[dict]:
    """Compute monthly returns from daily snapshots using TWR.

    Uses cash_flow (cumulative deposits) to adjust for deposits/withdrawals
    so each month reflects actual investment performance, not cash movement.
    """
    if len(snapshots) < 2:
        return []

    # Group snapshots by month
    monthly_snaps: dict[str, list[dict]] = {}
    for snap in snapshots:
        month_key = snap["date"][:7]  # YYYY-MM
        monthly_snaps.setdefault(month_key, []).append(snap)

    # We also need the last snapshot of the previous month as the starting point
    sorted_months = sorted(monthly_snaps.keys())

    result = []
    for idx, month in enumerate(sorted_months):
        snaps = monthly_snaps[month]
        if len(snaps) < 1:
            continue

        # Determine start: last snapshot of previous month, or first of this month
        if idx > 0:
            prev_month = sorted_months[idx - 1]
            prev_snaps = monthly_snaps[prev_month]
            start_snap = prev_snaps[-1]
        else:
            # First month — use first snapshot as start, compute from second
            if len(snaps) < 2:
                continue
            start_snap = snaps[0]
            snaps = snaps[1:]

        # Compute TWR for this month's daily sub-periods
        cumulative = 1.0
        prev = start_snap
        for curr in snaps:
            prev_val = prev["total_value"]
            curr_val = curr["total_value"]

            # Daily cash flow delta
            curr_cf = curr.get("cash_flow") or 0
            prev_cf = prev.get("cash_flow") or 0
            daily_flow = curr_cf - prev_cf

            # Adjust starting value for the cash flow
            adjusted_prev = prev_val + daily_flow
            if adjusted_prev > 0:
                cumulative *= curr_val / adjusted_prev

            prev = curr

        ret = (cumulative - 1) * 100
        result.append({"period": month, "return_pct": round(ret, 2)})

    return result


def compute_dividend_summary(
    transactions: list[dict],
    group_by: str = "month",
    ticker_currency: dict[str, str | None] | None = None,
    display_currency: str = "AUD",
) -> list[dict]:
    """Aggregate dividend transactions by month or year, with FX conversion."""
    # Build FX rates for foreign-currency tickers
    fx_rates: dict[str, float] = {}
    if ticker_currency:
        for ccy in set(c for c in ticker_currency.values() if c and c != display_currency):
            if ccy not in fx_rates:
                fx_rates[ccy] = fetch_fx_rate(ccy, display_currency)

    buckets: dict[str, float] = defaultdict(float)

    for txn in transactions:
        if txn["type"] != "DIVIDEND":
            continue
        date = txn["date"]
        amount = txn["price"] * txn["quantity"] if txn["quantity"] > 0 else txn["price"]

        # Apply FX conversion
        ccy = (ticker_currency or {}).get(txn.get("ticker"))
        if ccy and ccy != display_currency:
            amount *= fx_rates.get(ccy, 1.0)

        if group_by == "year":
            key = date[:4]
        else:
            key = date[:7]  # YYYY-MM

        buckets[key] += amount

    return [{"period": k, "amount": round(v, 2)} for k, v in sorted(buckets.items())]


def compute_sector_allocation(tickers: list[str], values: dict[str, float]) -> list[dict]:
    """Get sector allocation using yfinance."""
    import yfinance as yf

    sector_values: dict[str, float] = defaultdict(float)
    sector_tickers: dict[str, list[dict]] = defaultdict(list)

    for ticker in tickers:
        yf_ticker = normalize_ticker(ticker)
        try:
            info = yf.Ticker(yf_ticker).info
            # Stocks have "sector", ETFs have "category" or fund-specific fields
            sector = info.get("sector") or info.get("category") or None
            if not sector:
                qt = info.get("quoteType", "")
                long_name = info.get("longName", "")
                if qt == "ETF" or "ETF" in long_name:
                    # Classify ETFs by name keywords
                    ln = long_name.lower()
                    if any(k in ln for k in ("global", "world", "international", "msci")):
                        sector = "Global Equity ETF"
                    elif any(k in ln for k in ("australia", "asx", "a200")):
                        sector = "Australian Equity ETF"
                    elif any(k in ln for k in ("bond", "fixed income", "credit", "treasury")):
                        sector = "Fixed Income ETF"
                    elif any(k in ln for k in ("property", "reit", "real estate")):
                        sector = "Property ETF"
                    elif any(k in ln for k in ("nasdaq", "technology", "tech")):
                        sector = "Technology ETF"
                    else:
                        sector = "ETF"
                else:
                    sector = "Unknown"
        except Exception:
            sector = "Unknown"
        ticker_val = values.get(ticker, 0)
        sector_values[sector] += ticker_val
        sector_tickers[sector].append({"ticker": ticker, "value": round(ticker_val, 2)})

    total = sum(sector_values.values())
    result = []
    for sector, value in sorted(sector_values.items(), key=lambda x: -x[1]):
        # Sort tickers within sector by value descending
        holdings = sorted(sector_tickers[sector], key=lambda x: -x["value"])
        for h in holdings:
            h["weight_pct"] = round(h["value"] / total * 100, 2) if total > 0 else 0
        result.append({
            "sector": sector,
            "value": round(value, 2),
            "weight_pct": round(value / total * 100, 2) if total > 0 else 0,
            "tickers": holdings,
        })

    return result


def fetch_live_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch current prices for tickers using yfinance."""
    import yfinance as yf

    prices = {}
    for ticker in tickers:
        yf_ticker = normalize_ticker(ticker)
        try:
            hist = yf.Ticker(yf_ticker).history(period="1d")
            if hist is not None and not hist.empty:
                prices[ticker] = float(hist["Close"].iloc[-1])
        except Exception as e:
            logger.warning(f"Failed to fetch price for {ticker} ({yf_ticker}): {e}")
    return prices


def backfill_snapshots(portfolio_db, portfolio_id: int, holdings: list[dict], force_deposits: bool = False) -> None:
    """Backfill daily snapshots by replaying transactions to get accurate holdings at each date."""
    import yfinance as yf

    first_date = portfolio_db.get_first_transaction_date(portfolio_id)
    if not first_date:
        return

    portfolio = portfolio_db.get_portfolio(portfolio_id)
    display_currency = portfolio["currency"] if portfolio else "AUD"

    # Get all tickers ever traded (not just current holdings)
    txns, _ = portfolio_db.get_transactions(portfolio_id, limit=100000)
    txns.sort(key=lambda t: t["date"])
    all_tickers = sorted(set(t["ticker"] for t in txns))
    if not all_tickers:
        return

    # Build ticker -> currency map from holdings
    ticker_currency: dict[str, str | None] = {}
    for h in holdings:
        ticker_currency[h["ticker"]] = h.get("currency")

    existing = portfolio_db.get_snapshots(portfolio_id)
    existing_dates = {s["date"] for s in existing}

    start = datetime.strptime(first_date, "%Y-%m-%d")
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    end = today

    # Remove any stale snapshots for today or future dates
    portfolio_db.delete_snapshots_from(portfolio_id, today.strftime("%Y-%m-%d"))

    # Fetch historical prices for all tickers ever held
    price_history: dict[str, dict[str, float]] = {}
    for ticker in all_tickers:
        yf_ticker = normalize_ticker(ticker)
        try:
            df = yf.download(yf_ticker, start=first_date, end=end.strftime("%Y-%m-%d"), interval="1d", progress=False)
            if df is not None and not df.empty:
                closes = df["Close"].squeeze()
                price_history[ticker] = {}
                for date, price in closes.items():
                    price_history[ticker][date.strftime("%Y-%m-%d")] = float(price)
        except Exception as e:
            logger.warning(f"Failed to fetch history for {ticker}: {e}")

    if not price_history:
        return

    # Fetch historical FX rates for foreign-currency tickers
    fx_history: dict[str, dict[str, float]] = {}  # "USDAUD" -> {date: rate}
    fx_pairs_needed = set()
    for ticker, ccy in ticker_currency.items():
        if ccy and ccy != display_currency:
            fx_pairs_needed.add((ccy, display_currency))
    for from_ccy, to_ccy in fx_pairs_needed:
        pair = f"{from_ccy}{to_ccy}=X"
        try:
            df = yf.download(pair, start=first_date, end=end.strftime("%Y-%m-%d"), interval="1d", progress=False)
            if df is not None and not df.empty:
                closes = df["Close"].squeeze()
                key = f"{from_ccy}{to_ccy}"
                fx_history[key] = {}
                for date, rate in closes.items():
                    fx_history[key][date.strftime("%Y-%m-%d")] = float(rate)
        except Exception as e:
            logger.warning(f"Failed to fetch FX history for {pair}: {e}")

    last_known_fx: dict[str, float] = {}

    def get_fx(from_ccy: str, to_ccy: str, date_str: str) -> float:
        if from_ccy == to_ccy:
            return 1.0
        key = f"{from_ccy}{to_ccy}"
        hist = fx_history.get(key)
        if hist:
            rate = hist.get(date_str)
            if rate is not None:
                last_known_fx[key] = rate
                return rate
        return last_known_fx.get(key, 1.0)

    # Group transactions by date for replay
    txns_by_date: dict[str, list[dict]] = defaultdict(list)
    for txn in txns:
        txns_by_date[txn["date"]].append(txn)

    # Replay transactions day-by-day to compute accurate holdings + cash flows
    current_holdings: dict[str, float] = defaultdict(float)  # ticker -> qty
    ticker_cost: dict[str, float] = defaultdict(float)  # ticker -> cost basis
    cumulative_deposit = 0.0

    # Helper: get price for ticker on date (with fallback to most recent)
    last_known_price: dict[str, float] = {}

    def get_price(ticker: str, date_str: str) -> float:
        if ticker in price_history:
            p = price_history[ticker].get(date_str)
            if p is not None:
                last_known_price[ticker] = p
                return p
        return last_known_price.get(ticker, 0)

    current = start
    while current <= end:
        date_str = current.strftime("%Y-%m-%d")

        # Update caches for this date (before processing transactions)
        for ticker in price_history:
            p = price_history[ticker].get(date_str)
            if p is not None:
                last_known_price[ticker] = p
        for key in fx_history:
            rate = fx_history[key].get(date_str)
            if rate is not None:
                last_known_fx[key] = rate

        # Apply transactions for this date (convert to display currency)
        for txn in txns_by_date.get(date_str, []):
            ticker = txn["ticker"]
            qty = txn["quantity"]
            price = txn.get("price", 0) or 0
            fees = txn.get("fees", 0) or 0
            ccy = ticker_currency.get(ticker)
            fx = get_fx(ccy, display_currency, date_str) if ccy else 1.0

            if txn["type"] == "BUY":
                current_holdings[ticker] += qty
                cost_in_display = (qty * price + fees) * fx
                ticker_cost[ticker] += cost_in_display
                # Cash flow uses market value of shares added (not cost paid)
                # so TWR correctly strips out the deposit's effect on portfolio value
                market_price = get_price(ticker, date_str)
                market_val_added = qty * market_price * fx + fees * fx
                cumulative_deposit += market_val_added
            elif txn["type"] == "SELL":
                # Reduce cost proportionally for this ticker
                prev_qty = current_holdings[ticker]
                current_holdings[ticker] -= qty
                if prev_qty > 0:
                    sold_fraction = min(qty / prev_qty, 1.0)
                    ticker_cost[ticker] *= (1 - sold_fraction)
                # Cash flow uses market value of shares removed
                market_price = get_price(ticker, date_str)
                market_val_removed = qty * market_price * fx - fees * fx
                cumulative_deposit -= market_val_removed
            elif txn["type"] == "SPLIT":
                if qty > 0:
                    current_holdings[ticker] *= qty
            # DIVIDEND doesn't change holdings

        # Clamp negative holdings to 0 (pre-existing positions sold before any BUY on record)
        for ticker in list(current_holdings):
            if current_holdings[ticker] < -0.0001:
                current_holdings[ticker] = 0

        # Compute portfolio value from current holdings (with FX conversion)
        daily_value = 0.0
        for ticker, qty in current_holdings.items():
            if qty > 0:
                price = get_price(ticker, date_str)
                ccy = ticker_currency.get(ticker)
                fx = get_fx(ccy, display_currency, date_str) if ccy else 1.0
                daily_value += qty * price * fx

        total_cost = sum(ticker_cost.values())
        is_new = date_str not in existing_dates
        if daily_value > 0 and (is_new or force_deposits):
            portfolio_db.upsert_snapshot(
                portfolio_id, date_str, round(daily_value, 2), round(total_cost, 2),
                cash_flow=round(cumulative_deposit, 2),
            )

        current += timedelta(days=1)
