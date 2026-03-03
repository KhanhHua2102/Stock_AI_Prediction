"""
Performance & Reliability Utilities for PowerTrader
====================================================
Addresses performance issues identified in SECURITY_AND_PERFORMANCE_ANALYSIS.md:
- Issue 2: Memory caching for training data
- Issue 3: File I/O caching for price files
- Issue 4: SQLite database for trade/account history
- Issue 5: Async HTTP client wrapper

Addresses reliability issues:
- Reliability Issue 1: Circuit breaker for Kraken API failures
- Reliability Issue 2: Proper logging system with file rotation
- Reliability Issue 5: Specific error handling for order placement

Addresses security issues:
- Security Issue 3: Schema validation for Kraken API responses (pydantic)

Created: 2026-01-30
Updated: 2026-01-31 - Added reliability utilities, schema validation
"""

import os
import json
import time
import sqlite3
import threading
import logging
import logging.handlers
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable, Tuple, Union
from pathlib import Path
from contextlib import contextmanager
from enum import Enum
from dataclasses import dataclass, field
import hashlib
import traceback

# Pydantic for API response validation
try:
    from pydantic import BaseModel, Field, field_validator, ValidationError
    _PYDANTIC_AVAILABLE = True
except ImportError:
    _PYDANTIC_AVAILABLE = False
    BaseModel = None
    ValidationError = None


# =============================================================================
# Security Issue 3: Kraken API Response Schema Validation
# =============================================================================

if _PYDANTIC_AVAILABLE:

    class KrakenBalanceResponse(BaseModel):
        """Schema for Kraken Balance API response.

        Expected format: {"ZAUD": "1000.00", "XXBT": "0.5", ...}
        All values are string representations of floats.
        """
        balances: Dict[str, str] = Field(default_factory=dict)

        @field_validator('balances', mode='before')
        @classmethod
        def validate_balances(cls, v):
            if v is None:
                return {}
            if not isinstance(v, dict):
                raise ValueError(f"Expected dict, got {type(v).__name__}")
            # Validate each value is a valid number string
            validated = {}
            for key, value in v.items():
                if not isinstance(key, str):
                    raise ValueError(f"Balance key must be string, got {type(key).__name__}")
                try:
                    # Validate it's a valid number
                    float(value)
                    validated[key] = str(value)
                except (ValueError, TypeError):
                    raise ValueError(f"Balance value for {key} must be numeric, got: {value}")
            return validated

        @classmethod
        def from_api_response(cls, response: Any) -> 'KrakenBalanceResponse':
            """Create from raw API response (which is just the dict directly)."""
            if response is None:
                return cls(balances={})
            if isinstance(response, dict):
                return cls(balances=response)
            raise ValueError(f"Unexpected response type: {type(response).__name__}")


    class KrakenTradeInfo(BaseModel):
        """Schema for individual trade in TradesHistory response."""
        pair: str
        type: str  # "buy" or "sell"
        price: str
        vol: str  # volume
        cost: str
        time: float
        ordertype: Optional[str] = None
        fee: Optional[str] = None
        misc: Optional[str] = None

        @field_validator('type')
        @classmethod
        def validate_type(cls, v):
            if v not in ('buy', 'sell'):
                raise ValueError(f"Trade type must be 'buy' or 'sell', got: {v}")
            return v

        @field_validator('price', 'vol', 'cost')
        @classmethod
        def validate_numeric_string(cls, v):
            try:
                float(v)
                return v
            except (ValueError, TypeError):
                raise ValueError(f"Expected numeric string, got: {v}")

        def get_price_float(self) -> float:
            return float(self.price)

        def get_volume_float(self) -> float:
            return float(self.vol)

        def get_cost_float(self) -> float:
            return float(self.cost)


    class KrakenTradesHistoryResponse(BaseModel):
        """Schema for Kraken TradesHistory API response."""
        trades: Dict[str, KrakenTradeInfo] = Field(default_factory=dict)
        count: Optional[int] = None

        @classmethod
        def from_api_response(cls, response: Any) -> 'KrakenTradesHistoryResponse':
            """Create from raw API response."""
            if response is None:
                return cls(trades={})
            if isinstance(response, dict):
                trades_data = response.get('trades', {})
                count = response.get('count')
                # Convert each trade to KrakenTradeInfo
                validated_trades = {}
                for trade_id, trade_info in trades_data.items():
                    if isinstance(trade_info, dict):
                        validated_trades[trade_id] = KrakenTradeInfo(**trade_info)
                return cls(trades=validated_trades, count=count)
            raise ValueError(f"Unexpected response type: {type(response).__name__}")


    class KrakenOrderDescription(BaseModel):
        """Schema for order description in AddOrder response."""
        pair: Optional[str] = None
        type: Optional[str] = None
        ordertype: Optional[str] = None
        price: Optional[str] = None
        order: Optional[str] = None
        close: Optional[str] = None


    class KrakenAddOrderResponse(BaseModel):
        """Schema for Kraken AddOrder API response."""
        txid: List[str] = Field(default_factory=list)
        descr: Optional[KrakenOrderDescription] = None

        @field_validator('txid', mode='before')
        @classmethod
        def validate_txid(cls, v):
            if v is None:
                return []
            if isinstance(v, list):
                return [str(x) for x in v]
            if isinstance(v, str):
                return [v]
            raise ValueError(f"txid must be list or string, got: {type(v).__name__}")

        @classmethod
        def from_api_response(cls, response: Any) -> 'KrakenAddOrderResponse':
            """Create from raw API response."""
            if response is None:
                return cls(txid=[])
            if isinstance(response, dict):
                txid = response.get('txid', [])
                descr_data = response.get('descr')
                descr = KrakenOrderDescription(**descr_data) if descr_data else None
                return cls(txid=txid if isinstance(txid, list) else [txid], descr=descr)
            raise ValueError(f"Unexpected response type: {type(response).__name__}")

        def get_order_id(self) -> Optional[str]:
            """Get the first transaction ID if available."""
            return self.txid[0] if self.txid else None


    class KrakenOpenOrder(BaseModel):
        """Schema for individual open order."""
        status: str
        opentm: float  # open time
        vol: str  # volume
        vol_exec: str  # executed volume
        descr: KrakenOrderDescription
        cost: Optional[str] = None
        fee: Optional[str] = None
        price: Optional[str] = None
        misc: Optional[str] = None


    class KrakenOpenOrdersResponse(BaseModel):
        """Schema for Kraken OpenOrders API response."""
        open: Dict[str, KrakenOpenOrder] = Field(default_factory=dict)

        @classmethod
        def from_api_response(cls, response: Any) -> 'KrakenOpenOrdersResponse':
            """Create from raw API response."""
            if response is None:
                return cls(open={})
            if isinstance(response, dict):
                open_orders = response.get('open', {})
                validated_orders = {}
                for order_id, order_info in open_orders.items():
                    if isinstance(order_info, dict):
                        validated_orders[order_id] = KrakenOpenOrder(**order_info)
                return cls(open=validated_orders)
            raise ValueError(f"Unexpected response type: {type(response).__name__}")


class KrakenResponseValidator:
    """
    Validates Kraken API responses against expected schemas.

    SECURITY FIX (Issue #3):
    - Previously: No validation, trusting raw API responses
    - Now: Schema validation with pydantic, type checking, safe defaults

    Usage:
        validator = KrakenResponseValidator()

        # Validate balance response
        result = validator.validate_balance(api_response)
        if result.is_valid:
            balances = result.data.balances
        else:
            logger.error(f"Invalid response: {result.error}")

        # Or use safe extraction with defaults
        balances = validator.safe_get_balances(api_response)
    """

    def __init__(self, logger: Optional['TradingLogger'] = None):
        self.logger = logger
        self._pydantic_available = _PYDANTIC_AVAILABLE

    def _log_validation_error(self, endpoint: str, error: str, response: Any):
        """Log validation errors."""
        if self.logger:
            self.logger.warning(
                f"Kraken {endpoint} response validation failed",
                error=error,
                response_type=type(response).__name__
            )

    def validate_balance(self, response: Any) -> 'ValidationResult':
        """Validate Balance API response."""
        if not self._pydantic_available:
            # Fallback: basic type check
            if response is None:
                return ValidationResult(is_valid=True, data={'balances': {}})
            if isinstance(response, dict):
                return ValidationResult(is_valid=True, data={'balances': response})
            return ValidationResult(
                is_valid=False,
                error=f"Expected dict, got {type(response).__name__}"
            )

        try:
            validated = KrakenBalanceResponse.from_api_response(response)
            return ValidationResult(is_valid=True, data=validated)
        except (ValidationError, ValueError) as e:
            self._log_validation_error("Balance", str(e), response)
            return ValidationResult(is_valid=False, error=str(e))

    def validate_trades_history(self, response: Any) -> 'ValidationResult':
        """Validate TradesHistory API response."""
        if not self._pydantic_available:
            if response is None:
                return ValidationResult(is_valid=True, data={'trades': {}})
            if isinstance(response, dict):
                return ValidationResult(is_valid=True, data=response)
            return ValidationResult(
                is_valid=False,
                error=f"Expected dict, got {type(response).__name__}"
            )

        try:
            validated = KrakenTradesHistoryResponse.from_api_response(response)
            return ValidationResult(is_valid=True, data=validated)
        except (ValidationError, ValueError) as e:
            self._log_validation_error("TradesHistory", str(e), response)
            return ValidationResult(is_valid=False, error=str(e))

    def validate_add_order(self, response: Any) -> 'ValidationResult':
        """Validate AddOrder API response."""
        if not self._pydantic_available:
            if response is None:
                return ValidationResult(is_valid=True, data={'txid': []})
            if isinstance(response, dict):
                return ValidationResult(is_valid=True, data=response)
            return ValidationResult(
                is_valid=False,
                error=f"Expected dict, got {type(response).__name__}"
            )

        try:
            validated = KrakenAddOrderResponse.from_api_response(response)
            return ValidationResult(is_valid=True, data=validated)
        except (ValidationError, ValueError) as e:
            self._log_validation_error("AddOrder", str(e), response)
            return ValidationResult(is_valid=False, error=str(e))

    def validate_open_orders(self, response: Any) -> 'ValidationResult':
        """Validate OpenOrders API response."""
        if not self._pydantic_available:
            if response is None:
                return ValidationResult(is_valid=True, data={'open': {}})
            if isinstance(response, dict):
                return ValidationResult(is_valid=True, data=response)
            return ValidationResult(
                is_valid=False,
                error=f"Expected dict, got {type(response).__name__}"
            )

        try:
            validated = KrakenOpenOrdersResponse.from_api_response(response)
            return ValidationResult(is_valid=True, data=validated)
        except (ValidationError, ValueError) as e:
            self._log_validation_error("OpenOrders", str(e), response)
            return ValidationResult(is_valid=False, error=str(e))

    # Safe extraction methods with defaults

    def safe_get_balances(self, response: Any) -> Dict[str, float]:
        """Safely extract balances as float dict with validation."""
        result = self.validate_balance(response)
        if not result.is_valid:
            return {}

        if self._pydantic_available and hasattr(result.data, 'balances'):
            return {k: float(v) for k, v in result.data.balances.items()}

        # Fallback for non-pydantic
        if isinstance(result.data, dict):
            balances = result.data.get('balances', result.data)
            try:
                return {k: float(v) for k, v in balances.items()}
            except (ValueError, TypeError, AttributeError):
                return {}
        return {}

    def safe_get_trades(self, response: Any) -> Dict[str, Dict[str, Any]]:
        """Safely extract trades dict with validation."""
        result = self.validate_trades_history(response)
        if not result.is_valid:
            return {}

        if self._pydantic_available and hasattr(result.data, 'trades'):
            return {
                tid: {
                    'pair': t.pair,
                    'type': t.type,
                    'price': t.get_price_float(),
                    'vol': t.get_volume_float(),
                    'cost': t.get_cost_float(),
                    'time': t.time
                }
                for tid, t in result.data.trades.items()
            }

        # Fallback
        if isinstance(result.data, dict):
            return result.data.get('trades', {})
        return {}

    def safe_get_order_id(self, response: Any) -> Optional[str]:
        """Safely extract order ID from AddOrder response."""
        result = self.validate_add_order(response)
        if not result.is_valid:
            return None

        if self._pydantic_available and hasattr(result.data, 'get_order_id'):
            return result.data.get_order_id()

        # Fallback
        if isinstance(result.data, dict):
            txid = result.data.get('txid', [])
            if isinstance(txid, list) and txid:
                return txid[0]
            if isinstance(txid, str):
                return txid
        return None


@dataclass
class ValidationResult:
    """Result of schema validation."""
    is_valid: bool
    data: Any = None
    error: Optional[str] = None


def get_response_validator(logger: Optional['TradingLogger'] = None) -> KrakenResponseValidator:
    """Get a Kraken response validator instance."""
    return KrakenResponseValidator(logger=logger)


# =============================================================================
# Reliability Issue 2: Logging System with File Rotation
# =============================================================================

class TradingLogger:
    """
    Proper logging system with rotating file handlers.

    RELIABILITY FIX (Issue #2):
    - Previously: print() statements everywhere, lost on restart
    - Now: Structured logging with file rotation and persistence

    Usage:
        logger = get_trading_logger()
        logger.info("Trade executed", symbol="BTC", amount=100)
        logger.error("API failure", error=str(e), endpoint="Balance")
        logger.trade("BUY", symbol="BTC", qty=0.01, price=50000)
    """

    LEVELS = {
        'DEBUG': logging.DEBUG,
        'INFO': logging.INFO,
        'WARNING': logging.WARNING,
        'ERROR': logging.ERROR,
        'CRITICAL': logging.CRITICAL,
    }

    def __init__(
        self,
        name: str = "powertrader",
        log_dir: str = None,
        level: str = "INFO",
        max_bytes: int = 10 * 1024 * 1024,  # 10 MB
        backup_count: int = 5,
        console_output: bool = True,
    ):
        """
        Initialize trading logger.

        Args:
            name: Logger name
            log_dir: Directory for log files (default: data/logs)
            level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
            max_bytes: Max size per log file before rotation
            backup_count: Number of backup files to keep
            console_output: Also output to console
        """
        self.name = name
        self.log_dir = log_dir or self._default_log_dir()
        os.makedirs(self.log_dir, exist_ok=True)

        self._logger = logging.getLogger(name)
        self._logger.setLevel(self.LEVELS.get(level.upper(), logging.INFO))

        # Avoid duplicate handlers if logger already configured
        if not self._logger.handlers:
            self._setup_handlers(max_bytes, backup_count, console_output)

        # Separate logger for trades (audit trail)
        self._trade_logger = logging.getLogger(f"{name}.trades")
        self._trade_logger.setLevel(logging.INFO)
        if not self._trade_logger.handlers:
            self._setup_trade_handler(max_bytes, backup_count)

        # Separate logger for API errors
        self._api_logger = logging.getLogger(f"{name}.api")
        self._api_logger.setLevel(logging.WARNING)
        if not self._api_logger.handlers:
            self._setup_api_handler(max_bytes, backup_count)

    def _default_log_dir(self) -> str:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(os.path.dirname(base_dir), "data", "logs")

    def _setup_handlers(self, max_bytes: int, backup_count: int, console_output: bool):
        """Set up file and console handlers for main logger."""
        formatter = logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )

        # Rotating file handler
        file_handler = logging.handlers.RotatingFileHandler(
            os.path.join(self.log_dir, f"{self.name}.log"),
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding='utf-8'
        )
        file_handler.setFormatter(formatter)
        self._logger.addHandler(file_handler)

        # Console handler
        if console_output:
            console_handler = logging.StreamHandler()
            console_handler.setFormatter(formatter)
            self._logger.addHandler(console_handler)

    def _setup_trade_handler(self, max_bytes: int, backup_count: int):
        """Set up dedicated trade log file."""
        formatter = logging.Formatter(
            '%(asctime)s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        handler = logging.handlers.RotatingFileHandler(
            os.path.join(self.log_dir, "trades.log"),
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding='utf-8'
        )
        handler.setFormatter(formatter)
        self._trade_logger.addHandler(handler)

    def _setup_api_handler(self, max_bytes: int, backup_count: int):
        """Set up dedicated API error log file."""
        formatter = logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        handler = logging.handlers.RotatingFileHandler(
            os.path.join(self.log_dir, "api_errors.log"),
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding='utf-8'
        )
        handler.setFormatter(formatter)
        self._api_logger.addHandler(handler)

    def _format_kwargs(self, kwargs: Dict[str, Any]) -> str:
        """Format keyword arguments as key=value pairs."""
        if not kwargs:
            return ""
        parts = [f"{k}={v}" for k, v in kwargs.items()]
        return " | " + " | ".join(parts)

    def debug(self, message: str, **kwargs):
        """Log debug message."""
        self._logger.debug(message + self._format_kwargs(kwargs))

    def info(self, message: str, **kwargs):
        """Log info message."""
        self._logger.info(message + self._format_kwargs(kwargs))

    def warning(self, message: str, **kwargs):
        """Log warning message."""
        self._logger.warning(message + self._format_kwargs(kwargs))

    def error(self, message: str, **kwargs):
        """Log error message."""
        self._logger.error(message + self._format_kwargs(kwargs))

    def critical(self, message: str, **kwargs):
        """Log critical message."""
        self._logger.critical(message + self._format_kwargs(kwargs))

    def exception(self, message: str, exc_info: bool = True, **kwargs):
        """Log exception with traceback."""
        self._logger.exception(message + self._format_kwargs(kwargs), exc_info=exc_info)

    def trade(self, side: str, symbol: str, qty: float, price: float, **kwargs):
        """
        Log a trade to the dedicated trades log.

        Args:
            side: BUY or SELL
            symbol: Trading pair (e.g., BTC-AUD)
            qty: Quantity traded
            price: Execution price
            **kwargs: Additional info (order_id, pnl_pct, etc.)
        """
        msg = f"{side.upper()} | {symbol} | qty={qty:.8f} | price={price:.2f}"
        if kwargs:
            msg += self._format_kwargs(kwargs)
        self._trade_logger.info(msg)
        # Also log to main logger at INFO level
        self._logger.info(f"TRADE: {msg}")

    def api_error(self, endpoint: str, error: str, attempt: int = 1, **kwargs):
        """
        Log API error to dedicated API log.

        Args:
            endpoint: API endpoint that failed
            error: Error message
            attempt: Attempt number (for retries)
            **kwargs: Additional context
        """
        msg = f"ENDPOINT={endpoint} | ERROR={error} | ATTEMPT={attempt}"
        if kwargs:
            msg += self._format_kwargs(kwargs)
        self._api_logger.warning(msg)
        self._logger.warning(f"API ERROR: {msg}")

    def api_critical(self, endpoint: str, error: str, **kwargs):
        """Log critical API failure (circuit breaker triggered, etc.)."""
        msg = f"CRITICAL API FAILURE | ENDPOINT={endpoint} | ERROR={error}"
        if kwargs:
            msg += self._format_kwargs(kwargs)
        self._api_logger.critical(msg)
        self._logger.critical(f"API CRITICAL: {msg}")

    def get_log_path(self) -> str:
        """Get path to main log file."""
        return os.path.join(self.log_dir, f"{self.name}.log")

    def get_trade_log_path(self) -> str:
        """Get path to trades log file."""
        return os.path.join(self.log_dir, "trades.log")


# =============================================================================
# Reliability Issue 1: Circuit Breaker for API Failures
# =============================================================================

class CircuitState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, rejecting requests
    HALF_OPEN = "half_open"  # Testing if service recovered


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker."""
    failure_threshold: int = 5      # Failures before opening circuit
    recovery_timeout: float = 60.0  # Seconds before trying half-open
    half_open_max_calls: int = 3    # Max calls in half-open before deciding
    success_threshold: int = 2      # Successes in half-open to close circuit


@dataclass
class CircuitBreakerStats:
    """Statistics for circuit breaker."""
    state: CircuitState = CircuitState.CLOSED
    failures: int = 0
    successes: int = 0
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    times_opened: int = 0
    total_failures: int = 0
    total_successes: int = 0


class CircuitBreaker:
    """
    Circuit breaker for Kraken API calls.

    RELIABILITY FIX (Issue #1):
    - Previously: Retries with no backoff, silent failures
    - Now: Circuit breaker pattern with failure notifications

    States:
    - CLOSED: Normal operation, requests pass through
    - OPEN: Too many failures, reject requests immediately
    - HALF_OPEN: Testing recovery, limited requests allowed

    Usage:
        breaker = CircuitBreaker("kraken_api")

        # Wrap API calls
        result = breaker.call(api_function, arg1, arg2)

        # Or use decorator style
        if breaker.can_execute():
            try:
                result = api_function()
                breaker.record_success()
            except Exception as e:
                breaker.record_failure(e)
    """

    def __init__(
        self,
        name: str,
        config: CircuitBreakerConfig = None,
        logger: TradingLogger = None,
        on_state_change: Callable[[str, CircuitState, CircuitState], None] = None,
    ):
        """
        Initialize circuit breaker.

        Args:
            name: Identifier for this circuit breaker
            config: Configuration settings
            logger: Logger instance for notifications
            on_state_change: Callback when state changes (name, old_state, new_state)
        """
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self.logger = logger
        self.on_state_change = on_state_change

        self._stats = CircuitBreakerStats()
        self._lock = threading.Lock()
        self._half_open_calls = 0

    @property
    def state(self) -> CircuitState:
        """Get current circuit state."""
        return self._stats.state

    @property
    def stats(self) -> Dict[str, Any]:
        """Get circuit breaker statistics."""
        with self._lock:
            return {
                'name': self.name,
                'state': self._stats.state.value,
                'failures': self._stats.failures,
                'successes': self._stats.successes,
                'last_failure_time': self._stats.last_failure_time,
                'last_success_time': self._stats.last_success_time,
                'times_opened': self._stats.times_opened,
                'total_failures': self._stats.total_failures,
                'total_successes': self._stats.total_successes,
            }

    def _transition_to(self, new_state: CircuitState):
        """Transition to new state with logging and callbacks."""
        old_state = self._stats.state
        if old_state == new_state:
            return

        self._stats.state = new_state

        if new_state == CircuitState.OPEN:
            self._stats.times_opened += 1
            self._half_open_calls = 0
            if self.logger:
                self.logger.api_critical(
                    self.name,
                    f"Circuit OPENED after {self._stats.failures} failures",
                    times_opened=self._stats.times_opened
                )
        elif new_state == CircuitState.HALF_OPEN:
            self._half_open_calls = 0
            if self.logger:
                self.logger.warning(
                    f"Circuit {self.name} entering HALF_OPEN state",
                    recovery_timeout=self.config.recovery_timeout
                )
        elif new_state == CircuitState.CLOSED:
            self._stats.failures = 0
            self._stats.successes = 0
            if self.logger:
                self.logger.info(f"Circuit {self.name} CLOSED (recovered)")

        if self.on_state_change:
            try:
                self.on_state_change(self.name, old_state, new_state)
            except Exception:
                pass  # Don't let callback errors affect circuit

    def can_execute(self) -> bool:
        """
        Check if a request can be executed.

        Returns:
            True if request should proceed, False if circuit is open
        """
        with self._lock:
            if self._stats.state == CircuitState.CLOSED:
                return True

            if self._stats.state == CircuitState.OPEN:
                # Check if recovery timeout has elapsed
                if self._stats.last_failure_time:
                    elapsed = time.time() - self._stats.last_failure_time
                    if elapsed >= self.config.recovery_timeout:
                        self._transition_to(CircuitState.HALF_OPEN)
                        return True
                return False

            if self._stats.state == CircuitState.HALF_OPEN:
                # Allow limited calls in half-open state
                if self._half_open_calls < self.config.half_open_max_calls:
                    self._half_open_calls += 1
                    return True
                return False

            return False

    def record_success(self):
        """Record a successful API call."""
        with self._lock:
            self._stats.successes += 1
            self._stats.total_successes += 1
            self._stats.last_success_time = time.time()

            if self._stats.state == CircuitState.HALF_OPEN:
                if self._stats.successes >= self.config.success_threshold:
                    self._transition_to(CircuitState.CLOSED)
            elif self._stats.state == CircuitState.CLOSED:
                # Reset failure count on success
                self._stats.failures = 0

    def record_failure(self, error: Exception = None):
        """
        Record a failed API call.

        Args:
            error: The exception that occurred
        """
        with self._lock:
            self._stats.failures += 1
            self._stats.total_failures += 1
            self._stats.last_failure_time = time.time()

            error_msg = str(error) if error else "Unknown error"

            if self.logger:
                self.logger.api_error(
                    self.name,
                    error_msg,
                    attempt=self._stats.failures,
                    state=self._stats.state.value
                )

            if self._stats.state == CircuitState.HALF_OPEN:
                # Any failure in half-open goes back to open
                self._transition_to(CircuitState.OPEN)
            elif self._stats.state == CircuitState.CLOSED:
                if self._stats.failures >= self.config.failure_threshold:
                    self._transition_to(CircuitState.OPEN)

    def call(self, func: Callable, *args, **kwargs) -> Tuple[bool, Any]:
        """
        Execute a function through the circuit breaker.

        Args:
            func: Function to call
            *args, **kwargs: Arguments to pass to function

        Returns:
            Tuple of (success: bool, result_or_error: Any)
        """
        if not self.can_execute():
            return (False, CircuitOpenError(
                f"Circuit {self.name} is open, rejecting request"
            ))

        try:
            result = func(*args, **kwargs)
            self.record_success()
            return (True, result)
        except Exception as e:
            self.record_failure(e)
            return (False, e)

    def reset(self):
        """Reset circuit breaker to initial state."""
        with self._lock:
            self._stats = CircuitBreakerStats()
            self._half_open_calls = 0
            if self.logger:
                self.logger.info(f"Circuit {self.name} manually reset")


class CircuitOpenError(Exception):
    """Raised when circuit breaker is open and rejecting requests."""
    pass


# =============================================================================
# Reliability Issue 5: Order Error Handling
# =============================================================================

class OrderError(Exception):
    """Base class for order-related errors."""
    def __init__(self, message: str, symbol: str = None, side: str = None,
                 error_code: str = None, recoverable: bool = True):
        super().__init__(message)
        self.symbol = symbol
        self.side = side
        self.error_code = error_code
        self.recoverable = recoverable
        self.timestamp = datetime.utcnow().isoformat()


class InsufficientFundsError(OrderError):
    """Raised when there are insufficient funds to place order."""
    def __init__(self, message: str, symbol: str = None, side: str = None,
                 required: float = None, available: float = None):
        super().__init__(message, symbol, side, "INSUFFICIENT_FUNDS", recoverable=False)
        self.required = required
        self.available = available


class MinimumOrderError(OrderError):
    """Raised when order is below minimum size."""
    def __init__(self, message: str, symbol: str = None, side: str = None,
                 order_size: float = None, minimum: float = None):
        super().__init__(message, symbol, side, "MINIMUM_ORDER", recoverable=False)
        self.order_size = order_size
        self.minimum = minimum


class OrderRejectedError(OrderError):
    """Raised when order is rejected by exchange."""
    def __init__(self, message: str, symbol: str = None, side: str = None,
                 reason: str = None):
        super().__init__(message, symbol, side, "ORDER_REJECTED", recoverable=True)
        self.reason = reason


class APITimeoutError(OrderError):
    """Raised when API request times out."""
    def __init__(self, message: str, endpoint: str = None):
        super().__init__(message, error_code="TIMEOUT", recoverable=True)
        self.endpoint = endpoint


class RateLimitError(OrderError):
    """Raised when rate limit is exceeded."""
    def __init__(self, message: str, retry_after: float = None):
        super().__init__(message, error_code="RATE_LIMIT", recoverable=True)
        self.retry_after = retry_after


def parse_kraken_error(error_list: List[str], symbol: str = None,
                       side: str = None) -> Optional[OrderError]:
    """
    Parse Kraken API error response into specific exception.

    Args:
        error_list: List of error strings from Kraken API
        symbol: Trading symbol
        side: Order side (buy/sell)

    Returns:
        Specific OrderError subclass or None
    """
    if not error_list:
        return None

    error_str = " ".join(str(e).lower() for e in error_list)

    if "insufficient" in error_str or "not enough" in error_str:
        return InsufficientFundsError(
            f"Insufficient funds for {side} order on {symbol}",
            symbol=symbol, side=side
        )

    if "minimum" in error_str:
        return MinimumOrderError(
            f"Order below minimum size for {symbol}",
            symbol=symbol, side=side
        )

    if "rate limit" in error_str or "too many" in error_str:
        return RateLimitError(
            "Kraken API rate limit exceeded",
            retry_after=60.0  # Default retry
        )

    if "timeout" in error_str:
        return APITimeoutError("Kraken API request timed out")

    if "invalid" in error_str or "rejected" in error_str:
        return OrderRejectedError(
            f"Order rejected: {error_str}",
            symbol=symbol, side=side, reason=error_str
        )

    # Generic order error
    return OrderError(
        f"Order error: {error_str}",
        symbol=symbol, side=side,
        error_code="UNKNOWN"
    )


# =============================================================================
# Race Condition Fix: Atomic File Operations
# =============================================================================

def atomic_write(filepath: str, content: str, encoding: str = 'utf-8') -> bool:
    """
    Atomically write content to a file using temp file + rename pattern.

    RACE CONDITION FIX:
    - Previously: Direct write with open(..., 'w+') truncates file immediately,
      causing readers to see empty or partial content
    - Now: Write to temp file, then atomic rename

    Args:
        filepath: Target file path
        content: Content to write
        encoding: File encoding (default utf-8)

    Returns:
        True if successful, False otherwise
    """
    import tempfile

    # Get directory and filename
    directory = os.path.dirname(filepath) or '.'
    filename = os.path.basename(filepath)

    try:
        # Create temp file in same directory (required for atomic rename)
        fd, temp_path = tempfile.mkstemp(
            prefix=f".{filename}.",
            suffix=".tmp",
            dir=directory
        )

        try:
            # Write content to temp file
            with os.fdopen(fd, 'w', encoding=encoding) as f:
                f.write(content)

            # Atomic rename (POSIX guarantees this is atomic on same filesystem)
            os.replace(temp_path, filepath)
            return True

        except Exception:
            # Clean up temp file on error
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise

    except Exception as e:
        # Log error but don't crash - fall back to direct write
        try:
            with open(filepath, 'w', encoding=encoding) as f:
                f.write(content)
            return True
        except Exception:
            return False


def safe_read_signal(filepath: str, default: int = 0) -> int:
    """
    Safely read an integer signal value from a file.

    RACE CONDITION FIX:
    - Handles empty files (from truncation during write)
    - Handles partial reads
    - Returns default value on any error

    Args:
        filepath: Path to signal file
        default: Default value if read fails

    Returns:
        Integer value from file or default
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read().strip()

        # Handle empty file (race condition - file truncated but not yet written)
        if not content:
            return default

        # Parse as float first then int (handles "3.0" format)
        return int(float(content))

    except (OSError, ValueError, TypeError):
        return default


def safe_read_float(filepath: str, default: float = 0.0) -> float:
    """
    Safely read a float value from a file.

    Args:
        filepath: Path to file
        default: Default value if read fails

    Returns:
        Float value from file or default
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read().strip()

        if not content:
            return default

        return float(content)

    except (OSError, ValueError, TypeError):
        return default


# =============================================================================
# Issue 2: Memory Cache for Training Data
# =============================================================================

class TrainingMemoryCache:
    """
    Caches training memory files to prevent repeated disk reads.

    PERFORMANCE FIX (Issue #2):
    - Previously: Memory files read on every iteration (692-738 in pt_thinker.py)
    - Now: Files cached in memory, reloaded only when file mtime changes

    Usage:
        cache = TrainingMemoryCache(training_dir)
        memories = cache.get_memories(timeframe)
        weights = cache.get_weights(timeframe)
    """

    def __init__(self, training_dir: str):
        self.training_dir = training_dir
        self._cache: Dict[str, Dict] = {}
        self._lock = threading.Lock()

    def _get_file_mtime(self, filepath: str) -> Optional[float]:
        """Get file modification time, or None if file doesn't exist."""
        try:
            return os.path.getmtime(filepath)
        except OSError:
            return None

    def _is_cache_valid(self, cache_key: str, filepath: str) -> bool:
        """Check if cached data is still valid based on file mtime."""
        if cache_key not in self._cache:
            return False
        cached = self._cache[cache_key]
        current_mtime = self._get_file_mtime(filepath)
        return cached.get('mtime') == current_mtime and current_mtime is not None

    def _read_and_parse_file(self, filepath: str, parse_func: Callable[[str], Any]) -> Any:
        """Read file and parse with given function, with caching."""
        cache_key = filepath

        with self._lock:
            if self._is_cache_valid(cache_key, filepath):
                return self._cache[cache_key]['data']

            # Read and parse file
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                data = parse_func(content)

                # Update cache
                self._cache[cache_key] = {
                    'mtime': self._get_file_mtime(filepath),
                    'data': data
                }
                return data
            except Exception as e:
                raise RuntimeError(f"Failed to read {filepath}: {e}")

    def _parse_memory_list(self, content: str) -> List[str]:
        """Parse memory list file content."""
        return (content
                .replace("'", "")
                .replace(",", "")
                .replace('"', "")
                .replace("]", "")
                .replace("[", "")
                .split("~"))

    def _parse_weight_list(self, content: str) -> List[str]:
        """Parse weight list file content."""
        return (content
                .replace("'", "")
                .replace(",", "")
                .replace('"', "")
                .replace("]", "")
                .replace("[", "")
                .split(" "))

    def get_threshold(self, timeframe: str) -> float:
        """Get neural perfect threshold for timeframe."""
        filepath = os.path.join(self.training_dir, f"neural_perfect_threshold_{timeframe}.txt")
        return self._read_and_parse_file(filepath, float)

    def get_memories(self, timeframe: str) -> List[str]:
        """Get memory list for timeframe (cached)."""
        filepath = os.path.join(self.training_dir, f"memories_{timeframe}.txt")
        return self._read_and_parse_file(filepath, self._parse_memory_list)

    def get_weights(self, timeframe: str) -> List[str]:
        """Get weight list for timeframe (cached)."""
        filepath = os.path.join(self.training_dir, f"memory_weights_{timeframe}.txt")
        return self._read_and_parse_file(filepath, self._parse_weight_list)

    def get_high_weights(self, timeframe: str) -> List[str]:
        """Get high weight list for timeframe (cached)."""
        filepath = os.path.join(self.training_dir, f"memory_weights_high_{timeframe}.txt")
        return self._read_and_parse_file(filepath, self._parse_weight_list)

    def get_low_weights(self, timeframe: str) -> List[str]:
        """Get low weight list for timeframe (cached)."""
        filepath = os.path.join(self.training_dir, f"memory_weights_low_{timeframe}.txt")
        return self._read_and_parse_file(filepath, self._parse_weight_list)

    def clear_cache(self):
        """Clear all cached data."""
        with self._lock:
            self._cache.clear()

    def get_cache_stats(self) -> Dict[str, int]:
        """Get cache statistics."""
        with self._lock:
            return {
                'cached_files': len(self._cache),
                'memory_bytes': sum(
                    len(str(v.get('data', '')))
                    for v in self._cache.values()
                )
            }


# =============================================================================
# Issue 3: File I/O Cache for Price Files
# =============================================================================

class PriceFileCache:
    """
    Batches price file writes to reduce disk I/O.

    PERFORMANCE FIX (Issue #3):
    - Previously: Price files written every iteration (1269-1271 in pt_trader.py)
    - Now: Writes batched and flushed periodically or on significant changes

    Usage:
        cache = PriceFileCache(data_dir, flush_interval=5.0)
        cache.set_price('BTC', 50000.0)  # Cached in memory
        cache.flush()  # Write all pending to disk
    """

    def __init__(self, data_dir: str, flush_interval: float = 5.0,
                 change_threshold: float = 0.001):
        """
        Args:
            data_dir: Directory for price files
            flush_interval: Seconds between automatic flushes
            change_threshold: Minimum % change to trigger immediate write (0.001 = 0.1%)
        """
        self.data_dir = data_dir
        self.flush_interval = flush_interval
        self.change_threshold = change_threshold

        self._prices: Dict[str, float] = {}
        self._last_written: Dict[str, float] = {}
        self._last_flush = time.time()
        self._pending_writes: Dict[str, float] = {}
        self._lock = threading.Lock()

        os.makedirs(data_dir, exist_ok=True)

    def set_price(self, symbol: str, price: float) -> bool:
        """
        Set price for symbol. Returns True if written immediately.

        Price is written immediately if:
        - First time seeing this symbol
        - Price changed more than change_threshold
        - flush_interval has elapsed since last flush
        """
        with self._lock:
            old_price = self._prices.get(symbol)
            self._prices[symbol] = price

            # Check if we need immediate write
            needs_immediate = False

            if old_price is None:
                needs_immediate = True
            elif old_price > 0:
                pct_change = abs(price - old_price) / old_price
                if pct_change >= self.change_threshold:
                    needs_immediate = True

            # Check flush interval
            now = time.time()
            if now - self._last_flush >= self.flush_interval:
                self._flush_internal()
                return True

            if needs_immediate:
                self._write_price(symbol, price)
                return True

            # Queue for batch write
            self._pending_writes[symbol] = price
            return False

    def _write_price(self, symbol: str, price: float):
        """Write single price file."""
        filepath = os.path.join(self.data_dir, f"{symbol}_current_price.txt")
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(str(price))
            self._last_written[symbol] = price
        except Exception as e:
            print(f"Warning: Failed to write price for {symbol}: {e}")

    def _flush_internal(self):
        """Internal flush without lock."""
        for symbol, price in self._pending_writes.items():
            self._write_price(symbol, price)
        self._pending_writes.clear()
        self._last_flush = time.time()

    def flush(self):
        """Flush all pending writes to disk."""
        with self._lock:
            self._flush_internal()

    def get_price(self, symbol: str) -> Optional[float]:
        """Get cached price for symbol."""
        with self._lock:
            return self._prices.get(symbol)

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        with self._lock:
            return {
                'cached_symbols': len(self._prices),
                'pending_writes': len(self._pending_writes),
                'last_flush_ago': time.time() - self._last_flush
            }


# =============================================================================
# Issue 4: SQLite Database for Trade/Account History
# =============================================================================

class TradingDatabase:
    """
    SQLite database for trade and account history.

    PERFORMANCE FIX (Issue #4):
    - Previously: JSONL files with linear scan for reads
    - Now: SQLite with indexed queries, much faster at scale

    Usage:
        db = TradingDatabase(db_path)
        db.record_trade(trade_data)
        db.record_account_value(timestamp, value)
        trades = db.get_recent_trades(limit=100)
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Get thread-local database connection."""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            self._local.conn = sqlite3.connect(
                self.db_path,
                check_same_thread=False,
                timeout=30.0
            )
            self._local.conn.row_factory = sqlite3.Row
            # Enable WAL mode for better concurrent performance
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA synchronous=NORMAL")
        return self._local.conn

    def _init_db(self):
        """Initialize database schema."""
        conn = self._get_connection()
        cursor = conn.cursor()

        # Trade history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                quantity REAL NOT NULL,
                price REAL NOT NULL,
                total_value REAL,
                fee REAL,
                order_id TEXT,
                trade_type TEXT,
                notes TEXT,
                raw_data TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Account value history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS account_values (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                total_value REAL NOT NULL,
                cash_balance REAL,
                holdings_value REAL,
                details TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # DCA tracking table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS dca_tracking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                stage INTEGER NOT NULL,
                triggered_at TEXT NOT NULL,
                price REAL NOT NULL,
                quantity REAL NOT NULL,
                total_stages INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Indexes for faster queries
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_account_values_timestamp ON account_values(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_dca_symbol ON dca_tracking(symbol)")

        conn.commit()

    def record_trade(self, trade_data: Dict[str, Any]) -> int:
        """
        Record a trade to the database.

        Args:
            trade_data: Dict with keys: timestamp, symbol, side, quantity, price, etc.

        Returns:
            ID of the inserted record
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO trades (
                timestamp, symbol, side, quantity, price,
                total_value, fee, order_id, trade_type, notes, raw_data
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            trade_data.get('timestamp', datetime.utcnow().isoformat()),
            trade_data.get('symbol', ''),
            trade_data.get('side', ''),
            trade_data.get('quantity', 0),
            trade_data.get('price', 0),
            trade_data.get('total_value'),
            trade_data.get('fee'),
            trade_data.get('order_id'),
            trade_data.get('trade_type'),
            trade_data.get('notes'),
            json.dumps(trade_data) if trade_data else None
        ))

        conn.commit()
        return cursor.lastrowid

    def record_account_value(self, timestamp: str, total_value: float,
                            cash_balance: float = None,
                            holdings_value: float = None,
                            details: Dict = None) -> int:
        """Record account value snapshot."""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO account_values (
                timestamp, total_value, cash_balance, holdings_value, details
            ) VALUES (?, ?, ?, ?, ?)
        """, (
            timestamp,
            total_value,
            cash_balance,
            holdings_value,
            json.dumps(details) if details else None
        ))

        conn.commit()
        return cursor.lastrowid

    def record_dca(self, symbol: str, stage: int, price: float,
                   quantity: float, total_stages: int = 0) -> int:
        """Record DCA trigger event."""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO dca_tracking (
                symbol, stage, triggered_at, price, quantity, total_stages
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (
            symbol,
            stage,
            datetime.utcnow().isoformat(),
            price,
            quantity,
            total_stages
        ))

        conn.commit()
        return cursor.lastrowid

    def get_recent_trades(self, limit: int = 100, symbol: str = None) -> List[Dict]:
        """Get recent trades, optionally filtered by symbol."""
        conn = self._get_connection()
        cursor = conn.cursor()

        if symbol:
            cursor.execute("""
                SELECT * FROM trades
                WHERE symbol = ?
                ORDER BY timestamp DESC
                LIMIT ?
            """, (symbol, limit))
        else:
            cursor.execute("""
                SELECT * FROM trades
                ORDER BY timestamp DESC
                LIMIT ?
            """, (limit,))

        return [dict(row) for row in cursor.fetchall()]

    def get_account_value_history(self, start_time: str = None,
                                   end_time: str = None,
                                   limit: int = 1000) -> List[Dict]:
        """Get account value history within time range."""
        conn = self._get_connection()
        cursor = conn.cursor()

        query = "SELECT * FROM account_values"
        params = []
        conditions = []

        if start_time:
            conditions.append("timestamp >= ?")
            params.append(start_time)
        if end_time:
            conditions.append("timestamp <= ?")
            params.append(end_time)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]

    def get_dca_history(self, symbol: str = None) -> List[Dict]:
        """Get DCA trigger history."""
        conn = self._get_connection()
        cursor = conn.cursor()

        if symbol:
            cursor.execute("""
                SELECT * FROM dca_tracking
                WHERE symbol = ?
                ORDER BY triggered_at DESC
            """, (symbol,))
        else:
            cursor.execute("""
                SELECT * FROM dca_tracking
                ORDER BY triggered_at DESC
            """)

        return [dict(row) for row in cursor.fetchall()]

    def migrate_from_jsonl(self, trade_history_path: str = None,
                          account_value_path: str = None) -> Dict[str, int]:
        """
        Migrate existing JSONL files to SQLite database.

        Returns dict with count of migrated records.
        """
        migrated = {'trades': 0, 'account_values': 0}

        if trade_history_path and os.path.exists(trade_history_path):
            with open(trade_history_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            trade = json.loads(line)
                            self.record_trade(trade)
                            migrated['trades'] += 1
                        except json.JSONDecodeError:
                            continue

        if account_value_path and os.path.exists(account_value_path):
            with open(account_value_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            data = json.loads(line)
                            self.record_account_value(
                                timestamp=data.get('timestamp', ''),
                                total_value=data.get('total_value', 0),
                                cash_balance=data.get('cash_balance'),
                                holdings_value=data.get('holdings_value'),
                                details=data
                            )
                            migrated['account_values'] += 1
                        except json.JSONDecodeError:
                            continue

        return migrated

    def get_stats(self) -> Dict[str, Any]:
        """Get database statistics."""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM trades")
        trade_count = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM account_values")
        account_count = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM dca_tracking")
        dca_count = cursor.fetchone()[0]

        # Get database file size
        try:
            db_size = os.path.getsize(self.db_path)
        except OSError:
            db_size = 0

        return {
            'trade_count': trade_count,
            'account_value_count': account_count,
            'dca_count': dca_count,
            'db_size_bytes': db_size,
            'db_size_mb': round(db_size / (1024 * 1024), 2)
        }

    def close(self):
        """Close database connection."""
        if hasattr(self._local, 'conn') and self._local.conn:
            self._local.conn.close()
            self._local.conn = None


# =============================================================================
# Issue 5: Async HTTP Client Wrapper
# =============================================================================

class AsyncHTTPClient:
    """
    Async HTTP client wrapper using httpx for non-blocking requests.

    PERFORMANCE FIX (Issue #5):
    - Previously: Synchronous requests blocking execution
    - Now: Async requests with connection pooling

    Usage:
        # Sync interface (for gradual migration)
        client = AsyncHTTPClient()
        data = client.get_sync('https://api.example.com/data')

        # Async interface
        async with client:
            data = await client.get('https://api.example.com/data')
    """

    def __init__(self, timeout: float = 10.0, max_connections: int = 10):
        self.timeout = timeout
        self.max_connections = max_connections
        self._sync_client = None
        self._async_client = None

    def _get_sync_client(self):
        """Get or create synchronous httpx client."""
        if self._sync_client is None:
            try:
                import httpx
                self._sync_client = httpx.Client(
                    timeout=self.timeout,
                    limits=httpx.Limits(max_connections=self.max_connections)
                )
            except ImportError:
                # Fallback to requests if httpx not installed
                import requests
                self._sync_client = requests.Session()
        return self._sync_client

    def get_sync(self, url: str, params: Dict = None,
                 headers: Dict = None, **kwargs) -> Dict:
        """
        Synchronous GET request (for gradual migration from requests).
        Uses httpx if available, falls back to requests.
        """
        client = self._get_sync_client()

        try:
            # Check if it's httpx or requests
            if hasattr(client, 'get'):
                response = client.get(url, params=params, headers=headers, **kwargs)

                # httpx uses response.status_code, requests uses same
                if response.status_code != 200:
                    raise RuntimeError(f"HTTP {response.status_code}: {response.text}")

                return response.json()
        except Exception as e:
            raise RuntimeError(f"HTTP GET failed for {url}: {e}")

    def post_sync(self, url: str, data: Any = None, json: Dict = None,
                  headers: Dict = None, **kwargs) -> Dict:
        """Synchronous POST request."""
        client = self._get_sync_client()

        try:
            response = client.post(
                url, data=data, json=json, headers=headers, **kwargs
            )

            if response.status_code not in (200, 201):
                raise RuntimeError(f"HTTP {response.status_code}: {response.text}")

            return response.json()
        except Exception as e:
            raise RuntimeError(f"HTTP POST failed for {url}: {e}")

    async def get(self, url: str, params: Dict = None,
                  headers: Dict = None, **kwargs) -> Dict:
        """Async GET request."""
        try:
            import httpx
        except ImportError:
            raise RuntimeError("httpx required for async requests. Install with: pip install httpx")

        if self._async_client is None:
            self._async_client = httpx.AsyncClient(
                timeout=self.timeout,
                limits=httpx.Limits(max_connections=self.max_connections)
            )

        response = await self._async_client.get(
            url, params=params, headers=headers, **kwargs
        )

        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text}")

        return response.json()

    async def post(self, url: str, data: Any = None, json: Dict = None,
                   headers: Dict = None, **kwargs) -> Dict:
        """Async POST request."""
        try:
            import httpx
        except ImportError:
            raise RuntimeError("httpx required for async requests. Install with: pip install httpx")

        if self._async_client is None:
            self._async_client = httpx.AsyncClient(
                timeout=self.timeout,
                limits=httpx.Limits(max_connections=self.max_connections)
            )

        response = await self._async_client.post(
            url, data=data, json=json, headers=headers, **kwargs
        )

        if response.status_code not in (200, 201):
            raise RuntimeError(f"HTTP {response.status_code}: {response.text}")

        return response.json()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def close(self):
        """Close async client."""
        if self._async_client:
            await self._async_client.aclose()
            self._async_client = None

    def close_sync(self):
        """Close sync client."""
        if self._sync_client:
            if hasattr(self._sync_client, 'close'):
                self._sync_client.close()
            self._sync_client = None


# =============================================================================
# Global Instances (for easy import)
# =============================================================================

# These will be initialized on first use
_memory_cache: Optional[TrainingMemoryCache] = None
_price_cache: Optional[PriceFileCache] = None
_trading_db: Optional[TradingDatabase] = None
_http_client: Optional[AsyncHTTPClient] = None


def get_memory_cache(training_dir: str = None) -> TrainingMemoryCache:
    """Get or create global memory cache instance."""
    global _memory_cache
    if _memory_cache is None:
        if training_dir is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            training_dir = os.path.join(os.path.dirname(base_dir), "data", "training")
        _memory_cache = TrainingMemoryCache(training_dir)
    return _memory_cache


def get_price_cache(data_dir: str = None) -> PriceFileCache:
    """Get or create global price cache instance."""
    global _price_cache
    if _price_cache is None:
        if data_dir is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            data_dir = os.path.dirname(base_dir)  # Project root for price files
        _price_cache = PriceFileCache(data_dir)
    return _price_cache


def get_trading_db(db_path: str = None) -> TradingDatabase:
    """Get or create global trading database instance."""
    global _trading_db
    if _trading_db is None:
        if db_path is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            db_path = os.path.join(os.path.dirname(base_dir), "data", "runtime", "trading.db")
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        _trading_db = TradingDatabase(db_path)
    return _trading_db


def get_http_client() -> AsyncHTTPClient:
    """Get or create global HTTP client instance."""
    global _http_client
    if _http_client is None:
        _http_client = AsyncHTTPClient()
    return _http_client


# Reliability utilities
_trading_logger: Optional[TradingLogger] = None
_circuit_breaker: Optional[CircuitBreaker] = None


def get_trading_logger(
    log_dir: str = None,
    level: str = "INFO",
    console_output: bool = True
) -> TradingLogger:
    """
    Get or create global trading logger instance.

    Args:
        log_dir: Directory for log files
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        console_output: Also output to console

    Returns:
        TradingLogger instance
    """
    global _trading_logger
    if _trading_logger is None:
        _trading_logger = TradingLogger(
            name="powertrader",
            log_dir=log_dir,
            level=level,
            console_output=console_output
        )
    return _trading_logger


def get_circuit_breaker(
    name: str = "kraken_api",
    config: CircuitBreakerConfig = None,
) -> CircuitBreaker:
    """
    Get or create global circuit breaker instance.

    Args:
        name: Circuit breaker identifier
        config: Configuration settings

    Returns:
        CircuitBreaker instance
    """
    global _circuit_breaker
    if _circuit_breaker is None:
        logger = get_trading_logger()
        _circuit_breaker = CircuitBreaker(
            name=name,
            config=config or CircuitBreakerConfig(),
            logger=logger
        )
    return _circuit_breaker
