import os
import json
import secrets
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional


class Settings(BaseSettings):
    # Project paths
    project_dir: Path = Path(__file__).parent.parent.parent.parent  # pt_hub_web's parent
    hub_data_dir: Path = Path("")

    # Scripts (in legacy folder)
    script_neural_runner: str = "legacy/pt_thinker.py"
    script_trainer: str = "legacy/pt_trainer.py"
    # Stock prediction config
    tickers: List[str] = ["VNINDEX", "^GSPC", "GLOB.AX", "HCRD.AX", "BGBL.AX", "A200.AX"]
    default_timeframe: str = "1day"
    timeframes: List[str] = ["1day", "1week"]
    candles_limit: int = 120

    # Refresh rates
    ui_refresh_seconds: float = 1.0
    chart_refresh_seconds: float = 10.0

    # API - SECURITY FIX: Bind to localhost only (Issue #3)
    api_host: str = "127.0.0.1"
    api_port: int = 8000

    # API Authentication - SECURITY FIX (Issue #4)
    # Set via PT_API_KEY environment variable or generate random key
    api_key: Optional[str] = None

    # CORS - SECURITY FIX (Issue #5)
    # Set via PT_CORS_ORIGINS environment variable (comma-separated)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081,http://127.0.0.1:8081"

    # Rate Limiting - SECURITY FIX (Issue #7)
    rate_limit_per_minute: int = 60

    # LLM Analysis (9router - OpenAI-compatible)
    llm_api_base: str = "https://api.9router.com/v1"
    llm_api_key: Optional[str] = None  # PT_LLM_API_KEY env var
    llm_model: str = "cc/claude-opus-4-6"
    llm_fallback_models: List[str] = ["cc/claude-sonnet-4-6"]
    llm_max_tokens: int = 2000
    analysis_db_path: Path = Path("")
    runtime_db_path: Path = Path("")
    portfolio_db_path: Path = Path("")
    sec_user_agent: str = "StockAIPrediction/1.0 (tonyhua212002@duck.com)"

    # Phase 2 API keys (set via PT_FINNHUB_API_KEY, PT_FRED_API_KEY, PT_TWELVEDATA_API_KEY)
    finnhub_api_key: Optional[str] = None
    fred_api_key: Optional[str] = None
    twelvedata_api_key: Optional[str] = None

    # Phase 3 API keys (set via PT_FMP_API_KEY, PT_POLYGON_API_KEY)
    fmp_api_key: Optional[str] = None
    polygon_api_key: Optional[str] = None


    model_config = SettingsConfigDict(
        env_prefix="PT_",
        env_file=str(Path(__file__).parent.parent.parent.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._load_gui_settings()
        self._setup_api_key()

        # Set default hub_data_dir if not specified
        if not self.hub_data_dir or str(self.hub_data_dir) == ".":
            self.hub_data_dir = self.project_dir / "data" / "runtime"

        if not self.analysis_db_path or str(self.analysis_db_path) == ".":
            self.analysis_db_path = self.project_dir / "data" / "analysis.db"

        if not self.runtime_db_path or str(self.runtime_db_path) == ".":
            self.runtime_db_path = self.project_dir / "data" / "runtime.db"

        if not self.portfolio_db_path or str(self.portfolio_db_path) == ".":
            self.portfolio_db_path = self.project_dir / "data" / "portfolio.db"

    def _setup_api_key(self):
        """Setup API key for authentication."""
        if self.api_key:
            return

        # Generate a new API key and save it to .env
        self.api_key = secrets.token_urlsafe(32)
        env_path = self.project_dir / ".env"
        # Append or create .env with the key
        lines = []
        if env_path.exists():
            lines = env_path.read_text().splitlines()
        # Replace existing PT_API_KEY line or append
        found = False
        for i, line in enumerate(lines):
            if line.startswith("PT_API_KEY="):
                lines[i] = f"PT_API_KEY={self.api_key}"
                found = True
                break
        if not found:
            lines.append(f"PT_API_KEY={self.api_key}")
        env_path.write_text("\n".join(lines) + "\n")
        print(f"\n{'='*60}")
        print("SECURITY: New API key generated and saved to .env")
        print(f"API Key: {self.api_key}")
        print(f"{'='*60}\n")

    def get_cors_origins(self) -> List[str]:
        """Parse CORS origins from comma-separated string."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def _load_gui_settings(self):
        """Load settings from gui_settings.json if it exists."""
        settings_path = self.project_dir / "legacy" / "gui_settings.json"
        if settings_path.exists():
            try:
                with open(settings_path) as f:
                    data = json.load(f)

                if data.get("tickers"):
                    self.tickers = data["tickers"]
                elif data.get("coins"):  # backwards compat with old "coins" key
                    self.tickers = data["coins"]
                if data.get("default_timeframe"):
                    self.default_timeframe = data["default_timeframe"]
                if data.get("timeframes"):
                    self.timeframes = data["timeframes"]
                if data.get("candles_limit"):
                    self.candles_limit = data["candles_limit"]
                if data.get("ui_refresh_seconds"):
                    self.ui_refresh_seconds = data["ui_refresh_seconds"]
                if data.get("chart_refresh_seconds"):
                    self.chart_refresh_seconds = data["chart_refresh_seconds"]
                if data.get("hub_data_dir"):
                    self.hub_data_dir = Path(data["hub_data_dir"])
                if data.get("script_neural_runner2"):
                    self.script_neural_runner = data["script_neural_runner2"]
                if data.get("script_neural_trainer"):
                    self.script_trainer = data["script_neural_trainer"]
                pass  # script_trader removed
                if data.get("llm_api_base"):
                    self.llm_api_base = data["llm_api_base"]
                if data.get("llm_api_key"):
                    self.llm_api_key = data["llm_api_key"]
                if data.get("llm_model"):
                    self.llm_model = data["llm_model"]
            except Exception:
                pass

settings = Settings()

# Shared runtime database singleton
import sys as _sys
_sys.path.insert(0, str(settings.project_dir))
from shared.runtime_db import RuntimeDB
runtime_db = RuntimeDB(settings.runtime_db_path)

from app.services.portfolio_db import PortfolioDB
portfolio_db = PortfolioDB(settings.portfolio_db_path)
