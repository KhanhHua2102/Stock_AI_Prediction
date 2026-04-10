"""
Multi-Agent LangGraph Engine

Orchestrates: data collection -> parallel analyst execution -> optional debate
-> risk management -> portfolio management.

Uses the existing FINA Suite data pipeline plus financialdatasets.ai client.
"""

import asyncio
import json
import logging
import math
import re
import time
from typing import Annotated, Any, Callable, Literal, Optional, TypedDict

import numpy as np
from langgraph.graph import StateGraph, START, END
from pydantic import BaseModel, Field

from app.config import settings, agent_registry
from app.services import financial_datasets_api as fd_api
from app.services.analysis_engine import (
    _fetch_candles,
    _fetch_reddit_sentiment,
    _fetch_stocktwits_sentiment,
    _fetch_fear_greed_index,
    _fetch_sec_filings,
    _get_cik,
    _fetch_finnhub_recommendations,
    _fetch_ticker_news,
    _fetch_price_target,
    _fetch_fmp_valuation,
    _fetch_treasury_rates,
    _fetch_macro_indicators,
    compute_indicators,
    compute_trend_prejudgment,
    analysis_engine,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AgentSignal(BaseModel):
    agent_id: str
    agent_name: str
    category: str
    signal: Literal["bullish", "bearish", "neutral"]
    confidence: float
    max_position_pct: float = 0.15
    reasoning: str
    key_factors: list[str] = Field(default_factory=list)


class ConsensusResult(BaseModel):
    ticker: str
    action: Literal["BUY", "SELL", "HOLD"]
    confidence: float
    bullish_count: int
    bearish_count: int
    neutral_count: int
    weighted_bullish_pct: float
    weighted_bearish_pct: float
    reasoning: str


class TradeRecommendation(BaseModel):
    ticker: str
    action: Literal["BUY", "SELL", "HOLD"]
    confidence: float
    suggested_allocation_pct: float
    suggested_amount: float
    reasoning: str
    agent_breakdown: list[dict] = Field(default_factory=list)
    risk_notes: str = ""
    debate_summary: Optional[str] = None


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

def _merge_lists(a: list, b: list) -> list:
    return a + b


def _merge_dicts(a: dict, b: dict) -> dict:
    return {
        **a,
        **{
            k: _merge_dicts(a.get(k, {}), v)
            if isinstance(v, dict) and isinstance(a.get(k), dict)
            else v
            for k, v in b.items()
        },
    }


class MultiAgentState(TypedDict):
    tickers: list[str]
    selected_agents: list[str]
    portfolio_context: dict
    enable_risk_reasoning: bool
    market_data: Annotated[dict, _merge_dicts]
    agent_signals: Annotated[list[dict], _merge_lists]
    debate_rounds: Annotated[list[dict], _merge_lists]
    risk_assessment: dict
    risk_reasoning: str
    consensus: dict
    recommendations: list[dict]
    log_callback: Optional[Callable]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _call_llm(system_prompt: str, user_prompt: str, log_cb: Optional[Callable] = None) -> str:
    """Call the LLM via AsyncOpenAI with fallback model support."""
    import httpx as _httpx
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        base_url=settings.llm_api_base,
        api_key=settings.llm_api_key,
        timeout=_httpx.Timeout(120.0, connect=30.0),
    )

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})

    models = [settings.llm_model] + settings.llm_fallback_models
    last_error = None

    for model in models:
        try:
            if log_cb:
                log_cb(f"LLM call using model: {model}")
            resp = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.2,
                max_tokens=settings.llm_max_tokens,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            last_error = e
            logger.warning("_call_llm model %s failed: %s", model, e)

    raise RuntimeError(f"All LLM models failed. Last error: {last_error}")


def _parse_agent_json(raw: str) -> dict:
    """Parse JSON from agent LLM response with multiple fallbacks."""
    text = raw.strip()

    # Direct parse
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Regex for ```json blocks
    match = re.search(r"```json\s*(.*?)```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    # Regex for outermost { ... }
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    # json_repair fallback
    try:
        import json_repair
        result = json_repair.loads(text)
        if isinstance(result, dict):
            return result
    except Exception:
        pass

    return {}


def _emit(state: dict, msg: str) -> None:
    """Emit a log message via the state's log_callback if set."""
    cb = state.get("log_callback")
    if cb:
        try:
            cb(msg)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Node: data_collector
# ---------------------------------------------------------------------------

async def data_collector_node(state: MultiAgentState) -> dict:
    """Fetch all market data for each ticker in parallel."""
    from app.services.portfolio_metrics import normalize_ticker

    _emit(state, "Collecting market data for all tickers...")
    result: dict[str, dict] = {}

    async def _collect_one(ticker: str) -> tuple[str, dict]:
        # Normalize broker-format tickers (e.g. BGBL:AU → BGBL.AX) for API calls
        api_ticker = normalize_ticker(ticker)
        _emit(state, f"  Fetching data for {ticker}...")
        data: dict[str, Any] = {}

        # Fetch candles synchronously via thread
        candles = await asyncio.to_thread(_fetch_candles, api_ticker, 200)
        data["candles"] = candles

        # Parallel fetch of all other data sources
        cik = await _get_cik(api_ticker) if api_ticker != "VNINDEX" else None

        tasks = {
            "reddit_sentiment": _fetch_reddit_sentiment(api_ticker) if api_ticker != "VNINDEX" else asyncio.sleep(0),
            "stocktwits_sentiment": _fetch_stocktwits_sentiment(api_ticker) if api_ticker != "VNINDEX" else asyncio.sleep(0),
            "fear_greed": _fetch_fear_greed_index(),
            "sec_filings": _fetch_sec_filings(cik) if cik else asyncio.sleep(0),
            "finnhub_recommendations": _fetch_finnhub_recommendations(api_ticker) if api_ticker != "VNINDEX" else asyncio.sleep(0),
            "ticker_news": _fetch_ticker_news(api_ticker),
            "price_target": _fetch_price_target(api_ticker) if api_ticker != "VNINDEX" else asyncio.sleep(0),
            "fmp_valuation": _fetch_fmp_valuation(api_ticker),
            "treasury_rates": _fetch_treasury_rates(),
            "macro_indicators": _fetch_macro_indicators(api_ticker),
            # financialdatasets.ai sources
            "financial_metrics": fd_api.fetch_financial_metrics(api_ticker),
            "insider_trades": fd_api.fetch_insider_trades(api_ticker),
            "company_news": fd_api.fetch_company_news(api_ticker),
            "company_facts": fd_api.fetch_company_facts(api_ticker),
            "line_items": fd_api.fetch_line_items(
                api_ticker,
                ["revenue", "net_income", "earnings_per_share", "free_cash_flow", "total_debt"],
            ),
        }

        keys = list(tasks.keys())
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for k, v in zip(keys, results):
            if isinstance(v, Exception):
                logger.warning("data_collector %s/%s failed: %s", ticker, k, v)
                data[k] = None
            else:
                data[k] = v if not isinstance(v, type(None)) else None

        # Compute indicators and trend prejudgment if we have enough candles
        if candles and len(candles) >= 20:
            indicators = compute_indicators(candles)
            current_price = candles[-1]["close"]
            trend_prejudgment = compute_trend_prejudgment(indicators, current_price, candles)
            data["indicators"] = indicators
            data["trend_prejudgment"] = trend_prejudgment
            data["current_price"] = current_price
        elif candles:
            data["current_price"] = candles[-1]["close"]
            data["indicators"] = None
            data["trend_prejudgment"] = None
        else:
            data["current_price"] = 0.0
            data["indicators"] = None
            data["trend_prejudgment"] = None

        _emit(state, f"  Data collection complete for {ticker}")
        return ticker, data

    gather_results = await asyncio.gather(
        *[_collect_one(t) for t in state["tickers"]],
        return_exceptions=True,
    )

    for item in gather_results:
        if isinstance(item, Exception):
            logger.error("data_collector ticker failed: %s", item)
            continue
        ticker, data = item
        result[ticker] = data

    return {"market_data": result}


# ---------------------------------------------------------------------------
# Helper: build data context for agent prompt
# ---------------------------------------------------------------------------

def _build_data_context(ticker_data: dict, requires: list[str]) -> str:
    """Build a text summary of market data for the agent prompt."""
    sections: list[str] = []

    if "candles" in requires:
        candles = ticker_data.get("candles", [])
        if candles:
            recent = candles[-5:]
            lines = ["## Recent Price Action (last 5 days)"]
            for c in recent:
                lines.append(
                    f"  {c['time']}: O={c['open']:.2f} H={c['high']:.2f} "
                    f"L={c['low']:.2f} C={c['close']:.2f} V={c['volume']:,.0f}"
                )
            sections.append("\n".join(lines))

        indicators = ticker_data.get("indicators")
        if indicators:
            ma = indicators.get("ma_alignment", {})
            rsi = indicators.get("rsi", {})
            macd = indicators.get("macd", {})
            vol = indicators.get("volume", {})
            sections.append(
                f"## Technical Indicators\n"
                f"- MA Alignment: SMA20={ma.get('sma20')}, SMA50={ma.get('sma50')}, "
                f"SMA200={ma.get('sma200')} ({ma.get('status', 'N/A')})\n"
                f"- Trend Level: {ma.get('trend_level', 'N/A')}\n"
                f"- RSI(14): {rsi.get('value')} ({rsi.get('zone', 'N/A')})\n"
                f"- MACD: histogram={macd.get('histogram')} ({macd.get('direction', 'N/A')})\n"
                f"- Volume: {vol.get('ratio', 'N/A')}x avg ({vol.get('category', 'N/A')})\n"
                f"- Support: {indicators.get('support', [])}\n"
                f"- Resistance: {indicators.get('resistance', [])}"
            )

        prejudgment = ticker_data.get("trend_prejudgment")
        if prejudgment:
            sections.append(
                f"## Trend Pre-judgment\n"
                f"- Score: {prejudgment.get('signal_score', 'N/A')}/100\n"
                f"- Status: {prejudgment.get('trend_status', 'N/A')}\n"
                f"- Bullish factors: {'; '.join(prejudgment.get('reasons', []))}\n"
                f"- Risk factors: {'; '.join(prejudgment.get('risks', []))}"
            )

    if "fundamentals" in requires:
        val = ticker_data.get("fmp_valuation")
        if val:
            lines = ["## Fundamental Valuation (FMP)"]
            if val.get("dcf") is not None:
                lines.append(f"- DCF Fair Value: ${val['dcf']:.2f}")
            if val.get("pe_ratio") is not None:
                lines.append(f"- P/E Ratio: {val['pe_ratio']:.1f}")
            if val.get("roe") is not None:
                lines.append(f"- ROE: {val['roe']*100:.1f}%")
            if val.get("debt_equity_ratio") is not None:
                lines.append(f"- Debt/Equity: {val['debt_equity_ratio']:.2f}")
            sections.append("\n".join(lines))

        pt = ticker_data.get("price_target")
        if pt:
            sections.append(
                f"## Analyst Price Targets\n"
                f"- Average: ${pt.get('average')} | High: ${pt.get('high')} | Low: ${pt.get('low')}"
            )

    if "financials" in requires:
        metrics = ticker_data.get("financial_metrics")
        if metrics and isinstance(metrics, list) and len(metrics) > 0:
            latest = metrics[0]
            lines = ["## Financial Metrics (TTM)"]
            for k, v in latest.items():
                if k not in ("ticker", "period", "calendar_date", "report_period") and v is not None:
                    lines.append(f"- {k}: {v}")
            sections.append("\n".join(lines[:15]))  # cap at 15 lines

        line_items = ticker_data.get("line_items")
        if line_items and isinstance(line_items, list):
            lines = ["## Key Financial Line Items"]
            for item in line_items[:5]:
                lines.append(f"  - {item}")
            sections.append("\n".join(lines))

        facts = ticker_data.get("company_facts")
        if facts and isinstance(facts, dict):
            lines = ["## Company Facts"]
            for k in ("name", "sector", "industry", "market_cap", "employees"):
                if facts.get(k):
                    lines.append(f"- {k}: {facts[k]}")
            sections.append("\n".join(lines))

    if "sentiment" in requires:
        reddit = ticker_data.get("reddit_sentiment")
        if reddit:
            sections.append(
                f"## Reddit Sentiment\n"
                f"- Status: {reddit.get('sentiment')} (score: {reddit.get('sentiment_score')})\n"
                f"- Comments: {reddit.get('no_of_comments')}"
            )
        stocktwits = ticker_data.get("stocktwits_sentiment")
        if stocktwits:
            sections.append(
                f"## StockTwits\n"
                f"- Sentiment: {stocktwits.get('sentiment')}\n"
                f"- Bullish: {stocktwits.get('bullish_count')} | Bearish: {stocktwits.get('bearish_count')}"
            )
        fg = ticker_data.get("fear_greed")
        if fg:
            sections.append(
                f"## Fear & Greed Index\n- Score: {fg.get('score')}/100 ({fg.get('rating')})"
            )

    if "insider_trades" in requires:
        trades = ticker_data.get("insider_trades")
        if trades and isinstance(trades, list):
            lines = ["## Recent Insider Trades"]
            for t in trades[:10]:
                lines.append(
                    f"  - {t.get('name', 'Unknown')}: {t.get('transaction_type', '?')} "
                    f"{t.get('shares', 0):,.0f} shares @ ${t.get('price_per_share', 0):.2f} "
                    f"({t.get('filing_date', '')})"
                )
            sections.append("\n".join(lines))

    if "news" in requires:
        news = ticker_data.get("ticker_news") or []
        company_news = ticker_data.get("company_news") or []
        all_news = news + (company_news if isinstance(company_news, list) else [])
        if all_news:
            lines = ["## Recent News"]
            for n in all_news[:8]:
                headline = n.get("headline") or n.get("title", "")
                source = n.get("source", "")
                lines.append(f"  - [{source}] {headline}")
            sections.append("\n".join(lines))

        rec = ticker_data.get("finnhub_recommendations")
        if rec:
            sections.append(
                f"## Analyst Consensus (Finnhub)\n"
                f"- StrongBuy: {rec.get('strongBuy')} | Buy: {rec.get('buy')} | "
                f"Hold: {rec.get('hold')} | Sell: {rec.get('sell')} | StrongSell: {rec.get('strongSell')}"
            )

    if "macro" in requires:
        macro = ticker_data.get("macro_indicators")
        if macro:
            lines = [f"## Macro Indicators ({macro.get('region', 'N/A')})"]
            for k in ("cpi", "gdp_growth", "unemployment", "fed_funds_rate"):
                if k in macro and macro[k]:
                    lines.append(f"- {k}: {macro[k]}")
            sections.append("\n".join(lines))

        treasury = ticker_data.get("treasury_rates")
        if treasury:
            sections.append(
                f"## Treasury Rates (as of {treasury.get('date', 'N/A')})\n"
                f"- Bills: {treasury.get('bills')}% | Notes: {treasury.get('notes')}% | "
                f"Bonds: {treasury.get('bonds')}%"
            )

        filings = ticker_data.get("sec_filings")
        if filings and isinstance(filings, list):
            lines = ["## Recent SEC Filings"]
            for f in filings:
                lines.append(f"  - {f.get('date')}: {f.get('form')}")
            sections.append("\n".join(lines))

    return "\n\n".join(sections) if sections else "No data available."


# ---------------------------------------------------------------------------
# Helper: run a single agent
# ---------------------------------------------------------------------------

async def _run_single_agent(
    agent_id: str, ticker: str, ticker_data: dict, state: MultiAgentState
) -> dict:
    """Run one agent for one ticker, returning an AgentSignal-compatible dict."""
    config = agent_registry.get(agent_id)
    if config is None:
        logger.warning("Agent %s not found in registry", agent_id)
        return {
            "agent_id": agent_id,
            "agent_name": agent_id,
            "category": "unknown",
            "signal": "neutral",
            "confidence": 0.0,
            "reasoning": f"Agent {agent_id} not found in registry",
            "key_factors": [],
            "max_position_pct": 0.0,
        }

    # If this is the built-in FINA analyst, delegate to analysis_engine
    if config.is_fina_analyst:
        _emit(state, f"  Running FINA Analyst for {ticker}...")
        try:
            result = await analysis_engine.run_as_agent(ticker)
            result["ticker"] = ticker
            _emit(state, f"  FINA Analyst for {ticker}: {result.get('signal')} ({result.get('confidence')})")
            return result
        except Exception as e:
            logger.error("FINA Analyst failed for %s: %s", ticker, e)
            return {
                "agent_id": "fina_analyst",
                "agent_name": "FINA Analyst",
                "category": "technical",
                "signal": "neutral",
                "confidence": 0.0,
                "reasoning": f"FINA Analyst error: {e}",
                "key_factors": [],
                "max_position_pct": 0.0,
                "ticker": ticker,
            }

    # For LLM-based agents: build context and call LLM
    _emit(state, f"  Running {config.name} for {ticker}...")
    data_context = _build_data_context(ticker_data, config.requires_data)
    current_price = ticker_data.get("current_price", 0)

    user_prompt = (
        f"Analyze {ticker} (current price: ${current_price:.2f}) and provide your "
        f"investment signal.\n\n{data_context}\n\n"
        f"Respond with JSON only:\n"
        f'{{"signal": "bullish"|"bearish"|"neutral", '
        f'"confidence": <0-100>, '
        f'"reasoning": "<your analysis>", '
        f'"key_factors": ["<factor1>", "<factor2>", ...], '
        f'"max_position_pct": <0.0-0.25>}}'
    )

    try:
        log_cb = state.get("log_callback")
        raw = await _call_llm(config.system_prompt, user_prompt, log_cb)
        parsed = _parse_agent_json(raw)

        signal = parsed.get("signal", "neutral")
        if signal not in ("bullish", "bearish", "neutral"):
            signal = "neutral"

        confidence = parsed.get("confidence", 50.0)
        if isinstance(confidence, (int, float)):
            if confidence > 1.0:
                confidence = confidence / 100.0
        else:
            confidence = 0.5

        result = {
            "agent_id": config.id,
            "agent_name": config.name,
            "category": config.category,
            "signal": signal,
            "confidence": round(float(confidence), 2),
            "reasoning": parsed.get("reasoning", raw[:500]),
            "key_factors": parsed.get("key_factors", [])[:6],
            "max_position_pct": min(float(parsed.get("max_position_pct", 0.15)), 0.25),
            "ticker": ticker,
        }

        _emit(state, f"  {config.name} for {ticker}: {signal} ({result['confidence']})")
        return result

    except Exception as e:
        logger.error("Agent %s failed for %s: %s", config.id, ticker, e)
        return {
            "agent_id": config.id,
            "agent_name": config.name,
            "category": config.category,
            "signal": "neutral",
            "confidence": 0.0,
            "reasoning": f"Agent error: {e}",
            "key_factors": [],
            "max_position_pct": 0.0,
            "ticker": ticker,
        }


# ---------------------------------------------------------------------------
# Node: analysts
# ---------------------------------------------------------------------------

async def analyst_node(state: MultiAgentState) -> dict:
    """Run all selected agents in parallel for all tickers."""
    _emit(state, "Running analyst agents...")
    tasks = []
    for ticker in state["tickers"]:
        ticker_data = state.get("market_data", {}).get(ticker, {})
        for agent_id in state["selected_agents"]:
            tasks.append(_run_single_agent(agent_id, ticker, ticker_data, state))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    signals = []
    for r in results:
        if isinstance(r, Exception):
            logger.error("analyst_node task failed: %s", r)
            continue
        signals.append(r)

    _emit(state, f"Collected {len(signals)} agent signals")
    return {"agent_signals": signals}


# ---------------------------------------------------------------------------
# Conditional: should we debate?
# ---------------------------------------------------------------------------

def _should_debate(state: MultiAgentState) -> str:
    """Return 'debate' if any ticker has significant bull/bear divergence, else 'skip_debate'."""
    signals = state.get("agent_signals", [])
    tickers = state.get("tickers", [])

    for ticker in tickers:
        ticker_signals = [s for s in signals if s.get("ticker") == ticker]
        if not ticker_signals:
            continue
        total = len(ticker_signals)
        bullish = sum(1 for s in ticker_signals if s.get("signal") == "bullish")
        bearish = sum(1 for s in ticker_signals if s.get("signal") == "bearish")
        if total > 0 and (bullish / total) > 0.4 and (bearish / total) > 0.4:
            return "debate"

    return "skip_debate"


# ---------------------------------------------------------------------------
# Node: debate
# ---------------------------------------------------------------------------

async def debate_node(state: MultiAgentState) -> dict:
    """Run a debate round for tickers with divergent signals."""
    _emit(state, "Running debate for divergent tickers...")
    signals = state.get("agent_signals", [])
    rounds: list[dict] = []

    for ticker in state["tickers"]:
        ticker_signals = [s for s in signals if s.get("ticker") == ticker]
        if not ticker_signals:
            continue

        total = len(ticker_signals)
        bullish = [s for s in ticker_signals if s.get("signal") == "bullish"]
        bearish = [s for s in ticker_signals if s.get("signal") == "bearish"]

        if total > 0 and (len(bullish) / total) > 0.4 and (len(bearish) / total) > 0.4:
            _emit(state, f"  Debate for {ticker}: {len(bullish)} bull vs {len(bearish)} bear")

            bull_summary = "\n".join(
                f"- {s['agent_name']} ({s['confidence']:.0%}): {s['reasoning'][:200]}"
                for s in bullish
            )
            bear_summary = "\n".join(
                f"- {s['agent_name']} ({s['confidence']:.0%}): {s['reasoning'][:200]}"
                for s in bearish
            )

            system_prompt = (
                "You are an impartial investment moderator. Analyze the bull and bear "
                "arguments and provide a balanced synthesis. Focus on which side has "
                "stronger evidence and what risks each side may be overlooking."
            )
            user_prompt = (
                f"## Debate for {ticker}\n\n"
                f"### Bull Case\n{bull_summary}\n\n"
                f"### Bear Case\n{bear_summary}\n\n"
                f"Provide your synthesis in JSON:\n"
                f'{{"ticker": "{ticker}", "synthesis": "<your balanced analysis>", '
                f'"stronger_side": "bull"|"bear"|"balanced", '
                f'"key_risks": ["<risk1>", "<risk2>"]}}'
            )

            try:
                raw = await _call_llm(system_prompt, user_prompt, state.get("log_callback"))
                parsed = _parse_agent_json(raw)
                rounds.append({
                    "ticker": ticker,
                    "round": 1,
                    "synthesis": parsed.get("synthesis", raw[:500]),
                    "stronger_side": parsed.get("stronger_side", "balanced"),
                    "key_risks": parsed.get("key_risks", []),
                    "bull_count": len(bullish),
                    "bear_count": len(bearish),
                })
                _emit(state, f"  Debate result for {ticker}: {parsed.get('stronger_side', 'balanced')}")
            except Exception as e:
                logger.error("Debate failed for %s: %s", ticker, e)
                rounds.append({
                    "ticker": ticker,
                    "round": 1,
                    "synthesis": f"Debate failed: {e}",
                    "stronger_side": "balanced",
                    "key_risks": [],
                    "bull_count": len(bullish),
                    "bear_count": len(bearish),
                })

    return {"debate_rounds": rounds}


# ---------------------------------------------------------------------------
# Node: risk_manager
# ---------------------------------------------------------------------------

async def risk_manager_node(state: MultiAgentState) -> dict:
    """Compute volatility-based position limits and cross-ticker correlation."""
    _emit(state, "Running risk assessment...")
    market_data = state.get("market_data", {})
    tickers = state.get("tickers", [])

    per_ticker: dict[str, dict] = {}
    returns_map: dict[str, list[float]] = {}

    for ticker in tickers:
        td = market_data.get(ticker, {})
        candles = td.get("candles", [])
        if not candles or len(candles) < 10:
            per_ticker[ticker] = {
                "volatility": None,
                "max_position_pct": 0.10,
                "note": "Insufficient data",
            }
            continue

        closes = [c["close"] for c in candles]
        daily_returns = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]
        returns_map[ticker] = daily_returns

        # Annualized volatility
        vol = float(np.std(daily_returns)) * math.sqrt(252)

        # Volatility-based position limit
        if vol < 0.15:
            max_pos = 0.25
        elif vol < 0.30:
            # Linear scale from 0.25 down to 0.12
            max_pos = 0.25 - (vol - 0.15) / 0.15 * 0.13
        elif vol < 0.50:
            max_pos = 0.12
        else:
            max_pos = 0.10

        per_ticker[ticker] = {
            "volatility": round(vol, 4),
            "max_position_pct": round(max_pos, 4),
            "daily_returns_count": len(daily_returns),
        }

    # Cross-ticker correlation matrix
    correlation_multiplier = 1.0
    if len(returns_map) > 1:
        ticker_list = sorted(returns_map.keys())
        min_len = min(len(returns_map[t]) for t in ticker_list)
        if min_len > 5:
            matrix = np.array([returns_map[t][-min_len:] for t in ticker_list])
            corr = np.corrcoef(matrix)

            # Find max off-diagonal correlation
            max_corr = 0.0
            for i in range(len(ticker_list)):
                for j in range(i + 1, len(ticker_list)):
                    max_corr = max(max_corr, abs(corr[i][j]))

            if max_corr >= 0.80:
                correlation_multiplier = 0.70
            elif max_corr >= 0.60:
                correlation_multiplier = 0.85
            elif max_corr >= 0.40:
                correlation_multiplier = 1.0
            elif max_corr >= 0.20:
                correlation_multiplier = 1.05
            else:
                correlation_multiplier = 1.10

            # Apply correlation multiplier to position limits
            for ticker in per_ticker:
                if per_ticker[ticker].get("max_position_pct"):
                    per_ticker[ticker]["max_position_pct"] = round(
                        per_ticker[ticker]["max_position_pct"] * correlation_multiplier, 4
                    )

    risk_assessment = {
        "per_ticker": per_ticker,
        "correlation_multiplier": round(correlation_multiplier, 4),
        "ticker_count": len(tickers),
    }

    # Optional LLM reasoning
    risk_reasoning = ""
    if state.get("enable_risk_reasoning"):
        _emit(state, "Generating risk reasoning via LLM...")
        try:
            system_prompt = (
                "You are a risk manager. Provide a brief risk assessment "
                "for the following portfolio positions."
            )
            user_prompt = (
                f"## Risk Assessment Data\n{json.dumps(risk_assessment, indent=2)}\n\n"
                f"Provide a 2-3 sentence risk summary."
            )
            risk_reasoning = await _call_llm(system_prompt, user_prompt, state.get("log_callback"))
        except Exception as e:
            risk_reasoning = f"Risk reasoning failed: {e}"

    _emit(state, "Risk assessment complete")
    return {
        "risk_assessment": risk_assessment,
        "risk_reasoning": risk_reasoning,
    }


# ---------------------------------------------------------------------------
# Node: portfolio_manager
# ---------------------------------------------------------------------------

async def portfolio_manager_node(state: MultiAgentState) -> dict:
    """Build consensus and trade recommendations."""
    _emit(state, "Building consensus and recommendations...")
    signals = state.get("agent_signals", [])
    risk_assessment = state.get("risk_assessment", {})
    debate_rounds = state.get("debate_rounds", [])

    consensus_map: dict[str, dict] = {}
    recommendations: list[dict] = []

    for ticker in state["tickers"]:
        ticker_signals = [s for s in signals if s.get("ticker") == ticker]
        if not ticker_signals:
            continue

        # Weighted vote
        bullish_weight = sum(
            s.get("confidence", 0) for s in ticker_signals if s.get("signal") == "bullish"
        )
        bearish_weight = sum(
            s.get("confidence", 0) for s in ticker_signals if s.get("signal") == "bearish"
        )
        neutral_weight = sum(
            s.get("confidence", 0) for s in ticker_signals if s.get("signal") == "neutral"
        )
        total_weight = bullish_weight + bearish_weight + neutral_weight

        if total_weight == 0:
            total_weight = 1.0

        bullish_pct = bullish_weight / total_weight
        bearish_pct = bearish_weight / total_weight

        bullish_count = sum(1 for s in ticker_signals if s.get("signal") == "bullish")
        bearish_count = sum(1 for s in ticker_signals if s.get("signal") == "bearish")
        neutral_count = sum(1 for s in ticker_signals if s.get("signal") == "neutral")

        if bullish_pct > 0.60:
            action = "BUY"
        elif bearish_pct > 0.60:
            action = "SELL"
        else:
            action = "HOLD"

        confidence = max(bullish_pct, bearish_pct)

        # Risk-adjusted allocation
        avg_agent_alloc = (
            sum(s.get("max_position_pct", 0.15) for s in ticker_signals) / len(ticker_signals)
        )
        risk_limit = (
            risk_assessment.get("per_ticker", {}).get(ticker, {}).get("max_position_pct", 0.15)
        )
        allocation = min(avg_agent_alloc, risk_limit)

        # Agent breakdown for the recommendation
        agent_breakdown = [
            {
                "agent_id": s.get("agent_id"),
                "agent_name": s.get("agent_name"),
                "signal": s.get("signal"),
                "confidence": s.get("confidence"),
                "reasoning": s.get("reasoning", "")[:200],
            }
            for s in ticker_signals
        ]

        # Debate summary
        ticker_debates = [d for d in debate_rounds if d.get("ticker") == ticker]
        debate_summary = None
        if ticker_debates:
            debate_summary = ticker_debates[0].get("synthesis", "")

        # Risk notes
        risk_info = risk_assessment.get("per_ticker", {}).get(ticker, {})
        risk_notes = ""
        if risk_info.get("volatility"):
            risk_notes = (
                f"Annualized volatility: {risk_info['volatility']:.1%}. "
                f"Position limit: {risk_info['max_position_pct']:.1%}."
            )

        consensus_map[ticker] = {
            "ticker": ticker,
            "action": action,
            "confidence": round(confidence, 2),
            "bullish_count": bullish_count,
            "bearish_count": bearish_count,
            "neutral_count": neutral_count,
            "weighted_bullish_pct": round(bullish_pct, 4),
            "weighted_bearish_pct": round(bearish_pct, 4),
            "reasoning": "",  # filled by LLM below
        }

        recommendations.append({
            "ticker": ticker,
            "action": action,
            "confidence": round(confidence, 2),
            "suggested_allocation_pct": round(allocation, 4),
            "suggested_amount": 0.0,  # caller fills based on portfolio value
            "reasoning": "",
            "agent_breakdown": agent_breakdown,
            "risk_notes": risk_notes,
            "debate_summary": debate_summary,
        })

    # One LLM call to synthesize consensus reasoning for all tickers
    if consensus_map:
        try:
            system_prompt = (
                "You are a portfolio manager synthesizing multiple analyst opinions. "
                "Provide a brief consensus reasoning for each ticker."
            )
            user_prompt = (
                f"## Agent Signals Summary\n"
                f"{json.dumps({t: {'action': c['action'], 'bullish': c['bullish_count'], 'bearish': c['bearish_count'], 'neutral': c['neutral_count'], 'confidence': c['confidence']} for t, c in consensus_map.items()}, indent=2)}\n\n"
                f"## Risk Notes\n{state.get('risk_reasoning', 'N/A')}\n\n"
                f"Respond with JSON mapping each ticker to a reasoning string:\n"
                f'{{"<TICKER>": "<reasoning>", ...}}'
            )
            raw = await _call_llm(system_prompt, user_prompt, state.get("log_callback"))
            parsed = _parse_agent_json(raw)
            for ticker in consensus_map:
                reasoning = parsed.get(ticker, "")
                if reasoning:
                    consensus_map[ticker]["reasoning"] = reasoning
                    for rec in recommendations:
                        if rec["ticker"] == ticker:
                            rec["reasoning"] = reasoning
        except Exception as e:
            logger.error("Portfolio manager LLM reasoning failed: %s", e)

    _emit(state, "Consensus and recommendations complete")
    return {
        "consensus": consensus_map,
        "recommendations": recommendations,
    }


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------

def build_workflow() -> StateGraph:
    """Build the multi-agent LangGraph workflow."""
    graph = StateGraph(MultiAgentState)

    graph.add_node("data_collector", data_collector_node)
    graph.add_node("analysts", analyst_node)
    graph.add_node("debate", debate_node)
    graph.add_node("risk_manager", risk_manager_node)
    graph.add_node("portfolio_manager", portfolio_manager_node)

    graph.add_edge(START, "data_collector")
    graph.add_edge("data_collector", "analysts")
    graph.add_conditional_edges(
        "analysts",
        _should_debate,
        {"debate": "debate", "skip_debate": "risk_manager"},
    )
    graph.add_edge("debate", "risk_manager")
    graph.add_edge("risk_manager", "portfolio_manager")
    graph.add_edge("portfolio_manager", END)

    return graph


# ---------------------------------------------------------------------------
# Public class
# ---------------------------------------------------------------------------

class MultiAgentEngine:
    """High-level wrapper around the LangGraph multi-agent workflow."""

    def __init__(self):
        self._running = False
        self._current_tickers: list[str] = []
        self._cancelled = False
        self._log_callbacks: list[Callable] = []
        self._complete_callbacks: list[Callable] = []
        self._cancel_callbacks: list[Callable] = []

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def current_tickers(self) -> list[str]:
        return list(self._current_tickers)

    def register_log_callback(self, cb: Callable) -> None:
        if cb not in self._log_callbacks:
            self._log_callbacks.append(cb)

    def register_complete_callback(self, cb: Callable) -> None:
        if cb not in self._complete_callbacks:
            self._complete_callbacks.append(cb)

    def register_cancel_callback(self, cb: Callable) -> None:
        if cb not in self._cancel_callbacks:
            self._cancel_callbacks.append(cb)

    def _log(self, msg: str) -> None:
        logger.info("[MultiAgent] %s", msg)
        for cb in self._log_callbacks:
            try:
                cb(msg)
            except Exception:
                pass

    async def run(
        self,
        tickers: list[str],
        agent_ids: list[str],
        enable_risk_reasoning: bool = False,
        portfolio_context: Optional[dict] = None,
    ) -> list[dict]:
        """Run the multi-agent workflow and return per-ticker report dicts."""
        if self._running:
            raise RuntimeError("Multi-agent engine already running")

        self._running = True
        self._current_tickers = list(tickers)
        self._cancelled = False

        try:
            self._log(f"Starting multi-agent analysis for {tickers} with {len(agent_ids)} agents")

            initial_state: MultiAgentState = {
                "tickers": list(tickers),
                "selected_agents": list(agent_ids),
                "portfolio_context": portfolio_context or {},
                "enable_risk_reasoning": enable_risk_reasoning,
                "market_data": {},
                "agent_signals": [],
                "debate_rounds": [],
                "risk_assessment": {},
                "risk_reasoning": "",
                "consensus": {},
                "recommendations": [],
                "log_callback": self._log,
            }

            graph = build_workflow()
            app = graph.compile()
            final_state = await app.ainvoke(initial_state)

            if self._cancelled:
                self._log("Analysis was cancelled")
                return []

            # Build per-ticker report dicts for storage and frontend
            consensus = final_state.get("consensus", {})
            recommendations = final_state.get("recommendations", [])
            agent_signals = final_state.get("agent_signals", [])
            debate_rounds = final_state.get("debate_rounds", [])
            risk_assessment = final_state.get("risk_assessment", {})
            market_data = final_state.get("market_data", {})

            reports = []
            for ticker in tickers:
                ticker_consensus = consensus.get(ticker, {})
                ticker_rec = next((r for r in recommendations if r.get("ticker") == ticker), None)
                ticker_signals = [s for s in agent_signals if s.get("ticker") == ticker]
                ticker_debates = [d for d in debate_rounds if d.get("ticker") == ticker]
                ticker_market = market_data.get(ticker, {})

                report = {
                    "ticker": ticker,
                    "selected_agents": list(agent_ids),
                    "portfolio_context": portfolio_context,
                    "agent_signals": ticker_signals,
                    "debate_occurred": len(ticker_debates) > 0,
                    "debate_rounds": ticker_debates,
                    "risk_assessment": risk_assessment.get("per_ticker", {}).get(ticker),
                    "risk_reasoning": final_state.get("risk_reasoning", ""),
                    "consensus_action": ticker_consensus.get("action", "HOLD"),
                    "consensus_confidence": ticker_consensus.get("confidence", 0.0),
                    "consensus_reasoning": ticker_consensus.get("reasoning", ""),
                    "recommendation": ticker_rec,
                    "market_data_summary": {
                        "current_price": ticker_market.get("current_price"),
                    },
                    "model_used": settings.llm_model,
                    "total_duration_ms": None,
                    "price_at_analysis": ticker_market.get("current_price"),
                }
                reports.append(report)

            self._log(f"Analysis complete: {len(reports)} ticker(s)")

            for cb in self._complete_callbacks:
                try:
                    cb(reports)
                except Exception:
                    pass

            return reports

        except Exception as e:
            logger.error("MultiAgentEngine.run failed: %s", e)
            # Send error to frontend so it doesn't hang
            self._log(f"Analysis failed: {e}")
            for cb in self._complete_callbacks:
                try:
                    cb([])
                except Exception:
                    pass
            return []
        finally:
            self._running = False
            self._current_tickers = []

    async def cancel(self) -> None:
        """Cancel the running analysis."""
        if not self._running:
            return
        self._cancelled = True
        self._log("Cancellation requested")
        for cb in self._cancel_callbacks:
            try:
                cb()
            except Exception:
                pass


# Singleton
multi_agent_engine = MultiAgentEngine()
