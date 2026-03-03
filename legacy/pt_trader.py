import base64
import datetime
import json
import uuid
import time
import math
from typing import Any, Dict, Optional, List
import requests
import os
import colorama
from colorama import Fore, Style
import traceback
import hashlib
import hmac
import urllib.parse

# PERFORMANCE FIX (Issues #3, #4, #5): Import performance utilities
# RELIABILITY FIX (Issues #1, #2, #5): Import reliability utilities
# RACE CONDITION FIX: Import safe_read_signal for signal files
# SECURITY FIX (Issue #3): Import response validator for Kraken API
try:
    from performance_utils import (
        get_price_cache, get_trading_db, get_http_client,
        PriceFileCache, TradingDatabase, AsyncHTTPClient,
        # Reliability utilities
        get_trading_logger, get_circuit_breaker,
        TradingLogger, CircuitBreaker, CircuitBreakerConfig, CircuitState,
        CircuitOpenError, OrderError, InsufficientFundsError, MinimumOrderError,
        OrderRejectedError, APITimeoutError, RateLimitError, parse_kraken_error,
        # Race condition fix utilities
        safe_read_signal,
        # Security utilities - API response validation
        get_response_validator, KrakenResponseValidator, ValidationResult
    )
    _PERF_UTILS_AVAILABLE = True
    _RELIABILITY_UTILS_AVAILABLE = True
    _VALIDATION_AVAILABLE = True
except ImportError:
    _PERF_UTILS_AVAILABLE = False
    _RELIABILITY_UTILS_AVAILABLE = False
    _VALIDATION_AVAILABLE = False
    PriceFileCache = None
    TradingDatabase = None
    AsyncHTTPClient = None
    TradingLogger = None
    CircuitBreaker = None
    KrakenResponseValidator = None
    # Fallback safe_read_signal
    def safe_read_signal(filepath: str, default: int = 0) -> int:
        try:
            with open(filepath, 'r') as f:
                content = f.read().strip()
            if not content:
                return default
            return int(float(content))
        except Exception:
            return default

# -----------------------------
# GUI HUB OUTPUTS
# -----------------------------
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HUB_DATA_DIR = os.environ.get(
    "POWERTRADER_HUB_DIR", os.path.join(os.path.dirname(_BASE_DIR), "data", "runtime")
)
os.makedirs(HUB_DATA_DIR, exist_ok=True)

TRADER_STATUS_PATH = os.path.join(HUB_DATA_DIR, "trader_status.json")
TRADE_HISTORY_PATH = os.path.join(HUB_DATA_DIR, "trade_history.jsonl")
PNL_LEDGER_PATH = os.path.join(HUB_DATA_DIR, "pnl_ledger.json")
ACCOUNT_VALUE_HISTORY_PATH = os.path.join(HUB_DATA_DIR, "account_value_history.jsonl")


# Initialize colorama
colorama.init(autoreset=True)

# -----------------------------
# GUI SETTINGS (coins list + main_neural_dir)
# -----------------------------
_GUI_SETTINGS_PATH = os.environ.get("POWERTRADER_GUI_SETTINGS") or os.path.join(
    _BASE_DIR, "gui_settings.json"
)

_gui_settings_cache = {
    "mtime": None,
    "coins": ["BTC"],  # fallback defaults
    "main_neural_dir": None,
}


def _load_gui_settings() -> dict:
    """
    Reads gui_settings.json and returns a dict with:
    - coins: uppercased list
    - main_neural_dir: string (may be None)
    Caches by mtime so it is cheap to call frequently.
    """
    try:
        if not os.path.isfile(_GUI_SETTINGS_PATH):
            return dict(_gui_settings_cache)

        mtime = os.path.getmtime(_GUI_SETTINGS_PATH)
        if _gui_settings_cache["mtime"] == mtime:
            return dict(_gui_settings_cache)

        with open(_GUI_SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f) or {}

        coins = data.get("coins", None)
        if not isinstance(coins, list) or not coins:
            coins = list(_gui_settings_cache["coins"])
        coins = [str(c).strip().upper() for c in coins if str(c).strip()]
        if not coins:
            coins = list(_gui_settings_cache["coins"])

        main_neural_dir = data.get("main_neural_dir", None)
        if isinstance(main_neural_dir, str):
            main_neural_dir = main_neural_dir.strip() or None
        else:
            main_neural_dir = None

        _gui_settings_cache["mtime"] = mtime
        _gui_settings_cache["coins"] = coins
        _gui_settings_cache["main_neural_dir"] = main_neural_dir

        return {
            "mtime": mtime,
            "coins": list(coins),
            "main_neural_dir": main_neural_dir,
        }
    except Exception:
        return dict(_gui_settings_cache)


def _load_selected_coins() -> list:
    """
    Reads selected_trading_coins.json from hub_data directory.
    Returns the list of selected coins, or all GUI coins if no selection file exists.
    """
    try:
        selected_coins_path = os.path.join(HUB_DIR, "selected_trading_coins.json")
        if not os.path.isfile(selected_coins_path):
            # No selection file means trade all coins
            gui_settings = _load_gui_settings()
            return gui_settings["coins"]

        with open(selected_coins_path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}

        selected = data.get("selected_coins", [])
        if not isinstance(selected, list) or not selected:
            # Invalid or empty selection means trade all coins
            gui_settings = _load_gui_settings()
            return gui_settings["coins"]

        # Normalize and filter to valid coins from GUI settings
        gui_settings = _load_gui_settings()
        all_coins = gui_settings["coins"]
        selected = [str(c).strip().upper() for c in selected if str(c).strip()]
        selected = [c for c in selected if c in all_coins]

        if not selected:
            # No valid selected coins, fall back to all coins
            return all_coins

        return selected
    except Exception:
        # Error reading selection, fall back to all coins
        gui_settings = _load_gui_settings()
        return gui_settings["coins"]


def _build_base_paths(main_dir_in: str, coins_in: list) -> dict:
    """
    Safety rule:
    - BTC uses main_dir directly
    - other coins use <main_dir>/<SYM> ONLY if that folder exists
      (no fallback to BTC folder — avoids corrupting BTC data)
    """
    out = {"BTC": main_dir_in}
    try:
        for sym in coins_in:
            sym = str(sym).strip().upper()
            if not sym:
                continue
            if sym == "BTC":
                out["BTC"] = main_dir_in
                continue
            sub = os.path.join(main_dir_in, sym)
            if os.path.isdir(sub):
                out[sym] = sub
    except Exception:
        pass
    return out


# Live globals (will be refreshed inside manage_trades())
crypto_symbols = ["BTC"]  # fallback defaults

# Initialize with GUI coins at startup (BTC only now)
try:
    gui_settings = _load_gui_settings()
    crypto_symbols = gui_settings.get("coins", ["BTC"])
except Exception:
    pass  # Use fallback defaults if there's an error

# Default main_dir behavior if settings are missing
main_dir = os.getcwd()
base_paths = {"BTC": main_dir}

_last_settings_mtime = None


def _refresh_paths_and_symbols():
    """
    Hot-reload coins + main_neural_dir while trader is running.
    Updates globals: crypto_symbols, main_dir, base_paths
    """
    global crypto_symbols, main_dir, base_paths, _last_settings_mtime

    s = _load_gui_settings()
    mtime = s.get("mtime", None)

    # If settings file doesn't exist, keep current defaults
    if mtime is None:
        return

    if _last_settings_mtime == mtime:
        return

    _last_settings_mtime = mtime

    # Use GUI coins directly (BTC only now)
    coins = s.get("coins", ["BTC"])
    mndir = s.get("main_neural_dir") or main_dir

    # Keep it safe if folder isn't real on this machine
    if not os.path.isdir(mndir):
        mndir = os.getcwd()

    crypto_symbols = list(coins)
    main_dir = mndir
    base_paths = _build_base_paths(main_dir, crypto_symbols)


# API STUFF
KRAKEN_API_KEY = ""
KRAKEN_PRIVATE_KEY = ""

try:
    with open("kraken_key.txt", "r", encoding="utf-8") as f:
        KRAKEN_API_KEY = (f.read() or "").strip()
    with open("kraken_secret.txt", "r", encoding="utf-8") as f:
        KRAKEN_PRIVATE_KEY = (f.read() or "").strip()
except Exception:
    KRAKEN_API_KEY = ""
    KRAKEN_PRIVATE_KEY = ""

if not KRAKEN_API_KEY or not KRAKEN_PRIVATE_KEY:
    print(
        "\n[PowerTrader] Kraken API credentials not found.\n"
        "Open the GUI and go to Settings → Kraken API → Setup / Update.\n"
        "That wizard will help you configure your Kraken API key and secret,\n"
        "and will save kraken_key.txt + kraken_secret.txt so this trader can authenticate.\n"
    )
    raise SystemExit(1)


class CryptoAPITrading:
    def __init__(self):
        # keep a copy of the folder map (same idea as trader.py)
        self.path_map = dict(base_paths)

        self.api_key = KRAKEN_API_KEY
        self.private_key = KRAKEN_PRIVATE_KEY
        self.base_url = "https://api.kraken.com"

        # Nonce handling - use microseconds and ensure monotonic increase
        self._last_nonce = 0
        self._last_api_call = 0.0
        self._api_call_min_interval = 0.1  # minimum 100ms between API calls

        self.dca_levels_triggered = {}  # Track DCA levels for each crypto
        self.dca_levels = [
            -2.5,
            -5.0,
            -10.0,
            -20.0,
            -30.0,
            -40.0,
            -50.0,
        ]  # Moved to instance variable

        # --- Trailing profit margin (per-coin state) ---
        # Each coin keeps its own trailing PM line, peak, and "was above line" flag.
        self.trailing_pm = (
            {}
        )  # { "BTC": {"active": bool, "line": float, "peak": float, "was_above": bool}, ... }
        self.trailing_gap_pct = 0.5  # 0.5% trail gap behind peak
        self.pm_start_pct_no_dca = 5.0
        self.pm_start_pct_with_dca = 2.5

        self.cost_basis = (
            self.calculate_cost_basis()
        )  # Initialize cost basis at startup
        self.initialize_dca_levels()  # Initialize DCA levels based on historical buy orders

        # GUI hub persistence
        self._pnl_ledger = self._load_pnl_ledger()

        # Cache last known bid/ask per symbol so transient API misses don't zero out account value
        self._last_good_bid_ask = {}

        # Cache last *complete* account snapshot so transient holdings/price misses can't write a bogus low value
        self._last_good_account_snapshot = {
            "total_account_value": None,
            "buying_power": None,
            "holdings_sell_value": None,
            "holdings_buy_value": None,
            "percent_in_trade": None,
        }

        # --- DCA rate-limit (per trade, per coin, rolling 24h window) ---
        self.max_dca_buys_per_24h = 2
        self.dca_window_seconds = 24 * 60 * 60
        self._dca_buy_ts = {}  # { "BTC": [ts, ts, ...] } (DCA buys only)
        self._dca_last_sell_ts = {}  # { "BTC": ts_of_last_sell }
        self._seed_dca_window_from_history()

        # RELIABILITY FIX (Issues #1, #2, #5): Initialize logging and circuit breaker
        self._logger = None
        self._circuit_breaker = None
        self._response_validator = None
        if _RELIABILITY_UTILS_AVAILABLE:
            try:
                self._logger = get_trading_logger(console_output=True)
                self._circuit_breaker = get_circuit_breaker(
                    name="kraken_api",
                    config=CircuitBreakerConfig(
                        failure_threshold=5,      # Open after 5 consecutive failures
                        recovery_timeout=60.0,    # Try recovery after 60 seconds
                        half_open_max_calls=3,    # Allow 3 test calls
                        success_threshold=2       # Close after 2 successes
                    )
                )
                self._logger.info("PowerTrader initialized", version="1.0")
            except Exception as e:
                print(f"Warning: Could not initialize reliability utilities: {e}")

        # SECURITY FIX (Issue #3): Initialize response validator for Kraken API
        if _VALIDATION_AVAILABLE:
            try:
                self._response_validator = get_response_validator(logger=self._logger)
            except Exception as e:
                print(f"Warning: Could not initialize response validator: {e}")

    def _atomic_write_json(self, path: str, data: dict) -> None:
        try:
            tmp = f"{path}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, path)
        except Exception:
            pass

    def _append_jsonl(self, path: str, obj: dict) -> None:
        """Append to JSONL file (legacy format kept for backward compatibility)."""
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(obj) + "\n")
        except Exception:
            pass

        # PERFORMANCE FIX (Issue #4): Also write to SQLite database
        # SQLite provides indexed queries, much faster for historical lookups
        if _PERF_UTILS_AVAILABLE:
            try:
                db = get_trading_db()
                if path == TRADE_HISTORY_PATH:
                    db.record_trade({
                        'timestamp': datetime.datetime.utcfromtimestamp(
                            obj.get('ts', time.time())
                        ).isoformat(),
                        'symbol': obj.get('symbol', ''),
                        'side': obj.get('side', ''),
                        'quantity': obj.get('qty', 0),
                        'price': obj.get('price', 0),
                        'total_value': (obj.get('price') or 0) * (obj.get('qty') or 0),
                        'trade_type': obj.get('tag'),
                        'notes': obj.get('pnl_pct'),
                        'order_id': obj.get('order_id'),
                    })
                elif path == ACCOUNT_VALUE_HISTORY_PATH:
                    db.record_account_value(
                        timestamp=datetime.datetime.utcfromtimestamp(
                            obj.get('ts', time.time())
                        ).isoformat(),
                        total_value=obj.get('total_value', 0),
                        cash_balance=obj.get('cash_balance'),
                        holdings_value=obj.get('holdings_value'),
                        details=obj
                    )
            except Exception:
                pass  # Don't fail if database write fails

    def _load_pnl_ledger(self) -> dict:
        try:
            if os.path.isfile(PNL_LEDGER_PATH):
                with open(PNL_LEDGER_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {"total_realized_profit_aud": 0.0, "last_updated_ts": time.time()}

    def _save_pnl_ledger(self) -> None:
        try:
            self._pnl_ledger["last_updated_ts"] = time.time()
            self._atomic_write_json(PNL_LEDGER_PATH, self._pnl_ledger)
        except Exception:
            pass

    def _record_trade(
        self,
        side: str,
        symbol: str,
        qty: float,
        price: Optional[float] = None,
        avg_cost_basis: Optional[float] = None,
        pnl_pct: Optional[float] = None,
        tag: Optional[str] = None,
        order_id: Optional[str] = None,
    ) -> None:
        """
        Minimal local ledger for GUI:
        - append trade_history.jsonl
        - update pnl_ledger.json on sells (using estimated price * qty)
        - store the exact PnL% at the moment for DCA buys / sells (for GUI trade history)
        """
        ts = time.time()
        realized = None
        if side.lower() == "sell" and price is not None and avg_cost_basis is not None:
            try:
                realized = (float(price) - float(avg_cost_basis)) * float(qty)
                self._pnl_ledger["total_realized_profit_aud"] = float(
                    self._pnl_ledger.get("total_realized_profit_aud", 0.0)
                ) + float(realized)
            except Exception:
                realized = None

        entry = {
            "ts": ts,
            "side": side,
            "tag": tag,
            "symbol": symbol,
            "qty": qty,
            "price": price,
            "avg_cost_basis": avg_cost_basis,
            "pnl_pct": pnl_pct,
            "realized_profit_aud": realized,
            "order_id": order_id,
        }
        self._append_jsonl(TRADE_HISTORY_PATH, entry)
        if realized is not None:
            self._save_pnl_ledger()

    def _write_trader_status(self, status: dict) -> None:
        self._atomic_write_json(TRADER_STATUS_PATH, status)

    @staticmethod
    def _get_current_timestamp() -> int:
        return int(datetime.datetime.now(tz=datetime.timezone.utc).timestamp())

    @staticmethod
    def _fmt_price(price: float) -> str:
        """
        Dynamic decimal formatting by magnitude:
        - >= 1.0   -> 2 decimals (BTC/ETH/etc won't show 8 decimals)
        - <  1.0   -> enough decimals to show meaningful digits (based on first non-zero),
                     then trim trailing zeros.
        """
        try:
            p = float(price)
        except Exception:
            return "N/A"

        if p == 0:
            return "0"

        ap = abs(p)

        if ap >= 1.0:
            decimals = 2
        else:
            # Example:
            # 0.5      -> decimals ~ 4 (prints "0.5" after trimming zeros)
            # 0.05     -> 5
            # 0.005    -> 6
            # 0.000012 -> 8
            decimals = int(-math.floor(math.log10(ap))) + 3
            decimals = max(2, min(12, decimals))

        s = f"{p:.{decimals}f}"

        # Trim useless trailing zeros for cleaner output (0.5000 -> 0.5)
        if "." in s:
            s = s.rstrip("0").rstrip(".")

        return s

    @staticmethod
    def _read_long_dca_signal(symbol: str) -> int:
        """
        Reads long_dca_signal.txt from the per-coin folder (same folder rules as trader.py).

        Used for:
        - Start gate: start trades at level 3+
        - DCA assist: levels 4-7 map to trader DCA stages 0-3 (trade starts at level 3 => stage 0)

        RACE CONDITION FIX: Uses safe_read_signal to handle partial/empty reads
        when pt_thinker is writing to the file simultaneously.
        """
        sym = str(symbol).upper().strip()
        folder = base_paths.get(
            sym, main_dir if sym == "BTC" else os.path.join(main_dir, sym)
        )
        path = os.path.join(folder, "long_dca_signal.txt")
        return safe_read_signal(path, default=0)

    @staticmethod
    def _read_short_dca_signal(symbol: str) -> int:
        """
        Reads short_dca_signal.txt from the per-coin folder (same folder rules as trader.py).

        Used for:
        - Start gate: start trades at level 3+
        - DCA assist: levels 4-7 map to trader DCA stages 0-3 (trade starts at level 3 => stage 0)

        RACE CONDITION FIX: Uses safe_read_signal to handle partial/empty reads
        when pt_thinker is writing to the file simultaneously.
        """
        sym = str(symbol).upper().strip()
        folder = base_paths.get(
            sym, main_dir if sym == "BTC" else os.path.join(main_dir, sym)
        )
        path = os.path.join(folder, "short_dca_signal.txt")
        return safe_read_signal(path, default=0)

    def initialize_dca_levels(self):
        """
        Initializes the DCA levels_triggered dictionary based on the number of buy orders
        that have occurred after the first buy order following the most recent sell order
        for each cryptocurrency.
        """
        holdings = self.get_holdings()
        if not holdings or "results" not in holdings:
            print("No holdings found. Skipping DCA levels initialization.")
            return

        for holding in holdings.get("results", []):
            symbol = holding["asset_code"]

            # Only process coins that are in our configured trading list
            if symbol not in crypto_symbols:
                continue

            full_symbol = f"{symbol}-AUD"
            orders = self.get_orders(full_symbol)

            if not orders or "results" not in orders:
                print(f"No orders found for {full_symbol}. Skipping.")
                continue

            # Filter for filled buy and sell orders
            filled_orders = [
                order
                for order in orders["results"]
                if order["state"] == "filled" and order["side"] in ["buy", "sell"]
            ]

            if not filled_orders:
                print(f"No filled buy or sell orders for {full_symbol}. Skipping.")
                continue

            # Sort orders by creation time in ascending order (oldest first)
            filled_orders.sort(key=lambda x: x["created_at"])

            # Find the timestamp of the most recent sell order
            most_recent_sell_time = None
            for order in reversed(filled_orders):
                if order["side"] == "sell":
                    most_recent_sell_time = order["created_at"]
                    break

            # Determine the cutoff time for buy orders
            if most_recent_sell_time:
                # Find all buy orders after the most recent sell
                relevant_buy_orders = [
                    order
                    for order in filled_orders
                    if order["side"] == "buy"
                    and order["created_at"] > most_recent_sell_time
                ]
                if not relevant_buy_orders:
                    print(
                        f"No buy orders after the most recent sell for {full_symbol}."
                    )
                    self.dca_levels_triggered[symbol] = []
                    continue
                print(f"Most recent sell for {full_symbol} at {most_recent_sell_time}.")
            else:
                # If no sell orders, consider all buy orders
                relevant_buy_orders = [
                    order for order in filled_orders if order["side"] == "buy"
                ]
                if not relevant_buy_orders:
                    print(f"No buy orders for {full_symbol}. Skipping.")
                    self.dca_levels_triggered[symbol] = []
                    continue
                print(
                    f"No sell orders found for {full_symbol}. Considering all buy orders."
                )

            # Ensure buy orders are sorted by creation time ascending
            relevant_buy_orders.sort(key=lambda x: x["created_at"])

            # Identify the first buy order in the relevant list
            first_buy_order = relevant_buy_orders[0]
            first_buy_time = first_buy_order["created_at"]

            # Count the number of buy orders after the first buy
            buy_orders_after_first = [
                order
                for order in relevant_buy_orders
                if order["created_at"] > first_buy_time
            ]

            triggered_levels_count = len(buy_orders_after_first)

            # Track DCA by stage index (0, 1, 2, ...) rather than % values.
            # This makes neural-vs-hardcoded clean, and allows repeating the -50% stage indefinitely.
            self.dca_levels_triggered[symbol] = list(range(triggered_levels_count))
            print(f"Initialized DCA stages for {symbol}: {triggered_levels_count}")

    def _seed_dca_window_from_history(self) -> None:
        """
        Seeds in-memory DCA buy timestamps from TRADE_HISTORY_PATH so the 24h limit
        works across restarts.

        Uses the local GUI trade history (tag == "DCA") and resets per trade at the most recent sell.
        """
        now_ts = time.time()
        cutoff = now_ts - float(getattr(self, "dca_window_seconds", 86400))

        self._dca_buy_ts = {}
        self._dca_last_sell_ts = {}

        if not os.path.isfile(TRADE_HISTORY_PATH):
            return

        try:
            with open(TRADE_HISTORY_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = (line or "").strip()
                    if not line:
                        continue

                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue

                    ts = obj.get("ts", None)
                    side = str(obj.get("side", "")).lower()
                    tag = obj.get("tag", None)
                    sym_full = str(obj.get("symbol", "")).upper().strip()
                    base = sym_full.split("-")[0].strip() if sym_full else ""
                    if not base:
                        continue

                    try:
                        ts_f = float(ts)
                    except Exception:
                        continue

                    if side == "sell":
                        prev = float(self._dca_last_sell_ts.get(base, 0.0) or 0.0)
                        if ts_f > prev:
                            self._dca_last_sell_ts[base] = ts_f

                    elif side == "buy" and tag == "DCA":
                        self._dca_buy_ts.setdefault(base, []).append(ts_f)

        except Exception:
            return

        # Keep only DCA buys after the last sell (current trade) and within rolling 24h
        for base, ts_list in list(self._dca_buy_ts.items()):
            last_sell = float(self._dca_last_sell_ts.get(base, 0.0) or 0.0)
            kept = [t for t in ts_list if (t > last_sell) and (t >= cutoff)]
            kept.sort()
            self._dca_buy_ts[base] = kept

    def _dca_window_count(
        self, base_symbol: str, now_ts: Optional[float] = None
    ) -> int:
        """
        Count of DCA buys for this coin within rolling 24h in the *current trade*.
        Current trade boundary = most recent sell we observed for this coin.
        """
        base = str(base_symbol).upper().strip()
        if not base:
            return 0

        now = float(now_ts if now_ts is not None else time.time())
        cutoff = now - float(getattr(self, "dca_window_seconds", 86400))
        last_sell = float(self._dca_last_sell_ts.get(base, 0.0) or 0.0)

        ts_list = list(self._dca_buy_ts.get(base, []) or [])
        ts_list = [t for t in ts_list if (t > last_sell) and (t >= cutoff)]
        self._dca_buy_ts[base] = ts_list
        return len(ts_list)

    def _note_dca_buy(self, base_symbol: str, ts: Optional[float] = None) -> None:
        base = str(base_symbol).upper().strip()
        if not base:
            return
        t = float(ts if ts is not None else time.time())
        self._dca_buy_ts.setdefault(base, []).append(t)
        self._dca_window_count(base, now_ts=t)  # prune in-place

    def _reset_dca_window_for_trade(
        self, base_symbol: str, sold: bool = False, ts: Optional[float] = None
    ) -> None:
        base = str(base_symbol).upper().strip()
        if not base:
            return
        if sold:
            self._dca_last_sell_ts[base] = float(ts if ts is not None else time.time())
        self._dca_buy_ts[base] = []

    def _get_nonce(self) -> str:
        """Generate a strictly increasing nonce using microseconds."""
        # Use microseconds for higher resolution
        current_nonce = int(time.time() * 1_000_000)
        # Ensure strictly increasing
        if current_nonce <= self._last_nonce:
            current_nonce = self._last_nonce + 1
        self._last_nonce = current_nonce
        return str(current_nonce)

    def _wait_for_rate_limit(self) -> None:
        """Ensure minimum interval between API calls."""
        now = time.time()
        elapsed = now - self._last_api_call
        if elapsed < self._api_call_min_interval:
            time.sleep(self._api_call_min_interval - elapsed)
        self._last_api_call = time.time()

    def _log(self, level: str, message: str, **kwargs):
        """Helper method for logging with fallback to print."""
        if self._logger:
            log_method = getattr(self._logger, level.lower(), self._logger.info)
            log_method(message, **kwargs)
        else:
            print(f"[{level.upper()}] {message} {kwargs}")

    def make_api_request(
        self, endpoint: str, data: Optional[Dict[str, Any]] = None, max_retries: int = 3
    ) -> Any:
        """Make a signed API request to Kraken with retry logic for nonce errors."""
        url = f"{self.base_url}/0/private/{endpoint}"

        # RELIABILITY FIX (Issue #1): Check circuit breaker before making request
        if self._circuit_breaker:
            if not self._circuit_breaker.can_execute():
                self._log("warning", "Circuit breaker OPEN, rejecting API request",
                         endpoint=endpoint, state=self._circuit_breaker.state.value)
                return None

        for attempt in range(max_retries):
            # Rate limit between API calls
            self._wait_for_rate_limit()

            if data is None:
                request_data = {}
            else:
                request_data = data.copy()

            # Add nonce to data using improved nonce generation
            request_data["nonce"] = self._get_nonce()

            # Create post data string
            postdata = urllib.parse.urlencode(request_data)

            # Create message for signing
            encoded = (str(request_data["nonce"]) + postdata).encode("utf-8")
            message = (
                f"/0/private/{endpoint}".encode("utf-8") + hashlib.sha256(encoded).digest()
            )

            # Sign message
            signature = hmac.new(
                base64.b64decode(self.private_key), message, hashlib.sha512
            )
            sigdigest = base64.b64encode(signature.digest()).decode("utf-8")

            headers = {
                "API-Key": self.api_key,
                "API-Sign": sigdigest,
                "Content-Type": "application/x-www-form-urlencoded",
            }

            try:
                response = requests.post(url, headers=headers, data=postdata, timeout=10)
                response.raise_for_status()
                result = response.json()

                # Check for Kraken API errors
                if "error" in result and result["error"]:
                    error_str = str(result["error"])
                    # Retry on nonce errors
                    if "EAPI:Invalid nonce" in error_str:
                        if attempt < max_retries - 1:
                            wait_time = 0.5 * (attempt + 1)  # Exponential backoff
                            self._log("warning", f"Nonce error, retrying in {wait_time}s",
                                     attempt=attempt + 1, max_retries=max_retries)
                            time.sleep(wait_time)
                            continue

                    # Log the API error with details
                    if self._logger:
                        self._logger.api_error(endpoint, error_str, attempt=attempt + 1)
                    else:
                        print(f"Kraken API Error: {result['error']}")

                    # Record failure in circuit breaker
                    if self._circuit_breaker:
                        self._circuit_breaker.record_failure(Exception(error_str))
                    return None

                # Record success in circuit breaker
                if self._circuit_breaker:
                    self._circuit_breaker.record_success()

                return result.get("result", {})

            except requests.exceptions.Timeout as e:
                self._log("error", f"Kraken API timeout", endpoint=endpoint, attempt=attempt + 1)
                if self._circuit_breaker:
                    self._circuit_breaker.record_failure(e)
                if attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                return None

            except requests.exceptions.ConnectionError as e:
                self._log("error", f"Kraken API connection error", endpoint=endpoint,
                         attempt=attempt + 1, error=str(e))
                if self._circuit_breaker:
                    self._circuit_breaker.record_failure(e)
                if attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                return None

            except Exception as e:
                self._log("error", f"Kraken API request failed", endpoint=endpoint,
                         attempt=attempt + 1, error=str(e))
                if self._circuit_breaker:
                    self._circuit_breaker.record_failure(e)
                if attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                return None

        return None

    # Kraken asset code mapping to standard symbols
    KRAKEN_ASSET_MAP = {
        "XXBT": "BTC",
        "XBT": "BTC",
        "XETH": "ETH",
        "XLTC": "LTC",
        "XXRP": "XRP",
        "XDOGE": "DOGE",
        "ZAUD": "AUD",
        "ZUSD": "USD",
        "AUD.HOLD": "AUD",
    }

    def get_account(self) -> Any:
        """Get account balance from Kraken - returns AUD balance as buying_power.

        SECURITY FIX (Issue #3): Uses schema validation for API responses.
        """
        raw_response = self.make_api_request("Balance")
        if not raw_response:
            return {"buying_power": 0}

        # SECURITY FIX: Validate response before processing
        if self._response_validator:
            balances = self._response_validator.safe_get_balances(raw_response)
        else:
            # Fallback: basic validation
            balances = {}
            if isinstance(raw_response, dict):
                for k, v in raw_response.items():
                    try:
                        balances[k] = float(v)
                    except (ValueError, TypeError):
                        self._log("warning", f"Invalid balance value for {k}: {v}")

        # Kraken returns: {"ZAUD": 1000.00, "XXBT": 0.5, ...}
        # We need to extract AUD balance as buying_power
        aud_balance = 0.0
        for key, value in balances.items():
            asset = self.KRAKEN_ASSET_MAP.get(key, key)
            if asset == "AUD":
                aud_balance += value

        return {"buying_power": aud_balance}

    def get_holdings(self) -> Any:
        """Get holdings/balance from Kraken - returns holdings in expected format.

        SECURITY FIX (Issue #3): Uses schema validation for API responses.
        """
        raw_response = self.make_api_request("Balance")
        if not raw_response:
            return {"results": []}

        # SECURITY FIX: Validate response before processing
        if self._response_validator:
            balances = self._response_validator.safe_get_balances(raw_response)
        else:
            # Fallback: basic validation
            balances = {}
            if isinstance(raw_response, dict):
                for k, v in raw_response.items():
                    try:
                        balances[k] = float(v)
                    except (ValueError, TypeError):
                        self._log("warning", f"Invalid balance value for {k}: {v}")

        # Kraken returns: {"ZAUD": 1000.00, "XXBT": 0.5, ...}
        # Transform to: {"results": [{"asset_code": "BTC", "total_quantity": 0.5}, ...]}
        results = []
        for key, value in balances.items():
            asset = self.KRAKEN_ASSET_MAP.get(key, key)
            quantity = value  # Already float from validation

            # Skip USD, stablecoins, and zero balances (keep AUD as quote currency)
            if asset in ("USD", "USDT", "USDC", "DAI", "TUSD", "BUSD") or quantity <= 0:
                continue

            results.append({
                "asset_code": asset,
                "total_quantity": quantity,
            })

        return {"results": results}

    def get_trading_pairs(self) -> Any:
        """Get available trading pairs from Kraken"""
        import requests

        try:
            response = requests.get(
                "https://api.kraken.com/0/public/AssetPairs", timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("result", {})
            return {}
        except Exception:
            return {}

    def get_orders(self, symbol: str) -> Any:
        """Get open orders from Kraken"""
        return self.make_api_request("OpenOrders")

    def calculate_cost_basis(self) -> Dict[str, float]:
        """Calculate cost basis using Kraken trade history.

        Uses FIFO (First In, First Out) method to calculate average cost basis
        for each trading pair based on actual trade history.

        SECURITY FIX (Issue #3): Uses schema validation for API responses.

        Returns:
            Dict mapping symbol (e.g., "BTC-AUD") to average cost basis per unit
        """
        cost_basis: Dict[str, float] = {}

        try:
            # Fetch trade history from Kraken (up to last 50 trades per request)
            raw_response = self.make_api_request("TradesHistory", {"trades": True})

            if not raw_response:
                self._log("warning", "Could not fetch trade history for cost basis calculation")
                return {}

            # SECURITY FIX: Validate response before processing
            if self._response_validator:
                trades = self._response_validator.safe_get_trades(raw_response)
            else:
                # Fallback: basic extraction with validation
                trades = {}
                if isinstance(raw_response, dict) and "trades" in raw_response:
                    raw_trades = raw_response.get("trades", {})
                    if isinstance(raw_trades, dict):
                        for tid, tdata in raw_trades.items():
                            if isinstance(tdata, dict):
                                try:
                                    trades[tid] = {
                                        'pair': str(tdata.get('pair', '')),
                                        'type': str(tdata.get('type', '')),
                                        'price': float(tdata.get('price', 0)),
                                        'vol': float(tdata.get('vol', 0)),
                                        'cost': float(tdata.get('cost', 0)),
                                        'time': float(tdata.get('time', 0))
                                    }
                                except (ValueError, TypeError) as e:
                                    self._log("warning", f"Invalid trade data for {tid}: {e}")

            if not trades:
                self._log("warning", "No valid trades found in history")
                return {}

            # Track holdings and total cost per asset
            # Format: {symbol: {"qty": total_qty, "cost": total_cost}}
            holdings: Dict[str, Dict[str, float]] = {}

            # Sort trades by time (oldest first for FIFO calculation)
            sorted_trades = sorted(
                trades.items(),
                key=lambda x: x[1].get("time", 0)
            )

            for trade_id, trade in sorted_trades:
                pair = trade.get("pair", "")
                trade_type = trade.get("type", "")  # "buy" or "sell"
                price = trade.get("price", 0)
                volume = trade.get("vol", 0)
                cost = trade.get("cost", 0)  # Total cost in quote currency

                if not pair or price <= 0 or volume <= 0:
                    continue

                # Convert Kraken pair to standard format (e.g., XBTAUD -> BTC-AUD)
                symbol = self._convert_kraken_pair_to_symbol(pair)
                if not symbol:
                    continue

                if symbol not in holdings:
                    holdings[symbol] = {"qty": 0.0, "cost": 0.0}

                if trade_type == "buy":
                    # Add to holdings
                    holdings[symbol]["qty"] += volume
                    holdings[symbol]["cost"] += cost
                elif trade_type == "sell":
                    # Reduce holdings (FIFO - reduce proportionally)
                    if holdings[symbol]["qty"] > 0:
                        # Calculate proportion being sold
                        sell_ratio = min(volume / holdings[symbol]["qty"], 1.0)
                        holdings[symbol]["cost"] *= (1 - sell_ratio)
                        holdings[symbol]["qty"] -= volume
                        # Ensure we don't go negative
                        if holdings[symbol]["qty"] < 0:
                            holdings[symbol]["qty"] = 0.0
                            holdings[symbol]["cost"] = 0.0

            # Calculate average cost basis for each symbol
            for symbol, data in holdings.items():
                if data["qty"] > 0:
                    cost_basis[symbol] = data["cost"] / data["qty"]
                else:
                    cost_basis[symbol] = 0.0

            self._log("info", f"Cost basis calculated for {len(cost_basis)} symbols")
            return cost_basis

        except Exception as e:
            self._log("error", f"Failed to calculate cost basis: {e}")
            return {}

    def _convert_kraken_pair_to_symbol(self, kraken_pair: str) -> Optional[str]:
        """Convert Kraken trading pair to standard format (e.g., XBTAUD -> BTC-AUD)."""
        # Common Kraken pair mappings
        pair_map = {
            "XBTAUD": "BTC-AUD",
            "XXBTAUD": "BTC-AUD",
            "XXBTZAUD": "BTC-AUD",
            "ETHAUD": "ETH-AUD",
            "XETHAUD": "ETH-AUD",
            "XETHZAUD": "ETH-AUD",
            "XRPAUD": "XRP-AUD",
            "XXRPAUD": "XRP-AUD",
            "XXRPZAUD": "XRP-AUD",
            "LTCAUD": "LTC-AUD",
            "XLTCAUD": "LTC-AUD",
            "XLTCZAUD": "LTC-AUD",
            "DOGEAUD": "DOGE-AUD",
            "XDOGEAUD": "DOGE-AUD",
            "ADAAUD": "ADA-AUD",
            "DOTAUD": "DOT-AUD",
            "LINKAUD": "LINK-AUD",
            "UNIAUD": "UNI-AUD",
            "BNBAUD": "BNB-AUD",
        }

        # Try direct mapping first
        if kraken_pair in pair_map:
            return pair_map[kraken_pair]

        # Try to parse dynamically: look for AUD suffix
        kraken_pair_upper = kraken_pair.upper()
        if kraken_pair_upper.endswith("AUD") or kraken_pair_upper.endswith("ZAUD"):
            # Extract base asset
            if kraken_pair_upper.endswith("ZAUD"):
                base = kraken_pair_upper[:-4]
            else:
                base = kraken_pair_upper[:-3]

            # Remove leading X if present (Kraken convention)
            if base.startswith("X") and len(base) > 1:
                base = base[1:]
            if base.startswith("X") and len(base) > 1:
                base = base[1:]  # Handle double X like XXBT

            # Map XBT to BTC
            if base == "BT":
                base = "BTC"

            return f"{base}-AUD"

        return None

    def _convert_to_kraken_symbol(self, symbol: str) -> str:
        """Convert BTC-AUD format to Kraken format"""
        symbol_map = {
            "BTC-AUD": "XBTAUD",
            "ETH-AUD": "ETHAUD",
            "XRP-AUD": "XRPAUD",
            "BNB-AUD": "BNBAUD",
            "DOGE-AUD": "DOGEAUD",
            "ADA-AUD": "ADAAUD",
            "DOT-AUD": "DOTAUD",
            "LTC-AUD": "LTCAUD",
            "LINK-AUD": "LINKAUD",
            "UNI-AUD": "UNIAUD",
        }
        return symbol_map.get(symbol, symbol.replace("-AUD", "AUD"))

    def get_price(
        self, symbols: list
    ) -> tuple[Dict[str, float], Dict[str, float], list[str]]:
        buy_prices = {}
        sell_prices = {}
        valid_symbols = []

        for symbol in symbols:
            if symbol == "USDC-USD":
                continue

            try:
                # Use BTCMarkets public API for price data (no authentication needed)
                # BTCMarkets uses same symbol format (BTC-AUD)
                response = requests.get(
                    f"https://api.btcmarkets.net/v3/markets/{symbol}/ticker",
                    timeout=10,
                )

                if response.status_code == 200:
                    data = response.json()
                    # BTCMarkets ticker has bestAsk and bestBid
                    ask = float(data.get("bestAsk") or data.get("lastPrice", 0))
                    bid = float(data.get("bestBid") or data.get("lastPrice", 0))

                    if ask > 0 and bid > 0:
                        buy_prices[symbol] = ask
                        sell_prices[symbol] = bid
                        valid_symbols.append(symbol)

                        # Update cache for transient failures later
                        try:
                            self._last_good_bid_ask[symbol] = {
                                "ask": ask,
                                "bid": bid,
                                "ts": time.time(),
                            }
                        except Exception:
                            pass
                    else:
                        # Try cache fallback
                        self._try_price_cache(
                            symbol, buy_prices, sell_prices, valid_symbols
                        )
                else:
                    # Try cache fallback
                    self._try_price_cache(
                        symbol, buy_prices, sell_prices, valid_symbols
                    )

            except Exception:
                # Try cache fallback
                self._try_price_cache(symbol, buy_prices, sell_prices, valid_symbols)

        return buy_prices, sell_prices, valid_symbols

    def _try_price_cache(self, symbol, buy_prices, sell_prices, valid_symbols):
        """Helper method to try price cache fallback"""
        try:
            cached = self._last_good_bid_ask.get(symbol)
            if cached:
                ask = float(cached.get("ask", 0.0) or 0.0)
                bid = float(cached.get("bid", 0.0) or 0.0)
                if ask > 0.0 and bid > 0.0:
                    buy_prices[symbol] = ask
                    sell_prices[symbol] = bid
                    valid_symbols.append(symbol)
        except Exception:
            pass

    def place_buy_order(
        self,
        client_order_id: str,
        side: str,
        order_type: str,
        symbol: str,
        amount_in_usd: float,
        avg_cost_basis: Optional[float] = None,
        pnl_pct: Optional[float] = None,
        tag: Optional[str] = None,
    ) -> Any:
        """
        Place a buy order with proper error handling.

        RELIABILITY FIX (Issue #5): Specific exception handling with logging.
        """
        response = None

        # Fetch the current price of the asset
        try:
            current_buy_prices, current_sell_prices, valid_symbols = self.get_price(
                [symbol]
            )
            if symbol not in current_buy_prices:
                self._log("error", "Failed to get price for buy order",
                         symbol=symbol, amount=amount_in_usd)
                return None
            current_price = current_buy_prices[symbol]
            asset_quantity = amount_in_usd / current_price
        except Exception as e:
            self._log("error", "Price fetch failed for buy order",
                     symbol=symbol, error=str(e))
            return None

        max_retries = 5
        retries = 0

        while retries < max_retries:
            retries += 1
            try:
                # Default precision to 8 decimals initially
                rounded_quantity = round(asset_quantity, 8)

                # Kraken order format
                kraken_symbol = self._convert_to_kraken_symbol(symbol)

                order_data = {
                    "pair": kraken_symbol,
                    "type": "buy",
                    "ordertype": "market",
                    "volume": f"{rounded_quantity:.8f}",
                    "userref": client_order_id[:8],  # Kraken userref is max 32bit int
                }

                response = self.make_api_request("AddOrder", order_data)

                # SECURITY FIX (Issue #3): Validate AddOrder response
                order_id = None
                if response:
                    if self._response_validator:
                        order_id = self._response_validator.safe_get_order_id(response)
                    elif isinstance(response, dict) and "txid" in response:
                        txid = response.get("txid", [])
                        order_id = txid[0] if isinstance(txid, list) and txid else None

                if order_id:

                    # Log successful trade
                    if self._logger:
                        self._logger.trade(
                            "BUY", symbol, float(rounded_quantity), float(current_price),
                            order_id=order_id, tag=tag, amount_aud=amount_in_usd
                        )

                    self._record_trade(
                        side="buy",
                        symbol=symbol,
                        qty=float(rounded_quantity),
                        price=float(current_price),
                        avg_cost_basis=(
                            float(avg_cost_basis)
                            if avg_cost_basis is not None
                            else None
                        ),
                        pnl_pct=float(pnl_pct) if pnl_pct is not None else None,
                        tag=tag,
                        order_id=order_id,
                    )
                    return response  # Successfully placed order

            except Exception as e:
                # RELIABILITY FIX (Issue #5): Log the exception instead of silently ignoring
                self._log("error", "Exception placing buy order",
                         symbol=symbol, attempt=retries, error=str(e),
                         traceback=traceback.format_exc())

            # Check for Kraken errors with specific handling
            if response and "error" in response:
                error_list = response.get("error", [])

                # RELIABILITY FIX (Issue #5): Parse and handle specific errors
                if _RELIABILITY_UTILS_AVAILABLE:
                    try:
                        parsed_error = parse_kraken_error(error_list, symbol, "buy")
                        if parsed_error:
                            self._log("warning", f"Order error: {type(parsed_error).__name__}",
                                     symbol=symbol, error=str(parsed_error),
                                     recoverable=parsed_error.recoverable)

                            # Non-recoverable errors - don't retry
                            if not parsed_error.recoverable:
                                return None
                    except Exception:
                        pass

                # Legacy error handling fallback
                for error in error_list:
                    error_lower = error.lower() if isinstance(error, str) else str(error).lower()
                    if "minimum order size" in error_lower:
                        self._log("warning", "Order below minimum size",
                                 symbol=symbol, quantity=rounded_quantity)
                        return None
                    elif "insufficient funds" in error_lower:
                        self._log("warning", "Insufficient funds for order",
                                 symbol=symbol, amount=amount_in_usd)
                        return None

        self._log("error", "Buy order failed after max retries",
                 symbol=symbol, retries=max_retries)
        return None

    def place_sell_order(
        self,
        client_order_id: str,
        side: str,
        order_type: str,
        symbol: str,
        asset_quantity: float,
        expected_price: Optional[float] = None,
        avg_cost_basis: Optional[float] = None,
        pnl_pct: Optional[float] = None,
        tag: Optional[str] = None,
    ) -> Any:
        """
        Place a sell order with proper error handling.

        RELIABILITY FIX (Issue #5): Specific exception handling with logging.
        """
        try:
            # Kraken order format
            kraken_symbol = self._convert_to_kraken_symbol(symbol)

            order_data = {
                "pair": kraken_symbol,
                "type": "sell",
                "ordertype": "market",
                "volume": f"{asset_quantity:.8f}",
                "userref": client_order_id[:8],  # Kraken userref is max 32bit int
            }

            response = self.make_api_request("AddOrder", order_data)

            # SECURITY FIX (Issue #3): Validate AddOrder response
            order_id = None
            if response:
                if self._response_validator:
                    order_id = self._response_validator.safe_get_order_id(response)
                elif isinstance(response, dict) and "txid" in response:
                    txid = response.get("txid", [])
                    order_id = txid[0] if isinstance(txid, list) and txid else None

            if order_id:
                # Log successful trade
                if self._logger:
                    self._logger.trade(
                        "SELL", symbol, float(asset_quantity),
                        float(expected_price) if expected_price else 0,
                        order_id=order_id, tag=tag, pnl_pct=pnl_pct
                    )

                self._record_trade(
                    side="sell",
                    symbol=symbol,
                    qty=float(asset_quantity),
                    price=float(expected_price) if expected_price is not None else None,
                    avg_cost_basis=(
                        float(avg_cost_basis) if avg_cost_basis is not None else None
                    ),
                    pnl_pct=float(pnl_pct) if pnl_pct is not None else None,
                    tag=tag,
                    order_id=order_id,
                )
                return response

            # Check for errors in response
            if response and "error" in response:
                error_list = response.get("error", [])

                # RELIABILITY FIX (Issue #5): Parse and log specific errors
                if _RELIABILITY_UTILS_AVAILABLE:
                    try:
                        parsed_error = parse_kraken_error(error_list, symbol, "sell")
                        if parsed_error:
                            self._log("error", f"Sell order error: {type(parsed_error).__name__}",
                                     symbol=symbol, quantity=asset_quantity,
                                     error=str(parsed_error))
                    except Exception:
                        pass

                self._log("error", "Sell order failed",
                         symbol=symbol, quantity=asset_quantity, errors=error_list)
            elif response is None:
                self._log("error", "Sell order returned None (API failure)",
                         symbol=symbol, quantity=asset_quantity)

            return response

        except Exception as e:
            # RELIABILITY FIX (Issue #5): Log the exception with full traceback
            self._log("error", "Exception placing sell order",
                     symbol=symbol, quantity=asset_quantity, error=str(e),
                     traceback=traceback.format_exc())
            return None

    def manage_trades(self):
        trades_made = False  # Flag to track if any trade was made in this iteration

        # Hot-reload coins list + paths from GUI settings while running
        try:
            _refresh_paths_and_symbols()
            self.path_map = dict(base_paths)
        except Exception:
            pass

        # Fetch account details
        account = self.get_account()
        # Fetch holdings
        holdings = self.get_holdings()
        # Fetch trading pairs
        trading_pairs = self.get_trading_pairs()

        # Use the stored cost_basis instead of recalculating
        cost_basis = self.cost_basis
        # Fetch current prices (BTCMarkets uses -AUD pairs)
        symbols = [
            holding["asset_code"] + "-AUD" for holding in holdings.get("results", [])
        ]

        # ALSO fetch prices for tracked coins even if not currently held (so GUI can show bid/ask lines)
        for s in crypto_symbols:
            full = f"{s}-AUD"
            if full not in symbols:
                symbols.append(full)

        current_buy_prices, current_sell_prices, valid_symbols = self.get_price(symbols)

        # Calculate total account value (robust: never drop a held coin to $0 on transient API misses)
        snapshot_ok = True

        # buying power
        try:
            buying_power = float(account.get("buying_power", 0))
        except Exception:
            buying_power = 0.0
            snapshot_ok = False

        # holdings list (treat missing/invalid holdings payload as transient error)
        try:
            holdings_list = (
                holdings.get("results", None) if isinstance(holdings, dict) else None
            )
            if not isinstance(holdings_list, list):
                holdings_list = []
                snapshot_ok = False
        except Exception:
            holdings_list = []
            snapshot_ok = False

        holdings_buy_value = 0.0
        holdings_sell_value = 0.0

        for holding in holdings_list:
            try:
                asset = holding.get("asset_code")
                if asset == "USDC":
                    continue

                qty = float(holding.get("total_quantity", 0.0))
                if qty <= 0.0:
                    continue

                sym = f"{asset}-AUD"
                bp = float(current_buy_prices.get(sym, 0.0) or 0.0)
                sp = float(current_sell_prices.get(sym, 0.0) or 0.0)

                # If any held asset is missing a usable price this tick, do NOT allow a new "low" snapshot
                if bp <= 0.0 or sp <= 0.0:
                    snapshot_ok = False
                    continue

                holdings_buy_value += qty * bp
                holdings_sell_value += qty * sp
            except Exception:
                snapshot_ok = False
                continue

        total_account_value = buying_power + holdings_sell_value
        in_use = (
            (holdings_sell_value / total_account_value) * 100
            if total_account_value > 0
            else 0.0
        )

        # If this tick is incomplete, fall back to last known-good snapshot so the GUI chart never gets a bogus dip.
        if (not snapshot_ok) or (total_account_value <= 0.0):
            last = getattr(self, "_last_good_account_snapshot", None) or {}
            if last.get("total_account_value") is not None:
                total_account_value = float(last["total_account_value"])
                buying_power = float(last.get("buying_power", buying_power or 0.0))
                holdings_sell_value = float(
                    last.get("holdings_sell_value", holdings_sell_value or 0.0)
                )
                holdings_buy_value = float(
                    last.get("holdings_buy_value", holdings_buy_value or 0.0)
                )
                in_use = float(last.get("percent_in_trade", in_use or 0.0))
        else:
            # Save last complete snapshot
            self._last_good_account_snapshot = {
                "total_account_value": float(total_account_value),
                "buying_power": float(buying_power),
                "holdings_sell_value": float(holdings_sell_value),
                "holdings_buy_value": float(holdings_buy_value),
                "percent_in_trade": float(in_use),
            }

        os.system("cls" if os.name == "nt" else "clear")
        print("\n--- Account Summary ---")
        print(f"Total Account Value: ${total_account_value:.2f}")
        print(f"Holdings Value: ${holdings_sell_value:.2f}")
        print(f"Percent In Trade: {in_use:.2f}%")
        print(
            f"Trailing PM: start +{self.pm_start_pct_no_dca:.2f}% (no DCA) / +{self.pm_start_pct_with_dca:.2f}% (with DCA) "
            f"| gap {self.trailing_gap_pct:.2f}%"
        )
        print("\n--- Current Trades ---")

        positions = {}
        for holding in holdings.get("results", []):
            symbol = holding["asset_code"]
            full_symbol = f"{symbol}-AUD"

            # Only show coins that are in our configured trading list
            if symbol not in crypto_symbols:
                continue

            if full_symbol not in valid_symbols or symbol == "USDC":
                continue

            quantity = float(holding["total_quantity"])
            current_buy_price = current_buy_prices.get(full_symbol, 0)
            current_sell_price = current_sell_prices.get(full_symbol, 0)
            avg_cost_basis = cost_basis.get(symbol, 0)

            if avg_cost_basis > 0:
                gain_loss_percentage_buy = (
                    (current_buy_price - avg_cost_basis) / avg_cost_basis
                ) * 100
                gain_loss_percentage_sell = (
                    (current_sell_price - avg_cost_basis) / avg_cost_basis
                ) * 100
            else:
                gain_loss_percentage_buy = 0
                gain_loss_percentage_sell = 0
                print(
                    f"  Warning: Average Cost Basis is 0 for {symbol}, Gain/Loss calculation skipped."
                )

            value = quantity * current_sell_price
            triggered_levels_count = len(self.dca_levels_triggered.get(symbol, []))
            triggered_levels = triggered_levels_count  # Number of DCA levels triggered

            # Determine the next DCA trigger for this coin (hardcoded % and optional neural level)
            next_stage = triggered_levels_count  # stage 0 == first DCA after entry (trade starts at neural level 3)

            # Hardcoded % for this stage (repeat -50% after we reach it)
            hard_next = (
                self.dca_levels[next_stage]
                if next_stage < len(self.dca_levels)
                else self.dca_levels[-1]
            )

            # Neural DCA only applies to first 4 DCA stages:
            # stage 0-> neural 4, stage 1->5, stage 2->6, stage 3->7
            if next_stage < 4:
                neural_next = next_stage + 4
                next_dca_display = f"{hard_next:.2f}% / N{neural_next}"
            else:
                next_dca_display = f"{hard_next:.2f}%"

            # --- DCA DISPLAY LINE (pick whichever trigger line is higher: NEURAL vs HARD) ---
            # Hardcoded gives an actual price line: cost_basis * (1 + hard_next%).
            # Neural is level-based; for display we treat it as "higher" only once its condition is already met.
            dca_line_source = "HARD"
            dca_line_price = 0.0
            dca_line_pct = 0.0

            if avg_cost_basis > 0:
                # Hardcoded trigger line price
                hard_line_price = avg_cost_basis * (1.0 + (hard_next / 100.0))
                dca_line_price = hard_line_price

                # If neural is already satisfied for this stage, then neural is effectively the "higher/earlier" trigger.
                # For display purposes, treat that as an immediate line at current price (i.e., DCA is ready NOW).
                if next_stage < 4:
                    neural_level_needed_disp = next_stage + 4
                    neural_level_now_disp = self._read_long_dca_signal(symbol)

                    neural_ready_now = (gain_loss_percentage_buy < 0) and (
                        neural_level_now_disp >= neural_level_needed_disp
                    )
                    if neural_ready_now:
                        neural_line_price = current_buy_price
                        if neural_line_price > dca_line_price:
                            dca_line_price = neural_line_price
                            dca_line_source = f"NEURAL N{neural_level_needed_disp}"

                # PnL% shown alongside DCA is the normal buy-side PnL%
                # (same calculation as GUI "Buy Price PnL": current buy/ask vs avg cost basis)
                dca_line_pct = gain_loss_percentage_buy

            dca_line_price_disp = (
                self._fmt_price(dca_line_price) if avg_cost_basis > 0 else "N/A"
            )

            # Set color code:
            # - DCA is green if we're above the chosen DCA line, red if we're below it
            # - SELL stays based on profit vs cost basis (your original behavior)
            if dca_line_pct >= 0:
                color = Fore.GREEN
            else:
                color = Fore.RED

            if gain_loss_percentage_sell >= 0:
                color2 = Fore.GREEN
            else:
                color2 = Fore.RED

            # --- Trailing PM display (per-coin, isolated) ---
            # Display uses current state if present; otherwise shows the base PM start line.
            trail_status = "N/A"
            pm_start_pct_disp = 0.0
            base_pm_line_disp = 0.0
            trail_line_disp = 0.0
            trail_peak_disp = 0.0
            above_disp = False
            dist_to_trail_pct = 0.0

            if avg_cost_basis > 0:
                pm_start_pct_disp = (
                    self.pm_start_pct_no_dca
                    if int(triggered_levels) == 0
                    else self.pm_start_pct_with_dca
                )
                base_pm_line_disp = avg_cost_basis * (1.0 + (pm_start_pct_disp / 100.0))

                state = self.trailing_pm.get(symbol)
                if state is None:
                    trail_line_disp = base_pm_line_disp
                    trail_peak_disp = 0.0
                    active_disp = False
                else:
                    trail_line_disp = float(state.get("line", base_pm_line_disp))
                    trail_peak_disp = float(state.get("peak", 0.0))
                    active_disp = bool(state.get("active", False))

                above_disp = current_sell_price >= trail_line_disp
                # If we're already above the line, trailing is effectively "on/armed" (even if active flips this tick)
                trail_status = "ON" if (active_disp or above_disp) else "OFF"

                if trail_line_disp > 0:
                    dist_to_trail_pct = (
                        (current_sell_price - trail_line_disp) / trail_line_disp
                    ) * 100.0

            # PERFORMANCE FIX (Issue #3): Use cached price file writes
            # Previously: File written every iteration (slow on Windows NTFS)
            # Now: Batched writes with change threshold
            if _PERF_UTILS_AVAILABLE:
                price_cache = get_price_cache()
                price_cache.set_price(symbol, current_buy_price)
            else:
                # Fallback to original file writing
                file = open(symbol + "_current_price.txt", "w+")
                file.write(str(current_buy_price))
                file.close()

            positions[symbol] = {
                "quantity": quantity,
                "avg_cost_basis": avg_cost_basis,
                "current_buy_price": current_buy_price,
                "current_sell_price": current_sell_price,
                "gain_loss_pct_buy": gain_loss_percentage_buy,
                "gain_loss_pct_sell": gain_loss_percentage_sell,
                "value_usd": value,
                "dca_triggered_stages": int(triggered_levels_count),
                "next_dca_display": next_dca_display,
                "dca_line_price": float(dca_line_price) if dca_line_price else 0.0,
                "dca_line_source": dca_line_source,
                "dca_line_pct": float(dca_line_pct) if dca_line_pct else 0.0,
                "trail_active": True if (trail_status == "ON") else False,
                "trail_line": float(trail_line_disp) if trail_line_disp else 0.0,
                "trail_peak": float(trail_peak_disp) if trail_peak_disp else 0.0,
                "dist_to_trail_pct": (
                    float(dist_to_trail_pct) if dist_to_trail_pct else 0.0
                ),
            }

            print(
                f"\nSymbol: {symbol}"
                f"  |  DCA: {color}{dca_line_pct:+.2f}%{Style.RESET_ALL} @ {self._fmt_price(current_buy_price)} (Line: {dca_line_price_disp} {dca_line_source} | Next: {next_dca_display})"
                f"  |  Gain/Loss SELL: {color2}{gain_loss_percentage_sell:.2f}%{Style.RESET_ALL} @ {self._fmt_price(current_sell_price)}"
                f"  |  DCA Levels Triggered: {triggered_levels}"
                f"  |  Trade Value: ${value:.2f}"
            )

            if avg_cost_basis > 0:
                print(
                    f"  Trailing Profit Margin"
                    f"  |  Line: {self._fmt_price(trail_line_disp)}"
                    f"  |  Above: {above_disp}"
                )
            else:
                print("  PM/Trail: N/A (avg_cost_basis is 0)")

            # --- Trailing profit margin (0.5% trail gap) ---
            # PM "start line" is the normal 5% / 2.5% line (depending on DCA levels hit).
            # Trailing activates once price is ABOVE the PM start line, then line follows peaks up
            # by 0.5%. Forced sell happens ONLY when price goes from ABOVE the trailing line to BELOW it.
            if avg_cost_basis > 0:
                pm_start_pct = (
                    self.pm_start_pct_no_dca
                    if int(triggered_levels) == 0
                    else self.pm_start_pct_with_dca
                )
                base_pm_line = avg_cost_basis * (1.0 + (pm_start_pct / 100.0))
                trail_gap = self.trailing_gap_pct / 100.0  # 0.5% => 0.005

                state = self.trailing_pm.get(symbol)
                if state is None:
                    state = {
                        "active": False,
                        "line": base_pm_line,
                        "peak": 0.0,
                        "was_above": False,
                    }
                    self.trailing_pm[symbol] = state
                else:
                    # Never let the line be below the (possibly updated) base PM start line
                    if state.get("line", 0.0) < base_pm_line:
                        state["line"] = base_pm_line

                # Use SELL price because that's what you actually get when you market sell
                above_now = current_sell_price >= state["line"]

                # Activate trailing once we first get above the base PM line
                if (not state["active"]) and above_now:
                    state["active"] = True
                    state["peak"] = current_sell_price

                # If active, update peak and move trailing line up behind it
                if state["active"]:
                    if current_sell_price > state["peak"]:
                        state["peak"] = current_sell_price

                    new_line = state["peak"] * (1.0 - trail_gap)
                    if new_line < base_pm_line:
                        new_line = base_pm_line
                    if new_line > state["line"]:
                        state["line"] = new_line

                    # Forced sell on cross from ABOVE -> BELOW trailing line
                    if state["was_above"] and (current_sell_price < state["line"]):
                        print(
                            f"  Trailing PM hit for {symbol}. "
                            f"Sell price {current_sell_price:.8f} fell below trailing line {state['line']:.8f}."
                        )
                        response = self.place_sell_order(
                            str(uuid.uuid4()),
                            "sell",
                            "market",
                            full_symbol,
                            quantity,
                            expected_price=current_sell_price,
                            avg_cost_basis=avg_cost_basis,
                            pnl_pct=gain_loss_percentage_sell,
                            tag="TRAIL_SELL",
                        )

                        trades_made = True
                        self.trailing_pm.pop(
                            symbol, None
                        )  # clear per-coin trailing state on exit

                        # Trade ended -> reset rolling 24h DCA window for this coin
                        self._reset_dca_window_for_trade(symbol, sold=True)

                        print(f"  Successfully sold {quantity} {symbol}.")
                        time.sleep(5)
                        holdings = self.get_holdings()
                        continue

                # Save this tick’s position relative to the line (needed for “above -> below” detection)
                state["was_above"] = above_now

            # DCA (NEURAL or hardcoded %, whichever hits first for the current stage)
            # Trade starts at neural level 3 => trader is at stage 0.
            # Neural-driven DCA stages (max 4):
            #   stage 0 => neural 4 OR -2.5%
            #   stage 1 => neural 5 OR -5.0%
            #   stage 2 => neural 6 OR -10.0%
            #   stage 3 => neural 7 OR -20.0%
            # After that: hardcoded only (-30, -40, -50, then repeat -50 forever).
            current_stage = len(self.dca_levels_triggered.get(symbol, []))

            # Hardcoded loss % for this stage (repeat last level after list ends)
            hard_level = (
                self.dca_levels[current_stage]
                if current_stage < len(self.dca_levels)
                else self.dca_levels[-1]
            )
            hard_hit = gain_loss_percentage_buy <= hard_level

            # Neural trigger only for first 4 DCA stages
            neural_level_needed = None
            neural_level_now = None
            neural_hit = False
            if current_stage < 4:
                neural_level_needed = current_stage + 4
                neural_level_now = self._read_long_dca_signal(symbol)

                # Keep it sane: don't DCA from neural if we're not even below cost basis.
                neural_hit = (gain_loss_percentage_buy < 0) and (
                    neural_level_now >= neural_level_needed
                )

            if hard_hit or neural_hit:
                if neural_hit and hard_hit:
                    reason = f"NEURAL L{neural_level_now}>=L{neural_level_needed} OR HARD {hard_level:.2f}%"
                elif neural_hit:
                    reason = f"NEURAL L{neural_level_now}>=L{neural_level_needed}"
                else:
                    reason = f"HARD {hard_level:.2f}%"

                print(f"  DCAing {symbol} (stage {current_stage + 1}) via {reason}.")

                print(f"  Current Value: ${value:.2f}")
                dca_amount = value * 2
                print(f"  DCA Amount: ${dca_amount:.2f}")
                print(f"  Buying Power: ${buying_power:.2f}")

                recent_dca = self._dca_window_count(symbol)
                if recent_dca >= int(getattr(self, "max_dca_buys_per_24h", 2)):
                    print(
                        f"  Skipping DCA for {symbol}. "
                        f"Already placed {recent_dca} DCA buys in the last 24h (max {self.max_dca_buys_per_24h})."
                    )

                elif dca_amount <= buying_power:
                    response = self.place_buy_order(
                        str(uuid.uuid4()),
                        "buy",
                        "market",
                        full_symbol,
                        dca_amount,
                        avg_cost_basis=avg_cost_basis,
                        pnl_pct=gain_loss_percentage_buy,
                        tag="DCA",
                    )

                    print(f"  Buy Response: {response}")
                    if response and "errors" not in response:
                        # record that we completed THIS stage (no matter what triggered it)
                        self.dca_levels_triggered.setdefault(symbol, []).append(
                            current_stage
                        )

                        # Only record a DCA buy timestamp on success (so skips never advance anything)
                        self._note_dca_buy(symbol)

                        trades_made = True
                        print(f"  Successfully placed DCA buy order for {symbol}.")
                    else:
                        print(f"  Failed to place DCA buy order for {symbol}.")
                else:
                    print(f"  Skipping DCA for {symbol}. Not enough funds.")

            else:
                pass

        # --- ensure GUI gets bid/ask lines even for coins not currently held ---
        try:
            for sym in crypto_symbols:
                if sym in positions:
                    continue

                full_symbol = f"{sym}-AUD"
                if full_symbol not in valid_symbols or sym == "USDC":
                    continue

                current_buy_price = current_buy_prices.get(full_symbol, 0.0)
                current_sell_price = current_sell_prices.get(full_symbol, 0.0)

                # keep the per-coin current price file behavior for consistency
                try:
                    file = open(sym + "_current_price.txt", "w+")
                    file.write(str(current_buy_price))
                    file.close()
                except Exception:
                    pass

                positions[sym] = {
                    "quantity": 0.0,
                    "avg_cost_basis": 0.0,
                    "current_buy_price": current_buy_price,
                    "current_sell_price": current_sell_price,
                    "gain_loss_pct_buy": 0.0,
                    "gain_loss_pct_sell": 0.0,
                    "value_usd": 0.0,
                    "dca_triggered_stages": int(
                        len(self.dca_levels_triggered.get(sym, []))
                    ),
                    "next_dca_display": "",
                    "dca_line_price": 0.0,
                    "dca_line_source": "N/A",
                    "dca_line_pct": 0.0,
                    "trail_active": False,
                    "trail_line": 0.0,
                    "trail_peak": 0.0,
                    "dist_to_trail_pct": 0.0,
                }
        except Exception:
            pass

        if not trading_pairs:
            return

        allocation_in_usd = total_account_value * (0.00005 / len(crypto_symbols))
        if allocation_in_usd < 0.5:
            allocation_in_usd = 0.5

        holding_full_symbols = [
            f"{h['asset_code']}-AUD" for h in holdings.get("results", [])
        ]

        start_index = 0
        while start_index < len(crypto_symbols):
            base_symbol = crypto_symbols[start_index].upper().strip()
            full_symbol = f"{base_symbol}-AUD"

            # Skip if already held
            if full_symbol in holding_full_symbols:
                start_index += 1
                continue

            # Neural signals are used as a "permission to start" gate.
            buy_count = self._read_long_dca_signal(base_symbol)
            sell_count = self._read_short_dca_signal(base_symbol)

            # Default behavior: long must be >= 3 and short must be 0
            if not (buy_count >= 3 and sell_count == 0):
                start_index += 1
                continue

            response = self.place_buy_order(
                str(uuid.uuid4()),
                "buy",
                "market",
                full_symbol,
                allocation_in_usd,
            )

            if response and "errors" not in response:
                trades_made = True
                # Do NOT pre-trigger any DCA levels. Hardcoded DCA will mark levels only when it hits your loss thresholds.
                self.dca_levels_triggered[base_symbol] = []

                # Fresh trade -> clear any rolling 24h DCA window for this coin
                self._reset_dca_window_for_trade(base_symbol, sold=False)

                # Reset trailing PM state for this coin (fresh trade, fresh trailing logic)
                self.trailing_pm.pop(base_symbol, None)

                print(
                    f"Starting new trade for {full_symbol} (AI start signal long={buy_count}, short={sell_count}). "
                    f"Allocating ${allocation_in_usd:.2f}."
                )
                time.sleep(5)
                holdings = self.get_holdings()
                holding_full_symbols = [
                    f"{h['asset_code']}-AUD" for h in holdings.get("results", [])
                ]

            start_index += 1

        # If any trades were made, recalculate the cost basis
        if trades_made:
            time.sleep(5)
            print("Trades were made in this iteration. Recalculating cost basis...")
            new_cost_basis = self.calculate_cost_basis()
            if new_cost_basis:
                self.cost_basis = new_cost_basis
                print("Cost basis recalculated successfully.")
            else:
                print("Failed to recalculcate cost basis.")
            self.initialize_dca_levels()

        # --- GUI HUB STATUS WRITE ---
        try:
            status = {
                "timestamp": time.time(),
                "account": {
                    "total_account_value": total_account_value,
                    "buying_power": buying_power,
                    "holdings_sell_value": holdings_sell_value,
                    "holdings_buy_value": holdings_buy_value,
                    "percent_in_trade": in_use,
                    # trailing PM config (matches what's printed above current trades)
                    "pm_start_pct_no_dca": float(
                        getattr(self, "pm_start_pct_no_dca", 0.0)
                    ),
                    "pm_start_pct_with_dca": float(
                        getattr(self, "pm_start_pct_with_dca", 0.0)
                    ),
                    "trailing_gap_pct": float(getattr(self, "trailing_gap_pct", 0.0)),
                },
                "positions": positions,
            }
            # Build per-holding values in AUD for chart history
            holdings_aud = {}
            for sym, pos in positions.items():
                value_aud = pos.get("value_usd", 0)  # Actually AUD since we use -AUD pairs
                if value_aud > 0:
                    holdings_aud[sym] = value_aud

            self._append_jsonl(
                ACCOUNT_VALUE_HISTORY_PATH,
                {
                    "ts": status["timestamp"],
                    "total_account_value": total_account_value,
                    "holdings": holdings_aud,
                },
            )
            self._write_trader_status(status)
        except Exception:
            pass

    def run(self):
        while True:
            try:
                self.manage_trades()
                time.sleep(0.5)
            except Exception as e:
                print(traceback.format_exc())


if __name__ == "__main__":
    trading_bot = CryptoAPITrading()
    trading_bot.run()
