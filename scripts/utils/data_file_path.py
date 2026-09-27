# scripts/utils/data_file_path.py
# 공통 데이터 파일 경로 유틸리티

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]  # scripts/utils/ -> scripts/ -> 프로젝트 루트
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"

MARKET_SUBDIR_ALIASES = {
    "KOSPI": "kospi",
    "KOSDAQ": "kosdaq",
    "KONEX": "konex",
    "KRX": "krx",
    "KRX (KOSPI)": "kospi",
    "KRX (KOSDAQ)": "kosdaq",
    "KRX-KOSPI": "kospi",
    "KRX-KOSDAQ": "kosdaq",
    "NYSE": "nyse",
    "NASDAQ": "nasdaq",
    "AMEX": "amex",
}


def get_base_symbol(symbol):
    """접미사(.KS, .KQ 등) 제거하고 base symbol만 반환"""
    if not symbol:
        return symbol
    upper = symbol.upper()
    suffixes = [".KS", ".KQ", ".KN", ".KO"]
    for suffix in suffixes:
        if upper.endswith(suffix):
            return symbol[: -len(suffix)]
    return symbol


def sanitize_ticker_for_filename(ticker):
    """티커를 파일명으로 사용 가능하도록 정리"""
    base = get_base_symbol(ticker)
    return base.replace(".", "-").replace("/", "-").replace("\\", "-").lower()


def get_market_subdirectory(market):
    """market 값을 서브디렉토리명으로 변환"""
    if not market:
        return "misc"
    normalized = str(market).strip().upper()
    return MARKET_SUBDIR_ALIASES.get(normalized, normalized.lower())


def get_data_file_path(symbol, market=None, data_layout_mode=None):
    """
    데이터 파일 경로를 반환합니다.
    
    Args:
        symbol: 티커 심볼 (예: "000080.KQ", "AAPL")
        market: 시장 정보 (예: "KOSDAQ", "NASDAQ")
        data_layout_mode: 레이아웃 모드 ("market", "v2", "flat" 등). None이면 환경 변수 확인
    
    Returns:
        Path 객체: 데이터 파일 경로
    """
    if data_layout_mode is None:
        data_layout_mode = os.getenv("DATA_LAYOUT_MODE", "market").lower()
    
    filename = f"{sanitize_ticker_for_filename(symbol)}.json"
    
    # market 레이아웃 모드인 경우 서브디렉토리 사용
    if data_layout_mode in ("market", "v2"):
        if not market:
            # market이 없으면 symbol에서 추론 시도
            symbol_upper = symbol.upper()
            if symbol_upper.endswith(".KS"):
                market = "KOSPI"
            elif symbol_upper.endswith(".KQ"):
                market = "KOSDAQ"
            elif symbol_upper.endswith(".KN"):
                market = "KONEX"
            else:
                # market을 알 수 없으면 misc 디렉토리 사용
                market = "misc"
        
        subdir = get_market_subdirectory(market)
        return DATA_DIR / subdir / filename
    else:
        # flat 모드 (레거시 호환성)
        return DATA_DIR / filename


def find_existing_data_file(symbol, market=None):
    """
    기존 데이터 파일을 찾습니다 (market 서브디렉토리와 루트 모두 확인).
    
    Returns:
        Path 객체 또는 None
    """
    # 먼저 market 서브디렉토리에서 찾기
    if market:
        market_path = get_data_file_path(symbol, market, "market")
        if market_path.exists():
            return market_path
    
    # market 서브디렉토리들에서 찾기
    for subdir_name in ["kospi", "kosdaq", "konex", "nyse", "nasdaq", "amex"]:
        subdir_path = DATA_DIR / subdir_name / f"{sanitize_ticker_for_filename(symbol)}.json"
        if subdir_path.exists():
            return subdir_path
    
    # 루트에서 찾기 (레거시)
    root_path = DATA_DIR / f"{sanitize_ticker_for_filename(symbol)}.json"
    if root_path.exists():
        return root_path
    
    return None

