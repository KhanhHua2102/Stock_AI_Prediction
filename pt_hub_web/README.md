# PowerTrader Hub Web

A web-based dashboard for monitoring and controlling the PowerTrader cryptocurrency trading system.

## Prerequisites

- Python 3.11+
- Node.js 20+
- npm

## Project Structure

```
pt_hub_web/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── api/          # API routes
│   │   ├── services/     # Business logic
│   │   ├── config.py     # Configuration
│   │   └── main.py       # Application entry
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/             # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   └── store/
│   ├── Dockerfile
│   └── package.json
├── nginx/                # Nginx config (production)
├── venv/                 # Python virtual environment
├── docker-compose.yml
└── README.md
```

## Local Development

### 1. Backend Setup

```bash
cd pt_hub_web

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt

# Run the backend server
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

The API will be available at `http://localhost:8001`.

### 2. Frontend Setup

Open a new terminal:

```bash
cd pt_hub_web/frontend

# Install dependencies
npm install

# Run the development server
npm run dev
```

The frontend will be available at `http://localhost:3000`.

### 3. Environment Configuration

Create Kraken API credential files in the project root directory:

```bash
# In Crypto_Trading_PowerTrade/ (project root)
echo "your_kraken_api_key" > kraken_key.txt
echo "your_kraken_api_secret" > kraken_secret.txt
```

## Quick Start

From the project root:

```bash
./pt_hub_web/run.sh
```

This starts both backend and frontend in one terminal. Press Ctrl+C to stop.

## Running Services Manually

**Terminal 1 (Backend):**
```bash
cd pt_hub_web
source venv/bin/activate
cd backend
uvicorn app.main:app --reload --port 8001
```

**Terminal 2 (Frontend):**
```bash
cd pt_hub_web/frontend
npm run dev
```

## Docker Deployment

### Development (without nginx)

```bash
cd pt_hub_web

# Build and run backend + frontend
docker-compose up backend frontend
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`

### Production (with nginx reverse proxy)

```bash
cd pt_hub_web

# Build and run all services including nginx
docker-compose --profile production up -d
```

- Application: `http://localhost` (port 80)
- HTTPS: `https://localhost` (port 443, requires SSL cert setup)

### Docker Environment Variables

The docker-compose.yml mounts the project directory and sets:
- `PT_PROJECT_DIR=/project` - Path to project root inside container
- `PT_HUB_DATA_DIR=/project/data/runtime` - Runtime data directory

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/settings` | Application settings |
| `GET /api/account/portfolio` | Current portfolio (BTC + AUD) |
| `GET /api/account/holding-history/{asset}` | Asset holding history |
| `GET /api/account/kraken-trades` | Trade history from Kraken |
| `GET /api/trading/processes` | Trading process status |
| `GET /api/charts/candles/{coin}` | Price candles |
| `WS /api/ws` | WebSocket for real-time updates |

## Troubleshooting

### Port Already in Use

```bash
# Find the process using the port
lsof -i :8001

# Kill it or use a different port
uvicorn app.main:app --reload --port 8002
```

Then update `frontend/vite.config.ts` to proxy to the new port.

### Rate Limit Errors

If you see `EAPI:Rate limit exceeded` errors, wait a minute and retry. The backend has built-in retry logic with exponential backoff.

### Invalid Nonce Errors

If you encounter `EAPI:Invalid nonce` errors when fetching account data, click "Retry". This can happen when multiple API requests are made in quick succession.
