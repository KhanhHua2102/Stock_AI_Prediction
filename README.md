<p align="center">
  <h1 align="center">FINA Suite</h1>
</p>
<p align="center">AI-powered stock prediction, portfolio management, and market analysis.</p>
<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Python" src="https://img.shields.io/badge/python-3.11+-blue.svg?style=flat-square" />
  <img alt="Node.js" src="https://img.shields.io/badge/node-18+-green.svg?style=flat-square" />
  <img alt="React" src="https://img.shields.io/badge/react-18.2-61DAFB.svg?style=flat-square" />
  <img alt="FastAPI" src="https://img.shields.io/badge/fastapi-0.109-009688.svg?style=flat-square" />
</p>

<!-- Replace with actual screenshot once available -->
<!-- [![FINA Suite Dashboard](docs/screenshots/portfolio-dashboard.png)](#usage) -->

---

### Installation

```bash
# Clone and run
git clone https://github.com/your-username/FINA_Suite.git
cd FINA_Suite
cp .env.example .env   # Add your API keys
npm run dev            # Starts backend (:8000) + frontend (:8081)
```

```bash
# Or set up manually
cd fina_portal/backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
cd fina_portal/frontend && npm install

# Or use Docker
cd fina_portal && docker-compose up backend frontend
```

> [!TIP]
> The app auto-generates an API key on first run if `FS_API_KEY` is not set in `.env`.

### Configuration

Create a `.env` file in the project root:

```bash
# LLM provider (required — any OpenAI-compatible endpoint)
FS_LLM_API_BASE=https://api.openai.com/v1
FS_LLM_API_KEY=your-api-key
FS_LLM_MODEL=gpt-4o

# Market data APIs (optional — enables richer analysis)
FS_FINNHUB_API_KEY=
FS_FRED_API_KEY=
FS_FMP_API_KEY=
FS_POLYGON_API_KEY=
```

Settings can also be adjusted at runtime through the Settings tab in the UI.

### Features

FINA Suite ships with six main modules, each accessible as a tab in the dashboard:

- **Portfolio** — Track holdings, transactions, and dividends across stocks, ETFs, and crypto. Mean-variance optimization, rebalancing suggestions, performance analytics (Sharpe, drawdown, TWR), and CSV/Excel import.

- **Analysis** — Run LLM-powered deep analysis on individual tickers or your entire portfolio. Gathers technical indicators, fundamentals, social sentiment, macro data, and news — then synthesizes a scored BUY/HOLD/SELL recommendation. Includes backtesting and accuracy tracking.

- **Training** — Train neural prediction models per ticker with real-time log streaming. Batch or individual training with status tracking (`NOT_TRAINED` → `TRAINING` → `TRAINED`).

- **Predictions** — View live neural signals for trained tickers. Multi-timeframe cards (1H, 4H, 1D, 1W) showing signal strength, predicted price boundaries, and expected move percentage. Color-coded BUY/SELL/MIXED/NEUTRAL.

- **Charts** — Interactive candlestick charts (Lightweight Charts) with neural boundary overlays, timeframe switching, and auto-refresh.

- **Property** — Track residential property investments with valuation history, suburb research (median prices, rental yields, growth), ROI calculations, and loan-to-value tracking.

### Architecture

```
fina_portal/
├── backend/             FastAPI + Python
│   ├── app/api/routes/  11 routers, 50+ endpoints
│   └── app/services/    Business logic, DB, LLM engine
├── frontend/            React + Vite + TypeScript
│   ├── src/components/  24 components across 6 tabs
│   ├── src/store/       7 Zustand stores
│   └── src/hooks/       WebSocket, bootstrap, training
├── nginx/               Production reverse proxy
└── docker-compose.yml

legacy/                  Original training & inference scripts
├── fina_trainer.py      Neural model trainer
└── fina_thinker.py      Signal generator & runner

data/                    SQLite databases, model weights, cache
mcp_server.py            Claude MCP integration server
```

| Layer    | Technology                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite 5, Zustand, [HeroUI](https://heroui.com), Tailwind CSS, Lightweight Charts |
| Backend  | FastAPI, Pydantic, Uvicorn, asyncio, WebSockets                                                       |
| Database | SQLite (WAL mode) — runtime, portfolio, analysis, property                                            |
| ML/AI    | Instance-based k-NN predictor, OpenAI SDK (LLM analysis)                                              |
| Data     | yfinance, vnstock, Finnhub, FMP, FRED, Polygon, SEC EDGAR                                             |
| DevOps   | Docker Compose, Nginx                                                                                 |

### MCP Server

FINA Suite includes an [MCP](https://modelcontextprotocol.io) server for Claude integration:

```bash
python mcp_server.py
```

Exposes tools for stock price lookups, technical indicators, analysis execution, and portfolio management directly within Claude conversations.

### API

50+ REST endpoints with WebSocket support. Full Swagger UI at `http://localhost:8000/docs` when running.

| Group              | Endpoints | Description                                        |
| ------------------ | --------- | -------------------------------------------------- |
| `/api/portfolio`   | 9         | Holdings, transactions, optimization, risk metrics |
| `/api/analysis`    | 6         | LLM analysis, strategies, reports                  |
| `/api/training`    | 7         | Model training lifecycle, neural signals           |
| `/api/trading`     | 6         | Process management, active tickers                 |
| `/api/property`    | 7         | Properties, valuations, suburb research            |
| `/api/backtest`    | 4         | Backtest evaluation and statistics                 |
| `/api/market`      | 3         | Market reviews and sentiment                       |
| `/api/settings`    | 2         | App configuration                                  |
| `/api/predictions` | 1         | Current signals and price boundaries               |
| `/api/charts`      | 1         | OHLCV candlestick data                             |
| `/ws`              | 1         | Real-time WebSocket updates                        |

### Documentation

For more details on trading methodology and integrations, [**head over to the docs**](docs/).

| Document                                     | Description                   |
| -------------------------------------------- | ----------------------------- |
| [Trading Strategy](docs/TRADING_STRATEGY.md) | Signal generation methodology |

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

### Acknowledgements

This project builds upon the work of:

- [**ZhuLinsen/daily_stock_analysis**](https://github.com/ZhuLinsen/daily_stock_analysis) — Daily stock analysis framework
- [**garagesteve1155/PowerTrader_AI**](https://github.com/garagesteve1155/PowerTrader_AI) — Original PowerTrader AI trading system
- [**virattt/ai-hedge-fund**](https://github.com/virattt/ai-hedge-fund) — Multi-agent AI hedge fund system (agent personas, risk management, portfolio management)
- [**HeroUI**](https://heroui.com) — React UI component library

### License

Apache 2.0 — see [LICENSE](LICENSE).

---

> [!IMPORTANT]
> This software is for educational and research purposes. It is not financial advice. Trading stocks involves risk and past performance does not guarantee future results. Always do your own research before making investment decisions.
