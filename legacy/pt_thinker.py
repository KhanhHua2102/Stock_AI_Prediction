import os
import time
import random
import requests
import sys
import datetime
import traceback
import linecache
import base64
import calendar
import hashlib
import hmac
from datetime import datetime
import psutil
import logging
import json
import uuid

# PERFORMANCE FIX (Issues #2, #5): Import performance utilities
try:
    from performance_utils import (
        get_memory_cache, get_http_client,
        TrainingMemoryCache, AsyncHTTPClient,
    )
    _PERF_UTILS_AVAILABLE = True
except ImportError:
    _PERF_UTILS_AVAILABLE = False
    TrainingMemoryCache = None
    AsyncHTTPClient = None

# ---- Training data directory ----
# Use parent directory's data/training folder
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data", "training")

# ---- Shared RuntimeDB (SQLite) ----
sys.path.insert(0, os.path.dirname(BASE_DIR))
from pathlib import Path as _Path
from shared.runtime_db import RuntimeDB
_runtime_db = RuntimeDB(_Path(os.path.dirname(BASE_DIR)) / "data" / "runtime.db")

def _safe_ticker_name(ticker: str) -> str:
    """Sanitize ticker for filesystem: ^GSPC -> GSPC, GLOB.AX -> GLOB_AX"""
    return ticker.upper().replace("^", "").replace(".", "_")


def training_path(filename: str, ticker: str = None) -> str:
    """Return path to file in data/training (or data/training/{TICKER}/) subdirectory."""
    if ticker:
        d = os.path.join(TRAINING_DATA_DIR, _safe_ticker_name(ticker))
    else:
        d = TRAINING_DATA_DIR
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, filename)

from stock_data_fetcher import market


def restart_program():
    """Restarts the current program (no CLI args; uses hardcoded TICKER_SYMBOLS)."""
    try:
        os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)])
    except Exception as e:
        print(f"Error during program restart: {e}")


def PrintException():
    exc_type, exc_obj, tb = sys.exc_info()

    # walk to the innermost frame (where the error actually happened)
    while tb and tb.tb_next:
        tb = tb.tb_next

    f = tb.tb_frame
    lineno = tb.tb_lineno
    filename = f.f_code.co_filename

    linecache.checkcache(filename)
    line = linecache.getline(filename, lineno, f.f_globals)
    print('EXCEPTION IN (LINE {} "{}"): {}'.format(lineno, line.strip(), exc_obj))


restarted = "no"
short_started = "no"
long_started = "no"
minute = 0
last_minute = 0

# -----------------------------
# GUI SETTINGS (tickers list)
# -----------------------------
_GUI_SETTINGS_PATH = os.environ.get("POWERTRADER_GUI_SETTINGS") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "gui_settings.json"
)

_gui_settings_cache = {
    "mtime": None,
    "tickers": ["VNINDEX"],  # fallback defaults
}


def _load_gui_tickers() -> list:
    """
    Reads gui_settings.json and returns settings["tickers"] as an uppercased list.
    Falls back to "coins" key for backwards compatibility.
    Caches by mtime so it is cheap to call frequently.
    """
    try:
        if not os.path.isfile(_GUI_SETTINGS_PATH):
            return list(_gui_settings_cache["tickers"])

        mtime = os.path.getmtime(_GUI_SETTINGS_PATH)
        if _gui_settings_cache["mtime"] == mtime:
            return list(_gui_settings_cache["tickers"])

        with open(_GUI_SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f) or {}

        tickers = data.get("tickers", None) or data.get("coins", None)
        if not isinstance(tickers, list) or not tickers:
            tickers = list(_gui_settings_cache["tickers"])

        tickers = [str(c).strip().upper() for c in tickers if str(c).strip()]
        if not tickers:
            tickers = list(_gui_settings_cache["tickers"])

        _gui_settings_cache["mtime"] = mtime
        _gui_settings_cache["tickers"] = tickers
        return list(tickers)
    except Exception:
        return list(_gui_settings_cache["tickers"])


def _load_selected_tickers() -> list:
    """
    Reads selected_trading_tickers.json from hub_data directory.
    Returns the list of selected tickers, or all GUI tickers if no selection file exists.
    """
    try:
        selected_path = os.path.join(HUB_DIR, "selected_trading_coins.json")
        if not os.path.isfile(selected_path):
            return _load_gui_tickers()

        with open(selected_path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}

        selected = data.get("selected_coins", [])
        if not isinstance(selected, list) or not selected:
            return _load_gui_tickers()

        all_tickers = _load_gui_tickers()
        selected = [str(c).strip().upper() for c in selected if str(c).strip()]
        selected = [c for c in selected if c in all_tickers]

        if not selected:
            return all_tickers

        return selected
    except Exception:
        return _load_gui_tickers()


# Initial ticker list (will be kept live via _sync_tickers_from_settings())
TICKER_SYMBOLS = _load_gui_tickers()
CURRENT_TICKERS = list(TICKER_SYMBOLS)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def ticker_folder(sym: str) -> str:
    """Working directory for a ticker's relative file I/O."""
    return os.path.join(BASE_DIR, _safe_ticker_name(sym))


# --- training freshness gate (mirrors pt_hub.py) ---
_TRAINING_STALE_SECONDS = 14 * 24 * 60 * 60  # 14 days


def _ticker_is_trained(sym: str) -> bool:
    """
    Training freshness gate:

    Checks the trainer_status table in SQLite for last_training_time.
    If missing or older than 14 days, the ticker is NOT TRAINED.
    """
    try:
        row = _runtime_db.get_trainer(_safe_ticker_name(sym))
        if not row or not row.get("last_training_time"):
            return False
        ts = float(row["last_training_time"])
        if ts <= 0:
            return False
        return (time.time() - ts) <= _TRAINING_STALE_SECONDS
    except Exception:
        return False


# --- GUI HUB "runner ready" gate file (read by gui_hub.py Start All toggle) ---

HUB_DIR = os.environ.get("POWERTRADER_HUB_DIR") or os.path.join(os.path.dirname(BASE_DIR), "data", "runtime")
try:
    os.makedirs(HUB_DIR, exist_ok=True)
except Exception:
    pass



def _write_runner_ready(
    ready: bool, stage: str, ready_tickers=None, total_tickers: int = 0
) -> None:
    _runtime_db.set_status("runner_ready", {
        "timestamp": time.time(),
        "ready": bool(ready),
        "stage": stage,
        "ready_tickers": ready_tickers or [],
        "total_tickers": int(total_tickers or 0),
    })


# Ensure folders exist for the current configured tickers
for _sym in CURRENT_TICKERS:
    os.makedirs(ticker_folder(_sym), exist_ok=True)


distance = 0.5
tf_choices = ["1day", "1week"]


def new_ticker_state():
    return {
        "low_bound_prices": [0.01] * len(tf_choices),
        "high_bound_prices": [99999999999999999] * len(tf_choices),
        "tf_times": [],
        "tf_choice_index": 0,
        "tf_update": ["yes"] * len(tf_choices),
        "messages": ["none"] * len(tf_choices),
        "last_messages": ["none"] * len(tf_choices),
        "margins": [0.25] * len(tf_choices),
        "high_tf_prices": [99999999999999999] * len(tf_choices),
        "low_tf_prices": [0.01] * len(tf_choices),
        "tf_sides": ["none"] * len(tf_choices),
        "messaged": ["no"] * len(tf_choices),
        "updated": [0] * len(tf_choices),
        "perfects": ["active"] * len(tf_choices),
        "training_issues": [0] * len(tf_choices),
        # readiness gating (no placeholder-number checks; this is process-based)
        "bounds_version": 0,
        "last_display_bounds_version": -1,
    }


states = {}

display_cache = {sym: f"{sym}  (starting.)" for sym in CURRENT_TICKERS}

# Track which tickers have produced REAL predicted levels (not placeholder 1 / 99999999999999999)
_ready_tickers = set()


# We consider the runner "READY" only once it is ACTUALLY PRINTING real prediction messages
# (i.e. output lines start with WITHIN / LONG / SHORT). No numeric placeholder checks at all.
def _is_printing_real_predictions(messages) -> bool:
    try:
        for m in messages or []:
            if not isinstance(m, str):
                continue
            # These are the only message types produced once predictions are being used in output.
            # (INACTIVE means it's still not printing real prediction output for that timeframe.)
            if m.startswith("WITHIN") or m.startswith("LONG") or m.startswith("SHORT"):
                return True
        return False
    except Exception:
        return False


def _sync_tickers_from_settings():
    """
    Hot-reload tickers from GUI settings while runner is running.

    - Adds new tickers: creates folder + init_ticker() + starts stepping them
    - Removes tickers: stops stepping them (leaves state on disk untouched)
    """
    global CURRENT_TICKERS

    new_list = _load_gui_tickers()
    if new_list == CURRENT_TICKERS:
        return

    old_list = list(CURRENT_TICKERS)
    added = [c for c in new_list if c not in old_list]
    removed = [c for c in old_list if c not in new_list]

    # Handle removed tickers: stop stepping + clear UI cache entries
    for sym in removed:
        try:
            _ready_tickers.discard(sym)
        except Exception:
            pass
        try:
            display_cache.pop(sym, None)
        except Exception:
            pass

    # Handle added tickers: create folder + init state + show in UI output
    for sym in added:
        try:
            os.makedirs(ticker_folder(sym), exist_ok=True)
        except Exception:
            pass
        try:
            display_cache[sym] = f"{sym}  (starting.)"
        except Exception:
            pass
        try:
            # init_ticker switches CWD and does network calls, so do it carefully
            init_ticker(sym)
            os.chdir(BASE_DIR)
        except Exception:
            try:
                os.chdir(BASE_DIR)
            except Exception:
                pass

    CURRENT_TICKERS = list(new_list)


_write_runner_ready(
    False, stage="starting", ready_tickers=[], total_tickers=len(CURRENT_TICKERS)
)


def init_ticker(sym: str):
    # switch into the ticker's folder so ALL existing relative file I/O stays working
    os.chdir(ticker_folder(sym))

    # per-ticker initial signal state
    safe = _safe_ticker_name(sym)
    _runtime_db.upsert_signals(safe,
        alerts_version="5/3/2022/9am",
        long_onoff="OFF",
        short_onoff="OFF",
    )

    st = new_ticker_state()

    ticker = sym  # ticker passed directly (no suffix)
    ind = 0
    tf_times_local = []
    while True:
        history_list = []
        while True:
            try:
                history_list = market.get_kline(ticker, tf_choices[ind])
                break
            except Exception as e:
                time.sleep(3.5)
                if "Requests" in str(e):
                    pass
                else:
                    PrintException()
                continue

        ind += 1
        try:
            the_time = history_list[1][0]
        except Exception:
            the_time = 0.0

        tf_times_local.append(the_time)
        if len(tf_times_local) >= len(tf_choices):
            break

    st["tf_times"] = tf_times_local
    states[sym] = st


# init all tickers once (from GUI settings)
for _sym in CURRENT_TICKERS:
    init_ticker(_sym)

# restore CWD to base after init
os.chdir(BASE_DIR)


wallet_addr_list = []
wallet_addr_users = []
total_long = 0
total_short = 0
last_hour = 565457457357

cc_index = 0
tf_choice = []
prices = []
starts = []
long_start_prices = []
short_start_prices = []
buy_tickers = []
cc_update = "yes"
wr_update = "yes"


def find_purple_area(lines):
    """
    Given a list of (price, color) pairs (color is 'orange' or 'blue'),
    returns (purple_bottom, purple_top) if a purple area exists,
    else (None, None).
    """
    oranges = sorted(
        [price for price, color in lines if color == "orange"], reverse=True
    )
    blues = sorted([price for price, color in lines if color == "blue"])
    if not oranges or not blues:
        return (None, None)
    purple_bottom = None
    purple_top = None
    all_levels = sorted(
        set(oranges + blues + [float("-inf"), float("inf")]), reverse=True
    )
    for i in range(len(all_levels) - 1):
        top = all_levels[i]
        bottom = all_levels[i + 1]
        oranges_below = [o for o in oranges if o < bottom]
        blues_above = [b for b in blues if b > top]
        has_orange_below = any(o < top for o in oranges)
        has_blue_above = any(b > bottom for b in blues)
        if has_orange_below and has_blue_above:
            if purple_bottom is None or bottom < purple_bottom:
                purple_bottom = bottom
            if purple_top is None or top > purple_top:
                purple_top = top
    if (
        purple_bottom is not None
        and purple_top is not None
        and purple_top > purple_bottom
    ):
        return (purple_bottom, purple_top)
    return (None, None)


def step_ticker(sym: str):
    # run inside the ticker folder so all existing file reads/writes stay relative + isolated
    os.chdir(ticker_folder(sym))
    ticker = sym  # ticker passed directly (no suffix)
    st = states[sym]

    # --- training freshness gate ---
    # If GUI would show NOT TRAINED (missing / stale trainer_last_training_time.txt),
    # skip this ticker so no new trades can start until it is trained again.
    if not _ticker_is_trained(sym):
        try:
            safe = _safe_ticker_name(sym)
            _runtime_db.upsert_signals(safe,
                long_profit_margin=0.25, short_profit_margin=0.25,
                long_dca_signal=0, short_dca_signal=0,
            )
        except Exception:
            pass
        try:
            display_cache[sym] = sym + "  (NOT TRAINED / OUTDATED - run trainer)"
        except Exception:
            pass
        try:
            _ready_tickers.discard(sym)
            all_ready = len(_ready_tickers) >= len(CURRENT_TICKERS)
            _write_runner_ready(
                all_ready,
                stage=("real_predictions" if all_ready else "training_required"),
                ready_tickers=sorted(list(_ready_tickers)),
                total_tickers=len(CURRENT_TICKERS),
            )

        except Exception:
            pass
        return

    # ensure new readiness-version keys exist even if restarting from an older state dict
    if "bounds_version" not in st:
        st["bounds_version"] = 0
    if "last_display_bounds_version" not in st:
        st["last_display_bounds_version"] = -1

    # pull state into local names (lists mutate in-place; ones that get reassigned we set back at end)
    low_bound_prices = st["low_bound_prices"]
    high_bound_prices = st["high_bound_prices"]
    tf_times = st["tf_times"]
    tf_choice_index = st["tf_choice_index"]

    tf_update = st["tf_update"]
    messages = st["messages"]
    last_messages = st["last_messages"]
    margins = st["margins"]

    high_tf_prices = st["high_tf_prices"]
    low_tf_prices = st["low_tf_prices"]
    tf_sides = st["tf_sides"]
    messaged = st["messaged"]
    updated = st["updated"]
    perfects = st["perfects"]
    training_issues = st.get("training_issues", [0] * len(tf_choices))
    # keep training_issues aligned to tf_choices
    if len(training_issues) < len(tf_choices):
        training_issues.extend([0] * (len(tf_choices) - len(training_issues)))
    elif len(training_issues) > len(tf_choices):
        del training_issues[len(tf_choices) :]

    last_difference_between = 0.0

    # ====== ORIGINAL: fetch current candle for this timeframe index ======
    while True:
        history_list = []
        while True:
            try:
                history_list = market.get_kline(ticker, tf_choices[tf_choice_index])
                break
            except Exception as e:
                time.sleep(3.5)
                if "Requests" in str(e):
                    pass
                else:
                    pass
                continue
        if len(history_list) < 2:
            time.sleep(0.2)
            continue
        try:
            openPrice = float(history_list[1][1])
            closePrice = float(history_list[1][2])
            break
        except Exception:
            continue

    current_candle = 100 * ((closePrice - openPrice) / openPrice)

    # ====== Load neural training data from SQLite ======
    timeframe = tf_choices[tf_choice_index]
    _safe = _safe_ticker_name(sym)

    _mem_row = _runtime_db.get_memory(_safe, timeframe)
    if _mem_row:
        perfect_threshold = _mem_row.get("perfect_threshold", 0.0)
    else:
        perfect_threshold = 0.0

    def _parse_clean(raw: str) -> list:
        return raw.replace("'", "").replace(",", "").replace('"', "").replace("]", "").replace("[", "")

    try:
        training_issues[tf_choice_index] = 0

        if _mem_row and _mem_row.get("memories"):
            memory_list = _parse_clean(_mem_row["memories"]).split("~")
            weight_list = _parse_clean(_mem_row["weights"]).split(" ")
            high_weight_list = _parse_clean(_mem_row["weights_high"]).split(" ")
            low_weight_list = _parse_clean(_mem_row["weights_low"]).split(" ")
        elif _PERF_UTILS_AVAILABLE:
            # Fallback to file-based cache if DB has no data yet
            memory_cache = get_memory_cache(os.path.join(TRAINING_DATA_DIR, _safe))
            perfect_threshold = memory_cache.get_threshold(timeframe)
            memory_list = memory_cache.get_memories(timeframe)
            weight_list = memory_cache.get_weights(timeframe)
            high_weight_list = memory_cache.get_high_weights(timeframe)
            low_weight_list = memory_cache.get_low_weights(timeframe)
        else:
            raise FileNotFoundError("No training data in DB or on disk")

        mem_ind = 0
        diffs_list = []
        any_perfect = "no"
        perfect_dexs = []
        perfect_diffs = []
        moves = []
        move_weights = []
        unweighted = []
        high_unweighted = []
        low_unweighted = []
        high_moves = []
        low_moves = []

        while True:
            memory_pattern = (
                memory_list[mem_ind]
                .split("{}")[0]
                .replace("'", "")
                .replace(",", "")
                .replace('"', "")
                .replace("]", "")
                .replace("[", "")
                .split(" ")
            )
            check_dex = 0
            memory_candle = float(memory_pattern[check_dex])

            if current_candle == 0.0 and memory_candle == 0.0:
                difference = 0.0
            else:
                try:
                    difference = abs(
                        (
                            abs(current_candle - memory_candle)
                            / ((current_candle + memory_candle) / 2)
                        )
                        * 100
                    )
                except:
                    difference = 0.0

            diff_avg = difference

            if diff_avg <= perfect_threshold:
                any_perfect = "yes"
                high_diff = (
                    float(
                        memory_list[mem_ind]
                        .split("{}")[1]
                        .replace("'", "")
                        .replace(",", "")
                        .replace('"', "")
                        .replace("]", "")
                        .replace("[", "")
                        .replace(" ", "")
                    )
                    / 100
                )
                low_diff = (
                    float(
                        memory_list[mem_ind]
                        .split("{}")[2]
                        .replace("'", "")
                        .replace(",", "")
                        .replace('"', "")
                        .replace("]", "")
                        .replace("[", "")
                        .replace(" ", "")
                    )
                    / 100
                )

                unweighted.append(float(memory_pattern[len(memory_pattern) - 1]))
                move_weights.append(float(weight_list[mem_ind]))
                high_unweighted.append(high_diff)
                low_unweighted.append(low_diff)

                if float(weight_list[mem_ind]) != 0.0:
                    moves.append(
                        float(memory_pattern[len(memory_pattern) - 1])
                        * float(weight_list[mem_ind])
                    )

                if float(high_weight_list[mem_ind]) != 0.0:
                    high_moves.append(high_diff * float(high_weight_list[mem_ind]))

                if float(low_weight_list[mem_ind]) != 0.0:
                    low_moves.append(low_diff * float(low_weight_list[mem_ind]))

                perfect_dexs.append(mem_ind)
                perfect_diffs.append(diff_avg)

            diffs_list.append(diff_avg)
            mem_ind += 1

            if mem_ind >= len(memory_list):
                if any_perfect == "no":
                    final_moves = 0.0
                    high_final_moves = 0.0
                    low_final_moves = 0.0
                    del perfects[tf_choice_index]
                    perfects.insert(tf_choice_index, "inactive")
                else:
                    try:
                        final_moves = sum(moves) / len(moves)
                        high_final_moves = sum(high_moves) / len(high_moves)
                        low_final_moves = sum(low_moves) / len(low_moves)
                        del perfects[tf_choice_index]
                        perfects.insert(tf_choice_index, "active")
                    except:
                        final_moves = 0.0
                        high_final_moves = 0.0
                        low_final_moves = 0.0
                        del perfects[tf_choice_index]
                        perfects.insert(tf_choice_index, "inactive")
                break

    except Exception:
        PrintException()
        training_issues[tf_choice_index] = 1
        final_moves = 0.0
        high_final_moves = 0.0
        low_final_moves = 0.0
        del perfects[tf_choice_index]
        perfects.insert(tf_choice_index, "inactive")

    # keep threshold persisted in DB
    _runtime_db.upsert_memory(_safe, timeframe, perfect_threshold=perfect_threshold)

    # ====== ORIGINAL: compute new high/low predictions ======
    price_list2 = [openPrice, closePrice]
    current_pattern = [price_list2[0], price_list2[1]]

    try:
        c_diff = final_moves / 100
        high_diff = high_final_moves
        low_diff = low_final_moves

        start_price = current_pattern[len(current_pattern) - 1]
        high_new_price = start_price + (start_price * high_diff)
        low_new_price = start_price + (start_price * low_diff)
    except:
        start_price = current_pattern[len(current_pattern) - 1]
        high_new_price = start_price
        low_new_price = start_price

    if perfects[tf_choice_index] == "inactive":
        del high_tf_prices[tf_choice_index]
        high_tf_prices.insert(tf_choice_index, start_price)
        del low_tf_prices[tf_choice_index]
        low_tf_prices.insert(tf_choice_index, start_price)
    else:
        del high_tf_prices[tf_choice_index]
        high_tf_prices.insert(tf_choice_index, high_new_price)
        del low_tf_prices[tf_choice_index]
        low_tf_prices.insert(tf_choice_index, low_new_price)

    # ====== advance tf index; if full sweep complete, compute signals ======
    tf_choice_index += 1

    if tf_choice_index >= len(tf_choices):
        tf_choice_index = 0

        # reset tf_update for this ticker (but DO NOT block-wait; just detect updates and return)
        tf_update = ["no"] * len(tf_choices)

        # get current price ONCE per ticker
        while True:
            try:
                current = market.get_current_price(sym)
                break
            except Exception:
                time.sleep(1)
                continue

        # IMPORTANT: messages printed below use the bounds currently in state.
        # We only allow "ready" once messages are generated using a non-startup bounds_version.
        bounds_version_used_for_messages = st.get("bounds_version", 0)

        # --- HARD GUARANTEE: all TF arrays stay length==len(tf_choices) (fallback placeholders) ---
        def _pad_to_len(lst, n, fill):
            if lst is None:
                lst = []
            if len(lst) < n:
                lst.extend([fill] * (n - len(lst)))
            elif len(lst) > n:
                del lst[n:]
            return lst

        n_tfs = len(tf_choices)

        # bounds: use your fake numbers when TF inactive / missing
        low_bound_prices = _pad_to_len(low_bound_prices, n_tfs, 0.01)
        high_bound_prices = _pad_to_len(high_bound_prices, n_tfs, 99999999999999999)

        # predicted prices: keep equal when missing so it never triggers LONG/SHORT
        high_tf_prices = _pad_to_len(high_tf_prices, n_tfs, current)
        low_tf_prices = _pad_to_len(low_tf_prices, n_tfs, current)

        # status arrays
        perfects = _pad_to_len(perfects, n_tfs, "inactive")
        training_issues = _pad_to_len(training_issues, n_tfs, 0)
        messages = _pad_to_len(messages, n_tfs, "none")

        tf_sides = _pad_to_len(tf_sides, n_tfs, "none")
        messaged = _pad_to_len(messaged, n_tfs, "no")
        margins = _pad_to_len(margins, n_tfs, 0.0)
        updated = _pad_to_len(updated, n_tfs, 0)

        # per-timeframe message logic (same decisions as before)
        inder = 0
        while inder < len(tf_choices):
            # update the_time snapshot (same as before)
            while True:

                try:
                    history_list = market.get_kline(ticker, tf_choices[inder])
                    break
                except Exception as e:
                    time.sleep(3.5)
                    if "Requests" in str(e):
                        pass
                    else:
                        PrintException()
                    continue

            try:
                the_time = history_list[1][0]
            except Exception:
                the_time = 0.0

            # (original comparisons)
            if (
                current > high_bound_prices[inder]
                and high_tf_prices[inder] != low_tf_prices[inder]
            ):
                message = (
                    "SHORT on "
                    + tf_choices[inder]
                    + " timeframe. "
                    + format(
                        ((high_bound_prices[inder] - current) / abs(current)) * 100,
                        ".8f",
                    )
                    + " High Boundary: "
                    + str(high_bound_prices[inder])
                )
                if messaged[inder] != "yes":
                    del messaged[inder]
                    messaged.insert(inder, "yes")
                del margins[inder]
                margins.insert(
                    inder, ((high_tf_prices[inder] - current) / abs(current)) * 100
                )

                if "SHORT" in messages[inder]:
                    del messages[inder]
                    messages.insert(inder, message)
                    del updated[inder]
                    updated.insert(inder, 0)
                else:
                    del messages[inder]
                    messages.insert(inder, message)
                    del updated[inder]
                    updated.insert(inder, 1)

                del tf_sides[inder]
                tf_sides.insert(inder, "short")

            elif (
                current < low_bound_prices[inder]
                and high_tf_prices[inder] != low_tf_prices[inder]
            ):
                message = (
                    "LONG on "
                    + tf_choices[inder]
                    + " timeframe. "
                    + format(
                        ((low_bound_prices[inder] - current) / abs(current)) * 100,
                        ".8f",
                    )
                    + " Low Boundary: "
                    + str(low_bound_prices[inder])
                )
                if messaged[inder] != "yes":
                    del messaged[inder]
                    messaged.insert(inder, "yes")

                del margins[inder]
                margins.insert(
                    inder, ((low_tf_prices[inder] - current) / abs(current)) * 100
                )

                del tf_sides[inder]
                tf_sides.insert(inder, "long")

                if "LONG" in messages[inder]:
                    del messages[inder]
                    messages.insert(inder, message)
                    del updated[inder]
                    updated.insert(inder, 0)
                else:
                    del messages[inder]
                    messages.insert(inder, message)
                    del updated[inder]
                    updated.insert(inder, 1)

            else:
                if perfects[inder] == "inactive":
                    if training_issues[inder] == 1:
                        message = (
                            "INACTIVE (training data issue) on "
                            + tf_choices[inder]
                            + " timeframe."
                            + " Low Boundary: "
                            + str(low_bound_prices[inder])
                            + " High Boundary: "
                            + str(high_bound_prices[inder])
                        )
                    else:
                        message = (
                            "INACTIVE on "
                            + tf_choices[inder]
                            + " timeframe."
                            + " Low Boundary: "
                            + str(low_bound_prices[inder])
                            + " High Boundary: "
                            + str(high_bound_prices[inder])
                        )
                else:
                    message = (
                        "WITHIN on "
                        + tf_choices[inder]
                        + " timeframe."
                        + " Low Boundary: "
                        + str(low_bound_prices[inder])
                        + " High Boundary: "
                        + str(high_bound_prices[inder])
                    )

                del margins[inder]
                margins.insert(inder, 0.0)

                if message == messages[inder]:
                    del messages[inder]
                    messages.insert(inder, message)
                    del updated[inder]
                    updated.insert(inder, 0)
                else:
                    del messages[inder]
                    messages.insert(inder, message)
                    del updated[inder]
                    updated.insert(inder, 1)

                del tf_sides[inder]
                tf_sides.insert(inder, "none")

                del messaged[inder]
                messaged.insert(inder, "no")

            inder += 1

        # rebuild bounds (same math as before)
        prices_index = 0
        low_bound_prices = []
        high_bound_prices = []
        while True:
            new_low_price = low_tf_prices[prices_index] - (
                low_tf_prices[prices_index] * (distance / 100)
            )
            new_high_price = high_tf_prices[prices_index] + (
                high_tf_prices[prices_index] * (distance / 100)
            )
            if perfects[prices_index] != "inactive":
                low_bound_prices.append(new_low_price)
                high_bound_prices.append(new_high_price)
            else:
                low_bound_prices.append(0.01)
                high_bound_prices.append(99999999999999999)

            prices_index += 1
            if prices_index >= len(high_tf_prices):
                break

        new_low_bound_prices = sorted(low_bound_prices)
        new_low_bound_prices.reverse()
        new_high_bound_prices = sorted(high_bound_prices)

        og_index = 0
        og_low_index_list = []
        og_high_index_list = []
        while True:
            og_low_index_list.append(
                low_bound_prices.index(new_low_bound_prices[og_index])
            )
            og_high_index_list.append(
                high_bound_prices.index(new_high_bound_prices[og_index])
            )
            og_index += 1
            if og_index >= len(low_bound_prices):
                break

        og_index = 0
        gap_modifier = 0.0
        while True:
            if (
                new_low_bound_prices[og_index] == 0.01
                or new_low_bound_prices[og_index + 1] == 0.01
                or new_high_bound_prices[og_index] == 99999999999999999
                or new_high_bound_prices[og_index + 1] == 99999999999999999
            ):
                pass
            else:
                try:
                    low_perc_diff = (
                        abs(
                            new_low_bound_prices[og_index]
                            - new_low_bound_prices[og_index + 1]
                        )
                        / (
                            (
                                new_low_bound_prices[og_index]
                                + new_low_bound_prices[og_index + 1]
                            )
                            / 2
                        )
                    ) * 100
                except:
                    low_perc_diff = 0.0
                try:
                    high_perc_diff = (
                        abs(
                            new_high_bound_prices[og_index]
                            - new_high_bound_prices[og_index + 1]
                        )
                        / (
                            (
                                new_high_bound_prices[og_index]
                                + new_high_bound_prices[og_index + 1]
                            )
                            / 2
                        )
                    ) * 100
                except:
                    high_perc_diff = 0.0

                if (
                    low_perc_diff < 0.25 + gap_modifier
                    or new_low_bound_prices[og_index + 1]
                    > new_low_bound_prices[og_index]
                ):
                    new_price = new_low_bound_prices[og_index + 1] - (
                        new_low_bound_prices[og_index + 1] * 0.0005
                    )
                    del new_low_bound_prices[og_index + 1]
                    new_low_bound_prices.insert(og_index + 1, new_price)
                    continue

                if (
                    high_perc_diff < 0.25 + gap_modifier
                    or new_high_bound_prices[og_index + 1]
                    < new_high_bound_prices[og_index]
                ):
                    new_price = new_high_bound_prices[og_index + 1] + (
                        new_high_bound_prices[og_index + 1] * 0.0005
                    )
                    del new_high_bound_prices[og_index + 1]
                    new_high_bound_prices.insert(og_index + 1, new_price)
                    continue

            og_index += 1
            gap_modifier += 0.25
            if og_index >= len(new_low_bound_prices) - 1:
                break

        og_index = 0
        low_bound_prices = []
        high_bound_prices = []
        while True:
            try:
                low_bound_prices.append(
                    new_low_bound_prices[og_low_index_list.index(og_index)]
                )
            except:
                pass
            try:
                high_bound_prices.append(
                    new_high_bound_prices[og_high_index_list.index(og_index)]
                )
            except:
                pass
            og_index += 1
            if og_index >= len(new_low_bound_prices):
                break

        # bump bounds_version now that we've computed a new set of prediction bounds
        st["bounds_version"] = bounds_version_used_for_messages + 1

        _runtime_db.upsert_signals(_safe,
            low_bound_prices=new_low_bound_prices,
            high_bound_prices=new_high_bound_prices,
        )

        # cache display text for this ticker (main loop prints everything on one screen)
        try:
            display_cache[sym] = (
                sym + "  " + str(current) + "\n\n" + str(messages).replace("', '", "\n")
            )

            # The GUI-visible messages were generated using the bounds_version that was in state at the
            # start of this full-sweep (before we rebuilt bounds above).
            st["last_display_bounds_version"] = bounds_version_used_for_messages

            # Only consider this ticker "ready" once we've already rebuilt bounds at least once
            # AND we're now printing messages generated from those rebuilt bounds.
            if (
                st["last_display_bounds_version"] >= 1
            ) and _is_printing_real_predictions(messages):
                _ready_tickers.add(sym)
            else:
                _ready_tickers.discard(sym)

            all_ready = len(_ready_tickers) >= len(CURRENT_TICKERS)
            _write_runner_ready(
                all_ready,
                stage=("real_predictions" if all_ready else "warming_up"),
                ready_tickers=sorted(list(_ready_tickers)),
                total_tickers=len(CURRENT_TICKERS),
            )

        except:
            PrintException()

        # write PM + DCA signals (same as before)
        try:
            longs = tf_sides.count("long")
            shorts = tf_sides.count("short")

            # long pm
            current_pms = [m for m in margins if m != 0]
            try:
                pm = sum(current_pms) / len(current_pms)
                if pm < 0.25:
                    pm = 0.25
            except:
                pm = 0.25

            _runtime_db.upsert_signals(_safe,
                long_profit_margin=pm,
                long_dca_signal=longs,
            )

            # short pm
            current_pms = [m for m in margins if m != 0]
            try:
                pm = sum(current_pms) / len(current_pms)
                if pm < 0.25:
                    pm = 0.25
            except:
                pm = 0.25

            _runtime_db.upsert_signals(_safe,
                short_profit_margin=abs(pm),
                short_dca_signal=shorts,
            )

        except:
            PrintException()

        # ====== NON-BLOCKING candle update check (single pass) ======
        this_index_now = 0
        while this_index_now < len(tf_update):
            while True:
                try:
                    history_list = market.get_kline(ticker, tf_choices[this_index_now])
                    break
                except Exception as e:
                    time.sleep(3.5)
                    if "Requests" in str(e):
                        pass
                    else:
                        PrintException()
                    continue

            try:
                the_time = history_list[1][0]
            except Exception:
                the_time = 0.0

            if the_time != tf_times[this_index_now]:
                del tf_update[this_index_now]
                tf_update.insert(this_index_now, "yes")
                del tf_times[this_index_now]
                tf_times.insert(this_index_now, the_time)

            this_index_now += 1

    # ====== save state back ======
    st["low_bound_prices"] = low_bound_prices
    st["high_bound_prices"] = high_bound_prices
    st["tf_times"] = tf_times
    st["tf_choice_index"] = tf_choice_index

    # persist readiness gating fields
    st["bounds_version"] = st.get("bounds_version", 0)
    st["last_display_bounds_version"] = st.get("last_display_bounds_version", -1)

    st["tf_update"] = tf_update
    st["messages"] = messages
    st["last_messages"] = last_messages
    st["margins"] = margins

    st["high_tf_prices"] = high_tf_prices
    st["low_tf_prices"] = low_tf_prices
    st["tf_sides"] = tf_sides
    st["messaged"] = messaged
    st["updated"] = updated
    st["perfects"] = perfects
    st["training_issues"] = training_issues

    states[sym] = st


try:
    while True:
        # Hot-reload tickers from GUI settings while running
        _sync_tickers_from_settings()

        for _sym in CURRENT_TICKERS:
            step_ticker(_sym)

        # clear + re-print one combined screen (so you don't see old output above new)
        os.system("cls" if os.name == "nt" else "clear")

        for _sym in CURRENT_TICKERS:
            print(display_cache.get(_sym, _sym + "  (no data yet)"))
            print("\n" + ("-" * 60) + "\n")

        # small sleep so you don't peg CPU when running many tickers
        time.sleep(0.15)

except Exception:
    PrintException()
