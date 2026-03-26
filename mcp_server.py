#!/usr/bin/env python3
"""MCP Server for Stock AI Prediction — exposes trading intelligence as tools."""

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Optional

# Setup import paths before anything else
PROJECT_DIR = Path(__file__).parent
sys.path.insert(0, str(PROJECT_DIR / "pt_hub_web" / "backend"))
sys.path.insert(0, str(PROJECT_DIR))

from mcp.server.fastmcp import FastMCP

# Import existing services (initialises singletons)
from app.config import settings, runtime_db, portfolio_db
from app.services.analysis_engine import (
    AnalysisEngine,
    compute_indicators,
    _fetch_candles,
    _fetch_ticker_news,
    _fetch_price_target,
    _fetch_finnhub_recommendations,
    _fetch_reddit_sentiment,
    _fetch_fmp_valuation,
    _fetch_macro_indicators,
    _fetch_treasury_rates,
)
from app.services.analysis_db import AnalysisDB
from app.services.portfolio_metrics import (
    compute_portfolio_summary,
    fetch_live_prices,
    compute_twr_returns,
    compute_max_drawdown,
    compute_sharpe_ratio,
    compute_annualised_return,
    compute_monthly_returns,
    normalize_ticker,
)
from legacy.stock_data_fetcher import market

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# MCP server instance
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "stock-ai",
    instructions=(
        "Stock AI Prediction server. Query stock prices, run LLM-powered analysis, "
        "get AI prediction signals, manage portfolios, and access market intelligence. "
        "Use run_analysis for deep analysis (slow, calls LLM). Use get_technical_indicators "
        "or get_news for quick data. Portfolio tools manage real transaction records."
    ),
)

# ---------------------------------------------------------------------------
# Lazy singletons
# ---------------------------------------------------------------------------

_analysis_engine: Optional[AnalysisEngine] = None
_analysis_db: Optional[AnalysisDB] = None


def _get_analysis_engine() -> AnalysisEngine:
    global _analysis_engine
    if _analysis_engine is None:
        _analysis_engine = AnalysisEngine()
    return _analysis_engine


def _get_analysis_db() -> AnalysisDB:
    global _analysis_db
    if _analysis_db is None:
        _analysis_db = AnalysisDB(settings.analysis_db_path)
    return _analysis_db


def _json(obj: object) -> str:
    return json.dumps(obj, default=str, ensure_ascii=False)


# ============================= MARKET DATA =================================


@mcp.tool()
async def get_stock_price(ticker: str) -> str:
    """Get the current/latest price for a stock or index ticker (e.g. AAPL, VNINDEX, ^GSPC, GLOB.AX)."""
    try:
        price = await asyncio.to_thread(market.get_current_price, ticker)
        return _json({"ticker": ticker, "price": price})
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def get_price_history(ticker: str, days: int = 120) -> str:
    """Get OHLCV candlestick data for a ticker. Returns list of {time, open, high, low, close, volume}."""
    try:
        candles = await asyncio.to_thread(_fetch_candles, ticker, days)
        if not candles:
            return _json({"error": f"No data for {ticker}", "ticker": ticker})
        return _json({"ticker": ticker, "count": len(candles), "candles": candles})
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def search_ticker(query: str) -> str:
    """Search for ticker symbols across Yahoo Finance and VN HOSE exchanges."""
    from app.api.routes.settings import _search_yfinance, _search_vnstock

    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, _search_yfinance, query.upper())]
    if query.isalpha() and "." not in query and "^" not in query:
        tasks.append(loop.run_in_executor(None, _search_vnstock, query.upper()))

    raw = await asyncio.gather(*tasks, return_exceptions=True)
    results = []
    for r in raw:
        if isinstance(r, list):
            results.extend(r)
    return _json({"query": query, "results": results})


# ========================= TECHNICAL ANALYSIS ==============================


@mcp.tool()
async def get_technical_indicators(ticker: str) -> str:
    """Compute technical indicators for a ticker: moving averages (SMA 20/50/200), RSI, MACD, volume profile, support/resistance levels, and 52-week price range."""
    try:
        candles = await asyncio.to_thread(_fetch_candles, ticker, 200)
        if not candles:
            return _json({"error": f"No data for {ticker}"})
        indicators = compute_indicators(candles)
        indicators["current_price"] = candles[-1]["close"]
        indicators["ticker"] = ticker
        return _json(indicators)
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def get_prediction_signals(ticker: str) -> str:
    """Get AI neural prediction signals for a ticker: long/short DCA signals (0-7 scale), high/low bound prices per timeframe. Requires training to have been run first."""
    try:
        signals = runtime_db.get_signals(ticker)
        if not signals:
            return _json({"error": f"No signals for {ticker}. Training may not have been run.", "ticker": ticker})
        return _json({"ticker": ticker, **signals})
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


# ======================== INTELLIGENCE & RESEARCH ==========================


@mcp.tool()
async def run_analysis(ticker: str) -> str:
    """Run a full LLM-powered analysis for a ticker. This is SLOW (30-60 seconds) — it fetches market data, technical indicators, news, sentiment, macro data, then calls an LLM to produce a BUY/HOLD/SELL decision with score, price targets, and reasoning. The report is saved to the database."""
    engine = _get_analysis_engine()
    if engine.is_running:
        return _json({"error": "An analysis is already in progress", "current_ticker": engine.current_ticker})
    if not settings.llm_api_key:
        return _json({"error": "LLM API key not configured (set PT_LLM_API_KEY)"})
    try:
        report = await engine.run_analysis(ticker)
        return _json(report)
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def get_analysis_report(ticker: str) -> str:
    """Get the latest full analysis report for a ticker — includes decision, score, conclusion, price levels (support/resistance/target/stop_loss), checklist, technical indicators, news, and LLM reasoning."""
    db = _get_analysis_db()
    report = db.get_latest(ticker)
    if not report:
        return _json({"error": f"No analysis report found for {ticker}. Run 'run_analysis' first.", "ticker": ticker})
    return _json(report)


@mcp.tool()
async def get_analysis_history(ticker: str, limit: int = 5) -> str:
    """Get past analysis reports for a ticker (summaries: decision, score, price, date). Use get_analysis_report for the full latest report."""
    db = _get_analysis_db()
    reports, total = db.get_reports(ticker, limit=limit)
    summaries = [
        {
            "id": r["id"],
            "ticker": r["ticker"],
            "decision": r["decision"],
            "score": r["score"],
            "current_price": r["current_price"],
            "conclusion": r["conclusion"],
            "created_at": r["created_at"],
        }
        for r in reports
    ]
    return _json({"ticker": ticker, "total": total, "reports": summaries})


@mcp.tool()
async def get_portfolio_analysis(portfolio_id: int) -> str:
    """Get or run analysis for ALL tickers in a portfolio. Returns the latest report for each holding ticker, plus an aggregated portfolio outlook (average score, decision distribution)."""
    holdings = portfolio_db.get_holdings(portfolio_id)
    if not holdings:
        return _json({"error": "No holdings found", "portfolio_id": portfolio_id})

    db = _get_analysis_db()
    tickers = [h["ticker"] for h in holdings if h["quantity"] > 0.0001]
    reports = {}
    for ticker in tickers:
        report = db.get_latest(ticker)
        if report:
            reports[ticker] = {
                "decision": report["decision"],
                "score": report["score"],
                "conclusion": report["conclusion"],
                "price_levels": report.get("price_levels"),
                "current_price": report["current_price"],
                "created_at": report["created_at"],
            }
        else:
            reports[ticker] = {"decision": "NO_DATA", "score": None, "conclusion": "No analysis run yet."}

    # Aggregate
    scores = [r["score"] for r in reports.values() if r["score"] is not None]
    decisions = [r["decision"] for r in reports.values() if r["decision"] != "NO_DATA"]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None
    decision_counts = {}
    for d in decisions:
        decision_counts[d] = decision_counts.get(d, 0) + 1

    return _json({
        "portfolio_id": portfolio_id,
        "tickers_analyzed": len([r for r in reports.values() if r["decision"] != "NO_DATA"]),
        "tickers_missing": len([r for r in reports.values() if r["decision"] == "NO_DATA"]),
        "average_score": avg_score,
        "decision_distribution": decision_counts,
        "reports": reports,
    })


@mcp.tool()
async def get_news(ticker: str) -> str:
    """Fetch recent news headlines for a ticker from Google News and Finnhub."""
    try:
        news = await _fetch_ticker_news(ticker)
        return _json({"ticker": ticker, "count": len(news), "articles": news})
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def get_analyst_targets(ticker: str) -> str:
    """Get analyst price targets and buy/hold/sell recommendations for a ticker."""
    try:
        targets, recs = await asyncio.gather(
            _fetch_price_target(ticker),
            _fetch_finnhub_recommendations(ticker),
        )
        return _json({
            "ticker": ticker,
            "price_targets": targets,
            "recommendations": recs,
        })
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def get_valuation(ticker: str) -> str:
    """Get fundamental valuation data for a ticker: DCF, P/E ratio, net profit margin, current ratio, debt/equity, ROE. Data from Financial Modeling Prep."""
    try:
        val = await _fetch_fmp_valuation(ticker)
        if not val:
            return _json({"error": f"No valuation data for {ticker}", "ticker": ticker})
        val["ticker"] = ticker
        return _json(val)
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def get_macro_overview(ticker: str) -> str:
    """Get macroeconomic indicators relevant to a ticker's region: CPI, GDP growth, unemployment rate, plus US treasury rates. Pass any ticker to auto-detect region."""
    try:
        macro, treasury = await asyncio.gather(
            _fetch_macro_indicators(ticker),
            _fetch_treasury_rates(),
        )
        return _json({
            "ticker": ticker,
            "macro": macro,
            "treasury_rates": treasury,
        })
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


@mcp.tool()
async def get_reddit_sentiment(ticker: str) -> str:
    """Get Reddit/WallStreetBets sentiment for a ticker: number of comments, sentiment direction, and sentiment score."""
    try:
        data = await _fetch_reddit_sentiment(ticker)
        if not data:
            return _json({"error": f"No Reddit sentiment data for {ticker}", "ticker": ticker})
        data["ticker"] = ticker
        return _json(data)
    except Exception as e:
        return _json({"error": str(e), "ticker": ticker})


# ======================== PORTFOLIO MANAGEMENT =============================


@mcp.tool()
async def list_portfolios() -> str:
    """List all portfolios with their ID, name, currency, and benchmark."""
    portfolios = portfolio_db.get_portfolios()
    return _json({"portfolios": portfolios})


@mcp.tool()
async def create_portfolio(name: str, currency: str = "AUD", benchmark: str = "URTH") -> str:
    """Create a new portfolio. Returns the new portfolio ID."""
    try:
        pid = portfolio_db.create_portfolio(name, currency, benchmark)
        return _json({"portfolio_id": pid, "name": name, "currency": currency, "benchmark": benchmark})
    except Exception as e:
        return _json({"error": str(e)})


@mcp.tool()
async def delete_portfolio(portfolio_id: int) -> str:
    """Delete a portfolio and all its transactions, holdings, and snapshots. This is irreversible."""
    try:
        portfolio_db.delete_portfolio(portfolio_id)
        return _json({"deleted": True, "portfolio_id": portfolio_id})
    except Exception as e:
        return _json({"error": str(e), "portfolio_id": portfolio_id})


@mcp.tool()
async def get_portfolio_holdings(portfolio_id: int) -> str:
    """Get detailed holdings for a portfolio with live prices, cost basis, average cost, unrealised P&L, realised P&L, dividends, and weight percentages."""
    try:
        holdings = portfolio_db.get_holdings(portfolio_id)
        if not holdings:
            return _json({"portfolio_id": portfolio_id, "holdings": []})

        tickers = [h["ticker"] for h in holdings if h["quantity"] > 0.0001]
        live_prices = await asyncio.to_thread(fetch_live_prices, tickers) if tickers else {}

        portfolio = portfolio_db.get_portfolio(portfolio_id)
        display_currency = portfolio["currency"] if portfolio else "AUD"
        summary = await asyncio.to_thread(compute_portfolio_summary, holdings, live_prices, display_currency)
        summary["portfolio_id"] = portfolio_id
        return _json(summary)
    except Exception as e:
        return _json({"error": str(e), "portfolio_id": portfolio_id})


@mcp.tool()
async def delete_holding(portfolio_id: int, ticker: str) -> str:
    """Delete all transactions for a specific ticker in a portfolio, effectively removing the holding. Irreversible."""
    try:
        txns, _ = portfolio_db.get_transactions(portfolio_id, ticker=ticker, limit=100000)
        if not txns:
            return _json({"error": f"No transactions found for {ticker}", "portfolio_id": portfolio_id})
        txn_ids = [t["id"] for t in txns]
        portfolio_db.delete_transactions_batch(txn_ids)
        portfolio_db.rebuild_holdings(portfolio_id)
        return _json({"deleted": True, "portfolio_id": portfolio_id, "ticker": ticker, "transactions_removed": len(txn_ids)})
    except Exception as e:
        return _json({"error": str(e), "portfolio_id": portfolio_id, "ticker": ticker})


@mcp.tool()
async def get_portfolio_performance(portfolio_id: int) -> str:
    """Get portfolio performance: daily snapshots, time-weighted returns, max drawdown, Sharpe ratio, annualised return, and monthly returns."""
    try:
        snapshots = portfolio_db.get_snapshots(portfolio_id)
        if not snapshots:
            return _json({"error": "No snapshots yet. Add transactions and holdings first.", "portfolio_id": portfolio_id})

        twr = compute_twr_returns(snapshots)
        values = [s["total_value"] for s in snapshots]
        max_dd = compute_max_drawdown(values)

        # Daily returns for Sharpe
        daily_returns = []
        for i in range(1, len(values)):
            if values[i - 1] > 0:
                daily_returns.append(values[i] / values[i - 1] - 1)

        sharpe = compute_sharpe_ratio(daily_returns) if daily_returns else 0.0

        ann_return = 0.0
        if len(snapshots) >= 2:
            days = max((len(snapshots) - 1), 1)
            ann_return = compute_annualised_return(snapshots[0]["total_value"], snapshots[-1]["total_value"], days)

        monthly = compute_monthly_returns(snapshots)

        return _json({
            "portfolio_id": portfolio_id,
            "total_snapshots": len(snapshots),
            "start_date": snapshots[0]["date"],
            "end_date": snapshots[-1]["date"],
            "start_value": snapshots[0]["total_value"],
            "end_value": snapshots[-1]["total_value"],
            "annualised_return_pct": ann_return,
            "max_drawdown_pct": max_dd,
            "sharpe_ratio": sharpe,
            "monthly_returns": monthly,
            "cumulative_returns": twr[-5:] if twr else [],
        })
    except Exception as e:
        return _json({"error": str(e), "portfolio_id": portfolio_id})


@mcp.tool()
async def add_transaction(
    portfolio_id: int,
    ticker: str,
    type: str,
    date: str,
    quantity: float,
    price: float,
    fees: float = 0.0,
    notes: str = "",
) -> str:
    """Add a transaction (BUY/SELL/DIVIDEND/SPLIT) to a portfolio. Date format: YYYY-MM-DD. After adding, holdings are automatically recalculated."""
    if type.upper() not in ("BUY", "SELL", "DIVIDEND", "SPLIT"):
        return _json({"error": f"Invalid type '{type}'. Must be BUY, SELL, DIVIDEND, or SPLIT."})
    try:
        txn = {
            "ticker": ticker.upper(),
            "type": type.upper(),
            "date": date,
            "quantity": quantity,
            "price": price,
            "fees": fees,
            "notes": notes,
        }
        txn_id = portfolio_db.add_transaction(portfolio_id, txn)
        portfolio_db.rebuild_holdings(portfolio_id)
        return _json({"transaction_id": txn_id, "portfolio_id": portfolio_id, **txn})
    except Exception as e:
        return _json({"error": str(e)})


@mcp.tool()
async def edit_transaction(
    txn_id: int,
    ticker: Optional[str] = None,
    type: Optional[str] = None,
    date: Optional[str] = None,
    quantity: Optional[float] = None,
    price: Optional[float] = None,
    fees: Optional[float] = None,
    notes: Optional[str] = None,
) -> str:
    """Edit an existing transaction. Only provide fields you want to change. Holdings are automatically recalculated."""
    if type is not None and type.upper() not in ("BUY", "SELL", "DIVIDEND", "SPLIT"):
        return _json({"error": f"Invalid type '{type}'. Must be BUY, SELL, DIVIDEND, or SPLIT."})
    try:
        # Get existing transaction to find portfolio_id
        with portfolio_db._lock, portfolio_db._conn() as conn:
            row = conn.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,)).fetchone()
            if not row:
                return _json({"error": f"Transaction {txn_id} not found"})
            pid = row["portfolio_id"]

            updates = {}
            if ticker is not None:
                updates["ticker"] = ticker.upper()
            if type is not None:
                updates["type"] = type.upper()
            if date is not None:
                updates["date"] = date
            if quantity is not None:
                updates["quantity"] = quantity
            if price is not None:
                updates["price"] = price
            if fees is not None:
                updates["fees"] = fees
            if notes is not None:
                updates["notes"] = notes

            if not updates:
                return _json({"error": "No fields to update"})

            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(f"UPDATE transactions SET {set_clause} WHERE id = ?", list(updates.values()) + [txn_id])

        portfolio_db.rebuild_holdings(pid)
        return _json({"updated": True, "txn_id": txn_id, "portfolio_id": pid, "changes": updates})
    except Exception as e:
        return _json({"error": str(e)})


@mcp.tool()
async def delete_transaction(txn_id: int) -> str:
    """Delete a single transaction by ID. Holdings are automatically recalculated."""
    try:
        pid = portfolio_db.delete_transaction(txn_id)
        if pid is None:
            return _json({"error": f"Transaction {txn_id} not found"})
        portfolio_db.rebuild_holdings(pid)
        return _json({"deleted": True, "txn_id": txn_id, "portfolio_id": pid})
    except Exception as e:
        return _json({"error": str(e)})


@mcp.tool()
async def get_transactions(portfolio_id: int, ticker: Optional[str] = None, limit: int = 50) -> str:
    """List transactions for a portfolio, optionally filtered by ticker. Returns most recent first."""
    try:
        txns, total = portfolio_db.get_transactions(portfolio_id, ticker=ticker, limit=limit)
        return _json({"portfolio_id": portfolio_id, "total": total, "transactions": txns})
    except Exception as e:
        return _json({"error": str(e), "portfolio_id": portfolio_id})


@mcp.tool()
async def import_transactions(portfolio_id: int, file_path: str) -> str:
    """Import transactions from a CSV or XLSX file. Columns are auto-detected (supports Sharesight, Stake, CommSec, and generic formats). Holdings are rebuilt after import."""
    try:
        fp = Path(file_path)
        if not fp.exists():
            return _json({"error": f"File not found: {file_path}"})

        file_bytes = fp.read_bytes()
        file_id, columns, sample, total_rows = portfolio_db.parse_file(file_bytes, fp.name)

        # Auto-detect mapping
        mapping = portfolio_db.auto_detect_mapping(columns)

        # Check if we have enough mapped columns
        required = {"date", "ticker"}
        mapped = {k for k, v in mapping.items() if v is not None}
        if not required.issubset(mapped):
            return _json({
                "error": "Could not auto-detect required columns (date, ticker)",
                "columns_found": columns,
                "mapping_detected": mapping,
                "sample_rows": sample[:3],
            })

        # Apply mapping and import
        txns = portfolio_db.apply_mapping(file_id, {k: v for k, v in mapping.items() if v is not None})
        if not txns:
            return _json({"error": "No valid transactions found after mapping", "mapping": mapping})

        count = portfolio_db.add_transactions_batch(portfolio_id, txns)
        portfolio_db.rebuild_holdings(portfolio_id)

        return _json({
            "imported": count,
            "portfolio_id": portfolio_id,
            "file": fp.name,
            "mapping_used": mapping,
        })
    except Exception as e:
        return _json({"error": str(e), "file_path": file_path})


@mcp.tool()
async def optimize_portfolio(tickers: list[str], strategy: str = "mean-variance") -> str:
    """Optimize portfolio weights for a set of tickers using mean-variance optimization or equal-weight strategy. Returns optimal weights, expected return, volatility, and Sharpe ratio."""
    if len(tickers) < 2:
        return _json({"error": "Need at least 2 tickers for optimization"})
    if strategy not in ("mean-variance", "equal-weight"):
        return _json({"error": "Strategy must be 'mean-variance' or 'equal-weight'"})

    try:
        import yfinance as yf
        import math

        def _fetch_returns_local(tickers):
            returns_map = {}
            for t in tickers:
                try:
                    df = yf.download(t, period="1y", interval="1d", progress=False)
                    if df is not None and not df.empty:
                        closes = df["Close"].squeeze()
                        if hasattr(closes, "pct_change"):
                            daily = closes.pct_change().dropna().tolist()
                            if daily:
                                returns_map[t] = daily
                except Exception:
                    pass
            return returns_map

        returns_map = await asyncio.to_thread(_fetch_returns_local, tickers)
        valid = [t for t in tickers if t in returns_map]
        if len(valid) < 2:
            return _json({"error": "Could not fetch return data for enough tickers"})

        # Compute stats
        min_len = min(len(returns_map[t]) for t in valid)
        aligned = {t: returns_map[t][-min_len:] for t in valid}
        n = len(valid)
        means = [sum(aligned[t]) / min_len * 252 for t in valid]

        # Covariance matrix
        cov = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                mi = sum(aligned[valid[i]]) / min_len
                mj = sum(aligned[valid[j]]) / min_len
                cov[i][j] = sum((aligned[valid[i]][k] - mi) * (aligned[valid[j]][k] - mj) for k in range(min_len)) / (min_len - 1)

        if strategy == "equal-weight":
            weights = [1.0 / n] * n
        else:
            # Try Portfolio Optimizer API
            import httpx
            weights = [1.0 / n] * n  # fallback
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.post(
                        "https://api.portfoliooptimizer.io/v1/portfolio/optimization/minimum-variance",
                        json={"assets": n, "assetsCovarianceMatrix": cov, "assetsReturns": means},
                        timeout=15.0,
                    )
                    if resp.status_code == 200:
                        w = resp.json().get("assetsWeights", [])
                        if w and len(w) == n:
                            weights = w
            except Exception:
                pass

        # Portfolio stats
        port_return = sum(weights[i] * means[i] for i in range(n))
        port_var = sum(weights[i] * weights[j] * cov[i][j] for i in range(n) for j in range(n))
        port_vol = math.sqrt(port_var * 252)
        sharpe = port_return / port_vol if port_vol > 0 else 0.0

        assets = [{"ticker": valid[i], "weight": round(weights[i], 4)} for i in range(n)]
        return _json({
            "strategy": strategy,
            "assets": assets,
            "portfolio_return_pct": round(port_return * 100, 2),
            "portfolio_volatility_pct": round(port_vol * 100, 2),
            "sharpe_ratio": round(sharpe, 2),
        })
    except Exception as e:
        return _json({"error": str(e)})


@mcp.tool()
async def rebalance_portfolio(
    portfolio_id: int,
    target_weights: dict[str, float],
    additional_capital: float = 0.0,
) -> str:
    """Calculate buy/sell actions to rebalance a portfolio toward target weights. target_weights is a dict like {"AAPL": 0.4, "GLOB.AX": 0.6}. Weights must sum to ~1.0. Optionally provide additional_capital for buy-only rebalancing."""
    try:
        weight_sum = sum(target_weights.values())
        if abs(weight_sum - 1.0) > 0.05:
            return _json({"error": f"Target weights must sum to ~1.0, got {weight_sum:.4f}"})

        holdings = portfolio_db.get_holdings(portfolio_id)
        tickers_needed = list(set(list(target_weights.keys()) + [h["ticker"] for h in holdings if h["quantity"] > 0.0001]))
        live_prices = await asyncio.to_thread(fetch_live_prices, tickers_needed)

        # Current values
        current_values = {}
        for h in holdings:
            if h["quantity"] > 0.0001:
                price = live_prices.get(h["ticker"], h["avg_cost"])
                current_values[h["ticker"]] = h["quantity"] * price

        current_total = sum(current_values.values())
        new_total = current_total + additional_capital

        actions = []
        for ticker, target_w in target_weights.items():
            current_val = current_values.get(ticker, 0.0)
            target_val = target_w * new_total
            diff = target_val - current_val

            price = live_prices.get(ticker)
            if price and price > 0:
                shares = diff / price
            else:
                shares = 0

            if additional_capital > 0 and diff < 0:
                # buy-only: skip sells
                continue

            actions.append({
                "ticker": ticker,
                "action": "BUY" if diff > 0 else "SELL",
                "amount": round(abs(diff), 2),
                "shares": round(abs(shares), 4),
                "current_value": round(current_val, 2),
                "target_value": round(target_val, 2),
                "price": round(price, 2) if price else None,
            })

        return _json({
            "portfolio_id": portfolio_id,
            "current_total": round(current_total, 2),
            "target_total": round(new_total, 2),
            "additional_capital": additional_capital,
            "actions": sorted(actions, key=lambda x: -x["amount"]),
        })
    except Exception as e:
        return _json({"error": str(e), "portfolio_id": portfolio_id})


# =============================== SYSTEM ====================================


@mcp.tool()
async def manage_tickers(action: str, tickers: Optional[list[str]] = None) -> str:
    """Manage tracked tickers. Actions: 'list' (show current), 'add' (add tickers), 'remove' (remove tickers). For add/remove, provide a list of ticker symbols."""
    if action == "list":
        return _json({"tickers": settings.tickers})

    if action not in ("add", "remove"):
        return _json({"error": "Action must be 'list', 'add', or 'remove'"})

    if not tickers:
        return _json({"error": f"Provide tickers list for '{action}'"})

    current = list(settings.tickers)
    if action == "add":
        for t in tickers:
            if t not in current:
                current.append(t)
    elif action == "remove":
        current = [t for t in current if t not in tickers]
        if not current:
            return _json({"error": "Cannot remove all tickers — at least one must remain"})

    settings.tickers = current

    # Persist to gui_settings.json
    settings_path = settings.project_dir / "legacy" / "gui_settings.json"
    try:
        data = {}
        if settings_path.exists():
            data = json.loads(settings_path.read_text())
        data["tickers"] = current
        settings_path.write_text(json.dumps(data, indent=2))
    except Exception as e:
        return _json({"error": f"Updated in-memory but failed to persist: {e}", "tickers": current})

    return _json({"action": action, "tickers": current})


# =============================== RESOURCES =================================


@mcp.resource("stock://tickers")
async def resource_tickers() -> str:
    """Current list of tracked tickers."""
    return _json({"tickers": settings.tickers})


@mcp.resource("stock://config")
async def resource_config() -> str:
    """Current system configuration."""
    return _json({
        "tickers": settings.tickers,
        "default_timeframe": settings.default_timeframe,
        "timeframes": settings.timeframes,
        "candles_limit": settings.candles_limit,
        "llm_model": settings.llm_model,
        "has_llm_key": bool(settings.llm_api_key),
        "has_finnhub_key": bool(settings.finnhub_api_key),
        "has_fmp_key": bool(settings.fmp_api_key),
    })


@mcp.resource("stock://analysis/{ticker}/latest")
async def resource_latest_analysis(ticker: str) -> str:
    """Latest analysis report for a ticker."""
    db = _get_analysis_db()
    report = db.get_latest(ticker)
    if not report:
        return _json({"error": f"No report for {ticker}"})
    return _json(report)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
