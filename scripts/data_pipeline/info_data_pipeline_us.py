#!/usr/bin/env python3
# scripts/info_data_pipeline_us.py
"""
미국 시장(US) 전용 정보성 데이터 통합 파이프라인
- US 티커만 처리하는 독립 실행 스크립트
- 한 번의 실행으로 yfinance를 활용한 모든 정보성 데이터 업데이트
"""

import json
import time
import math
import requests
import warnings
import sys
import logging
import yfinance as yf
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from tqdm import tqdm
from collections import Counter
import pandas as pd

# yfinance 경고 메시지 억제 (일부만)
warnings.filterwarnings("ignore", category=FutureWarning)

# yfinance 로거 레벨 조정 (ERROR만 표시)
logging.getLogger("yfinance").setLevel(logging.ERROR)
logging.getLogger("urllib3").setLevel(logging.WARNING)

# 참고: yfinance가 출력하는 메시지들의 의미:
# 1. "HTTP Error 404: Quote not found for symbol: XXX"
#    -> yfinance API에서 해당 심볼을 찾을 수 없음
#    -> 가능한 원인: 상장폐지, 티커 심볼 오류, 접미사 문제
#    -> 처리: 접미사 대체 시도 후 실패 시 조용히 건너뛰기 (정상 동작)
#
# 2. "$XXX: possibly delisted; no timezone found"
#    -> 상장폐지되었거나 데이터가 없는 티커
#    -> 처리: 배당 데이터가 없는 정상적인 경우이므로 조용히 건너뛰기 (정상 동작)
#
# 이 메시지들은 배당 데이터가 없는 정상적인 티커에 대해 나타나는 것이므로
# 에러로 처리하지 않고 조용히 건너뛰는 것이 맞습니다.
# 실제 문제가 있는 경우는 다른 예외로 처리됩니다.

# 공통 유틸리티
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import (
    DATA_DIR,
    PUBLIC_DIR,
    load_json_file,
    save_json_file,
    get_kst_now,
    should_skip_update_timestamp,
    get_data_file_path,
)
from scripts.data_pipeline.history_policy import dividend_refresh_start, merge_yahoo_dividend

# 경로 설정
NAV_FILE_PATH = PUBLIC_DIR / "nav.json"
US_HOLIDAYS_PATH = PUBLIC_DIR / "holidays" / "us_holidays.json"

# 글로벌 상태 (한 번만 로드)
nav_data = None
ticker_info_map = {}
active_symbols = []
us_holidays = set()

# --- Rate limit configuration (half-speed throttling) ---
INFO_BATCH_SIZE = 50  # 이전 100
INFO_BATCH_DELAY_SEC = 2.0  # 이전 1초 간격보다 2배 대기
INFO_SYMBOL_DELAY_SEC = 0.05  # 개별 심볼 후 짧은 휴식
DIVIDEND_SYMBOL_DELAY_SEC = 0.2  # 배당 수집시 요청 간 딜레이


def fetch_dividends(symbol, start_date_str):
    """배당 데이터 가져오기 (US는 접미사 불필요)"""
    try:
        ticker_obj = yf.Ticker(symbol)
        try:
            dividends = ticker_obj.dividends
        except (AttributeError, KeyError, ValueError):
            return pd.Series(dtype="float64")

        if dividends is None or not isinstance(dividends, pd.Series) or dividends.empty:
            return pd.Series(dtype="float64")

        try:
            filtered = dividends[dividends.index >= start_date_str]
            return filtered if not filtered.empty else pd.Series(dtype="float64")
        except (KeyError, ValueError, TypeError):
            return pd.Series(dtype="float64")
    except Exception:
        return pd.Series(dtype="float64")


def fetch_ticker_info(symbol):
    """티커 정보 가져오기 (US는 접미사 불필요)"""
    try:
        info = yf.Ticker(symbol).info
        return info if info else {}
    except Exception:
        return {}


# ============================================================================
# 초기화
# ============================================================================
def initialize():
    """US 시장 데이터 로드 (한 번만 실행)"""
    global nav_data, ticker_info_map, active_symbols, us_holidays

    print("=" * 80)
    print("🚀 정보성 데이터 통합 파이프라인 시작 (US 전용)")
    print("=" * 80)

    # nav.json 로드
    print("\n[1/3] nav.json 로드 중...")
    nav_data = load_json_file(NAV_FILE_PATH)
    if not nav_data:
        print("❌ nav.json을 찾을 수 없습니다.")
        return False

    all_tickers_info = nav_data.get("nav", [])
    active_tickers_info = [t for t in all_tickers_info if not t.get("upcoming", False)]

    # US 시장 필터링
    active_tickers_info = [
        t
        for t in active_tickers_info
        if t.get("currency") == "USD"
        or t.get("market") in ["NYSE", "NASDAQ", "AMEX"]
    ]

    ticker_info_map = {}
    for entry in active_tickers_info:
        symbol = entry.get("symbol")
        if not symbol:
            continue
        ticker_info_map[symbol] = entry

    active_symbols = list(ticker_info_map.keys())

    print(f"   ✓ 활성 티커 {len(active_symbols)}개 로드 완료")

    # 휴일 데이터 로드 (US만)
    print("\n[2/3] 휴일 데이터 로드 중...")
    us_holidays = set(h["date"] for h in load_json_file(US_HOLIDAYS_PATH) or [])
    print(f"   ✓ 미국 휴일: {len(us_holidays)}일")

    # 데이터 디렉토리 확인
    print("\n[3/3] 데이터 디렉토리 확인 중...")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"   ✓ 데이터 디렉토리: {DATA_DIR}")

    print("\n✅ 초기화 완료\n")
    return True


# ============================================================================
# ISIN 유틸 함수
# ============================================================================
# Step 1: 배당 데이터 업데이트 (update_dividends)
# ============================================================================
def get_last_dividend_date(file_path):
    """JSON 파일에서 마지막 배당 지급일 찾기"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        backtest_data = data.get("backtestData", [])
        dividend_dates = [
            item["date"]
            for item in backtest_data
            if ("amount" in item or "amountFixed" in item) and not item.get("forecasted") and not item.get("expected")
        ]
        if dividend_dates:
            return max(dividend_dates)
        return None
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def update_dividends():
    """배당 데이터 증분 업데이트"""
    print("\n" + "=" * 80)
    print("📊 STEP 1: 배당 데이터 업데이트")
    print("=" * 80)

    updated_count = 0

    for symbol in tqdm(active_symbols, desc="배당 데이터 수집"):
        try:
            ticker_meta = ticker_info_map.get(symbol, {})
            if not symbol:
                continue
            file_path = get_data_file_path(
                symbol,
                ticker_meta.get("market"),
                layout="market",
                ensure_dir=True,
            )

            # 마지막 배당일 조회
            last_div_date_str = get_last_dividend_date(file_path)

            # 다운로드 시작일 설정
            start_date_str = dividend_refresh_start(last_div_date_str, ticker_meta.get("ipoDate"))

            # 이미 최신이면 건너뛰기
            if (
                datetime.strptime(start_date_str, "%Y-%m-%d").date()
                > datetime.now().date()
            ):
                continue

            # yfinance에서 배당 데이터 다운로드
            new_dividends_df = fetch_dividends(symbol, start_date_str)

            if new_dividends_df.empty:
                continue

            # 기존 데이터와 병합
            existing_data = load_json_file(file_path) or {"backtestData": []}
            backtest_data = existing_data.get("backtestData", [])
            backtest_map = {item["date"]: item for item in backtest_data}
            original_data_str = json.dumps(backtest_data, sort_keys=True)
            currency = ticker_meta.get("currency", "USD")

            for date, amount in new_dividends_df.items():
                date_str = date.strftime("%Y-%m-%d")
                new_amount = int(round(amount)) if currency == "KRW" else float(amount)

                if date_str not in backtest_map:
                    backtest_map[date_str] = {"date": date_str}

                merge_yahoo_dividend(backtest_map[date_str], new_amount, symbol)

            final_backtest_data = sorted(backtest_map.values(), key=lambda x: x["date"])

            # 변경사항이 있을 때만 저장
            if original_data_str != json.dumps(final_backtest_data, sort_keys=True):
                existing_data["backtestData"] = final_backtest_data
                save_json_file(file_path, existing_data, indent=4)
                updated_count += 1

        except Exception as e:
            tqdm.write(f"  ❌ {symbol} 처리 중 오류: {e}")

        if DIVIDEND_SYMBOL_DELAY_SEC:
            time.sleep(DIVIDEND_SYMBOL_DELAY_SEC)

    print(f"\n✅ 배당 데이터 업데이트 완료: {updated_count}개 파일 변경\n")
    return updated_count


# ============================================================================
# Step 2: 티커 정보 업데이트 (scraper_info)
# ============================================================================
def fetch_bulk_ticker_info_batch(symbol_pairs_batch):
    """여러 티커의 정보를 배치로 가져오기"""
    bulk_data = {}
    try:
        symbols = [symbol for _, symbol in symbol_pairs_batch if symbol]
        unique_symbols = list(set(symbols))
        tickers = yf.Tickers(unique_symbols)

        for base_symbol, symbol in symbol_pairs_batch:
            if not symbol:
                bulk_data[base_symbol] = None
                continue
            ticker_obj = tickers.tickers.get(symbol)
            if not ticker_obj:
                bulk_data[base_symbol] = None
                continue
            try:
                bulk_data[base_symbol] = ticker_obj.info
            except Exception:
                bulk_data[base_symbol] = None
        return bulk_data
    except Exception as e:
        print(f"  ❌ 배치 가져오기 오류: {e}")
        return {base_symbol: None for base_symbol, _ in symbol_pairs_batch}


def process_single_ticker_info(info):
    """티커 정보 가공"""
    if not info:
        return {}

    def normalize_number(value):
        if value is None:
            return None
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, (int,)):
            return value
        if isinstance(value, float):
            if not pd.notna(value):
                return None
            if value.is_integer():
                return int(value)
            return round(value, 6)
        try:
            parsed = float(value)
            if math.isnan(parsed) or math.isinf(parsed):
                return None
            if parsed.is_integer():
                return int(parsed)
            return round(parsed, 6)
        except Exception:
            return value

    current_price = info.get("regularMarketPrice") or info.get("previousClose")
    yield_val = (
        (info.get("trailingAnnualDividendRate", 0) / current_price)
        if current_price and info.get("trailingAnnualDividendRate")
        else None
    )

    earnings_ts = info.get("earningsTimestamp")
    earnings_date = (
        datetime.fromtimestamp(earnings_ts).strftime("%Y-%m-%d")
        if earnings_ts
        else None
    )

    fifty_two_week_range = (
        f"{info.get('fiftyTwoWeekLow')} - {info.get('fiftyTwoWeekHigh')}"
        if info.get("fiftyTwoWeekLow") and info.get("fiftyTwoWeekHigh")
        else None
    )

    return {
        "regularMarketPrice": normalize_number(info.get("regularMarketPrice")),
        "englishName": info.get("longName"),
        "earningsDate": earnings_date,
        "enterpriseValue": normalize_number(info.get("enterpriseValue")),
        "marketCap": normalize_number(info.get("marketCap")),
        "Volume": normalize_number(info.get("volume")),
        "AvgVolume": normalize_number(info.get("averageVolume")),
        "sharesOutstanding": normalize_number(info.get("sharesOutstanding")),
        "52Week": fifty_two_week_range,
        "Yield": normalize_number(yield_val),
        "dividendRate": normalize_number(info.get("dividendRate")),
        "payoutRatio": normalize_number(info.get("payoutRatio")),
        "isin": info.get("isin"),
    }


def update_ticker_info():
    """티커 정보 업데이트 + marketCap을 backtestData에 추가 (통합)"""
    print("\n" + "=" * 80)
    print("📋 STEP 2: 티커 정보 + 시가총액 업데이트 (통합)")
    print("=" * 80)

    batch_size = INFO_BATCH_SIZE
    all_bulk_info = {}

    # 배치로 정보 가져오기
    for i in tqdm(
        range(0, len(active_symbols), batch_size), desc="티커 정보 배치 수집"
    ):
        batch_keys = active_symbols[i : i + batch_size]
        symbol_pairs = []
        for symbol in batch_keys:
            symbol_pairs.append((symbol, symbol))
        batch_info = fetch_bulk_ticker_info_batch(symbol_pairs)
        all_bulk_info.update(batch_info)
        if i + batch_size < len(active_symbols):
            time.sleep(INFO_BATCH_DELAY_SEC)

    total_changed_files = 0
    marketcap_added_count = 0
    now_kst_str = get_kst_now().strftime("%Y-%m-%d %H:%M:%S KST")
    today_str = datetime.now().strftime("%Y-%m-%d")

    # 개별 티커 처리
    for symbol in tqdm(active_symbols, desc="티커 정보 + 시가총액 처리"):
        try:
            info_from_nav = ticker_info_map[symbol]
            raw_dynamic_info = all_bulk_info.get(symbol)
            if not raw_dynamic_info:
                raw_dynamic_info = fetch_ticker_info(symbol)
            dynamic_info = process_single_ticker_info(raw_dynamic_info)

            file_path = get_data_file_path(
                symbol,
                info_from_nav.get("market"),
                layout="market",
                ensure_dir=True,
            )
            existing_data = load_json_file(file_path) or {
                "tickerInfo": {},
                "backtestData": [],
            }
            old_info = existing_data.get("tickerInfo", {})

            new_info = {
                "Symbol": symbol,
                "koName": info_from_nav.get("koName"),
                "longName": info_from_nav.get("longName"),
                "company": info_from_nav.get("company"),
                "frequency": info_from_nav.get("frequency"),
                "group": info_from_nav.get("group"),
                "underlying": info_from_nav.get("underlying"),
                "market": info_from_nav.get("market"),
                "currency": info_from_nav.get("currency"),
                "Update": now_kst_str,
            }
            new_info.update(dynamic_info)

            isin_value = (
                dynamic_info.get("isin")
                or old_info.get("isin")
                or info_from_nav.get("isin")
            )
            if isin_value:
                new_info["isin"] = isin_value
                if info_from_nav.get("isin") != isin_value:
                    info_from_nav["isin"] = isin_value
            # 기존 이벤트(예: frequencyChanges, weekdayChanges, splits 등)는 보존
            existing_events = existing_data.get("tickerInfo", {}).get("events", {})
            if existing_events:
                new_info["events"] = existing_events

            # 변경사항 추적
            changes = {}
            old_update = old_info.get("Update") if old_info else None
            if (
                old_info
                and old_update
                and old_update.split(" ")[0] != now_kst_str.split(" ")[0]
            ):
                for key, new_val in dynamic_info.items():
                    old_val = old_info.get(key)
                    if old_val is not None and isinstance(new_val, (int, float)):
                        if new_val > old_val:
                            changes[key] = {"value": old_val, "change": "up"}
                        elif new_val < old_val:
                            changes[key] = {"value": old_val, "change": "down"}
            elif old_info:
                changes = old_info.get("changes", {})
            new_info["changes"] = changes

            # 변경 여부 확인
            compare_old = {
                k: v for k, v in old_info.items() if k not in ["Update", "changes"]
            }
            compare_new = {
                k: v for k, v in new_info.items() if k not in ["Update", "changes"]
            }

            data_changed = json.dumps(compare_old, sort_keys=True) != json.dumps(
                compare_new, sort_keys=True
            )

            # [추가] marketCap을 backtestData에도 추가 (중복 API 호출 제거)
            market_cap = dynamic_info.get("marketCap")
            backtest_data_changed = False
            if market_cap:
                backtest_data = existing_data.get("backtestData", [])
                today_entry = None
                for entry in backtest_data:
                    if entry.get("date") == today_str:
                        today_entry = entry
                        break

                # 오늘 날짜가 없으면 가장 최근 항목 찾기
                if not today_entry:
                    sorted_data = sorted(
                        backtest_data, key=lambda x: x.get("date", ""), reverse=True
                    )
                    if sorted_data:
                        today_entry = sorted_data[0]  # 가장 최근 항목

                if today_entry and "marketCap" not in today_entry:
                    today_entry["marketCap"] = market_cap
                    backtest_data_changed = True
                    marketcap_added_count += 1

            # 전체 변경 여부 = tickerInfo 변경 또는 backtestData 변경
            any_data_changed = data_changed or backtest_data_changed

            # 정책: 데이터 변경이 없으면 Update 필드 유지하고 저장 안함
            if should_skip_update_timestamp(old_info.get("Update"), any_data_changed):
                new_info["Update"] = old_info.get("Update")  # 기존 Update 유지
                continue  # 데이터 변경이 없으면 저장하지 않음

            # 데이터 변경이 있으면 Update 필드 갱신하고 저장
            existing_data["tickerInfo"] = new_info
            save_json_file(file_path, existing_data)
            total_changed_files += 1

        except Exception as e:
            tqdm.write(f"  ❌ {symbol} 처리 중 오류: {e}")

        if INFO_SYMBOL_DELAY_SEC:
            time.sleep(INFO_SYMBOL_DELAY_SEC)

    print(f"\n✅ 티커 정보 업데이트 완료: {total_changed_files}개 파일 변경")
    print(f"   💰 시가총액 추가: {marketcap_added_count}개\n")
    return total_changed_files


# ============================================================================
# Step 3: 배당 빈도 분석 (analyze_dividend_frequency)
# ============================================================================
MONTH_INITIALS = {
    1: "J",
    2: "F",
    3: "M",
    4: "A",
    5: "M",
    6: "J",
    7: "J",
    8: "A",
    9: "S",
    10: "O",
    11: "N",
    12: "D",
}


def analyze_frequency_and_group(dividend_dates):
    """배당 빈도와 그룹 분석"""
    if len(dividend_dates) < 2:
        return None, None

    intervals = [
        (dividend_dates[i] - dividend_dates[i - 1]).days
        for i in range(1, len(dividend_dates))
    ]
    if not intervals:
        return None, None

    def get_interval_group(days):
        if 4 <= days <= 10:
            return 7
        if 25 <= days <= 35:
            return 30
        if 81 <= days <= 101:
            return 91
        if 335 <= days <= 395:
            return 365
        return None

    grouped_intervals = [get_interval_group(days) for days in intervals]
    grouped_intervals = [g for g in grouped_intervals if g is not None]

    if not grouped_intervals:
        return None, None

    most_common_interval = Counter(grouped_intervals).most_common(1)[0][0]

    frequency_map = {7: "매주", 30: "매월", 91: "분기", 365: "매년"}
    frequency = frequency_map.get(most_common_interval)

    if most_common_interval == 7:
        weekday_counts = Counter(d.weekday() for d in dividend_dates)
        most_common_weekday = weekday_counts.most_common(1)[0][0]
        weekday_map = {0: "월", 1: "화", 2: "수", 3: "목", 4: "금"}
        group = weekday_map.get(most_common_weekday)
    else:
        month_counts = Counter(d.month for d in dividend_dates)
        top_months = sorted(month_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        group = "".join(
            MONTH_INITIALS[m] for m, _ in sorted(top_months, key=lambda x: x[0])
        )

    return frequency, group


def analyze_dividend_frequency():
    """배당 빈도 분석 및 nav.json 업데이트"""
    print("\n" + "=" * 80)
    print("📅 STEP 3: 배당 빈도 분석")
    print("=" * 80)

    updated_count = 0

    for ticker_info in tqdm(nav_data.get("nav", []), desc="배당 빈도 분석"):
        symbol = ticker_info.get("symbol")
        if not symbol or ticker_info.get("upcoming"):
            continue

        file_path = get_data_file_path(
            symbol, ticker_info.get("market"), layout="market", ensure_dir=True
        )
        data = load_json_file(file_path)

        if not data or "backtestData" not in data:
            continue

        dividend_entries = [
            item
            for item in data["backtestData"]
            if ("amount" in item or "amountFixed" in item)
            and not item.get("forecasted")
        ]

        if len(dividend_entries) < 2:
            continue

        dividend_dates = [
            datetime.strptime(item["date"], "%Y-%m-%d") for item in dividend_entries
        ]
        frequency, group = analyze_frequency_and_group(dividend_dates)

        if (
            frequency
            and group
            and (
                ticker_info.get("frequency") != frequency
                or ticker_info.get("group") != group
            )
        ):
            ticker_info["frequency"] = frequency
            ticker_info["group"] = group
            updated_count += 1

    # nav.json 저장
    save_json_file(NAV_FILE_PATH, nav_data)
    print(f"\n✅ 배당 빈도 분석 완료: {updated_count}개 티커 업데이트\n")
    return updated_count


# ============================================================================
# Step 4: 미래 배당일 예측 (project_future_dividends)
# ============================================================================
def get_previous_business_day(date, holiday_set):
    """이전 영업일 찾기"""
    current_date = date
    while True:
        weekday = current_date.weekday()
        date_str = current_date.strftime("%Y-%m-%d")
        if weekday < 5 and date_str not in holiday_set:
            return current_date
        current_date -= timedelta(days=1)


def project_future_dividends():
    """미래 배당일 예측"""
    print("\n" + "=" * 80)
    print("🔮 STEP 4: 미래 배당일 예측")
    print("=" * 80)

    today = datetime.now()
    limit_date = today + relativedelta(months=6)

    updated_count = 0

    for nav_item in tqdm(nav_data.get("nav", []), desc="미래 배당일 예측"):
        if nav_item.get("upcoming"):
            continue

        symbol = nav_item.get("symbol")
        if not symbol:
            continue

        file_path = get_data_file_path(
            symbol, nav_item.get("market"), layout="market", ensure_dir=True
        )
        data = load_json_file(file_path)

        if not data or "backtestData" not in data or "tickerInfo" not in data:
            continue

        ticker_info = data["tickerInfo"]
        if ticker_info.get("upcoming") or not ticker_info.get("frequency"):
            continue

        original_data_str = json.dumps(data["backtestData"], sort_keys=True)

        # forecasted 제거
        cleaned_backtest_data = [
            item for item in data["backtestData"] if not item.get("forecasted")
        ]

        known_entries = [
            item
            for item in cleaned_backtest_data
            if "amount" in item or "amountFixed" in item or item.get("expected")
        ]

        if not known_entries:
            continue

        last_known_date_str = max(item["date"] for item in known_entries)
        next_date = datetime.strptime(last_known_date_str, "%Y-%m-%d")

        frequency = ticker_info["frequency"]
        group = ticker_info.get("group")
        holiday_set = us_holidays

        future_projections = []
        existing_dates = {item["date"] for item in cleaned_backtest_data}

        while True:
            if frequency == "매주":
                next_date += timedelta(days=7)
                if group in ["월", "화", "수", "목", "금"]:
                    day_map = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4}
                    target_weekday = day_map[group]
                    days_ahead = target_weekday - next_date.weekday()
                    next_date += timedelta(days=days_ahead)
            elif frequency == "매월":
                next_date += relativedelta(months=1)
            elif frequency == "분기":
                next_date += relativedelta(months=3)
            elif frequency == "매년":
                next_date += relativedelta(years=1)
            else:
                break

            if next_date < today:
                continue

            if next_date >= limit_date:
                break

            adjusted_date = get_previous_business_day(next_date, holiday_set)
            date_str = adjusted_date.strftime("%Y-%m-%d")

            if date_str not in existing_dates:
                future_projections.append({"date": date_str, "forecasted": True})
                existing_dates.add(date_str)

        if not future_projections:
            continue

        final_backtest_data = cleaned_backtest_data + future_projections
        final_backtest_data.sort(key=lambda x: x["date"])
        data["backtestData"] = final_backtest_data

        if original_data_str != json.dumps(data["backtestData"], sort_keys=True):
            save_json_file(file_path, data)
            updated_count += 1

    print(f"\n✅ 미래 배당일 예측 완료: {updated_count}개 파일 업데이트\n")
    return updated_count


# ============================================================================
# 메인 실행
# ============================================================================
def main():
    """US 전용 통합 파이프라인 실행"""
    import sys

    start_time = time.time()

    # 커맨드라인 인자 파싱
    steps_to_run = []

    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            arg_lower = arg.lower()
            if arg_lower in ["1", "dividends"]:
                steps_to_run.append("dividends")
            elif arg_lower in ["2", "info"]:
                steps_to_run.append("info")
            elif arg_lower in ["3", "frequency"]:
                steps_to_run.append("frequency")
            elif arg_lower in ["4", "projection"]:
                steps_to_run.append("projection")
            elif arg_lower == "--help" or arg_lower == "-h":
                print("사용법:")
                print("  python scripts/info_data_pipeline_us.py [단계]")
                print("")
                print("단계 옵션:")
                print("  1, dividends    - 배당 데이터 업데이트")
                print("  2, info         - 티커 정보 + 시가총액 업데이트")
                print("  3, frequency    - 배당 빈도 분석")
                print("  4, projection   - 미래 배당일 예측")
                print("")
                print("예시:")
                print("  python scripts/info_data_pipeline_us.py                    # 전체 실행")
                print("  python scripts/info_data_pipeline_us.py 1                  # Step 1만")
                print("  python scripts/info_data_pipeline_us.py dividends          # 배당 데이터만")
                return
            else:
                print(f"⚠️  알 수 없는 인자: {arg}")
                print("  --help 또는 -h로 사용법을 확인하세요.")
                return

    # 초기화 (US 전용)
    if not initialize():
        return

    # 실행할 단계가 지정되지 않았으면 전체 실행
    if not steps_to_run:
        steps_to_run = ["dividends", "info", "frequency", "projection"]

    # 결과 저장
    results = {}

    # Step 1: 배당 데이터 업데이트
    if "dividends" in steps_to_run:
        print("\n" + "=" * 80)
        print("📊 STEP 1: 배당 데이터 업데이트 실행")
        print("=" * 80)
        results["dividends"] = update_dividends()
    else:
        print("\n⏭️  STEP 1: 배당 데이터 업데이트 건너뜀")

    # Step 2: 티커 정보 + 시가총액 업데이트
    if "info" in steps_to_run:
        print("\n" + "=" * 80)
        print("📋 STEP 2: 티커 정보 + 시가총액 업데이트 실행")
        print("=" * 80)
        results["info"] = update_ticker_info()
    else:
        print("\n⏭️  STEP 2: 티커 정보 + 시가총액 업데이트 건너뜀")

    # Step 3: 배당 빈도 분석
    if "frequency" in steps_to_run:
        print("\n" + "=" * 80)
        print("📅 STEP 3: 배당 빈도 분석 실행")
        print("=" * 80)
        results["frequency"] = analyze_dividend_frequency()
    else:
        print("\n⏭️  STEP 3: 배당 빈도 분석 건너뜀")

    # Step 4: 미래 배당일 예측
    if "projection" in steps_to_run:
        print("\n" + "=" * 80)
        print("🔮 STEP 4: 미래 배당일 예측 실행")
        print("=" * 80)
        results["projection"] = project_future_dividends()
    else:
        print("\n⏭️  STEP 4: 미래 배당일 예측 건너뜀")

    # 완료
    elapsed_time = time.time() - start_time
    print("\n" + "=" * 80)
    print("🎉 정보성 데이터 통합 파이프라인 완료")
    print("=" * 80)
    if "dividends" in results:
        print(f"📊 배당 데이터: {results['dividends']}개 파일 업데이트")
    if "info" in results:
        print(f"📋 티커 정보 + 시가총액: {results['info']}개 파일 업데이트")
    if "frequency" in results:
        print(f"📅 배당 빈도: {results['frequency']}개 티커 업데이트")
    if "projection" in results:
        print(f"🔮 배당일 예측: {results['projection']}개 파일 업데이트")
    print(f"⏱️  총 소요 시간: {elapsed_time:.2f}초")
    if len(steps_to_run) == 4:
        print(f"✨ 최적화: 중복 API 호출 제거로 성능 향상")
    print("=" * 80)


if __name__ == "__main__":
    main()
