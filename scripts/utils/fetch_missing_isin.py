"""
Fetch ISIN codes for symbols listed in ``public/missing_isin.json`` and update the
corresponding files under ``public/data``.

Usage:
    python scripts/fetch_missing_isin.py

    # optionally pass specific symbols
    python scripts/fetch_missing_isin.py --symbol 000080.KS --symbol YMAX
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Iterable, Optional

import requests
from bs4 import BeautifulSoup

try:  # pragma: no cover - optional dependency
    from playwright.sync_api import (
        TimeoutError as PlaywrightTimeoutError,
        sync_playwright,
    )
except ImportError:  # pragma: no cover - playwright is optional
    sync_playwright = None
    PlaywrightTimeoutError = Exception

try:  # pragma: no cover - optional dependency
    import cloudscraper
except ImportError:
    cloudscraper = None


ROOT_DIR = Path(__file__).resolve().parents[2]  # scripts/utils/ -> scripts/ -> 프로젝트 루트
MISSING_PATH = ROOT_DIR / "public" / "missing_isin.json"
DATA_DIR = ROOT_DIR / "public" / "data"
BASE_URL = "http://stockevents.app/kr/stock/{symbol}"
# BASE_URL = "https://kr.investing.com/etfs/{symbol}"
REQUEST_TIMEOUT = 10
REQUEST_SLEEP_SECONDS = 0.5
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/119.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "sec-ch-ua": '"Chromium";v="119", "Not?A_Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}

REQUEST_SESSION = (
    cloudscraper.create_scraper(browser={"custom": "Firefox"}, delay=10)
    if cloudscraper
    else requests.Session()
)
REQUEST_SESSION.headers.update(HEADERS)

INVESTING_SUFFIXES = (
    ".KS",
    ".KQ",
    ".KOSPI",
    ".KOSDAQ",
    ".KR",
)

KOREAN_SUFFIXES = (".KS", ".KQ")

SUFFIX_TO_MARKET = {
    ".KS": "KOSPI",
    ".KQ": "KOSDAQ",
}

NAV_DIR = ROOT_DIR / "public" / "nav"
SIDEBAR_FILES = [
    ROOT_DIR / "public" / "sidebar-tickers.json",
    ROOT_DIR / "public" / "sidebar" / "sidebar-tickers-kr-stocks.json",
    ROOT_DIR / "public" / "sidebar" / "sidebar-tickers-kr-etfs.json",
]


def ensure_yf_symbol(entry: dict, fallback_suffix: Optional[str]) -> bool:
    """yfSymbol을 설정"""
    if not fallback_suffix or not isinstance(entry, dict):
        return False
    symbol = entry.get("symbol")
    if not symbol:
        return False
    suffix_value = (
        fallback_suffix if fallback_suffix.startswith(".") else f".{fallback_suffix}"
    )
    yf_symbol = f"{symbol}{suffix_value}"
    # yfSymbol이 없거나 다르면 업데이트
    if entry.get("yfSymbol") != yf_symbol:
        entry["yfSymbol"] = yf_symbol
        return True
    return False


class FetchError(Exception):
    """Raised when ISIN cannot be fetched for a symbol."""


def load_missing_symbols() -> list[str]:
    with MISSING_PATH.open(encoding="utf-8") as fp:
        payload = json.load(fp)

    missing = payload.get("missing", [])
    return [entry["symbol"] for entry in missing if entry.get("symbol")]


def symbol_to_slug(symbol: str) -> str:
    slug = symbol.lower()
    for ch in (".", "/", "\\"):
        slug = slug.replace(ch, "-")
    return slug


def normalize_symbol_for_investing(symbol: str) -> str:
    upper_symbol = symbol.upper()
    for suffix in INVESTING_SUFFIXES:
        if upper_symbol.endswith(suffix):
            return symbol[: -len(suffix)]
    return symbol


def generate_symbol_variants(symbol: str) -> list[str]:
    variants: list[str] = [symbol]
    upper_symbol = symbol.upper()
    for suffix in KOREAN_SUFFIXES:
        if upper_symbol.endswith(suffix):
            base = symbol[: -len(suffix)]
            for alt_suffix in KOREAN_SUFFIXES:
                candidate = f"{base}{alt_suffix}"
                if candidate not in variants:
                    variants.append(candidate)
            break
    return variants


def format_symbol_for_fetch(symbol: str) -> str:
    if "investing.com" in BASE_URL:
        return normalize_symbol_for_investing(symbol)
    return symbol


def extract_suffix(symbol: str) -> Optional[str]:
    upper_symbol = symbol.upper()
    for suffix in SUFFIX_TO_MARKET:
        if upper_symbol.endswith(suffix):
            return suffix
    return None


def determine_market_from_symbol(symbol: str) -> Optional[str]:
    suffix = extract_suffix(symbol)
    if not suffix:
        return None
    return SUFFIX_TO_MARKET.get(suffix)


def nav_filename_for_symbol(symbol: str) -> str:
    if not symbol:
        return "unknown.json"
    first_char = symbol[0].lower()
    if first_char.isalnum():
        return f"{first_char}.json"
    return "unknown.json"


def load_json_array(path: Path) -> list:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as fp:
        return json.load(fp)


def dump_json(path: Path, payload) -> None:
    with path.open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, indent=4, ensure_ascii=False)
        fp.write("\n")


def update_nav_root(
    original_symbol: str,
    resolved_symbol: str,
    new_market: Optional[str],
    fallback_suffix: Optional[str] = None,
) -> Optional[dict]:
    nav_path = ROOT_DIR / "public" / "nav.json"
    if not nav_path.exists():
        return None

    with nav_path.open(encoding="utf-8") as fp:
        payload = json.load(fp)

    nav_entries = payload.get("nav")
    if not isinstance(nav_entries, list):
        return None

    changed = False
    resolved_entry_ref: Optional[dict] = None
    for entry in nav_entries:
        if not isinstance(entry, dict):
            continue

        if entry.get("symbol") == original_symbol:
            entry["symbol"] = resolved_symbol
            if new_market:
                entry["market"] = new_market
            if ensure_yf_symbol(entry, fallback_suffix):
                changed = True
            changed = True
            resolved_entry_ref = entry
        elif entry.get("symbol") == resolved_symbol:
            if new_market and entry.get("market") != new_market:
                entry["market"] = new_market
                changed = True
            if ensure_yf_symbol(entry, fallback_suffix):
                changed = True
            resolved_entry_ref = entry

    if changed:
        dump_json(nav_path, payload)

    if resolved_entry_ref is not None:
        return json.loads(json.dumps(resolved_entry_ref))

    return None


def update_sidebar_files(
    original_symbol: str, resolved_symbol: str, new_market: Optional[str]
) -> None:
    for path in SIDEBAR_FILES:
        if not path.exists():
            continue

        with path.open(encoding="utf-8") as fp:
            try:
                entries = json.load(fp)
            except json.JSONDecodeError:
                continue

        if not isinstance(entries, list):
            continue

        changed = False
        for entry in entries:
            if not isinstance(entry, dict):
                continue

            if entry.get("symbol") == original_symbol:
                entry["symbol"] = resolved_symbol
                if new_market:
                    entry["market"] = new_market
                changed = True
            elif entry.get("symbol") == resolved_symbol:
                if new_market and entry.get("market") != new_market:
                    entry["market"] = new_market
                    changed = True

        if changed:
            dump_json(path, entries)


def remove_from_nav_market(market: str, symbol: str) -> Optional[dict]:
    market_dir = NAV_DIR / market
    if not market_dir.exists():
        return None

    for json_file in sorted(market_dir.glob("*.json")):
        entries = load_json_array(json_file)
        if not isinstance(entries, list):
            continue

        for idx, entry in enumerate(entries):
            if isinstance(entry, dict) and entry.get("symbol") == symbol:
                removed = entries.pop(idx)
                dump_json(json_file, entries)
                return removed
    return None


def add_to_nav_market(
    market: str, symbol: str, entry: dict, fallback_suffix: Optional[str] = None
) -> None:
    market_dir = NAV_DIR / market
    market_dir.mkdir(parents=True, exist_ok=True)

    filename = nav_filename_for_symbol(symbol)
    target_path = market_dir / filename
    entries = load_json_array(target_path)
    if not isinstance(entries, list):
        entries = []

    # Remove duplicates of the resolved symbol if present
    entries = [
        existing
        for existing in entries
        if not (isinstance(existing, dict) and existing.get("symbol") == symbol)
    ]

    ensure_yf_suffix_fallback(entry, fallback_suffix)
    entries.append(entry)
    try:
        entries.sort(key=lambda item: item.get("symbol", ""))
    except Exception:
        pass

    dump_json(target_path, entries)


def relocate_data_file(
    original_symbol: str, resolved_symbol: str, new_market: Optional[str]
) -> None:
    old_slug = symbol_to_slug(original_symbol)
    new_slug = symbol_to_slug(resolved_symbol)
    old_path = DATA_DIR / f"{old_slug}.json"
    new_path = DATA_DIR / f"{new_slug}.json"

    target_path = new_path
    if old_path.exists() and old_path != new_path:
        if new_path.exists():
            print(
                f"[WARN] {original_symbol}: target data file {new_path} already exists; skipping rename",
                file=sys.stderr,
            )
        else:
            old_path.rename(new_path)
    elif not old_path.exists() and not new_path.exists():
        print(
            f"[WARN] {original_symbol}: data file not found for market update",
            file=sys.stderr,
        )
        return

    if new_path.exists():
        target_path = new_path
    else:
        target_path = old_path

    try:
        with target_path.open(encoding="utf-8") as fp:
            data = json.load(fp)
    except (OSError, json.JSONDecodeError) as exc:
        print(
            f"[WARN] {resolved_symbol}: failed to load data file {target_path} ({exc})",
            file=sys.stderr,
        )
        return

    ticker_info = data.get("tickerInfo")
    if isinstance(ticker_info, dict):
        ticker_info["Symbol"] = resolved_symbol
        if new_market:
            ticker_info["market"] = new_market
    else:
        print(
            f"[WARN] {resolved_symbol}: tickerInfo missing in {target_path}",
            file=sys.stderr,
        )

    with target_path.open("w", encoding="utf-8") as fp:
        json.dump(data, fp, indent=4, ensure_ascii=False)
        fp.write("\n")


def apply_market_adjustments(original_symbol: str, resolved_symbol: str) -> None:
    old_suffix = extract_suffix(original_symbol)
    new_suffix = extract_suffix(resolved_symbol)
    fallback_suffix = new_suffix

    if not new_suffix or old_suffix == new_suffix:
        return

    old_market = SUFFIX_TO_MARKET.get(old_suffix) if old_suffix else None
    new_market = SUFFIX_TO_MARKET.get(new_suffix)

    if not new_market or old_market == new_market:
        return

    relocate_data_file(original_symbol, resolved_symbol, new_market)
    resolved_entry = update_nav_root(
        original_symbol, resolved_symbol, new_market, fallback_suffix
    )
    update_sidebar_files(original_symbol, resolved_symbol, new_market)

    removed_entry = (
        remove_from_nav_market(old_market, original_symbol) if old_market else None
    )
    entry_to_add = removed_entry or resolved_entry
    if entry_to_add:
        if not isinstance(entry_to_add, dict):
            entry_to_add = {"symbol": resolved_symbol}
        entry_to_add = json.loads(json.dumps(entry_to_add))
        entry_to_add["symbol"] = resolved_symbol
        entry_to_add.pop("market", None)
        add_to_nav_market(new_market, resolved_symbol, entry_to_add, fallback_suffix)


def remove_symbols_from_missing(*symbols: str) -> None:
    if not symbols:
        return

    symbols_set = {symbol for symbol in symbols if symbol}
    if not symbols_set:
        return

    if not MISSING_PATH.exists():
        return

    with MISSING_PATH.open(encoding="utf-8") as fp:
        payload = json.load(fp)

    missing = payload.get("missing")
    if not isinstance(missing, list):
        return

    new_missing = [entry for entry in missing if entry.get("symbol") not in symbols_set]
    if len(new_missing) == len(missing):
        return

    payload["missing"] = new_missing
    dump_json(MISSING_PATH, payload)


def fetch_isin_via_requests(symbol: str) -> tuple[str, str]:
    errors: list[str] = []
    for candidate in generate_symbol_variants(symbol):
        formatted_symbol = format_symbol_for_fetch(candidate)
        url = BASE_URL.format(symbol=formatted_symbol)
        try:
            response = REQUEST_SESSION.get(url, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            errors.append(f"{candidate}: request failed ({exc})")
            continue

        if response.status_code != 200:
            errors.append(f"{candidate}: unexpected status code {response.status_code}")
            continue

        soup = BeautifulSoup(response.text, "lxml")
        target_div = None
        for div in soup.find_all("div", class_="font-semibold"):
            if div.get_text(strip=True) == "ISIN":
                target_div = div.find_next_sibling("div")
                break

        if target_div is None:
            errors.append(f"{candidate}: failed to locate ISIN element")
            continue

        isin = target_div.get_text(strip=True)
        if not isin:
            errors.append(f"{candidate}: ISIN element is empty")
            continue

        if candidate != symbol:
            print(f"[INFO] {symbol}: fetched using alternate suffix {candidate}")
        return isin, candidate

    raise FetchError("; ".join(errors) if errors else f"{symbol}: failed to fetch ISIN")


def fetch_isin_via_playwright(symbol: str) -> tuple[str, str]:
    if not sync_playwright:
        raise FetchError("Playwright is not available.")

    last_error: FetchError | None = None
    for candidate in generate_symbol_variants(symbol):
        formatted_symbol = format_symbol_for_fetch(candidate)
        url = BASE_URL.format(symbol=formatted_symbol)

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = None
                try:
                    context = browser.new_context(
                        user_agent=HEADERS["User-Agent"],
                        locale="ko-KR",
                    )
                    page = context.new_page()
                    page.goto(
                        url, wait_until="networkidle", timeout=REQUEST_TIMEOUT * 1000
                    )
                    locator = page.locator("div.font-semibold", has_text="ISIN")
                    if locator.count() == 0:
                        raise FetchError(
                            f"{candidate}: failed to locate ISIN label via Playwright"
                        )

                    isin_value = locator.first.evaluate(
                        "el => (el.nextElementSibling && el.nextElementSibling.textContent) || ''"
                    )
                finally:
                    if context is not None:
                        context.close()
                    browser.close()
        except (
            PlaywrightTimeoutError
        ) as exc:  # pragma: no cover - runtime error handling
            last_error = FetchError(f"{candidate}: Playwright navigation timeout")
            continue
        except FetchError as exc:
            last_error = exc
            continue
        except Exception as exc:  # pragma: no cover - unexpected Playwright failure
            last_error = FetchError(f"{candidate}: Playwright error {exc}")
            continue

        isin = (isin_value or "").strip()
        if not isin:
            last_error = FetchError(
                f"{candidate}: Playwright did not yield an ISIN value"
            )
            continue

        if candidate != symbol:
            print(
                f"[INFO] {symbol}: fetched via Playwright using alternate suffix {candidate}"
            )
        return isin, candidate

    if last_error:
        raise last_error
    raise FetchError(f"{symbol}: Playwright did not fetch ISIN")


def fetch_isin(symbol: str) -> tuple[str, str]:
    errors: list[str] = []

    if sync_playwright:
        try:
            return fetch_isin_via_playwright(symbol)
        except FetchError as exc:
            errors.append(str(exc))
        except Exception as exc:  # pragma: no cover - unexpected Playwright failure
            errors.append(f"{symbol}: Playwright error {exc}")

    try:
        return fetch_isin_via_requests(symbol)
    except FetchError as exc:
        errors.append(str(exc))
    except requests.RequestException as exc:
        errors.append(f"{symbol}: request failed ({exc})")

    raise FetchError("; ".join(errors))


def update_data_file(symbol: str, isin: str) -> bool:
    slug = symbol_to_slug(symbol)
    json_path = DATA_DIR / f"{slug}.json"

    if not json_path.exists():
        print(f"[WARN] {symbol}: data file not found at {json_path}", file=sys.stderr)
        return False

    with json_path.open(encoding="utf-8") as fp:
        data = json.load(fp)

    ticker_info = data.get("tickerInfo")
    if not isinstance(ticker_info, dict):
        print(
            f"[WARN] {symbol}: tickerInfo missing or not a dict in {json_path}",
            file=sys.stderr,
        )
        return False

    new_market = determine_market_from_symbol(symbol)
    if ticker_info.get("Symbol") != symbol:
        ticker_info["Symbol"] = symbol
    if new_market and ticker_info.get("market") != new_market:
        ticker_info["market"] = new_market

    previous = ticker_info.get("isin")
    if previous == isin:
        print(f"[SKIP] {symbol}: ISIN already set to {isin}")
        return True

    ticker_info["isin"] = isin

    with json_path.open("w", encoding="utf-8") as fp:
        json.dump(data, fp, indent=4, ensure_ascii=False)
        fp.write("\n")

    if previous:
        print(f"[UPDATE] {symbol}: {previous} -> {isin}")
    else:
        print(f"[UPDATE] {symbol}: set ISIN to {isin}")

    return True


def process_symbols(symbols: Iterable[str]) -> None:
    for idx, symbol in enumerate(symbols, start=1):
        try:
            isin, resolved_symbol = fetch_isin(symbol)
        except FetchError as exc:
            print(f"[ERROR] {exc}", file=sys.stderr)
            continue

        target_symbol = resolved_symbol
        if resolved_symbol != symbol:
            apply_market_adjustments(symbol, resolved_symbol)
            print(
                f"[INFO] {symbol}: remapped to {resolved_symbol} after suffix correction"
            )

        update_data_file(target_symbol, isin)
        remove_symbols_from_missing(symbol, resolved_symbol)

        if REQUEST_SLEEP_SECONDS:
            time.sleep(REQUEST_SLEEP_SECONDS)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch ISIN codes and update local data files."
    )
    parser.add_argument(
        "--symbol",
        dest="symbols",
        action="append",
        help="Limit the operation to specific symbol(s). Can be passed multiple times.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most this many symbols (useful when testing).",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip symbols whose data file already contains a non-null ISIN.",
    )
    return parser


def filter_symbols(symbols: Iterable[str], skip_existing: bool) -> list[str]:
    filtered: list[str] = []
    for symbol in symbols:
        if not skip_existing:
            filtered.append(symbol)
            continue

        slug = symbol_to_slug(symbol)
        json_path = DATA_DIR / f"{slug}.json"
        if not json_path.exists():
            filtered.append(symbol)
            continue

        with json_path.open(encoding="utf-8") as fp:
            data = json.load(fp)
        ticker_info = data.get("tickerInfo") or {}
        isin = ticker_info.get("isin")
        if isin:
            print(f"[SKIP] {symbol}: data file already has ISIN {isin}")
            continue

        filtered.append(symbol)
    return filtered


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.symbols:
        symbols = args.symbols
    else:
        symbols = load_missing_symbols()

    symbols = filter_symbols(symbols, skip_existing=args.skip_existing)

    if args.limit is not None:
        symbols = symbols[: args.limit]

    if not symbols:
        print("No symbols to process.")
        return 0

    print(f"Processing {len(symbols)} symbol(s)...")
    process_symbols(symbols)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
