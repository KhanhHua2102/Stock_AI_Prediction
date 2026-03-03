# PowerTrader AI Trading Strategy & Methodology

This document provides a comprehensive analysis of PowerTrader AI's trading strategy, combining setup instructions with detailed technical methodology.

## Overview

PowerTrader AI is a fully automated crypto trading system powered by a custom price prediction AI and a structured/tiered DCA (Dollar Cost Averaging) system. It implements a sophisticated multi-layered approach that combines machine learning predictions with systematic risk management.

## The AI Prediction System

### What Type of AI Is This?

"It's an instance-based (kNN/kernel-style) predictor with online per-instance reliability weighting, used as a multi-timeframe trading signal." - ChatGPT on the type of AI used in this trading bot.

When people think AI, they usually think about LLM style AIs and neural networks. What many people don't realize is there are many types of Artificial Intelligence and Machine Learning - and the one in PowerTrader AI falls under the "Other" category.

### How The AI Training Works

When training for a coin, it goes through the entire history for that coin on multiple timeframes and saves each pattern it sees, along with what happens on the next candle AFTER the pattern. It uses these saved patterns to generate a predicted candle by taking a weighted average of the closest matches in memory to the current pattern in time.

This weighted average output is done once for each timeframe, from 1 hour up to 1 week. Each timeframe gets its own predicted candle. The low and high prices from these candles are what are shown as the blue and orange horizontal lines on the price charts.

After a candle closes, it checks what happened against what it predicted, and adjusts the weight for each "memory pattern" that was used to generate the weighted average, depending on how accurate each pattern was compared to what actually happened.

Yes, it is EXTREMELY simple. Yes, it is STILL considered AI.

## Complete Trading Strategy Breakdown

### 1. Multi-Timeframe Neural Network Analysis

The system analyzes **7 different timeframes** simultaneously:

- 1 hour, 2 hour, 4 hour, 8 hour, 12 hour, 1 day, 1 week

For each timeframe, it:

- Uses historical candlestick data from KuCoin to train neural networks
- Establishes dynamic **high/low boundary zones** based on AI predictions
- Generates signals when current price breaks above (SHORT) or below (LONG) these boundaries

### 2. DCA (Dollar Cost Averaging) System

The core trading strategy uses an **8-level DCA system** with predetermined percentage triggers:

```
DCA Level 0: -2.5% (minimum drop to start buying)
DCA Level 1: -5.0%
DCA Level 2: -10.0%
DCA Level 3: -15.0%
DCA Level 4: -25.0%
DCA Level 5: -35.0%
DCA Level 6: -45.0%
DCA Level 7: -50.0% (maximum drop)
```

### 3. Neural Signal Integration

The AI component generates signals on a **0-7 scale**:

- **Levels 4-7**: Map directly to DCA levels 0-3 for aggressive buying
- **Lower levels (0-3)**: Used for less aggressive positions
- The neural network analyzes price patterns, momentum, and boundary zones

**A TRADE WILL START FOR A COIN IF THAT COIN REACHES A LONG LEVEL OF 3 OR HIGHER WHILE HAVING A SHORT LEVEL OF 0!**

### 4. Trading Decision Logic

#### For determining when to start trades:

The AI's Thinker script sends a signal to start a trade for a coin if the ask price for the coin drops below at least 3 of the AI's predicted low prices for the coin (it predicts the currently active candle's high and low prices for each timeframe across all timeframes from 1hr to 1wk).

#### For determining when to DCA:

It uses either the current price level from the AI that is tied to the current amount of DCA buys that have been done on the trade (for example, right after a trade starts when 3 blue lines get crossed, its first DCA won't happen until the price crosses the 4th line, so on so forth), or it uses the hardcoded drawdown % for its current level, whichever it hits first. It allows a max of 2 DCAs within a rolling 24hr window to keep from dumping all of your money in too quickly on coins that are having an extended downtrend!

#### For determining when to sell:

The bot uses a trailing profit margin to maximize the potential gains. The margin line is set at either 5% gain if no DCA has happened on the trade, or 2.5% gain if any DCA has happened. The trailing margin gap is 0.5% (this is the amount the price has to go over the profit margin to begin raising the profit margin up to TRAIL after the price and maximize how much profit is gained once the price drops below the profit margin again and the bot sells the trade).

### 5. Profit Management Strategy

- **Entry Strategy**: DCA buys triggered by both percentage drops AND neural signals
- **Exit Strategy**: Trailing profit margins starting at 5% with 0.5% trail gaps
- **Position Sizing**: Each DCA level uses progressively larger position sizes
- **Risk Control**: Maximum 2 DCA purchases per coin per 24-hour period

### 6. Complete Trading Flow

The system operates continuously with this logic:

1. **Monitor Phase**: Track all coins across 7 timeframes
2. **Signal Generation**: Neural networks analyze boundaries and generate 0-7 signals
3. **Entry Decision**: Combine price drops with neural signals to trigger DCA buys
4. **Position Management**: Track all open positions and their profit/loss
5. **Exit Decision**: Use trailing profit margins to lock in gains
6. **Risk Management**: Limit frequency and size of new positions

### 7. Key Risk Controls

- **24-Hour Rate Limiting**: Max 2 DCA buys per coin per day
- **Account Balance Monitoring**: Tracks available funds before each trade
- **Training Requirements**: Only trades coins with fresh AI training data
- **Boundary Validation**: Ensures neural predictions are within reasonable ranges

### 8. Unique Features

- **Multi-Asset Support**: Simultaneously trades BTC, ETH, BNB, XRP, DOGE
- **Real-Time Adaptation**: Continuously updates neural boundaries based on market conditions
- **Purple Zone Detection**: Special algorithm to find optimal entry zones between support/resistance
- **Hybrid Data Sources**: Uses KuCoin for training, Kraken for live trading

## Strategy Classification

This is a **momentum-based contrarian strategy** - it uses AI to identify when significant price drops represent buying opportunities rather than continued declines, then systematically builds positions through DCA while maintaining strict profit-taking discipline through trailing stops.

The system essentially tries to "buy the dip" intelligently by using neural networks to distinguish between temporary corrections (good buying opportunities) and genuine downtrends (avoid buying). The multi-timeframe analysis provides confirmation across different time horizons to increase confidence in trading decisions.

## Neural Levels Explained

- These are signal strength levels from low to high (0-7)
- Higher number = stronger signal
- LONG = buy-direction signal, SHORT = sell-direction signal
- The system combines these signals with hardcoded percentage triggers for precise entry timing

## Practical Trading Example

### Starting Portfolio
- **$60 AUD** (cash)
- **$20 BTC** (existing holding)
- **Total Value: $80 AUD**

### DCA Trigger Reference

| Level | Hardcoded Drop | Neural Level | Whichever Hits First |
|-------|----------------|--------------|----------------------|
| 0 | -2.5% | Level 4 | Triggers DCA |
| 1 | -5.0% | Level 5 | Triggers DCA |
| 2 | -10.0% | Level 6 | Triggers DCA |
| 3 | -15.0% | Level 7 | Triggers DCA |
| 4 | -25.0% | - | Triggers DCA |
| 5 | -35.0% | - | Triggers DCA |
| 6 | -45.0% | - | Triggers DCA |
| 7 | -50.0% | - | Triggers DCA |

### Example Trade Flow

| Step | Event | Signal/Trigger | Action | Portfolio After |
|------|-------|----------------|--------|-----------------|
| 1 | AI detects buying opportunity | LONG=3, SHORT=0 | Initial buy ~$0.50 | $59.50 AUD, $20.50 BTC |
| 2 | Price drops -3% below cost | Hits -2.5% DCA level | DCA buy 2× position (~$40) | $19.50 AUD, ~$60 BTC |
| 3 | Price recovers +5% above cost | PM line (2.5%) activates | Hold - trailing begins | $19.50 AUD, ~$63 BTC |
| 4 | Price peaks at +8% | Trail line at +7.5% | Hold - tracking peak | $19.50 AUD, ~$65 BTC |
| 5 | Price drops to +7% | Crosses below trail line | **SELL 100%** | ~$84 AUD, $0 BTC |

### Step-by-Step Breakdown

**Step 1 - Entry Signal:**
- Neural network detects price dropped below 3 predicted low lines (LONG=3)
- No bearish signals present (SHORT=0)
- Bot executes initial buy of ~$0.50 (minimum position size)

**Step 2 - DCA Triggered:**
- Price continues dropping, hits -3% below cost basis
- This exceeds the -2.5% hardcoded trigger for DCA Level 0
- Bot buys 2× the current position value (~$40)
- New averaged cost basis is lower

**Step 3 - Profit Margin Activates:**
- Price recovers and reaches +5% above new cost basis
- Since DCA was used, profit margin line is set at 2.5%
- Price is above PM line, so trailing mode activates

**Step 4 - Trailing the Peak:**
- Price continues rising to +8%
- Trailing line follows at 0.5% below peak = +7.5%
- Bot holds, waiting for reversal

**Step 5 - Exit Triggered:**
- Price drops from +8% to +7%
- This crosses below the trailing line (+7.5%)
- Bot executes market sell of 100% position
- Profit realized: ~$4 AUD

### Key Takeaways

1. **Small initial positions** - Entry buys are tiny (~$0.50) to test the waters
2. **Aggressive DCA** - Each DCA doubles the position size (2×)
3. **Trailing exit** - Locks in profits by following price peaks with 0.5% buffer
4. **Rate limited** - Max 2 DCA buys per coin per 24 hours prevents over-exposure
5. **Dual triggers** - DCA can trigger from neural signals OR hardcoded % drops (whichever first)
