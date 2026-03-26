# Public APIs for Stock AI Prediction

Curated APIs for enhancing stock prediction, analysis, and portfolio management.
Focus markets: **US (S&P 500)**, **Australia (ASX)**, **Vietnam (VNINDEX)**.

Source: [marcelscruz/public-apis](https://github.com/marcelscruz/public-apis) + additional research.

---

## Market Data

Real-time and historical price data for US, ASX, and Vietnamese markets.

| API | Description | Markets | Auth | Free Tier | Link |
|-----|-------------|---------|------|-----------|------|
| **Alpha Vantage** | Real-time & historical data with 50+ built-in technical indicators. Supports global exchanges including ASX | US, ASX | apiKey | 25 calls/day | https://www.alphavantage.co/ |
| **Twelve Data** | Real-time & historical data, 100+ technical indicators, 50+ global exchanges | US, ASX | apiKey | 8 calls/min | https://twelvedata.com/ |
| **Finnhub** | Real-time stocks, WebSocket feed, company profiles. Strong US/global coverage | US, ASX | apiKey | 60 calls/min | https://finnhub.io/docs/api |
| **Polygon** | Tick-level historical data, aggregates, snapshots — institutional grade | US | apiKey | 5 calls/min | https://polygon.io/ |
| **Financial Modeling Prep** | Fundamentals, financial statements, earnings, DCF, ratios. Global coverage | US, ASX | apiKey | 250 calls/day | https://site.financialmodelingprep.com/developer/docs |

**FMP Key Endpoints (stable API — legacy `/api/v3/` deprecated Aug 2025):**
- `GET /stable/discounted-cash-flow?symbol=AAPL` — returns DCF fair value
- `GET /stable/ratios-ttm?symbol=AAPL` — P/E, margins, ROE, debt/equity
- `GET /stable/income-statement?symbol=AAPL` — revenue, earnings
- `GET /stable/cash-flow-statement?symbol=AAPL` — free cash flow
- Free tier: 250 requests/day
| **StockData** | Real-time, intraday & historical data + news + sentiment | US, global | apiKey | Yes | https://www.StockData.org |
| **vnstock** (Python) | Vietnamese stock market data — VNINDEX, HNX, UPCOM. Already used in this project | Vietnam | None | Unlimited | https://github.com/thinh-vu/vnstock |

## Price Targets, Forecasts & Analyst Ratings

Analyst consensus, price targets, and earnings estimates to feed into LLM analysis.

| API | Description | Coverage | Auth | Free Tier | Link |
|-----|-------------|----------|------|-----------|------|
| **Finnhub** | Price targets (mean/high/low), analyst recommendations (buy/hold/sell), earnings estimates, upgrade/downgrade history | US, global | apiKey | 60 calls/min | https://finnhub.io/docs/api |
| **Twelve Data** | `/analysis/price-target`, `/analysis/recommendations`, earnings estimates, EPS trends & revisions | US, global | apiKey | 8 calls/min | https://twelvedata.com/ |
| **Financial Modeling Prep** | Analyst estimates, price targets, DCF valuations, earnings surprises, sector performance | US, global | apiKey | 250 calls/day | https://site.financialmodelingprep.com/developer/docs |
| **Aletheia** | Earnings call transcripts & analysis, financial statements, insider trading | US | apiKey | Yes | https://aletheiaapi.com/ |
| **Earnings Feed** | SEC filings, insider transactions, institutional holdings, earnings calendar | US | apiKey | Yes | https://earningsfeed.com/api/docs |

## News & Sentiment

Market-moving news and sentiment analysis for US, ASX, and Vietnam.

| API | Description | Coverage | Auth | Free Tier | Link |
|-----|-------------|----------|------|-----------|------|
| **Finnhub** | Company news, market news, press releases, sentiment scores | US, global | apiKey | 60 calls/min | https://finnhub.io/docs/api |
| **StockData** | News aggregation with sentiment scoring per ticker | US, global | apiKey | Yes | https://www.StockData.org |
| **WallstreetBets** | Reddit stock sentiment — social buzz indicator for US stocks | US | None | Unlimited | https://dashboard.nbshare.io/apps/reddit/api/ |
| **SEC EDGAR** | Official SEC filings (10-K, 10-Q, 8-K) for US public companies | US | None | Unlimited | https://www.sec.gov/search-filings/edgar-application-programming-interfaces |
| **Bullbear Advisors** | Buy/sell signals based on candlestick pattern recognition | US | None | Yes | https://rapidapi.com/otha1920/api/bullbear-advisor |

## Macro & Economic Data

Macro context for regime detection and market-wide signals across target markets.

| API | Description | Coverage | Auth | Free Tier | Link |
|-----|-------------|----------|------|-----------|------|
| **FRED** | Interest rates, GDP, CPI, unemployment, yield curves — essential for US macro context | US | apiKey | Unlimited | https://fred.stlouisfed.org/docs/api/fred/ |
| **Econdb** | Global macroeconomic data — covers US, Australia, and Vietnam | US, AU, VN | None | Unlimited | https://www.econdb.com/api/ |
| **Fed Treasury** | US treasury yields, debt, fiscal data — bond market signals | US | None | Unlimited | https://fiscaldata.treasury.gov/api-documentation/ |
| **FXMacroData** | Central bank rate decisions and forex impact data | Global | apiKey | Yes | https://fxmacrodata.com/ |

## Currency & Forex

USD/AUD and USD/VND rates for cross-market portfolio tracking.

| API | Description | Auth | Free Tier | Link |
|-----|-------------|------|-----------|------|
| **xChangeApi** | Real-time exchange rates — USD/AUD, USD/VND | apiKey | Yes | https://xchangeapi.com/ |
| **Twelve Data** | Forex pairs with historical data and indicators | apiKey | 8 calls/min | https://twelvedata.com/ |
| **Alpha Vantage** | Forex real-time & historical — supports AUD, VND pairs | apiKey | 25 calls/day | https://www.alphavantage.co/ |

## Portfolio Optimization & Balancing

Portfolio construction, risk analysis, and rebalancing across US/ASX/VN holdings.

| API | Description | Auth | Free Tier | Link |
|-----|-------------|------|-----------|------|
| **Portfolio Optimizer** | Mean-variance optimization, minimum variance, risk parity, efficient frontier — 100% free, no auth | None | Unlimited | https://portfoliooptimizer.io/ |
| **Financial Modeling Prep** | Financial ratios, DCF, sector performance — fundamental screening for allocation weights | apiKey | 250 calls/day | https://site.financialmodelingprep.com/developer/docs |
| **Polygon** | Historical correlation data between assets — diversification and covariance analysis | apiKey | 5 calls/min | https://polygon.io/ |
| **OpenFIGI** | Bloomberg symbology — resolve tickers across US/ASX/VN exchanges | apiKey | Yes | https://www.openfigi.com/api |

---

## Recommended Integration Priority

### Phase 1 — Quick wins (no auth, free) ✅ DONE

| # | API | Use Case | Status |
|---|-----|----------|--------|
| 1 | **WallstreetBets** | Add social sentiment score to LLM analysis prompt for US stocks | ✅ Done (Tradestie Reddit API in `analysis_engine.py`) |
| 2 | **Econdb** | Pull macro indicators for US, AU, VN market context | ✅ Done — `_fetch_macro_indicators()` fetches CPI, GDP, unemployment by region; added `## Macroeconomic Context` section to LLM prompt |
| 3 | **Portfolio Optimizer** | Efficient frontier, risk parity — add portfolio tab | ✅ Done — `POST /api/portfolio/optimize` (min-variance via `api.portfoliooptimizer.io/v1/portfolio/optimization/minimum-variance`); frontend Portfolio tab with strategy selector + risk metrics |
| 4 | **Fed Treasury** | Yield curve data for US market regime detection | ✅ Done — `_fetch_treasury_rates()` via fiscal data API (`avg_interest_rates`); added `## Interest Rate Environment` section to LLM prompt. Replaced dead `_fetch_yield_curve()` code |
| 5 | **SEC EDGAR** | Major filings as signals for US stocks | ✅ Done (`_fetch_sec_filings()` + CIK mapping in `analysis_engine.py`) |

**Files changed in Phase 1:**
- `backend/app/services/analysis_engine.py` — Econdb macro fetcher, Fed Treasury fetcher, extended LLM prompt
- `backend/app/api/routes/portfolio.py` — NEW: `/optimize` and `/risk-return` endpoints
- `backend/app/main.py` — registered portfolio router
- `frontend/src/services/api.ts` — added `portfolioApi`
- `frontend/src/services/types.ts` — added portfolio types
- `frontend/src/components/portfolio/PortfolioTab.tsx` — real API calls, strategy selector, risk metrics

### Phase 2 — High-value (free API key)

| # | API | Use Case |
|---|-----|----------|
| 6 | **Finnhub** | Price targets + analyst ratings + news sentiment → enrich LLM analysis prompt |
| 7 | **Twelve Data** | Server-side technical indicators + price targets for US & ASX |
| 8 | **FRED** | CPI, rates, unemployment → macro-aware predictions |
| 9 | **Earnings Feed** | Insider buy/sell alerts before price moves |

### Phase 3 — Portfolio & advanced features ✅ DONE

| # | API | Use Case | Status |
|---|-----|----------|--------|
| 10 | **Portfolio Optimizer** | Multi-market portfolio optimization (US + ASX + VN) | ✅ Done in Phase 1 — min-variance optimization + rebalance |
| 11 | **Financial Modeling Prep** | Fundamental ratios for stock screening and weighting | ✅ Done — `_fetch_fmp_valuation()` fetches DCF + ratios (P/E, margins, ROE, D/E); added `## Fundamental Valuation` section to LLM prompt. Uses new `/stable/` API (legacy `/api/v3/` deprecated) |
| 12 | **Polygon** | Cross-asset correlation for diversification analysis | ✅ Done — `POST /api/portfolio/correlation` computes Pearson correlation from Polygon daily data; frontend heatmap with color-coded matrix (green=low corr, red=high). Falls back to yfinance |
| 13 | **xChangeApi** | USD/AUD/VND conversion for unified portfolio valuation | ⏭️ Skipped — no free tier available |

**Files changed in Phase 3:**
- `backend/app/config.py` — added `fmp_api_key`, `polygon_api_key`
- `backend/app/services/analysis_engine.py` — FMP valuation fetcher, extended LLM prompt with DCF/ratios
- `backend/app/api/routes/portfolio.py` — `/correlation` endpoint with Polygon + yfinance fallback
- `frontend/src/services/api.ts` — added `portfolioApi.correlation()`
- `frontend/src/services/types.ts` — added `CorrelationResult`
- `frontend/src/components/portfolio/PortfolioTab.tsx` — correlation heatmap UI
