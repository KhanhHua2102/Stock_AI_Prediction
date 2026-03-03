# PowerTrader AI

A fully automated cryptocurrency trading system with custom price prediction AI and web-based dashboard.

## Project Structure

```
PowerTrader/
├── pt_hub_web/           # Modern web application (React + FastAPI)
│   ├── backend/          # FastAPI backend
│   ├── frontend/         # React frontend
│   └── docker-compose.yml
├── legacy/               # Legacy standalone GUI application
│   ├── pt_hub.py         # Main GUI application
│   ├── pt_trainer.py     # AI model trainer
│   ├── pt_trader.py      # Live trading execution
│   ├── pt_thinker.py     # Neural signal generator
│   └── requirements.txt  # Legacy dependencies
├── data/
│   ├── training/         # AI model training outputs (weights, memories)
│   └── runtime/          # Runtime state files (status, logs)
├── docs/
│   ├── LEGACY_README.md  # Original setup documentation
│   └── TRADING_STRATEGY.md
└── README.md
```

## Quick Start

### Web Application (Recommended)

```bash
cd pt_hub_web

# Option 1: Using Docker
docker-compose up backend frontend

# Option 2: Manual setup
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

### Legacy GUI Application

```bash
cd legacy
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python pt_hub.py
```

## Configuration

### API Credentials

Create these files in the project root:
- `kraken_key.txt` - Your Kraken API key
- `kraken_secret.txt` - Your Kraken API secret

### Settings

GUI settings are stored in `legacy/gui_settings.json`. The web application reads from this file for shared configuration.

## Documentation

- [Legacy Setup Guide](docs/LEGACY_README.md)
- [Trading Strategy](docs/TRADING_STRATEGY.md)
- [Web App README](pt_hub_web/README.md)

## License

Apache 2.0
