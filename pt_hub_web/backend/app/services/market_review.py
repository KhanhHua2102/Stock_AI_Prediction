"""Daily market review service — fetches index/sector data and generates an LLM summary."""

import asyncio
import logging
from datetime import datetime
from typing import Optional

import httpx

from app.config import settings
from app.services.analysis_db import AnalysisDB
from app.services.analysis_engine import _fetch_fear_greed_index

logger = logging.getLogger(__name__)

# Major indices + sector ETFs
INDEX_SYMBOLS = ["^GSPC", "^DJI", "^IXIC", "^VIX"]
INDEX_NAMES = {"^GSPC": "S&P 500", "^DJI": "Dow Jones", "^IXIC": "Nasdaq", "^VIX": "VIX"}

SECTOR_ETFS = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLV": "Healthcare",
    "XLE": "Energy",
    "XLY": "Consumer Disc.",
    "XLP": "Consumer Staples",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLRE": "Real Estate",
    "XLU": "Utilities",
    "XLC": "Communication",
}


def _fetch_index_data() -> dict:
    """Fetch current index and sector ETF data via yfinance (sync, run in thread)."""
    import yfinance as yf

    all_symbols = INDEX_SYMBOLS + list(SECTOR_ETFS.keys())
    result = {"indices": {}, "sectors": []}

    try:
        data = yf.download(all_symbols, period="5d", interval="1d", progress=False, group_by="ticker")
        if data is None or data.empty:
            return result

        for sym in INDEX_SYMBOLS:
            try:
                df = data[sym] if len(all_symbols) > 1 else data
                if df is None or df.empty or len(df) < 2:
                    continue
                close = float(df["Close"].iloc[-1])
                prev = float(df["Close"].iloc[-2])
                change_pct = round((close - prev) / prev * 100, 2)
                result["indices"][sym] = {
                    "name": INDEX_NAMES.get(sym, sym),
                    "price": round(close, 2),
                    "change_pct": change_pct,
                }
            except Exception:
                continue

        sectors = []
        for sym, name in SECTOR_ETFS.items():
            try:
                df = data[sym] if len(all_symbols) > 1 else data
                if df is None or df.empty or len(df) < 2:
                    continue
                close = float(df["Close"].iloc[-1])
                prev = float(df["Close"].iloc[-2])
                change_pct = round((close - prev) / prev * 100, 2)
                sectors.append({"etf": sym, "name": name, "change_pct": change_pct})
            except Exception:
                continue

        sectors.sort(key=lambda x: x["change_pct"], reverse=True)
        result["sectors"] = sectors
    except Exception as e:
        logger.warning(f"Failed to fetch market data: {e}")

    return result


def _build_market_review_prompt(indices: dict, sectors: list, fear_greed: Optional[dict]) -> str:
    """Build prompt for LLM market review generation."""
    index_lines = []
    for sym, info in indices.items():
        sign = "+" if info["change_pct"] >= 0 else ""
        index_lines.append(f"- {info['name']}: {info['price']:,.2f} ({sign}{info['change_pct']}%)")

    sector_lines = []
    for s in sectors:
        sign = "+" if s["change_pct"] >= 0 else ""
        sector_lines.append(f"- {s['name']} ({s['etf']}): {sign}{s['change_pct']}%")

    fg_section = ""
    if fear_greed:
        fg_section = f"\n## Market Sentiment\n- Fear & Greed Index: {fear_greed['score']}/100 ({fear_greed['rating']})\n"

    return f"""You are a senior market analyst. Write a concise daily market review based on the following data.

## Major Indices (Today)
{chr(10).join(index_lines)}

## Sector Performance
{chr(10).join(sector_lines)}
{fg_section}
Write a 3-4 paragraph market review covering:
1. Overall market direction and key movers
2. Sector rotation themes (which sectors are leading/lagging and why)
3. Risk factors and sentiment assessment
4. Short-term outlook

Keep it concise and actionable. No markdown headers — just flowing paragraphs. Write in English."""


async def generate_market_review(force: bool = False) -> dict:
    """Generate today's market review. Uses cached version if available unless force=True."""
    db = AnalysisDB(settings.analysis_db_path)
    today = datetime.now().strftime("%Y-%m-%d")

    if not force:
        existing = db.get_market_review(today)
        if existing:
            return existing

    logger.info("Generating market review...")

    # Fetch data in parallel
    market_data, fear_greed = await asyncio.gather(
        asyncio.to_thread(_fetch_index_data),
        _fetch_fear_greed_index(),
    )

    indices = market_data.get("indices", {})
    sectors = market_data.get("sectors", [])

    if not indices:
        raise RuntimeError("Could not fetch market index data")

    # Generate LLM summary
    prompt = _build_market_review_prompt(indices, sectors, fear_greed)
    summary = await _call_llm(prompt)

    review = {
        "date": today,
        "indices": indices,
        "sectors": sectors,
        "summary": summary,
        "fear_greed": fear_greed,
        "model_used": settings.llm_model,
    }

    db.insert_market_review(review)
    logger.info("Market review generated and stored.")

    return db.get_market_review(today) or review


async def get_market_context_for_prompt() -> str:
    """Return a condensed market context string for injection into stock analysis prompts."""
    db = AnalysisDB(settings.analysis_db_path)
    review = db.get_latest_market_review()
    if not review:
        return ""

    lines = [f"Market review ({review['date']}):"]
    for sym, info in review.get("indices", {}).items():
        sign = "+" if info["change_pct"] >= 0 else ""
        lines.append(f"  {info['name']}: {sign}{info['change_pct']}%")

    fg = review.get("fear_greed")
    if fg and isinstance(fg, dict):
        lines.append(f"  Fear & Greed: {fg.get('score', 'N/A')}/100 ({fg.get('rating', 'N/A')})")

    # Add first 2 sentences of summary
    summary = review.get("summary", "")
    sentences = summary.split(". ")
    brief = ". ".join(sentences[:2]) + "." if sentences else ""
    if brief:
        lines.append(f"  Summary: {brief}")

    return "\n".join(lines)


async def _call_llm(prompt: str) -> str:
    """Call LLM for market review generation."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        base_url=settings.llm_api_base,
        api_key=settings.llm_api_key,
    )

    models = [settings.llm_model] + settings.llm_fallback_models
    last_error = None

    for model in models:
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1500,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            last_error = e
            logger.warning(f"Market review LLM model {model} failed: {e}")

    raise RuntimeError(f"All LLM models failed for market review. Last error: {last_error}")
