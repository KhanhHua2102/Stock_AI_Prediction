import os
import json
import secrets
from pathlib import Path
from pydantic_settings import BaseSettings
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


    class Config:
        env_prefix = "PT_"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._load_gui_settings()
        self._setup_api_key()

        # Set default hub_data_dir if not specified
        if not self.hub_data_dir or str(self.hub_data_dir) == ".":
            self.hub_data_dir = self.project_dir / "data" / "runtime"

    def _setup_api_key(self):
        """Setup API key for authentication."""
        # Check environment variable first (PT_API_KEY)
        if self.api_key:
            return  # Already set via environment variable

        # Check for API key file
        api_key_path = self.project_dir / ".api_key"
        if api_key_path.exists():
            self.api_key = api_key_path.read_text().strip()
            return

        # Generate a new API key and save it
        self.api_key = secrets.token_urlsafe(32)
        api_key_path.write_text(self.api_key)
        # Make file readable only by owner (on Unix systems)
        try:
            os.chmod(api_key_path, 0o600)
        except Exception:
            pass  # Windows doesn't support chmod the same way
        print(f"\n{'='*60}")
        print("SECURITY: New API key generated and saved to .api_key")
        print(f"API Key: {self.api_key}")
        print("Use this key in the X-API-Key header for all requests")
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
                elif data.get("coins"):
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
            except Exception:
                pass

settings = Settings()
