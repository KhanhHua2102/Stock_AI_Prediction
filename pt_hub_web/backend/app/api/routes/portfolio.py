import asyncio
import logging
import math
from datetime import datetime
from typing import List, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


class OptimizeRequest(BaseModel):
    tickers: List[str] = Field(..., min_length=2)
    strategy: str = Field(default="mean-variance", pattern="^(mean-variance|equal-weight)$")


class RiskReturnRequest(BaseModel):
    tickers: List[str] = Field(..., min_length=1)
    weights: List[float] = Field(..., min_length=1)


class HoldingItem(BaseModel):
    ticker: str
    quantity: Optional[float] = None
    price: Optional[float] = None
    value: Optional[float] = None  # alternative: provide total value directly


class TargetWeight(BaseModel):
    ticker: str
    weight: float


class RebalanceRequest(BaseModel):
    holdings: List[HoldingItem] = Field(..., min_length=1)
    target_weights: List[TargetWeight] = Field(..., min_length=1)
    strategy: str = Field(default="rebalance", pattern="^(rebalance|buy-only)$")
    additional_capital: float = Field(default=0.0, ge=0)


def _fetch_returns(tickers: list[str], period: str = "1y") -> dict[str, list[float]]:
    """Fetch daily returns for each ticker using yfinance. Runs in thread."""
    import yfinance as yf

    returns_map = {}
    for ticker in tickers:
        try:
            df = yf.download(ticker, period=period, interval="1d", progress=False)
            if df is not None and not df.empty:
                closes = df["Close"].squeeze()
                if hasattr(closes, "pct_change"):
                    daily_returns = closes.pct_change().dropna().tolist()
                    if daily_returns:
                        returns_map[ticker] = daily_returns
        except Exception as e:
            logger.warning(f"Failed to fetch returns for {ticker}: {e}")
    return returns_map


def _compute_covariance_matrix(returns_map: dict[str, list[float]], tickers: list[str]) -> list[list[float]]:
    """Compute covariance matrix from daily returns (pure Python)."""
    n = len(tickers)
    # Align to shortest series
    min_len = min(len(returns_map[t]) for t in tickers)
    aligned = {t: returns_map[t][-min_len:] for t in tickers}

    means = {t: sum(aligned[t]) / min_len for t in tickers}

    cov = []
    for i in range(n):
        row = []
        for j in range(n):
            ti, tj = tickers[i], tickers[j]
            covar = sum(
                (aligned[ti][k] - means[ti]) * (aligned[tj][k] - means[tj])
                for k in range(min_len)
            ) / (min_len - 1)
            row.append(covar)
        cov.append(row)
    return cov


def _compute_mean_returns(returns_map: dict[str, list[float]], tickers: list[str]) -> list[float]:
    """Compute annualized mean returns."""
    result = []
    for t in tickers:
        daily_mean = sum(returns_map[t]) / len(returns_map[t])
        annualized = daily_mean * 252
        result.append(annualized)
    return result


def _portfolio_stats(weights: list[float], mean_returns: list[float], cov_matrix: list[list[float]]) -> dict:
    """Compute portfolio return, volatility, and Sharpe ratio."""
    n = len(weights)
    port_return = sum(weights[i] * mean_returns[i] for i in range(n))

    # Portfolio variance = w^T * Cov * w
    port_variance = 0.0
    for i in range(n):
        for j in range(n):
            port_variance += weights[i] * weights[j] * cov_matrix[i][j]
    port_volatility = math.sqrt(port_variance * 252)

    sharpe = port_return / port_volatility if port_volatility > 0 else 0.0

    return {
        "portfolio_return": round(port_return * 100, 2),
        "portfolio_volatility": round(port_volatility * 100, 2),
        "sharpe_ratio": round(sharpe, 2),
    }


@router.post("/optimize")
async def optimize_portfolio(req: OptimizeRequest):
    """Optimize portfolio weights using Portfolio Optimizer API or equal-weight fallback."""
    tickers = req.tickers

    if req.strategy == "equal-weight":
        weight = 1.0 / len(tickers)
        # Still fetch returns for risk metrics
        returns_map = await asyncio.to_thread(_fetch_returns, tickers)
        valid_tickers = [t for t in tickers if t in returns_map]
        if len(valid_tickers) < 2:
            return {
                "assets": [{"ticker": t, "weight": weight} for t in tickers],
                "portfolio_return": None,
                "portfolio_volatility": None,
                "sharpe_ratio": None,
                "strategy": "equal-weight",
            }
        eq_weights = [1.0 / len(valid_tickers)] * len(valid_tickers)
        mean_ret = _compute_mean_returns(returns_map, valid_tickers)
        cov = _compute_covariance_matrix(returns_map, valid_tickers)
        stats = _portfolio_stats(eq_weights, mean_ret, cov)
        return {
            "assets": [{"ticker": t, "weight": round(1.0 / len(tickers), 4)} for t in tickers],
            **stats,
            "strategy": "equal-weight",
        }

    # Mean-variance: fetch returns, compute covariance, call Portfolio Optimizer API
    returns_map = await asyncio.to_thread(_fetch_returns, tickers)
    valid_tickers = [t for t in tickers if t in returns_map]

    if len(valid_tickers) < 2:
        raise HTTPException(status_code=400, detail="Could not fetch return data for enough tickers")

    cov_matrix = _compute_covariance_matrix(returns_map, valid_tickers)
    mean_returns = _compute_mean_returns(returns_map, valid_tickers)

    # Call Portfolio Optimizer API for minimum-variance portfolio
    try:
        api_body = {
            "assets": len(valid_tickers),
            "assetsCovarianceMatrix": cov_matrix,
            "assetsReturns": mean_returns,
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.portfoliooptimizer.io/v1/portfolio/optimization/minimum-variance",
                json=api_body,
                timeout=15.0,
            )
            if response.status_code == 200:
                data = response.json()
                weights = data.get("assetsWeights", [])
                if weights and len(weights) == len(valid_tickers):
                    # Map back including any tickers that failed data fetch
                    assets = []
                    weight_map = {valid_tickers[i]: weights[i] for i in range(len(valid_tickers))}
                    for t in tickers:
                        assets.append({"ticker": t, "weight": round(weight_map.get(t, 0.0), 4)})
                    stats = _portfolio_stats(weights, mean_returns, cov_matrix)
                    return {"assets": assets, **stats, "strategy": "mean-variance"}

            logger.warning(f"Portfolio Optimizer API returned {response.status_code}: {response.text}")
    except Exception as e:
        logger.warning(f"Portfolio Optimizer API failed: {e}")

    # Fallback: equal-weight
    logger.info("Falling back to equal-weight allocation")
    weight = 1.0 / len(valid_tickers)
    eq_weights = [weight] * len(valid_tickers)
    stats = _portfolio_stats(eq_weights, mean_returns, cov_matrix)
    return {
        "assets": [{"ticker": t, "weight": round(1.0 / len(tickers), 4)} for t in tickers],
        **stats,
        "strategy": "equal-weight (fallback)",
    }


@router.post("/risk-return")
async def risk_return(req: RiskReturnRequest):
    """Compute risk-return metrics for a given portfolio allocation."""
    if len(req.tickers) != len(req.weights):
        raise HTTPException(status_code=400, detail="tickers and weights must have the same length")

    weight_sum = sum(req.weights)
    if abs(weight_sum - 1.0) > 0.01:
        raise HTTPException(status_code=400, detail=f"Weights must sum to 1.0, got {weight_sum}")

    returns_map = await asyncio.to_thread(_fetch_returns, req.tickers)
    valid = [t for t in req.tickers if t in returns_map]
    if len(valid) < len(req.tickers):
        missing = set(req.tickers) - set(valid)
        raise HTTPException(status_code=400, detail=f"Could not fetch data for: {missing}")

    mean_returns = _compute_mean_returns(returns_map, req.tickers)
    cov_matrix = _compute_covariance_matrix(returns_map, req.tickers)
    stats = _portfolio_stats(req.weights, mean_returns, cov_matrix)
    return stats


def _fetch_current_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch current prices for tickers using yfinance."""
    import yfinance as yf
    from app.services.portfolio_metrics import normalize_ticker

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


@router.post("/rebalance")
async def rebalance_portfolio(req: RebalanceRequest):
    """Compute buy/sell actions to rebalance toward target weights."""
    # Build target weight map
    target_map = {tw.ticker: tw.weight for tw in req.target_weights}
    weight_sum = sum(target_map.values())
    if abs(weight_sum - 1.0) > 0.01:
        raise HTTPException(status_code=400, detail=f"Target weights must sum to 1.0, got {weight_sum:.4f}")

    # Resolve holding values
    # For holdings that have quantity but no price, fetch current prices
    tickers_needing_price = [
        h.ticker for h in req.holdings
        if h.value is None and h.quantity is not None and h.price is None
    ]
    fetched_prices = {}
    if tickers_needing_price:
        fetched_prices = await asyncio.to_thread(_fetch_current_prices, tickers_needing_price)

    holding_values = {}
    holding_prices = {}
    for h in req.holdings:
        if h.value is not None:
            holding_values[h.ticker] = h.value
            # Use price if given, else try to fetch for share calculation
            if h.price is not None:
                holding_prices[h.ticker] = h.price
        elif h.quantity is not None:
            price = h.price if h.price is not None else fetched_prices.get(h.ticker)
            if price is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot determine value for {h.ticker}: no price provided and auto-fetch failed",
                )
            holding_values[h.ticker] = h.quantity * price
            holding_prices[h.ticker] = price
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Holding for {h.ticker} must have either 'value' or 'quantity'",
            )

    # Fetch prices for tickers we don't have prices for (needed for share calculation)
    tickers_without_price = [
        t for t in target_map if t not in holding_prices
    ]
    if tickers_without_price:
        extra_prices = await asyncio.to_thread(_fetch_current_prices, tickers_without_price)
        holding_prices.update(extra_prices)

    current_total = sum(holding_values.values())

    if req.strategy == "buy-only":
        if req.additional_capital <= 0:
            raise HTTPException(status_code=400, detail="buy-only strategy requires additional_capital > 0")
        new_total = current_total + req.additional_capital

        actions = []
        for tw in req.target_weights:
            t = tw.ticker
            current_val = holding_values.get(t, 0.0)
            target_val = tw.weight * new_total
            diff = target_val - current_val

            if diff > 0.01:
                price = holding_prices.get(t)
                shares = diff / price if price and price > 0 else 0
                actions.append({
                    "ticker": t,
                    "action": "BUY",
                    "shares": round(shares, 4),
                    "dollar_amount": round(diff, 2),
                    "current_weight": round(current_val / current_total, 4) if current_total > 0 else 0,
                    "target_weight": tw.weight,
                    "current_value": round(current_val, 2),
                })
            else:
                actions.append({
                    "ticker": t,
                    "action": "HOLD",
                    "shares": 0,
                    "dollar_amount": 0,
                    "current_weight": round(current_val / current_total, 4) if current_total > 0 else 0,
                    "target_weight": tw.weight,
                    "current_value": round(current_val, 2),
                })

        # Cap buy amounts to not exceed additional_capital
        total_buy = sum(a["dollar_amount"] for a in actions if a["action"] == "BUY")
        if total_buy > req.additional_capital:
            scale = req.additional_capital / total_buy
            for a in actions:
                if a["action"] == "BUY":
                    a["dollar_amount"] = round(a["dollar_amount"] * scale, 2)
                    price = holding_prices.get(a["ticker"])
                    a["shares"] = round(a["dollar_amount"] / price, 4) if price and price > 0 else 0

        return {
            "actions": actions,
            "total_portfolio_value": round(current_total, 2),
            "additional_capital": req.additional_capital,
            "strategy": "buy-only",
        }

    # Full rebalance strategy
    actions = []
    for tw in req.target_weights:
        t = tw.ticker
        current_val = holding_values.get(t, 0.0)
        target_val = tw.weight * current_total
        diff = target_val - current_val

        price = holding_prices.get(t)
        shares = abs(diff) / price if price and price > 0 else 0

        if diff > 0.01:
            action = "BUY"
        elif diff < -0.01:
            action = "SELL"
        else:
            action = "HOLD"
            shares = 0
            diff = 0

        actions.append({
            "ticker": t,
            "action": action,
            "shares": round(shares, 4),
            "dollar_amount": round(abs(diff), 2),
            "current_weight": round(current_val / current_total, 4) if current_total > 0 else 0,
            "target_weight": tw.weight,
            "current_value": round(current_val, 2),
        })

    return {
        "actions": actions,
        "total_portfolio_value": round(current_total, 2),
        "additional_capital": 0,
        "strategy": "rebalance",
    }


class CorrelationRequest(BaseModel):
    tickers: List[str] = Field(..., min_length=2)


def _fetch_polygon_closes(tickers: list[str], days: int = 365) -> dict[str, list[float]]:
    """Fetch daily close prices from Polygon. Runs in thread."""
    from app.config import settings
    from datetime import datetime, timedelta

    closes_map = {}
    if not settings.polygon_api_key:
        return closes_map

    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    for ticker in tickers:
        try:
            import httpx as _httpx
            url = (
                f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/{start}/{end}"
                f"?adjusted=true&sort=asc&limit=5000&apiKey={settings.polygon_api_key}"
            )
            resp = _httpx.get(url, timeout=15.0)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                if results:
                    closes_map[ticker] = [r["c"] for r in results]
        except Exception as e:
            logger.warning(f"Failed to fetch Polygon closes for {ticker}: {e}")
    return closes_map


def _compute_correlation_matrix(closes_map: dict[str, list[float]], tickers: list[str]) -> list[list[float]]:
    """Compute Pearson correlation matrix from close prices."""
    n = len(tickers)
    # Compute daily returns
    returns_map = {}
    for t in tickers:
        closes = closes_map[t]
        returns_map[t] = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes))]

    # Align to shortest
    min_len = min(len(returns_map[t]) for t in tickers)
    aligned = {t: returns_map[t][-min_len:] for t in tickers}
    means = {t: sum(aligned[t]) / min_len for t in tickers}

    # Pearson correlation
    corr = []
    for i in range(n):
        row = []
        for j in range(n):
            ti, tj = tickers[i], tickers[j]
            cov = sum((aligned[ti][k] - means[ti]) * (aligned[tj][k] - means[tj]) for k in range(min_len))
            var_i = sum((aligned[ti][k] - means[ti])**2 for k in range(min_len))
            var_j = sum((aligned[tj][k] - means[tj])**2 for k in range(min_len))
            denom = (var_i * var_j) ** 0.5
            row.append(round(cov / denom, 4) if denom > 0 else 0.0)
        corr.append(row)
    return corr


@router.post("/correlation")
async def correlation_matrix(req: CorrelationRequest):
    """Compute Pearson correlation matrix between tickers using Polygon or yfinance."""
    from app.config import settings

    tickers = req.tickers

    # Try Polygon first
    if settings.polygon_api_key:
        closes_map = await asyncio.to_thread(_fetch_polygon_closes, tickers)
        valid = [t for t in tickers if t in closes_map and len(closes_map[t]) > 20]
        if len(valid) >= 2:
            matrix = _compute_correlation_matrix(closes_map, valid)
            return {"tickers": valid, "matrix": matrix, "source": "polygon"}

    # Fallback to yfinance
    returns_map = await asyncio.to_thread(_fetch_returns, tickers)
    valid = [t for t in tickers if t in returns_map and len(returns_map[t]) > 20]
    if len(valid) < 2:
        raise HTTPException(status_code=400, detail="Could not fetch enough data for correlation")

    # Convert returns to closes for correlation (or compute directly from returns)
    min_len = min(len(returns_map[t]) for t in valid)
    aligned = {t: returns_map[t][-min_len:] for t in valid}
    means = {t: sum(aligned[t]) / min_len for t in valid}

    n = len(valid)
    corr = []
    for i in range(n):
        row = []
        for j in range(n):
            ti, tj = valid[i], valid[j]
            cov = sum((aligned[ti][k] - means[ti]) * (aligned[tj][k] - means[tj]) for k in range(min_len))
            var_i = sum((aligned[ti][k] - means[ti])**2 for k in range(min_len))
            var_j = sum((aligned[tj][k] - means[tj])**2 for k in range(min_len))
            denom = (var_i * var_j) ** 0.5
            row.append(round(cov / denom, 4) if denom > 0 else 0.0)
        corr.append(row)

    return {"tickers": valid, "matrix": corr, "source": "yfinance"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Portfolio Management (CRUD, Import, Dashboard)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _get_portfolio_db():
    from app.config import portfolio_db
    return portfolio_db


class CreatePortfolioRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    currency: str = Field(default="AUD", max_length=3)
    benchmark: str = Field(default="URTH")


class UpdatePortfolioRequest(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None
    benchmark: Optional[str] = None


class TransactionRequest(BaseModel):
    ticker: str
    type: Literal["BUY", "SELL", "DIVIDEND", "SPLIT"]
    date: str  # YYYY-MM-DD
    quantity: float
    price: float = 0.0
    fees: float = 0.0
    notes: Optional[str] = None


class ImportColumnMapping(BaseModel):
    date: str
    ticker: str
    type: str
    quantity: str
    price: str
    fees: Optional[str] = None
    amount: Optional[str] = None


class ImportConfirmRequest(BaseModel):
    file_id: str
    mapping: ImportColumnMapping
    currency: Optional[str] = None
    force: bool = False  # Skip duplicate check and import all
    skip_duplicates: bool = False  # Import only non-duplicate rows


# ── Portfolio CRUD ──────────────────────────────────────────────

@router.post("/portfolios")
async def create_portfolio(req: CreatePortfolioRequest):
    db = _get_portfolio_db()
    try:
        pid = db.create_portfolio(req.name, req.currency, req.benchmark)
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=409, detail=f"Portfolio '{req.name}' already exists")
        raise
    return {"id": pid, "name": req.name}


@router.get("/portfolios")
async def list_portfolios():
    db = _get_portfolio_db()
    portfolios = db.get_portfolios()
    return {"portfolios": portfolios}


@router.get("/portfolios/{portfolio_id}")
async def get_portfolio(portfolio_id: int):
    db = _get_portfolio_db()
    p = db.get_portfolio(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


@router.put("/portfolios/{portfolio_id}")
async def update_portfolio(portfolio_id: int, req: UpdatePortfolioRequest):
    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")
    db.update_portfolio(portfolio_id, **req.model_dump(exclude_none=True))
    return {"status": "updated"}


@router.delete("/portfolios/{portfolio_id}")
async def delete_portfolio(portfolio_id: int):
    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")
    db.delete_portfolio(portfolio_id)
    return {"status": "deleted"}


# ── Transactions ────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/transactions")
async def add_transaction(portfolio_id: int, req: TransactionRequest):
    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")
    txn_id = db.add_transaction(portfolio_id, req.model_dump())
    db.rebuild_holdings(portfolio_id)
    return {"id": txn_id}


@router.get("/portfolios/{portfolio_id}/transactions")
async def list_transactions(
    portfolio_id: int,
    ticker: Optional[str] = None,
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
):
    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")
    txns, total = db.get_transactions(portfolio_id, ticker=ticker, limit=limit, offset=offset)
    return {"transactions": txns, "total": total}


@router.delete("/portfolios/{portfolio_id}/transactions/{txn_id}")
async def delete_transaction(portfolio_id: int, txn_id: int):
    db = _get_portfolio_db()
    pid = db.delete_transaction(txn_id)
    if pid is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.rebuild_holdings(pid)
    return {"status": "deleted"}


class BatchDeleteRequest(BaseModel):
    ids: List[int] = Field(..., min_length=1)


@router.post("/portfolios/{portfolio_id}/transactions/batch-delete")
async def batch_delete_transactions(portfolio_id: int, req: BatchDeleteRequest):
    db = _get_portfolio_db()
    pid = db.delete_transactions_batch(req.ids)
    if pid is None:
        raise HTTPException(status_code=404, detail="No matching transactions found")
    db.rebuild_holdings(pid)
    # Clear snapshots so they get recomputed
    first_date = db.get_first_transaction_date(pid)
    if first_date:
        db.delete_snapshots_from(pid, first_date)
    return {"status": "deleted", "count": len(req.ids)}


@router.post("/portfolios/{portfolio_id}/rebuild-snapshots")
async def rebuild_snapshots_endpoint(portfolio_id: int):
    from app.services.portfolio_metrics import backfill_snapshots, fetch_live_prices

    db = _get_portfolio_db()
    portfolio = db.get_portfolio(portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Clear all snapshots
    first_date = db.get_first_transaction_date(portfolio_id)
    if first_date:
        db.delete_snapshots_from(portfolio_id, first_date)

    # Re-backfill
    holdings = db.get_holdings(portfolio_id)
    if holdings:
        await asyncio.to_thread(backfill_snapshots, db, portfolio_id, holdings, force_deposits=True)

    return {"status": "rebuilt"}


# ── Import ──────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/import/preview")
async def import_preview(portfolio_id: int, file: UploadFile = File(...)):
    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")

    data = await file.read()
    try:
        file_id, columns, sample, total = db.parse_file(data, file.filename or "upload.csv")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Auto-detect column mapping
    suggested_mapping = db.auto_detect_mapping(columns)

    return {
        "file_id": file_id,
        "columns": columns,
        "sample_rows": sample,
        "row_count": total,
        "suggested_mapping": suggested_mapping,
    }


_validated_txns: dict[str, list[dict]] = {}


@router.post("/portfolios/{portfolio_id}/import/confirm")
async def import_confirm(portfolio_id: int, req: ImportConfirmRequest):
    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Check if we have cached validated transactions (second call after duplicate warning)
    transactions = _validated_txns.pop(req.file_id, None)

    if transactions is None:
        # First call: parse and validate
        mapping = req.mapping.model_dump(exclude_none=True)
        try:
            transactions = db.apply_mapping(req.file_id, mapping)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        if not transactions:
            raise HTTPException(status_code=400, detail="No valid transactions found in file")

        # Stamp currency
        if req.currency:
            for txn in transactions:
                txn["currency"] = req.currency.upper()

    # Check for duplicates unless force=true
    if not req.force:
        dup_indices = db.find_duplicate_indices(portfolio_id, transactions)
        if dup_indices:
            if req.skip_duplicates:
                # Filter out duplicate rows
                dup_set = set(dup_indices)
                transactions = [t for i, t in enumerate(transactions) if i not in dup_set]
                if not transactions:
                    return {"imported": 0, "status": "success"}
            else:
                # Return all rows with duplicate flags for user decision
                _validated_txns[req.file_id] = transactions
                dup_set = set(dup_indices)
                rows = [
                    {**txn, "is_duplicate": i in dup_set}
                    for i, txn in enumerate(transactions)
                ]
                return {
                    "status": "duplicates_found",
                    "duplicate_count": len(dup_indices),
                    "new_count": len(transactions) - len(dup_indices),
                    "total_count": len(transactions),
                    "rows": rows,
                    "file_id": req.file_id,
                }

    count = db.add_transactions_batch(portfolio_id, transactions)
    db.rebuild_holdings(portfolio_id)

    # Invalidate snapshots from the earliest imported transaction so they get recomputed
    earliest = min(t["date"] for t in transactions)
    db.delete_snapshots_from(portfolio_id, earliest)

    return {"imported": count, "status": "success"}


# ── Dashboard Data ──────────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/holdings")
async def get_holdings(portfolio_id: int):
    from app.services.portfolio_metrics import compute_portfolio_summary, fetch_live_prices

    db = _get_portfolio_db()
    portfolio = db.get_portfolio(portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    holdings = db.get_holdings(portfolio_id)
    if not holdings:
        return {
            "total_value": 0, "total_cost": 0, "unrealised_pnl": 0, "unrealised_pnl_pct": 0,
            "realised_pnl": 0, "total_dividends": 0, "annualised_return": 0,
            "sharpe_ratio": 0, "max_drawdown": 0, "holdings": [],
        }

    # Fetch live prices
    tickers = [h["ticker"] for h in holdings if h["quantity"] > 0]
    live_prices = await asyncio.to_thread(fetch_live_prices, tickers) if tickers else {}

    summary = compute_portfolio_summary(holdings, live_prices, portfolio["currency"])

    # Compute performance metrics from snapshots (exclude today — may not have market data)
    from app.services.portfolio_metrics import compute_twr_returns, compute_annualised_return, compute_sharpe_ratio, compute_max_drawdown, compute_portfolio_beta, compute_benchmark_returns
    today_str = datetime.now().strftime("%Y-%m-%d")
    snapshots = [s for s in db.get_snapshots(portfolio_id) if s["date"] < today_str]
    if len(snapshots) >= 2:
        values = [s["total_value"] for s in snapshots]
        days = (
            __import__("datetime").datetime.strptime(snapshots[-1]["date"], "%Y-%m-%d")
            - __import__("datetime").datetime.strptime(snapshots[0]["date"], "%Y-%m-%d")
        ).days
        # Use TWR for annualised return (accounts for deposits/withdrawals)
        twr = compute_twr_returns(snapshots)
        if twr and days > 0:
            total_return_factor = 1 + twr[-1]["cumulative_return"] / 100
            summary["annualised_return"] = round((total_return_factor ** (365.0 / days) - 1) * 100, 2)
        else:
            summary["annualised_return"] = compute_annualised_return(values[0], values[-1], days) if days > 0 else 0
        # Daily returns for Sharpe — use TWR-adjusted returns to exclude deposit/withdrawal noise
        if twr and len(twr) >= 2:
            twr_factors = [1 + t["cumulative_return"] / 100 for t in twr]
            daily_rets = [(twr_factors[i] / twr_factors[i-1] - 1) for i in range(1, len(twr_factors)) if twr_factors[i-1] > 0]
        else:
            daily_rets = [(values[i] / values[i-1] - 1) for i in range(1, len(values)) if values[i-1] > 0]
        summary["sharpe_ratio"] = compute_sharpe_ratio(daily_rets)
        summary["max_drawdown"] = compute_max_drawdown(values)
        # Beta vs benchmark — align portfolio returns to benchmark trading dates
        benchmark_data = await asyncio.to_thread(
            compute_benchmark_returns, portfolio["benchmark"], snapshots[0]["date"], snapshots[-1]["date"]
        )
        if len(benchmark_data) >= 2:
            bm_dates = {d["date"] for d in benchmark_data}
            # Build date-indexed snapshot values for aligned lookup
            snap_by_date = {s["date"]: s["total_value"] for s in snapshots}
            bm_prices = [100 * (1 + d["cumulative_return"] / 100) for d in benchmark_data]
            # Portfolio returns only on benchmark trading dates — skip dates with missing snapshots
            bm_date_list = [d["date"] for d in benchmark_data]
            port_aligned = []
            bm_aligned = []
            for i in range(1, len(bm_date_list)):
                curr_val = snap_by_date.get(bm_date_list[i])
                prev_val = snap_by_date.get(bm_date_list[i - 1])
                if curr_val and prev_val and prev_val > 0 and bm_prices[i-1] > 0:
                    port_aligned.append(curr_val / prev_val - 1)
                    bm_aligned.append(bm_prices[i] / bm_prices[i-1] - 1)
            summary["beta"] = compute_portfolio_beta(port_aligned, bm_aligned)
        else:
            summary["beta"] = 0
    else:
        summary["annualised_return"] = 0
        summary["sharpe_ratio"] = 0
        summary["max_drawdown"] = 0
        summary["beta"] = 0

    # Save yesterday's snapshot if missing — delegate to backfill for correct TWR cash flows
    if summary["total_value"] > 0:
        from datetime import timedelta
        from app.services.portfolio_metrics import backfill_snapshots
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        existing = db.get_snapshots(portfolio_id, start_date=yesterday, end_date=yesterday)
        if not existing:
            await asyncio.to_thread(backfill_snapshots, db, portfolio_id, holdings, force_deposits=False)

    return summary


@router.get("/portfolios/{portfolio_id}/value-history")
async def get_value_history(portfolio_id: int):
    from app.services.portfolio_metrics import backfill_snapshots

    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Backfill snapshots using transaction replay for accurate TWR
    snapshots = db.get_snapshots(portfolio_id)
    needs_full_backfill = len(snapshots) < 5
    # Also check if any snapshots are missing cash_flow (legacy data)
    # Use 'is None' — cash_flow=0 is valid (before first transaction)
    if not needs_full_backfill and any(s.get("cash_flow") is None for s in snapshots[:10]):
        needs_full_backfill = True
    if needs_full_backfill:
        holdings = db.get_holdings(portfolio_id)
        if holdings:
            await asyncio.to_thread(backfill_snapshots, db, portfolio_id, holdings, force_deposits=True)
            snapshots = db.get_snapshots(portfolio_id)

    # Exclude today — market data may not be available yet
    today = datetime.now().strftime("%Y-%m-%d")
    snapshots = [s for s in snapshots if s["date"] < today]

    return {"data": [
        {"date": s["date"], "value": s["total_value"], "deposits": s.get("cash_flow", 0) or s["total_cost"]}
        for s in snapshots
    ]}


@router.get("/portfolios/{portfolio_id}/performance")
async def get_performance(portfolio_id: int):
    from app.services.portfolio_metrics import compute_twr_returns, compute_benchmark_returns

    db = _get_portfolio_db()
    portfolio = db.get_portfolio(portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    today = datetime.now().strftime("%Y-%m-%d")
    snapshots = [s for s in db.get_snapshots(portfolio_id) if s["date"] < today]
    if len(snapshots) < 2:
        return {"portfolio": [], "benchmark": [], "benchmark_ticker": portfolio["benchmark"]}

    portfolio_returns = compute_twr_returns(snapshots)

    # Fetch benchmark
    start = snapshots[0]["date"]
    end = snapshots[-1]["date"]
    benchmark_returns = await asyncio.to_thread(
        compute_benchmark_returns, portfolio["benchmark"], start, end
    )

    return {
        "portfolio": portfolio_returns,
        "benchmark": benchmark_returns,
        "benchmark_ticker": portfolio["benchmark"],
    }


@router.get("/portfolios/{portfolio_id}/dividends")
async def get_dividends(portfolio_id: int, group_by: str = Query(default="month", pattern="^(month|year)$")):
    from app.services.portfolio_metrics import compute_dividend_summary

    db = _get_portfolio_db()
    portfolio = db.get_portfolio(portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    display_ccy = portfolio["currency"]
    holdings = db.get_holdings(portfolio_id)
    ticker_currency = {h["ticker"]: h.get("currency") for h in holdings}

    div_txns = db.get_dividend_transactions(portfolio_id)
    result = await asyncio.to_thread(
        compute_dividend_summary, div_txns, group_by, ticker_currency, display_ccy
    )
    return {"data": result, "group_by": group_by}


@router.get("/portfolios/{portfolio_id}/allocation")
async def get_allocation(portfolio_id: int):
    from app.services.portfolio_metrics import compute_sector_allocation, fetch_live_prices, fetch_fx_rate

    db = _get_portfolio_db()
    portfolio = db.get_portfolio(portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    display_ccy = portfolio["currency"]
    holdings = db.get_holdings(portfolio_id)
    active = [h for h in holdings if h["quantity"] > 0]
    if not active:
        return {"data": []}

    tickers = [h["ticker"] for h in active]
    prices = await asyncio.to_thread(fetch_live_prices, tickers)

    # Fetch FX rates for foreign-currency holdings
    fx_rates: dict[str, float] = {}
    for h in active:
        ccy = h.get("currency")
        if ccy and ccy != display_ccy and ccy not in fx_rates:
            fx_rates[ccy] = await asyncio.to_thread(fetch_fx_rate, ccy, display_ccy)

    values = {}
    for h in active:
        ccy = h.get("currency")
        fx = fx_rates.get(ccy, 1.0) if ccy else 1.0
        values[h["ticker"]] = h["quantity"] * prices.get(h["ticker"], h["avg_cost"]) * fx

    result = await asyncio.to_thread(compute_sector_allocation, tickers, values)
    return {"data": result}


@router.get("/portfolios/{portfolio_id}/returns")
async def get_returns(portfolio_id: int):
    from app.services.portfolio_metrics import compute_monthly_returns

    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")

    today_str = datetime.now().strftime("%Y-%m-%d")
    snapshots = [s for s in db.get_snapshots(portfolio_id) if s["date"] < today_str]
    result = compute_monthly_returns(snapshots)
    return {"data": result}


@router.get("/portfolios/{portfolio_id}/drawdown")
async def get_drawdown(portfolio_id: int):
    from app.services.portfolio_metrics import compute_drawdown

    db = _get_portfolio_db()
    if not db.get_portfolio(portfolio_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")

    today_str = datetime.now().strftime("%Y-%m-%d")
    snapshots = [s for s in db.get_snapshots(portfolio_id) if s["date"] < today_str]
    result = compute_drawdown(snapshots)
    return {"data": result}


@router.get("/portfolios/{portfolio_id}/stock-breakdown")
async def get_stock_breakdown(portfolio_id: int):
    from app.services.portfolio_metrics import fetch_live_prices, fetch_fx_rate

    db = _get_portfolio_db()
    portfolio = db.get_portfolio(portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    display_ccy = portfolio["currency"]
    holdings = db.get_holdings(portfolio_id)
    if not holdings:
        return {"data": [], "closed": []}

    tickers = [h["ticker"] for h in holdings if h["quantity"] > 0]
    prices = await asyncio.to_thread(fetch_live_prices, tickers) if tickers else {}

    # Fetch FX rates for foreign-currency holdings
    fx_rates: dict[str, float] = {}
    for h in holdings:
        ccy = h.get("currency")
        if ccy and ccy != display_ccy and ccy not in fx_rates:
            fx_rates[ccy] = await asyncio.to_thread(fetch_fx_rate, ccy, display_ccy)

    active = []
    closed = []
    for h in holdings:
        ticker = h["ticker"]
        qty = h["quantity"]
        ccy = h.get("currency")
        fx = fx_rates.get(ccy, 1.0) if ccy else 1.0

        price = prices.get(ticker, h["avg_cost"])
        market_val = qty * price * fx
        cost = h["cost_basis"] * fx
        avg_cost = h["avg_cost"] * fx
        realised = h.get("realised_pnl", 0) * fx
        divs = h.get("total_dividends", 0) * fx
        unrealised = (market_val - cost) if qty > 0 else 0
        total_return = unrealised + realised + divs
        total_return_pct = (total_return / cost * 100) if cost > 0 else 0

        entry = {
            "ticker": ticker,
            "quantity": qty,
            "avg_cost": round(avg_cost, 4),
            "current_price": round(price * fx, 2),
            "market_value": round(market_val, 2),
            "cost_basis": round(cost, 2),
            "unrealised_pnl": round(unrealised, 2),
            "realised_pnl": round(realised, 2),
            "dividends": round(divs, 2),
            "total_return": round(total_return, 2),
            "total_return_pct": round(total_return_pct, 2),
        }

        if qty > 0.0001:
            active.append(entry)
        else:
            closed.append(entry)

    return {
        "data": sorted(active, key=lambda x: abs(x["total_return"]), reverse=True),
        "closed": sorted(closed, key=lambda x: abs(x["total_return"]), reverse=True),
    }
