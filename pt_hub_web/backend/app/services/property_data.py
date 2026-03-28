"""
Fetch Australian property suburb metrics from free external sources using Crawl4AI.

Sources (all free, no API keys required):
  1. OpenAgent — suburb profiles with median prices, rent, days on market, population
  2. realestate.com.au — neighbourhood profiles (JS-rendered, needs headless browser)
  3. SQM Research — vacancy rates

Crawl4AI provides headless browser scraping with stealth mode to bypass anti-bot.
"""

import json
import re
import time
from datetime import datetime
from typing import Optional

import httpx

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    _HAS_CRAWL4AI = True
except ImportError:
    _HAS_CRAWL4AI = False
    AsyncWebCrawler = None  # type: ignore

# ── Singleton crawler (started/stopped via lifespan in main.py) ──
_crawler: Optional["AsyncWebCrawler"] = None

if _HAS_CRAWL4AI:
    _browser_config = BrowserConfig(
        headless=True,
        verbose=False,
        browser_type="chromium",
    )

    _run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=30000,
        wait_until="domcontentloaded",
        verbose=False,
    )


async def start_crawler():
    """Call from FastAPI lifespan startup."""
    global _crawler
    if not _HAS_CRAWL4AI:
        print("[property_data] Crawl4AI not installed, using httpx fallback")
        return
    try:
        _crawler = AsyncWebCrawler(config=_browser_config)
        await _crawler.start()
        print("[property_data] Crawl4AI browser started")
    except Exception as e:
        _crawler = None
        print(f"[property_data] Crawl4AI unavailable, using httpx fallback: {e}")


async def stop_crawler():
    """Call from FastAPI lifespan shutdown."""
    global _crawler
    if _crawler:
        await _crawler.close()
        _crawler = None
        print("[property_data] Crawl4AI browser stopped")


_HTTPX_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
}


async def _crawl(url: str, wait_for: Optional[str] = None) -> Optional[str]:
    """Crawl a URL and return the page markdown. Falls back to raw HTML via httpx."""
    if _crawler:
        try:
            config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=30000,
                wait_until="domcontentloaded",
                verbose=False,
                wait_for=wait_for,
            )
            result = await _crawler.arun(url=url, config=config)
            if result.success:
                return result.markdown.raw_markdown if hasattr(result.markdown, 'raw_markdown') else str(result.markdown)
            else:
                print(f"[property_data] Crawl failed for {url}: {result.error_message}")
        except Exception as e:
            print(f"[property_data] Crawl error for {url}: {e}")

    # Fallback: return raw HTML (regex patterns work on both markdown and HTML)
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, headers=_HTTPX_HEADERS, timeout=20.0)
            if resp.status_code == 200:
                return resp.text
    except Exception as e:
        print(f"[property_data] httpx fallback error for {url}: {e}")
    return None


async def _crawl_html(url: str) -> Optional[str]:
    """Crawl a URL and return raw HTML. Uses Crawl4AI if available, else httpx fallback."""
    if _crawler:
        try:
            config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=30000,
                wait_until="domcontentloaded",
                verbose=False,
            )
            result = await _crawler.arun(url=url, config=config)
            if result.success:
                return result.html
        except Exception as e:
            print(f"[property_data] Crawl error for {url}: {e}")

    # Fallback to httpx when Crawl4AI is unavailable
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, headers=_HTTPX_HEADERS, timeout=20.0)
            if resp.status_code == 200:
                return resp.text
            print(f"[property_data] httpx returned {resp.status_code} for {url}")
    except Exception as e:
        print(f"[property_data] httpx error for {url}: {e}")
    return None


# ── Cache ──────────────────────────────────────────────────────
_suburb_cache: dict[str, dict] = {}
_CACHE_TTL = 3600  # 1 hour


def _get_property_db():
    from app.config import property_db
    return property_db


def _parse_dollar(text: str) -> Optional[float]:
    """Parse '$1.32M', '$630K', '$800', '$1,200' into float."""
    text = text.strip().replace(",", "").replace("$", "")
    multiplier = 1
    if text.upper().endswith("M"):
        multiplier = 1_000_000
        text = text[:-1]
    elif text.upper().endswith("K"):
        multiplier = 1_000
        text = text[:-1]
    try:
        return float(text) * multiplier
    except ValueError:
        return None


def _parse_int(text: str) -> Optional[int]:
    try:
        return int(text.strip().replace(",", ""))
    except ValueError:
        return None


# ── Source 1: OpenAgent (headless browser) ─────────────────────

def _oa_field(text: str, field: str) -> Optional[float]:
    """Extract a numeric field from OpenAgent's embedded JSON blob."""
    match = re.search(rf'{field}["\\\\ ]*:\s*([\d.eE+-]+|null)', text)
    if match and match.group(1) != "null":
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


async def _scrape_openagent(suburb: str, state: str, postcode: str) -> list[dict]:
    """
    Scrape suburb data from OpenAgent.com.au using Crawl4AI headless browser.
    OpenAgent embeds a structured JSON blob in the HTML with median prices,
    rent, DOM, growth rates, clearance rates, and more. We extract per-field
    via regex, then fall back to markdown-based patterns.
    """
    slug = suburb.lower().replace(" ", "-")
    url = f"https://www.openagent.com.au/suburb-profiles/{slug}-{postcode}"
    metrics = []
    today = datetime.now().strftime("%Y-%m")

    # Get raw HTML for JSON field extraction
    html = await _crawl_html(url)
    if not html:
        return []

    # ── JSON field extraction (primary method) ────────────────
    house_price = _oa_field(html, "medianSalePrice3MonthsHouse")
    unit_price = _oa_field(html, "medianSalePrice3MonthsUnit")
    house_rent = _oa_field(html, "medianRent12MonthsHouse")
    unit_rent = _oa_field(html, "medianRent12MonthsUnit")
    dom_house = _oa_field(html, "medianDaysOnMarket12MonthsHouse")
    clearance_house = _oa_field(html, "clearanceRate1MonthHouse")
    growth_house = _oa_field(html, "medianSaleChange12MonthsHouse")
    growth_unit = _oa_field(html, "medianSaleChange12MonthsUnit")

    if house_price and house_price > 10_000:
        metrics.append({"metric_type": "median_house_price", "value": house_price, "date": today, "source": "openagent"})
    if unit_price and unit_price > 10_000:
        metrics.append({"metric_type": "median_unit_price", "value": unit_price, "date": today, "source": "openagent"})
    if house_rent and 50 < house_rent < 5_000:
        metrics.append({"metric_type": "median_rent_house", "value": house_rent, "date": today, "source": "openagent"})
    if unit_rent and 50 < unit_rent < 5_000:
        metrics.append({"metric_type": "median_rent_unit", "value": unit_rent, "date": today, "source": "openagent"})
    if dom_house and 0 < dom_house < 365:
        metrics.append({"metric_type": "days_on_market", "value": dom_house, "date": today, "source": "openagent"})
    if clearance_house and 0 < clearance_house <= 100:
        metrics.append({"metric_type": "auction_clearance", "value": clearance_house, "date": today, "source": "openagent"})

    # Growth rates (decimal → percentage, e.g. 0.237 → 23.7)
    if growth_house is not None:
        metrics.append({"metric_type": "annual_growth_house", "value": round(growth_house * 100, 1), "date": today, "source": "openagent"})
    if growth_unit is not None:
        metrics.append({"metric_type": "annual_growth_unit", "value": round(growth_unit * 100, 1), "date": today, "source": "openagent"})

    # Yield: calculate from price + rent if both available
    if house_price and house_rent and house_price > 0:
        yield_house = round((house_rent * 52) / house_price * 100, 2)
        metrics.append({"metric_type": "yield_gross", "value": yield_house, "date": today, "source": "openagent"})

    # ── Markdown fallback for population + missing fields ─────
    if not house_price or not unit_price:
        markdown = await _crawl(url)
        if markdown:
            if not house_price:
                m = re.search(r'(?:Houses?|Median\s+house\s+price)[^\n$]{0,120}?\$\s*([\d,.]+[KMkm]?)', markdown, re.IGNORECASE)
                if m:
                    val = _parse_dollar(m.group(1))
                    if val and val > 10_000:
                        metrics.append({"metric_type": "median_house_price", "value": val, "date": today, "source": "openagent"})

            if not unit_price:
                m = re.search(r'(?:Units?|Apartments?|Median\s+unit\s+price)[^\n$]{0,120}?\$\s*([\d,.]+[KMkm]?)', markdown, re.IGNORECASE)
                if m:
                    val = _parse_dollar(m.group(1))
                    if val and val > 10_000:
                        metrics.append({"metric_type": "median_unit_price", "value": val, "date": today, "source": "openagent"})

    # ── Historical yearly median prices (houseData/unitData) ───
    house_history: list[tuple[str, float]] = []
    for field, metric_type in [("houseData", "median_house_price"), ("unitData", "median_unit_price")]:
        match = re.search(rf'{field}["\\\\ ]*:\s*(\[.*?\])', html, re.DOTALL)
        if match:
            raw = match.group(1).replace('\\"', '"').replace('\\\\"', '"')
            pairs = re.findall(r'"year":\s*"(\d{4})",\s*"value":\s*(\d+)', raw)
            for year, val in pairs:
                metrics.append({
                    "metric_type": metric_type,
                    "value": float(val),
                    "date": f"{year}-12",
                    "source": "openagent",
                })
                if metric_type == "median_house_price":
                    house_history.append((year, float(val)))

    # ── Back-calculate historical rent + yield from price history ──
    rent_change = _oa_field(html, "medianRentChange12MonthsHouse")
    if house_rent and house_history and rent_change is not None:
        current_year = datetime.now().year
        growth = max(rent_change, 0.005)  # floor at 0.5% to avoid flat lines
        for year_str, price in house_history:
            year = int(year_str)
            years_back = current_year - year
            if years_back <= 0:
                continue
            est_rent = house_rent / ((1 + growth) ** years_back)
            metrics.append({
                "metric_type": "median_rent_house",
                "value": round(est_rent, 0),
                "date": f"{year_str}-12",
                "source": "openagent",
            })
            # Also derive historical yield
            if price > 0:
                est_yield = round((est_rent * 52) / price * 100, 2)
                metrics.append({
                    "metric_type": "yield_gross",
                    "value": est_yield,
                    "date": f"{year_str}-12",
                    "source": "openagent",
                })

    # Population (not in JSON blob, extract from HTML text)
    pop_match = re.search(r'(?:Population)[^0-9]{0,30}?([\d,]+)', html, re.IGNORECASE)
    if pop_match:
        val = _parse_int(pop_match.group(1))
        if val and val > 0:
            metrics.append({"metric_type": "population", "value": float(val), "date": today, "source": "openagent"})

    return metrics


# ── Source 2: realestate.com.au (headless browser) ─────────────

async def _scrape_rea_suburb(suburb: str, state: str, postcode: str) -> list[dict]:
    """
    Scrape realestate.com.au neighbourhood profiles using headless browser.
    REA is heavily JS-rendered and blocks raw HTTP — Crawl4AI handles this.
    """
    slug = suburb.lower().replace(" ", "-")
    state_lower = state.lower()
    url = f"https://www.realestate.com.au/neighbourhoods/{slug}-{postcode}-{state_lower}"
    metrics = []
    today = datetime.now().strftime("%Y-%m")

    # Try HTML first for embedded JSON data
    html = await _crawl_html(url)
    if not html:
        return []

    # REA embeds structured data in JSON within script tags
    json_data = re.search(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL)
    if json_data:
        try:
            ld = json.loads(json_data.group(1))
            # Try to extract from structured data
            if isinstance(ld, dict):
                for key in ("medianSoldPrice", "medianPrice"):
                    if key in ld:
                        val = float(ld[key])
                        if val > 10000:
                            metrics.append({"metric_type": "median_house_price", "value": val, "date": today, "source": "rea"})
                            break
        except (json.JSONDecodeError, ValueError):
            pass

    # Also try __NEXT_DATA__ or embedded JSON props
    next_data = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if next_data:
        try:
            nd = json.loads(next_data.group(1))
            props = nd.get("props", {}).get("pageProps", {})
            suburb_data = props.get("suburbProfile", props.get("suburb", {}))
            if isinstance(suburb_data, dict):
                median = suburb_data.get("medianSoldPrice") or suburb_data.get("medianPrice")
                if median:
                    val = float(median)
                    if val > 10000 and not any(m["metric_type"] == "median_house_price" for m in metrics):
                        metrics.append({"metric_type": "median_house_price", "value": val, "date": today, "source": "rea"})

                rent = suburb_data.get("medianRentPrice") or suburb_data.get("medianRent")
                if rent:
                    val = float(rent)
                    if 50 < val < 5000:
                        metrics.append({"metric_type": "median_rent_house", "value": val, "date": today, "source": "rea"})
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    # Fallback: regex on raw HTML for inline JSON props
    if not any(m["metric_type"] == "median_house_price" for m in metrics):
        price_match = re.search(r'"medianSoldPrice"\s*:\s*(\d+)', html)
        if price_match:
            val = float(price_match.group(1))
            if val > 10000:
                metrics.append({"metric_type": "median_house_price", "value": val, "date": today, "source": "rea"})

    if not any(m["metric_type"] == "median_rent_house" for m in metrics):
        rent_match = re.search(r'"medianRentPrice"\s*:\s*(\d+)', html)
        if rent_match:
            val = float(rent_match.group(1))
            if 50 < val < 5000:
                metrics.append({"metric_type": "median_rent_house", "value": val, "date": today, "source": "rea"})

    # Markdown fallback for text-based extraction
    if not metrics:
        markdown = await _crawl(url)
        if markdown:
            house_match = re.search(
                r'(?:median|house)\s*(?:price|value)[^\n$]*?\$\s*([\d,.]+[KMkm]?)',
                markdown, re.IGNORECASE
            )
            if house_match:
                val = _parse_dollar(house_match.group(1))
                if val and val > 10000:
                    metrics.append({"metric_type": "median_house_price", "value": val, "date": today, "source": "rea"})

    return metrics


# ── Source 3: SQM Research (headless browser) ──────────────────

async def _scrape_sqm_vacancy(suburb: str, state: str) -> list[dict]:
    """Scrape vacancy rate from SQM Research using headless browser."""
    slug = suburb.lower().replace(" ", "-")
    state_lower = state.lower()
    url = f"https://sqmresearch.com.au/graph_vacancy.php?region={state_lower}%3A%3A{slug}&type=c&t=1"

    markdown = await _crawl(url)
    if not markdown:
        return []

    match = re.search(r"Vacancy Rate.*?(\d+\.?\d*)%", markdown, re.IGNORECASE | re.DOTALL)
    if match:
        return [{
            "metric_type": "vacancy_rate",
            "value": float(match.group(1)),
            "date": datetime.now().strftime("%Y-%m"),
            "source": "sqm_research",
        }]
    return []


# ── Valuation history from OpenAgent suburb median prices ─────

async def fetch_valuation_history(suburb: str, state: str, postcode: str, property_type: str = "house") -> list[dict]:
    """
    Fetch yearly median price history from OpenAgent for a suburb.
    Returns list of {date, value, source} suitable for property valuations.
    """
    slug = suburb.lower().replace(" ", "-")
    url = f"https://www.openagent.com.au/suburb-profiles/{slug}-{postcode}"

    html = await _crawl_html(url)
    if not html:
        return []

    field = "unitData" if property_type in ("apartment", "unit") else "houseData"
    match = re.search(rf'{field}["\\\\ ]*:\s*(\[.*?\])', html, re.DOTALL)
    if not match:
        return []

    raw = match.group(1).replace('\\"', '"').replace('\\\\"', '"')
    pairs = re.findall(r'"year":\s*"(\d{4})",\s*"value":\s*(\d+)', raw)

    valuations = []
    for year, val in pairs:
        valuations.append({
            "date": f"{year}-12-31",
            "estimated_value": float(val),
            "source": "openagent",
        })
    return valuations


# ── Main: Refresh suburb data from all sources ─────────────────

async def refresh_suburb_data(suburb: str, state: str, postcode: str) -> dict:
    """
    Fetch suburb metrics from all available free sources and store in DB.
    Uses Crawl4AI headless browser for reliable scraping.
    """
    cache_key = f"{suburb}:{state}"
    if cache_key in _suburb_cache and time.time() - _suburb_cache[cache_key]["ts"] < _CACHE_TTL:
        return _suburb_cache[cache_key]["data"]

    db = _get_property_db()
    all_metrics: list[dict] = []
    sources_tried: list[str] = []
    errors: list[str] = []

    # 1. OpenAgent (best free source — median prices, rent, DOM, population)
    sources_tried.append("openagent")
    try:
        oa_metrics = await _scrape_openagent(suburb, state, postcode)
        all_metrics.extend(oa_metrics)
    except Exception as e:
        errors.append(f"openagent: {e}")

    # 2. realestate.com.au (fallback for prices — JS-rendered, needs headless)
    sources_tried.append("rea")
    try:
        rea_metrics = await _scrape_rea_suburb(suburb, state, postcode)
        existing_types = {m["metric_type"] for m in all_metrics}
        for m in rea_metrics:
            if m["metric_type"] not in existing_types:
                all_metrics.append(m)
    except Exception as e:
        errors.append(f"rea: {e}")

    # 3. SQM Research (vacancy rates)
    sources_tried.append("sqm_research")
    try:
        sqm_metrics = await _scrape_sqm_vacancy(suburb, state)
        all_metrics.extend(sqm_metrics)
    except Exception as e:
        errors.append(f"sqm: {e}")

    # Store all fetched metrics in DB
    stored = 0
    for m in all_metrics:
        try:
            db.upsert_suburb_metric(
                suburb=suburb.upper(),
                state=state.upper(),
                postcode=postcode,
                date=m["date"],
                metric_type=m["metric_type"],
                value=m["value"],
                source=m["source"],
            )
            stored += 1
        except Exception as e:
            errors.append(f"db: {e}")

    result = {
        "suburb": suburb,
        "state": state,
        "sources_tried": sources_tried,
        "metrics_fetched": len(all_metrics),
        "metrics_stored": stored,
        "errors": errors,
    }

    _suburb_cache[cache_key] = {"ts": time.time(), "data": result}
    return result
