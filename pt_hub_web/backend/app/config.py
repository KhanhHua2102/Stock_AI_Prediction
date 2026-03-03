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
    script_trader: str = "legacy/pt_trader.py"

    # Trading config
    coins: List[str] = ["BTC"]
    default_timeframe: str = "1hour"
    timeframes: List[str] = ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day", "1week"]
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
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Rate Limiting - SECURITY FIX (Issue #7)
    rate_limit_per_minute: int = 60

    # Kraken credentials - SECURITY FIX (Issue #1)
    # Priority: 1. Environment variables, 2. Files (fallback)
    kraken_key: Optional[str] = None
    kraken_secret: Optional[str] = None

    class Config:
        env_prefix = "PT_"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._load_gui_settings()
        self._load_kraken_credentials()
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

                if data.get("coins"):
                    self.coins = data["coins"]
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
                if data.get("script_trader"):
                    self.script_trader = data["script_trader"]
            except Exception:
                pass

    def _load_kraken_credentials(self):
        """Load Kraken API credentials.

        SECURITY FIX (Issue #1): Priority order:
        1. Environment variables (PT_KRAKEN_KEY, PT_KRAKEN_SECRET) - RECOMMENDED
        2. Files (kraken_key.txt, kraken_secret.txt) - Fallback for backward compatibility

        For production, use environment variables:
            export PT_KRAKEN_KEY="your-api-key"
            export PT_KRAKEN_SECRET="your-api-secret"
        """
        # Environment variables are already loaded by pydantic-settings
        # Only load from files if not set via environment
        if not self.kraken_key:
            key_path = self.project_dir / "kraken_key.txt"
            if key_path.exists():
                self.kraken_key = key_path.read_text().strip()
                print("WARNING: Loading Kraken API key from file. "
                      "Consider using PT_KRAKEN_KEY environment variable instead.")

        if not self.kraken_secret:
            secret_path = self.project_dir / "kraken_secret.txt"
            if secret_path.exists():
                self.kraken_secret = secret_path.read_text().strip()
                print("WARNING: Loading Kraken API secret from file. "
                      "Consider using PT_KRAKEN_SECRET environment variable instead.")


settings = Settings()
