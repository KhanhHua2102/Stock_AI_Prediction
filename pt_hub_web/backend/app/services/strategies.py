"""Trading strategy definitions for analysis engine."""

STRATEGIES = {
    "default": {
        "name": "Balanced Analysis",
        "description": "Standard multi-factor analysis considering technicals, fundamentals, and sentiment equally.",
        "prompt_instructions": "",
    },
    "trend_following": {
        "name": "Trend Following",
        "description": "Focus on MA alignment, MACD direction, and momentum. Favor positions aligned with the prevailing trend.",
        "prompt_instructions": (
            "Focus your analysis primarily on trend indicators: MA alignment (SMA20/50/200), "
            "MACD direction, and momentum. Give strong weight to whether the stock is in a "
            "confirmed uptrend or downtrend. Favor BUY when all MAs are bullishly aligned "
            "(SMA20 > SMA50 > SMA200) and MACD histogram is positive and expanding. "
            "Favor SELL when bearishly aligned. Volume should confirm the trend — "
            "rising volume on up-moves is bullish, rising volume on down-moves is bearish."
        ),
    },
    "mean_reversion": {
        "name": "Mean Reversion",
        "description": "Look for oversold/overbought conditions using RSI and support/resistance levels.",
        "prompt_instructions": (
            "Focus your analysis on mean-reversion signals: RSI extremes (oversold <30 = "
            "potential buy, overbought >70 = potential sell), proximity to key support/resistance "
            "levels, and deviation from moving averages. Look for prices that have overextended "
            "from their 20-day or 50-day SMA. Favor BUY near strong support with oversold RSI. "
            "Favor SELL near strong resistance with overbought RSI. Set tight targets at the "
            "mean (moving average) rather than momentum-based targets."
        ),
    },
    "breakout": {
        "name": "Volume Breakout",
        "description": "Identify breakout patterns with volume confirmation above resistance.",
        "prompt_instructions": (
            "Focus your analysis on breakout patterns: Is the price approaching or breaking "
            "through key resistance levels? Is volume significantly above average (>1.5x)? "
            "Look for consolidation patterns (tight range, declining volume) followed by "
            "expansion (price break + volume surge). Only signal BUY on confirmed breakouts "
            "with volume above 1.5x the 20-day average. Set stop-loss just below the broken "
            "resistance (now support). Be cautious of false breakouts — require a close above "
            "resistance, not just an intraday pierce."
        ),
    },
    "conservative": {
        "name": "Conservative / Value",
        "description": "Emphasize fundamentals, valuation metrics, and risk management with tight stop losses.",
        "prompt_instructions": (
            "Take a conservative, value-oriented approach: Heavily weight fundamental data "
            "(P/E ratio, DCF fair value, profit margins, ROE, debt levels). Require a margin "
            "of safety — only recommend BUY when the current price is significantly below "
            "fair value AND technical indicators are not bearish. Set tight stop losses (2-3% "
            "below entry). Favor stocks with strong balance sheets (low debt/equity, high "
            "current ratio) and consistent earnings. Weight analyst consensus and price targets "
            "more heavily than momentum indicators."
        ),
    },
}


def get_strategy(key: str) -> dict:
    """Return a strategy by key, falling back to default."""
    return STRATEGIES.get(key, STRATEGIES["default"])


def get_strategy_list() -> list:
    """Return list of strategies with key, name, description (no prompt instructions)."""
    return [
        {"key": k, "name": v["name"], "description": v["description"]}
        for k, v in STRATEGIES.items()
    ]
