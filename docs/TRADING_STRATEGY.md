# Trading Strategy & Methodology

This document describes the prediction system used by Stock AI Prediction — how models are trained, how signals are generated, and how the system decides what to show on the dashboard.

## Overview

Stock AI Prediction uses a **pattern-matching predictor** (instance-based k-NN with learned reliability weights) to generate multi-timeframe trading signals. It is not a neural network or deep learning model — it works by comparing the current price pattern against a library of historical patterns and taking a weighted average of what happened next.

The system covers US (S&P 500, individual stocks), Australian (ASX ETFs/stocks), and Vietnamese (VNINDEX) markets.

## The Prediction Algorithm

### What Type of AI Is This?

> "It's an instance-based (k-NN/kernel-style) predictor with online per-instance reliability weighting, used as a multi-timeframe trading signal."

When people think AI, they usually think about LLMs and neural networks. The predictor here falls under **instance-based learning** — it stores examples (patterns) and makes predictions by finding the closest matches to the current situation.

### How It Works (Simple Version)

1. During **training**, the system walks through all historical candles for a ticker and saves each price pattern it sees, along with what the next candle's high and low were.
2. During **prediction**, it compares the current price pattern against all stored patterns, finds the closest matches, and takes a weighted average of their outcomes.
3. After each candle closes, it checks how accurate each pattern was and adjusts its weight up or down. Accurate patterns get more influence over time; inaccurate ones fade out.

## Training System

### Data Sources

| Market | Source | Intervals |
| ------ | ------ | --------- |
| ASX, US stocks | yfinance | 1h, 1d, 1wk |
| VNINDEX | vnstock | 1H, 1D, 1W |

Data is cached locally in `data/cache/{ticker}_{timeframe}.json` with a 6-hour freshness window. Historical data goes back ~730 days for intraday and maximum available for daily/weekly.

### Timeframes

Training runs on two primary timeframes:

- **1 day** — daily candle patterns
- **1 week** — weekly candle patterns

Each timeframe is trained independently with its own set of memories and weights.

### Memory Structure

A "memory" is a stored pattern consisting of three parts:

```
{percentage_change_pattern} {} {high_price_move} {} {low_price_move}
```

- **percentage_change_pattern**: Space-separated floats representing normalized price changes across recent candles: `(price - open) / open * 100`
- **high_price_move**: The percentage move to the high of the next candle: `(high - open) / open * 100`
- **low_price_move**: The percentage move to the low of the next candle: `(low - open) / open * 100`

Multiple memories are concatenated with `~` as a delimiter. All memories for a (ticker, timeframe) pair are stored together.

### Training Loop

For each timeframe, the trainer walks through historical data:

```
For each window position in historical price data:
  1. Extract the current pattern (last N candles as % changes)
  2. Compare against ALL stored memories using normalized RMSD
  3. Find matches where difference <= perfect_threshold
  4. If matches found:
     - Take weighted average of their high/low moves
     - Generate predicted high and low prices
  5. If no matches: use the single closest memory as fallback
  6. Compare prediction against actual outcome
  7. Adjust weights:
     - Prediction accurate → weight += 0.25
     - Overestimated → weight -= 0.25
     - Underestimated → weight -= 0.25
  8. Store new pattern as a memory with initial weight 1.0
```

### Pattern Matching Distance

The distance between two patterns is calculated as a normalized percentage difference:

```
For each candle position:
  diff = |current_value - memory_value| / ((current_value + memory_value) / 2) * 100

average_diff = sum(all diffs) / count

Match if: average_diff <= perfect_threshold
```

### Adaptive Threshold

The `perfect_threshold` controls how strict pattern matching is:

- Starts at a moderate value
- If more than 20 patterns match → **tighten** (decrease threshold, be more selective)
- If fewer than 20 patterns match → **relax** (increase threshold, accept looser matches)
- Range: 0.0 to 100.0
- Goal: maintain approximately 20 good matches per prediction

This self-tuning mechanism ensures the system neither overfits to noise (too many matches) nor starves for data (too few matches).

### Weight System

Three parallel weight arrays track reliability for different aspects:

| Weight | Tracks | Range |
| ------ | ------ | ----- |
| `weights` | Close price prediction accuracy | 0.0 – 2.0 |
| `weights_high` | High price prediction accuracy | 0.0 – 2.0 |
| `weights_low` | Low price prediction accuracy | 0.0 – 2.0 |

- **Initial weight**: 1.0 for new patterns
- **Adjustment**: +0.25 for correct predictions, -0.25 for incorrect
- **Clamped** to [0.0, 2.0] — a pattern can never have more than 2× or less than 0× influence

### Persistence

Training data is stored in two locations:

| Storage | Location | Purpose |
| ------- | -------- | ------- |
| SQLite (primary) | `data/runtime.db` → `training_memory` table | Memories, weights, threshold per (ticker, timeframe) |
| Text files (fallback) | `data/training/{TICKER}/` | Flat file backup |

**Optimization**: An in-memory cache holds loaded memories during training. Writes are batched every 200 iterations using a dirty flag to reduce disk I/O.

### Training Status

Each ticker tracks its training state in the `trainer_status` table:

| State | Meaning |
| ----- | ------- |
| `NOT_TRAINED` | No training data exists |
| `TRAINING` | Trainer is currently running |
| `PARTIAL` | Some timeframes trained, not all |
| `TRAINED` / `FINISHED` | All timeframes complete |

The `last_training_time` timestamp is used by the signal generator to check freshness (must be within 14 days).

## Signal Generation

### Runner Loop

The signal generator (`pt_thinker.py`) runs continuously:

```
Loop (every ~150ms):
  1. Sync active tickers from settings (hot-reload)
  2. For each ticker:
     a. Download current candle for each timeframe
     b. Load trained memories from SQLite
     c. Match current pattern against memories
     d. Generate predicted high/low prices
     e. Compute boundary prices
     f. Determine signal (LONG / SHORT / WITHIN / INACTIVE)
     g. Write results to database
  3. Sleep 150ms
```

### Boundary Computation

For each timeframe, the system computes a high boundary and low boundary:

**Step 1 — Raw bounds from predictions:**

```
low_bound  = predicted_low  - (predicted_low  * 0.005)   # 0.5% below prediction
high_bound = predicted_high + (predicted_high * 0.005)   # 0.5% above prediction
```

**Step 2 — Multi-level consolidation:**

All bounds across timeframes are sorted and adjusted so they don't overlap or invert:

- If the gap between consecutive bounds is less than 0.25%, they're nudged apart
- If bounds are inverted (low > high), they're adjusted with small multipliers (0.9995 / 1.0005)
- Results are remapped back to their original timeframes

### Signal Types

For each timeframe, the current price is compared against the boundaries:

| Condition | Signal | Meaning |
| --------- | ------ | ------- |
| Price < low boundary | **LONG** | Price is below predicted range — potential buying opportunity |
| Price > high boundary | **SHORT** | Price is above predicted range — potential selling opportunity |
| Low ≤ Price ≤ High | **WITHIN** | Price is inside predicted range — no signal |
| No trained data | **INACTIVE** | Timeframe has no model — cannot generate signal |

### DCA Signal Aggregation

The signals across all timeframes are aggregated into two counts:

- **`long_dca_signal`**: Number of timeframes currently showing LONG
- **`short_dca_signal`**: Number of timeframes currently showing SHORT

A higher count means more timeframes agree on the direction, indicating a stronger signal. For example, if price is below the predicted low on 3 out of 4 timeframes, `long_dca_signal = 3`.

### Profit Margin Calculation

For each timeframe with an active signal, a margin percentage is calculated:

```
margin% = ((boundary_price - current_price) / current_price) * 100
```

These margins are averaged across all active timeframes, with a minimum floor of 0.25%. The result is stored as `long_profit_margin` and `short_profit_margin`.

### Readiness Gates

The system prevents premature signal output through three gates:

1. **Trainer freshness**: Training data must be less than 14 days old. Stale tickers are set to INACTIVE.
2. **Bounds version**: Boundaries must have been computed at least once (`bounds_version >= 1`).
3. **Signal type**: Output must contain real LONG/SHORT/WITHIN signals, not startup placeholders.

All three gates must pass before signals are written to the database.

### Database Output

Signals are written to the `ticker_signals` table:

| Column | Type | Description |
| ------ | ---- | ----------- |
| `ticker` | TEXT (PK) | Stock/ETF ticker symbol |
| `long_dca_signal` | INT | Count of timeframes in LONG |
| `short_dca_signal` | INT | Count of timeframes in SHORT |
| `long_onoff` | TEXT | "ON" or "OFF" |
| `short_onoff` | TEXT | "ON" or "OFF" |
| `long_profit_margin` | FLOAT | Average margin for LONG signals (≥ 0.25%) |
| `short_profit_margin` | FLOAT | Average margin for SHORT signals (≥ 0.25%) |
| `low_bound_prices` | JSON | Array of low boundary prices per timeframe |
| `high_bound_prices` | JSON | Array of high boundary prices per timeframe |
| `updated_at` | TIMESTAMP | Last update time |

## How to Read the Dashboard

### Predictions Tab

Each ticker shows:

- **Overall signal**: Aggregated direction across all timeframes (BUY / SELL / MIXED / NEUTRAL)
- **Per-timeframe cards**: Each card shows signal strength, predicted high/low boundaries, and expected move %
- **Signal strength**: Based on the count of timeframes agreeing on the direction

### Charts Tab

The candlestick chart displays:

- Standard OHLCV price data
- **Predicted boundary lines** overlaid — the high and low prices the model expects for the current candle

When price breaks below the low boundary, that timeframe registers a LONG signal. When price breaks above the high boundary, it registers a SHORT signal.

## Performance Optimizations

| Optimization | Description |
| ------------ | ----------- |
| Memory cache | Pattern memories held in RAM with dirty-flag batch writes every 200 iterations |
| Disk cache | Market data cached with 6-hour freshness window |
| SQLite WAL | Write-Ahead Logging for concurrent read/write access |
| Threshold throttling | Perfect threshold writes only when changed > 0.05 or every 200 loops |
| Circuit breaker | API failures tracked with automatic backoff (5 errors → 60s cooldown) |

## Strategy Classification

This is a **boundary-based momentum system**. It identifies when the current price deviates significantly from the model's predicted range across multiple timeframes. The more timeframes that agree (higher signal count), the stronger the conviction.

The system does not execute trades automatically in the web version — it provides signals and analysis that inform manual trading decisions, complemented by the LLM-powered analysis engine for deeper research.
