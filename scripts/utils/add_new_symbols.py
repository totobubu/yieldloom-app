#!/usr/bin/env python
"""
로컬 환경에서 신규 티커를 온보딩하기 위한 one-stop 스크립트.

사용 예:
    python scripts/utils/add_new_symbols.py --symbol YMAX
    python scripts/utils/add_new_symbols.py --symbol voo --symbol qqq

    # 커맨드라인으로 값 미리 전달 (인터랙티브 입력 생략):
    python scripts/utils/add_new_symbols.py \
        --symbol TPAY --symbol GIF \
        --isin TPAY:US1234567890AB --isin GIF:US9876543210AB \
        --market TPAY:NASDAQ --market GIF:NYSE \
        --etf TPAY \
        --company TPAY:YieldMax \
        --underlying TPAY:TSLA \
        --ko-name "TPAY:트리플포인트 벤처" --ko-name "GIF:GIF"

    # 심볼이 하나일 때 SYMBOL: 접두사 생략 가능:
    python scripts/utils/add_new_symbols.py --symbol TPAY --company Roundhill --isin US77926X8662 --market bats --etf TPAY --ko-name "라운드힐 S&P 500 타겟10 ETF"

주요 단계:
    1. fetch_missing_isin.py 로직을 재사용해 ISIN/심볼 정규화
       (실패 시 터미널에서 수동 입력 가능)
    2. fetch_market_from_google_finance.js를 사용하여 정확한 거래소 정보 조회
       (기존 감지 실패 시 Google Finance에서 자동 조회)
    3. Yahoo Finance chart API를 활용해 IPO 일자를 조회
       (tasks/addIpoDatesToNav.js와 동일한 방식)
    4. 해당 market 폴더의 nav 소스 파일에 심볼/ipoDate 반영
    5. public/data/<market>/<symbol>.json 스켈레톤 생성 및 기본 메타데이터 저장
    6. update_info_data.yml과 동일한 순서의 워크플로우를 로컬에서 실행 (R2 업로드 포함)

Windows PowerShell, macOS/Linux 쉘 모두 지원.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

# 기존 스크립트 재사용
try:
    # 실행 경로가 프로젝트 루트가 아닐 수 있으므로 scripts 디렉터리를 우선 추가
    CURRENT_DIR = Path(__file__).resolve().parent
    if str(CURRENT_DIR) not in sys.path:
        sys.path.insert(0, str(CURRENT_DIR))
    from fetch_missing_isin import (  # type: ignore
        FetchError,
        fetch_isin,
        symbol_to_slug,
        determine_market_from_symbol,
    )
except ImportError as exc:  # pragma: no cover - 환경 문제
    raise SystemExit(
        f"fetch_missing_isin.py 로직을 불러오지 못했습니다: {exc}"
    ) from exc

ROOT_DIR = (
    Path(__file__).resolve().parents[2]
)  # scripts/utils/ -> scripts/ -> 프로젝트 루트
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import save_json_file  # 프로젝트 공용 유틸

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
NAV_DIR = PUBLIC_DIR / "nav"
PYTHON = sys.executable

MARKET_CHOICES = (
    "NASDAQ",
    "NYSE",
    "NYSEARCA",
    "BATS",
    "AMEX",
    "KOSPI",
    "KOSDAQ",
    "KONEX",
)
MARKET_TO_CURRENCY = {
    "NASDAQ": "USD",
    "NYSE": "USD",
    "NYSEARCA": "USD",
    "BATS": "USD",
    "AMEX": "USD",
    "KOSPI": "KRW",
    "KOSDAQ": "KRW",
    "KONEX": "KRW",
}

# 거래소 → 디렉토리 매핑
MARKET_TO_DIR = {
    "NASDAQ": "nasdaq",
    "NYSE": "nyse",
    "NYSEARCA": "nysearca",
    "BATS": "bats",
    "AMEX": "amex",
    "KOSPI": "kospi",
    "KOSDAQ": "kosdaq",
    "KONEX": "konex",
}

YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/119.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


class WorkflowError(RuntimeError):
    """Raised when a required step fails."""


def nav_filename_for_symbol(symbol: str) -> str:
    if not symbol:
        return "unknown.json"
    first_char = symbol[0].lower()
    if first_char.isalnum():
        return f"{first_char}.json"
    return "unknown.json"


def sanitize_symbol(symbol: str) -> str:
    return symbol.upper().strip()


def prompt_user(prompt: str, default: Optional[str] = None) -> str:
    if not sys.stdin.isatty():
        raise WorkflowError(
            f"{prompt} 값을 자동으로 얻지 못했고 터미널 입력이 불가능합니다."
        )

    suffix = f" (default: {default})" if default else ""
    while True:
        value = input(f"{prompt}{suffix}: ").strip()
        if value:
            return value
        if default:
            return default
        print("값을 입력해주세요.")


def prompt_yes_no(prompt: str, default: bool = False) -> bool:
    """사용자에게 yes/no 질문을 합니다."""
    default_str = "y" if default else "n"
    response = prompt_user(f"{prompt} (y/n)", default=default_str).lower()
    return response in ("y", "yes")


def detect_etf(symbol: str, prefill: Optional[bool] = None) -> bool:
    """심볼이 ETF인지 확인합니다. prefill이 있으면 인터랙티브 입력을 건너뜁니다."""
    if prefill is not None:
        print(f"[INFO] {symbol} ETF 여부 (CLI): {'예' if prefill else '아니오'}")
        return prefill
    print(f"\n[INFO] {symbol}이(가) ETF인지 확인 중...")
    return prompt_yes_no(f"{symbol}이(가) ETF입니까?", default=False)


def prompt_company(symbol: str, prefill: Optional[str] = None) -> Optional[str]:
    """회사명을 입력받습니다. prefill이 있으면 인터랙티브 입력을 건너뜁니다."""
    if prefill is not None:
        print(f"[INFO] {symbol} 회사명 (CLI): {prefill}")
        return prefill if prefill else None
    company = prompt_user(f"{symbol}의 회사명 (예: YieldMax, GraniteShares)", default="").strip()
    return company if company else None

def fetch_korean_name_from_toss(symbol: str, market: str) -> Optional[str]:
    """토스증권에서 한국어 종목명을 자동으로 조회합니다."""
    try:
        # fetch_korean_names_from_toss.py 스크립트 실행
        script_path = ROOT_DIR / "scripts" / "data_pipeline" / "fetch_korean_names_from_toss.py"

        if not script_path.exists():
            return None

        result = subprocess.run(
            [PYTHON, str(script_path), "--symbol", symbol, "--market", market],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )

        if result.returncode != 0:
            return None

        # korean_names_from_toss.json 파일 읽기
        output_file = script_path.parent / "korean_names_from_toss.json"
        if output_file.exists():
            with output_file.open(encoding="utf-8") as f:
                data = json.load(f)
                if symbol in data:
                    ko_name = data[symbol].get("koName")
                    if ko_name:
                        print(f"[INFO] 토스증권에서 한국어 종목명 자동 조회 성공: {ko_name}")
                        return ko_name

        return None

    except Exception as exc:
        print(f"[WARN] 토스증권 한국어 종목명 조회 실패: {exc}")
        return None

def prompt_ko_name(symbol: str, market: str = "NASDAQ", prefill: Optional[str] = None) -> Optional[str]:
    """한국어 종목명을 입력받습니다. prefill이 있으면 인터랙티브 입력을 건너뜁니다."""
    if prefill is not None:
        print(f"[INFO] {symbol} 한국어 종목명 (CLI): {prefill}")
        return prefill if prefill else None

    # 1. 토스증권에서 자동 검색 시도
    print(f"[INFO] 토스증권에서 {symbol}의 한국어 종목명을 조회합니다...")
    toss_ko_name = fetch_korean_name_from_toss(symbol, market)

    if toss_ko_name:
        # 자동 조회 성공 시 사용자에게 확인
        use_toss = prompt_yes_no(
            f"토스증권에서 찾은 '{toss_ko_name}'을(를) 사용하시겠습니까?",
            default=True
        )
        if use_toss:
            return toss_ko_name

    # 2. 토스 검색 실패 또는 사용자가 거부한 경우 수동 입력
    ko_name = prompt_user(f"{symbol}의 한국어 종목명 (예: 삼성전자, 카카오)", default="").strip()
    return ko_name if ko_name else None


def prompt_underlying(symbol: str, prefill: Optional[str] = None) -> Optional[str]:
    """기초자산 심볼을 입력받습니다. prefill이 있으면 인터랙티브 입력을 건너뜁니다."""
    if prefill is not None:
        val = prefill.upper() if prefill else None
        print(f"[INFO] {symbol} 기초자산 (CLI): {val}")
        return val if val else None
    has_underlying = prompt_yes_no(f"{symbol}에 기초자산(underlying)이 있습니까?", default=False)
    if has_underlying:
        underlying = prompt_user(f"{symbol}의 기초자산 심볼 (예: NVDA, TSLA)", default="").strip().upper()
        return underlying if underlying else None
    return None


def prompt_market(symbol: str) -> str:
    print(f"[INPUT] {symbol}의 상장 시장을 선택하세요: {', '.join(MARKET_CHOICES)}")
    while True:
        user_value = prompt_user("Market").upper()
        if user_value in MARKET_CHOICES:
            return user_value
        print(f"지원되지 않는 시장입니다. ({', '.join(MARKET_CHOICES)})")


def prompt_isin(symbol: str) -> str:
    while True:
        candidate = prompt_user(f"{symbol} ISIN (예: US0000000001)").upper()
        if len(candidate) == 12 and candidate.isalnum():
            return candidate
        print("ISIN은 12자리 영숫자입니다. 다시 입력해주세요.")


def fetch_isin_with_fallback(symbol: str) -> Tuple[str, str]:
    try:
        return fetch_isin(symbol)
    except FetchError as exc:
        print(f"[WARN] 자동 ISIN 조회 실패: {exc}")
        manual_symbol = prompt_user(
            "수동으로 입력할 심볼 (엔터 시 기존 심볼 유지)", default=symbol
        ).upper()
        manual_isin = prompt_isin(manual_symbol)
        return manual_isin, manual_symbol


def fetch_ipo_date(symbol: str) -> Optional[str]:
    """Yahoo Finance에서 IPO 날짜를 자동으로 조회합니다."""
    now_ts = int(time.time())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{symbol.upper()}?period1=0&period2={now_ts}&interval=1d&events=history"
    )
    try:
        response = requests.get(url, headers=YF_HEADERS, timeout=15)
        response.raise_for_status()
        payload = response.json()
        result = (payload.get("chart") or {}).get("result") or []
        meta = result[0].get("meta") if result else {}
        first_trade = meta.get("firstTradeDate")
        if first_trade:
            iso = (
                datetime.fromtimestamp(first_trade, tz=timezone.utc).date().isoformat()
            )
            print(f"[INFO] IPO 날짜 자동 조회 성공: {iso}")
            return iso
        raise ValueError("firstTradeDate 필드를 찾을 수 없음")
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[WARN] Yahoo Finance IPO 조회 실패 ({exc})")
        print(f"[INFO] IPO 날짜는 나중에 자동으로 계산됩니다.")
        return None


def ensure_data_file(
    symbol: str,
    market: str,
    currency: Optional[str],
    isin: str,
    company: Optional[str] = None,
    underlying: Optional[str] = None,
    ko_name: Optional[str] = None,
) -> Path:
    """data 파일에 티커 정보를 추가하거나 업데이트합니다."""
    slug = symbol_to_slug(symbol)
    # market 디렉토리 사용
    market_dir = MARKET_TO_DIR.get(market, market.lower())
    market_data_dir = DATA_DIR / market_dir
    market_data_dir.mkdir(parents=True, exist_ok=True)
    data_path = market_data_dir / f"{slug}.json"

    if data_path.exists():
        try:
            with data_path.open(encoding="utf-8") as fp:
                payload = json.load(fp)
        except json.JSONDecodeError:
            payload = {}
    else:
        payload = {}

    ticker_info = payload.setdefault("tickerInfo", {})
    ticker_info["Symbol"] = symbol
    ticker_info["isin"] = isin
    ticker_info["market"] = market
    if currency:
        ticker_info["currency"] = currency
    if company:
        ticker_info["company"] = company
    if underlying:
        ticker_info["underlying"] = underlying
    if ko_name:
        ticker_info["koName"] = ko_name
    ticker_info["Update"] = datetime.now(timezone(timedelta(hours=9))).strftime(
        "%Y-%m-%d %H:%M:%S KST"
    )
    payload.setdefault("backtestData", [])

    save_json_file(str(data_path), payload, indent=4)
    print(f"[UPDATE] data 파일 저장: {data_path.relative_to(ROOT_DIR)}")
    return data_path


def fetch_market_from_google_finance(symbol: str) -> Optional[str]:
    """Google Finance에서 거래소 정보를 가져옵니다."""
    script_path = ROOT_DIR / "scripts" / "utils" / "fetch_market_from_google_finance.js"
    if not script_path.exists():
        print(
            f"[WARN] fetch_market_from_google_finance.js를 찾을 수 없습니다: {script_path}"
        )
        return None

    node_exe = resolve_executable("node")
    try:
        # --query-only 모드 사용 (nav.json 업데이트 없이 마켓 정보만 조회)
        result = subprocess.run(
            [node_exe, str(script_path), "--query-only", symbol.upper()],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )

        if result.returncode != 0:
            print(f"[WARN] Google Finance 마켓 조회 실패: {result.stderr}")
            return None

        # 출력에서 거래소 정보 추출
        # 예: "[AAPW] 거래소: BATS"
        output = result.stdout
        for line in output.split("\n"):
            # "[SYMBOL] 거래소:" 패턴 찾기
            if f"[{symbol.upper()}]" in line and "거래소:" in line:
                # "거래소: BATS" 패턴
                if ":" in line:
                    parts = line.split("거래소:")[-1].strip()
                    # 알파벳만 추출 (BATS, NASDAQ 등)
                    market = "".join(c for c in parts if c.isalpha()).upper()
                    if market and len(market) >= 2:
                        return market

        return None
    except subprocess.TimeoutExpired:
        print(f"[WARN] Google Finance 마켓 조회 타임아웃")
        return None
    except Exception as exc:
        print(f"[WARN] Google Finance 마켓 조회 오류: {exc}")
        return None


def ensure_nav_entry(
    symbol: str,
    market: str,
    ipo_date: Optional[str],
    isin: str,
    company: Optional[str] = None,
    underlying: Optional[str] = None,
    ko_name: Optional[str] = None,
) -> Path:
    """nav 파일에 티커 정보를 추가하거나 업데이트합니다."""
    nav_file = nav_filename_for_symbol(symbol)
    market_dir_name = MARKET_TO_DIR.get(market, market.lower())
    market_nav_dir = NAV_DIR / market_dir_name
    market_nav_dir.mkdir(parents=True, exist_ok=True)
    nav_path = market_nav_dir / nav_file

    if nav_path.exists():
        try:
            with nav_path.open(encoding="utf-8") as fp:
                entries = json.load(fp)
        except json.JSONDecodeError:
            entries = []
    else:
        entries = []

    # 기존 항목 찾기
    existing_entry = None
    for entry in entries:
        if entry.get("symbol") == symbol:
            existing_entry = entry
            break

    if existing_entry:
        # 업데이트
        existing_entry["isin"] = isin
        existing_entry["market"] = market
        if ipo_date:
            existing_entry["ipoDate"] = ipo_date
        if company:
            existing_entry["company"] = company
        if underlying:
            existing_entry["underlying"] = underlying
        if ko_name:
            existing_entry["koName"] = ko_name
        print(f"[UPDATE] nav 항목 업데이트: {symbol}")
    else:
        # 신규 추가
        new_entry = {
            "symbol": symbol,
            "isin": isin,
            "market": market,
            "yfSymbol": symbol,
            "currency": MARKET_TO_CURRENCY.get(market, "USD"),
            "sharesOutstanding": False,  # 기본값
        }
        if ipo_date:
            new_entry["ipoDate"] = ipo_date
        if company:
            new_entry["company"] = company
        if underlying:
            new_entry["underlying"] = underlying
        if ko_name:
            new_entry["koName"] = ko_name

        entries.append(new_entry)
        print(f"[ADD] nav 항목 추가: {symbol}")

    # 심볼 기준 정렬
    entries.sort(key=lambda x: x.get("symbol", ""))

    save_json_file(str(nav_path), entries, indent=4)
    return nav_path


def resolve_market(symbol: str, detected: Optional[str], prefill: Optional[str] = None) -> str:
    """마켓 정보를 결정합니다. prefill이 있으면 인터랙티브 입력을 건너뜁니다."""
    # 0. CLI로 미리 전달된 마켓 사용
    if prefill:
        prefill_upper = prefill.upper()
        print(f"[INFO] {symbol} 시장 (CLI): {prefill_upper}")
        return prefill_upper

    # 1. 기존 감지된 마켓이 유효하면 사용
    if detected in MARKET_CHOICES:
        print(f"[INFO] 기존 감지 마켓 사용: {detected}")
        return detected

    # 2. Google Finance에서 거래소 정보 가져오기
    print(f"[INFO] Google Finance에서 {symbol}의 거래소 정보를 조회합니다...")
    google_market = fetch_market_from_google_finance(symbol)

    if google_market and google_market in MARKET_CHOICES:
        print(f"[INFO] Google Finance에서 거래소 확인: {google_market}")
        return google_market

    # 3. Google Finance에서 새로운 거래소가 발견된 경우
    if google_market:
        print(f"[INFO] 새로운 거래소 발견: {google_market}")
        # 사용자에게 확인
        print(f"[INPUT] {symbol}의 거래소로 '{google_market}'을 사용하시겠습니까?")
        response = prompt_user("사용 (y/n)", default="y").lower()
        if response == "y":
            # MARKET_CHOICES에 추가 (런타임에만)
            return google_market

    # 4. 수동 입력
    return prompt_market(symbol)


def check_existing_symbol(symbol: str) -> Optional[Tuple[str, Path]]:
    """모든 시장에서 심볼이 이미 존재하는지 확인합니다.

    Returns:
        (market, nav_path) tuple if found, None otherwise
    """
    for market_choice in MARKET_CHOICES:
        market_dir_name = MARKET_TO_DIR.get(market_choice, market_choice.lower())
        market_dir = NAV_DIR / market_dir_name
        if not market_dir.exists():
            continue

        # 모든 nav 파일 검색
        for nav_file in market_dir.glob("*.json"):
            try:
                with nav_file.open(encoding="utf-8") as fp:
                    entries = json.load(fp)
                    if not isinstance(entries, list):
                        continue

                    for entry in entries:
                        if entry.get("symbol") == symbol:
                            return (market_choice, nav_file)
            except (FileNotFoundError, json.JSONDecodeError):
                continue

    return None


def resolve_executable(executable: str) -> str:
    """Return a platform-appropriate executable path."""
    system = platform.system().lower()
    if system.startswith("win"):
        if executable.lower() in {"npm", "npx"}:
            return f"{executable}.cmd"
        if not os.path.splitext(executable)[1]:
            # PATHEXT를 이용해 직접 찾는다.
            path = shutil.which(executable)
            if path:
                return path
    return executable


def run_command(label: str, command: List[str], dry_run: bool = False) -> None:
    normalized = [resolve_executable(command[0]), *command[1:]]
    printable = shlex.join(normalized)
    print(f"\n-> {label}\n   $ {printable}")
    if dry_run:
        return

    # Windows에서 .cmd 파일 실행 시 shell=True 필요
    use_shell = platform.system().lower().startswith("win") and (
        normalized[0].endswith(".cmd") or normalized[0].endswith(".bat")
    )

    result = subprocess.run(normalized, cwd=ROOT_DIR, shell=use_shell)  # noqa: S603
    if result.returncode != 0:
        raise WorkflowError(f"명령 실패: {label} (exit {result.returncode})")


def get_ticker_markets(symbols: List[Dict[str, str]]) -> Dict[str, List[str]]:
    """티커를 시장별로 분류합니다."""
    kr_tickers = []
    us_tickers = []

    for symbol_info in symbols:
        market = symbol_info.get("market", "").upper()
        resolved_symbol = symbol_info.get("resolved_symbol", "")

        if market in ("KOSPI", "KOSDAQ", "KONEX"):
            kr_tickers.append(resolved_symbol)
        else:
            us_tickers.append(resolved_symbol)

    return {"KR": kr_tickers, "US": us_tickers}


def run_update_workflow(symbols: List[Dict[str, str]]) -> None:
    """
    신규 티커만 처리하는 최적화된 워크플로우 실행.

    Args:
        symbols: 처리할 티커 정보 목록 (각 항목은 process_symbol의 반환값)
    """
    # 신규 티커는 이미 process_symbol에서 IPO 날짜를 가져와서 nav에 저장했으므로
    # add-ipo-dates 단계는 건너뜁니다.

    # 빈 딕셔너리(스킵된 항목) 필터링
    valid_symbols = [s for s in symbols if s.get("resolved_symbol")]
    resolved_symbols = [s.get("resolved_symbol", "") for s in valid_symbols]

    if not resolved_symbols:
        print("[WARN] 처리할 티커가 없습니다.")
        return

    steps: List[Tuple[str, List[str]]] = [
        ("1. nav.json 재생성", ["npm", "run", "generate-nav"]),
    ]

    # 신규 티커만 정보성 데이터 업데이트
    steps.append(
        (
            f"2. 정보성 데이터 업데이트 ({', '.join(resolved_symbols)})",
            [PYTHON, "scripts/data_pipeline/scraper_info.py", *resolved_symbols],
        )
    )

    # 티커를 시장별로 분류하여 주기 시세 데이터 수집
    ticker_markets = get_ticker_markets(symbols)
    os.environ["DATA_LAYOUT_MODE"] = "market"

    if ticker_markets["KR"]:
        steps.append(
            (
                f"3. 주기 시세 데이터 수집 (KR: {', '.join(ticker_markets['KR'])})",
                ["node", "tasks/updateHistoricalKrData.js", *ticker_markets["KR"]],
            )
        )

    if ticker_markets["US"]:
        steps.append(
            (
                f"3-2. 주기 시세 데이터 수집 (US: {', '.join(ticker_markets['US'])})",
                ["node", "tasks/updateHistoricalUsData.js", *ticker_markets["US"]],
            )
        )

    # 신규 티커만 배당 데이터 수집 (yfinance에서 배당 히스토리 가져오기)
    steps.append(
        (
            f"4. 배당 데이터 수집 ({', '.join(resolved_symbols)})",
            [PYTHON, "scripts/data_pipeline/update_dividends.py", *resolved_symbols],
        )
    )

    # 배당 데이터가 있는 경우에만 yield 계산
    steps.append(
        (
            f"5. 배당 yield 계산 ({', '.join(resolved_symbols)})",
            [PYTHON, "scripts/data_pipeline/scraper_dividend.py", *resolved_symbols],
        )
    )

    # Firebase 동기화 추가 (신규 티커만)
    firebase_cmd = ["node", "scripts/mappings/sync-nav-to-firebase.js"]
    for sym in resolved_symbols:
        firebase_cmd.extend(["--symbol", sym])
    steps.append((f"6. Firebase 동기화 ({', '.join(resolved_symbols)})", firebase_cmd))

    # 사이드바 생성 (market_data 워크플로우와 동일하게)
    steps.append(
        ("7. 사이드바 생성", ["npm", "run", "generate-sidebar-tickers"])
    )

    # R2 업로드 (변경된 파일만)
    steps.append(
        ("8. R2 업로드 (변경된 파일)", [PYTHON, "scripts/cloud/upload_changed_to_r2.py"])
    )

    print("\n" + "=" * 80)
    print("신규 티커 워크플로우 실행")
    print("=" * 80)
    for label, command in steps:
        run_command(label, command)
    print("\n✅ 워크플로우 완료")


def parse_prefill_map(entries: List[str], all_symbols: List[str]) -> Dict[str, str]:
    """SYMBOL:VALUE 또는 단순 VALUE(심볼이 하나일 때) 형식 파싱.

    Returns:
        Dict[UPPER_SYMBOL -> value]
    """
    result: Dict[str, str] = {}
    for entry in (entries or []):
        if ":" in entry:
            sym, _, val = entry.partition(":")
            result[sym.upper().strip()] = val.strip()
        else:
            # 심볼 접두사 없음 → 심볼이 하나인 경우에만 허용
            upper_symbols = [s.upper() for s in all_symbols]
            if len(upper_symbols) == 1:
                result[upper_symbols[0]] = entry.strip()
            else:
                raise SystemExit(
                    f"[ERROR] 여러 심볼이 있을 때는 'SYMBOL:VALUE' 형식으로 전달해야 합니다: '{entry}'"
                )
    return result


def process_symbol(symbol: str, prefill: Optional[Dict] = None) -> Dict[str, str]:  # noqa: C901
    """단일 심볼을 처리합니다.

    Args:
        symbol: 처리할 심볼
        prefill: CLI로 미리 전달된 값. 키:
            isin, market, is_etf, company, underlying, ko_name
    """
    if prefill is None:
        prefill = {}

    # CLI 인자가 하나라도 있으면 non-interactive 모드
    # (지정하지 않은 값은 None으로 자동 처리, 인터랙티브 프롬프트 건너뜀)
    cli_mode = any(v is not None for v in prefill.values())
    if cli_mode:
        print("[INFO] CLI 모드: 지정되지 않은 값은 자동으로 건너뜁니다.")

    normalized = sanitize_symbol(symbol)
    print("\n" + "=" * 60)
    print(f"신규 티커 처리: {normalized}")
    print("=" * 60)

    # ISIN
    prefill_isin = prefill.get("isin")
    if prefill_isin:
        isin = prefill_isin.upper()
        resolved_symbol = normalized
        print(f"[INFO] ISIN (CLI): {isin}")
    else:
        isin, resolved_symbol = fetch_isin_with_fallback(normalized)
    if resolved_symbol != normalized:
        print(f"[INFO] {normalized} → {resolved_symbol} 로 재매핑")

    # 기존 심볼 확인
    existing = check_existing_symbol(resolved_symbol)
    if existing:
        existing_market, existing_path = existing
        print(f"[WARN] {resolved_symbol}는 이미 {existing_market} 시장에 존재합니다.")
        print(f"       위치: {existing_path.relative_to(ROOT_DIR)}")
        print(f"[SKIP] 중복 방지를 위해 건너뜁니다.")
        # 빈 딕셔너리 반환 (워크플로우에서 필터링됨)
        return {}

    detected_market = determine_market_from_symbol(resolved_symbol)
    market = resolve_market(resolved_symbol, detected_market, prefill.get("market"))
    currency = MARKET_TO_CURRENCY.get(market)

    # ETF 확인 및 추가 정보 수집
    # CLI 모드에서는 --etf 미지정 시 False로 처리 (인터랙티브 없음)
    is_etf = detect_etf(resolved_symbol, prefill.get("is_etf") if not cli_mode else (prefill.get("is_etf") or False))
    company = None
    underlying = None
    ko_name = None
    if is_etf:
        # CLI 모드: 미지정 값은 None (인터랙티브 건너뜀)
        company = prompt_company(resolved_symbol, prefill.get("company") if not cli_mode else (prefill.get("company") or ""))
        underlying = prompt_underlying(resolved_symbol, prefill.get("underlying") if not cli_mode else (prefill.get("underlying") or ""))
    elif prefill.get("company") or prefill.get("underlying"):
        # ETF 아니어도 CLI로 전달된 경우 반영
        company = prefill.get("company") or None
        underlying = (prefill.get("underlying") or "").upper() or None
    # 한국어 종목명(koName): CLI 모드에서는 미지정 시 None (인터랙티브 건너뜀)
    ko_name = prompt_ko_name(resolved_symbol, market, prefill.get("ko_name") if not cli_mode else (prefill.get("ko_name") or ""))

    # IPO 날짜 자동 조회 (실패 시 None, 나중에 자동 계산됨)
    ipo_date = fetch_ipo_date(resolved_symbol)

    # nav 파일 업데이트 (ISIN, company, underlying, koName 포함)
    nav_path = ensure_nav_entry(
        resolved_symbol, market, ipo_date, isin, company, underlying, ko_name
    )

    # data 파일 업데이트 (ISIN, company, underlying, koName 포함)
    data_path = ensure_data_file(
        resolved_symbol, market, currency, isin, company, underlying, ko_name
    )

    return {
        "input_symbol": normalized,
        "resolved_symbol": resolved_symbol,
        "market": market,
        "isin": isin,
        "ipo_date": ipo_date,
        "upcoming": not bool(ipo_date),
        "company": company or "N/A",
        "underlying": underlying or "N/A",
        "nav_path": str(nav_path.relative_to(ROOT_DIR)),
        "data_path": str(data_path.relative_to(ROOT_DIR)),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="신규 심볼 온보딩 자동화 스크립트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  # 기본 (인터랙티브):
  python scripts/utils/add_new_symbols.py --symbol YMAX

  # 값 미리 전달 (인터랙티브 생략):
  python scripts/utils/add_new_symbols.py \\
      --symbol TPAY --symbol GIF \\
      --isin TPAY:US1234567890AB --isin GIF:US9876543210AB \\
      --market TPAY:NASDAQ --market GIF:NYSE \\
      --etf TPAY \\
      --company TPAY:YieldMax \\
      --underlying TPAY:TSLA \\
      --ko-name "TPAY:트리플포인트" --ko-name "GIF:GIF"

  # 심볼이 하나면 SYMBOL: 접두사 생략 가능:
  python scripts/utils/add_new_symbols.py --symbol YMAX \\
      --isin US12345678901A --market NASDAQ --etf YMAX --ko-name "YieldMax"
        """,
    )
    parser.add_argument(
        "--symbol",
        dest="symbols",
        action="append",
        required=True,
        metavar="SYMBOL",
        help="처리할 심볼 (여러 번 지정 가능)",
    )
    # --- 값 미리 전달 옵션 (SYMBOL:VALUE 또는 심볼 하나일 때 VALUE) ---
    parser.add_argument(
        "--isin",
        dest="isins",
        action="append",
        default=[],
        metavar="[SYMBOL:]ISIN",
        help="ISIN 미리 전달 (예: TPAY:US1234567890AB)",
    )
    parser.add_argument(
        "--market",
        dest="markets",
        action="append",
        default=[],
        metavar="[SYMBOL:]MARKET",
        help="시장 미리 전달 (예: TPAY:NASDAQ)",
    )
    parser.add_argument(
        "--etf",
        dest="etfs",
        action="append",
        default=[],
        metavar="SYMBOL",
        help="ETF로 표시할 심볼 (예: --etf TPAY)",
    )
    parser.add_argument(
        "--company",
        dest="companies",
        action="append",
        default=[],
        metavar="[SYMBOL:]NAME",
        help="회사명 미리 전달 (예: TPAY:YieldMax)",
    )
    parser.add_argument(
        "--underlying",
        dest="underlyings",
        action="append",
        default=[],
        metavar="[SYMBOL:]UNDERLYING",
        help="기초자산 심볼 미리 전달 (예: TPAY:TSLA)",
    )
    parser.add_argument(
        "--ko-name",
        dest="ko_names",
        action="append",
        default=[],
        metavar="[SYMBOL:]NAME",
        help="한국어 종목명 미리 전달 (예: \"TPAY:트리플포인트\")",
    )
    # --- 동작 제어 옵션 ---
    parser.add_argument(
        "--skip-workflow",
        action="store_true",
        help="update_info_data 로컬 워크플로우 실행을 건너뜁니다.",
    )
    parser.add_argument(
        "--skip-format",
        action="store_true",
        help="최종 포맷팅 스텝만 건너뜁니다.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="명령 실행 없이 수행 계획만 출력합니다.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    os.chdir(ROOT_DIR)

    # CLI 미리 전달값 파싱 (SYMBOL:VALUE → {SYMBOL: VALUE} 맵)
    isin_map = parse_prefill_map(args.isins, args.symbols)
    market_map = parse_prefill_map(args.markets, args.symbols)
    company_map = parse_prefill_map(args.companies, args.symbols)
    underlying_map = parse_prefill_map(args.underlyings, args.symbols)
    ko_name_map = parse_prefill_map(args.ko_names, args.symbols)
    # --etf SYMBOL 형식이므로 대문자로 set 생성
    etf_set = {s.upper() for s in (args.etfs or [])}

    summaries: List[Dict[str, str]] = []

    for symbol in args.symbols:
        sym_upper = symbol.upper()
        prefill: Dict = {
            "isin": isin_map.get(sym_upper),
            "market": market_map.get(sym_upper),
            "is_etf": True if sym_upper in etf_set else None,
            "company": company_map.get(sym_upper),
            "underlying": underlying_map.get(sym_upper),
            "ko_name": ko_name_map.get(sym_upper),
        }
        summaries.append(process_symbol(symbol, prefill=prefill))

    if args.dry_run:
        print("\n[DRY-RUN] 워크플로우는 실행되지 않았습니다.")
        return 0

    if not args.skip_workflow:
        run_update_workflow(symbols=summaries)
    else:
        print("\n[INFO] --skip-workflow 옵션으로 통합 워크플로우를 건너뜁니다.")

    print("\n요약")
    print("-" * 40)
    for item in summaries:
        if not item.get("resolved_symbol"):
            continue
        ipo_info = item['ipo_date'] if item['ipo_date'] else "upcoming: true"
        print(
            f"{item['resolved_symbol']} "
            f"(시장: {item['market']}, ISIN: {item['isin']}, IPO: {ipo_info})"
        )
        if item.get("company") and item["company"] != "N/A":
            print(f"  - 회사: {item['company']}")
        if item.get("underlying") and item["underlying"] != "N/A":
            print(f"  - 기초자산: {item['underlying']}")
        print(f"  - nav : {item['nav_path']}")
        print(f"  - data: {item['data_path']}")
    print("-" * 40)
    print("완료되었습니다.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except WorkflowError as exc:
        print(f"\n❌ 작업 중단: {exc}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n사용자 중단 (Ctrl+C)")
        sys.exit(1)
