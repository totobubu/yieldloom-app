# NEW FILE: scripts/utils.py
import json
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
DEFAULT_DATA_LAYOUT = os.environ.get("DATA_LAYOUT_MODE", "flat").lower()

MARKET_SUBDIR_ALIASES = {
    "KOSPI": "kospi",
    "KOSDAQ": "kosdaq",
    "KONEX": "konex",
    "KRX (KOSPI)": "kospi",
    "KRX (KOSDAQ)": "kosdaq",
    "KRX": "krx",
    "NYSE": "nyse",
    "NASDAQ": "nasdaq",
    "AMEX": "amex",
    "N/A": "misc",
}

SUFFIX_TO_MARKET = {
    ".KS": "KOSPI",
    ".KQ": "KOSDAQ",
    ".KN": "KONEX",
    ".KO": "KOSPI",
}

KRX_SUFFIXES = {".KS", ".KQ", ".KN", ".KO"}


def get_kst_now():
    return datetime.now(timezone(timedelta(hours=9)))


def load_json_file(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        # 로컬에 없으면 R2에서 조회 (Lazy Loading)
        r2_url = os.environ.get("R2_PUBLIC_URL")
        if r2_url:
            try:
                import requests
                
                # 절대 경로에서 public/ 이후 경로 추출
                # 예: .../public/data/aapl.json -> data/aapl.json
                path_str = str(file_path).replace("\\", "/")
                if "public/" in path_str:
                    relative_path = path_str.split("public/", 1)[1]
                    full_url = f"{r2_url.rstrip('/')}/{relative_path}"
                    
                    response = requests.get(full_url, timeout=10)
                    if response.status_code == 200:
                        # print(f"ℹ️ Loaded from R2: {relative_path}")
                        return response.json()
            except Exception:
                pass
        return None


def save_json_file(file_path, data, indent=4):
    try:
        # JSON 순서 보장: tickerInfo → backtestData → 기타
        if isinstance(data, dict):
            ordered_data = {}
            # 1순위: tickerInfo
            if "tickerInfo" in data:
                ordered_data["tickerInfo"] = data["tickerInfo"]
            # 2순위: dividendTotal (있는 경우)
            if "dividendTotal" in data:
                ordered_data["dividendTotal"] = data["dividendTotal"]
            # 3순위: backtestData
            if "backtestData" in data:
                ordered_data["backtestData"] = data["backtestData"]
            # 나머지 필드들
            for key in data:
                if key not in ["tickerInfo", "dividendTotal", "backtestData"]:
                    ordered_data[key] = data[key]
            data = ordered_data

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent, ensure_ascii=False)
        return True
    except IOError as e:
        print(f"  -> Error saving file {file_path}: {e}")
        return False


def sanitize_symbol(symbol):
    if not symbol:
        return ""
    # 접미사 제거 후 base symbol만 사용
    base = get_base_symbol(symbol) or symbol
    return base.replace(".", "-").replace("/", "-").lower()


def sanitize_ticker_for_filename(ticker):
    # 접미사 제거 후 base symbol만 사용
    base = get_base_symbol(ticker) or ticker
    return base.replace(".", "-").replace("/", "-").lower()


def build_data_filename(symbol):
    # 접미사(.KS, .KQ 등) 제거하고 base symbol만 사용
    base = get_base_symbol(symbol) or symbol
    slug = base.replace(".", "-").replace("/", "-").lower()
    return f"{slug}.json"


def normalize_market_name(market):
    if not market:
        return None
    normalized = str(market).strip().upper()
    if not normalized:
        return None
    return {
        "KRX (KOSPI)": "KOSPI",
        "KRX (KOSDAQ)": "KOSDAQ",
        "KRX-KOSPI": "KOSPI",
        "KRX-KOSDAQ": "KOSDAQ",
        "KRX": "KRX",
        "KO": "KOSPI",
        "KOSPI": "KOSPI",
        "KOSDAQ": "KOSDAQ",
        "KONEX": "KONEX",
    }.get(normalized, normalized)


def detect_market_from_symbol(symbol):
    if not symbol:
        return None
    upper_symbol = symbol.upper()
    for suffix, market in SUFFIX_TO_MARKET.items():
        if upper_symbol.endswith(suffix):
            return market
    return None


def get_base_symbol(symbol):
    if not symbol:
        return None
    normalized = str(symbol).strip().upper()
    if not normalized:
        return None
    for suffix in KRX_SUFFIXES:
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)]
    return normalized


def get_market_subdirectory(market):
    normalized = normalize_market_name(market) or "MISC"
    return MARKET_SUBDIR_ALIASES.get(normalized, normalized.lower())


def get_data_file_path(symbol, market=None, *, layout=None, ensure_dir=False):
    """
    Resolve the JSON data file path for a ticker based on the selected layout.

    Args:
        symbol (str): Yahoo Finance symbol (e.g. "005930.KS")
        market (str, optional): Explicit market name.
        layout (str, optional): "flat" (default) or "market"/"v2".
        ensure_dir (bool): create parent directory if missing.

    Returns:
        pathlib.Path: Absolute path to the JSON file.
    """

    filename = build_data_filename(symbol)
    layout_mode = (layout or DEFAULT_DATA_LAYOUT or "flat").lower()
    target = DATA_DIR

    if layout_mode in {"market", "v2"}:
        market_name = market or detect_market_from_symbol(symbol)
        subdir = get_market_subdirectory(market_name)
        target = target / subdir

    target_path = target / filename
    if ensure_dir:
        target_path.parent.mkdir(parents=True, exist_ok=True)
    return target_path


def parse_numeric_value(value_str):
    if value_str is None:
        return None
    if isinstance(value_str, (int, float)):
        return float(value_str)
    value_str = str(value_str).strip()
    cleaned_str = re.sub(r"[^0-9.-]", "", value_str)
    if not cleaned_str or cleaned_str == ".":
        return None
    try:
        return float(cleaned_str)
    except ValueError:
        return None


def should_skip_update_timestamp(old_update_str, data_changed):
    """
    Update 필드를 변경할지 여부를 결정합니다.

    Args:
        old_update_str: 기존 Update 필드 값 (예: "2024-01-01 12:00:00 KST")
        data_changed: 실제 데이터 변경 여부 (bool)

    Returns:
        bool: True면 Update 필드를 변경하지 않음 (skip), False면 Update 필드 변경

    정책:
    - 데이터 변경이 있으면 항상 Update 필드 갱신 (False 반환)
    - 데이터 변경이 없으면 항상 Update 필드 유지 (True 반환)
    - 기존 Update 필드가 없으면 새로 생성 (False 반환)
    """
    # 데이터 변경이 있으면 항상 Update 필드 갱신
    if data_changed:
        return False

    # 기존 Update 필드가 없으면 갱신
    if not old_update_str:
        return False

    # 데이터 변경이 없고 기존 Update가 있으면 그대로 유지
    return True
