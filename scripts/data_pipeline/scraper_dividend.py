# scripts\scraper_dividend.py
import os
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from tqdm import tqdm

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import load_json_file, save_json_file, sanitize_ticker_for_filename, get_data_file_path, load_json_file as load_nav


def parse_date(date_str):
    """날짜 문자열을 datetime 객체로 변환"""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def get_dividend_value(item):
    """항목의 배당 값 반환 (amountFixed 우선, 없으면 amount)"""
    if "amountFixed" in item:
        return item.get("amountFixed")
    elif "amount" in item:
        return item.get("amount")
    return None


def clean_duplicate_dividends(backtest_data):
    """
    중복 배당 데이터 정리
    1. 같은 날짜에 amountFixed와 amount가 모두 있으면 둘 다 유지
    2. 연속된 날짜에 동일한 배당이 있을 때 amountFixed가 있는 항목만 유지하고, 나머지의 amount 제거
    """
    if not backtest_data:
        return backtest_data

    # 날짜순으로 정렬
    sorted_data = sorted(backtest_data, key=lambda x: x.get("date", ""))

    # 모든 항목을 복사하여 처리
    cleaned_data = [item.copy() for item in sorted_data]

    # 각 항목의 배당 값과 amountFixed 여부를 확인
    i = 0
    while i < len(cleaned_data):
        current = cleaned_data[i]
        current_date = parse_date(current.get("date"))

        if not current_date:
            i += 1
            continue

        current_value = get_dividend_value(current)
        if current_value is None:
            i += 1
            continue

        # 같은 배당 값을 가진 연속된 항목들의 인덱스 찾기
        duplicate_indices = [i]

        # 이전 날짜 확인 (최대 7일 이내)
        for j in range(max(0, i - 7), i):
            prev_item = cleaned_data[j]
            prev_date = parse_date(prev_item.get("date"))
            if not prev_date or (current_date - prev_date).days > 7:
                continue

            prev_value = get_dividend_value(prev_item)
            # 소수점 3자리 동일 또는 절대 오차 0.001 이내면 동일 배당으로 간주
            if prev_value is not None and (
                round(prev_value, 3) == round(current_value, 3)
                or abs(prev_value - current_value) < 0.001
            ):
                if j not in duplicate_indices:
                    duplicate_indices.insert(0, j)

        # 다음 날짜 확인 (최대 7일 이내)
        for j in range(i + 1, len(cleaned_data)):
            next_item = cleaned_data[j]
            next_date = parse_date(next_item.get("date"))
            if not next_date or (next_date - current_date).days > 7:
                break

            next_value = get_dividend_value(next_item)
            # 소수점 3자리 동일 또는 절대 오차 0.001 이내면 동일 배당으로 간주
            if next_value is not None and (
                round(next_value, 3) == round(current_value, 3)
                or abs(next_value - current_value) < 0.001
            ):
                duplicate_indices.append(j)
            else:
                break

        # 중복 그룹이 2개 이상이면 처리
        if len(duplicate_indices) > 1:
            # amountFixed가 있는 항목 찾기
            fixed_indices = [
                idx for idx in duplicate_indices if "amountFixed" in cleaned_data[idx]
            ]

            if fixed_indices:
                # amountFixed가 있는 항목은 유지 (1번 규칙: 같은 날짜에 amountFixed와 amount가 모두 있어도 둘 다 유지)
                # amountFixed가 없는 항목에서만 amount 제거
                for idx in duplicate_indices:
                    if idx not in fixed_indices:
                        # amountFixed가 없고 amount만 있는 항목에서 amount 제거
                        cleaned_data[idx].pop("amount", None)
            else:
                # amountFixed가 없으면 첫 번째만 유지, 나머지에서 amount 제거
                first_idx = min(duplicate_indices)
                for idx in duplicate_indices:
                    if idx != first_idx:
                        cleaned_data[idx].pop("amount", None)

        i += 1

    return cleaned_data


def calculate_yields(backtest_data):
    if not backtest_data:
        return []

    for item in backtest_data:
        try:
            item["date_obj"] = datetime.strptime(item["date"], "%Y-%m-%d")
        except (ValueError, KeyError):
            item["date_obj"] = None

    valid_data = sorted(
        [item for item in backtest_data if item["date_obj"] is not None],
        key=lambda x: x["date_obj"],
    )

    for i, current_item in enumerate(valid_data):
        price_raw = current_item.get("open") or current_item.get("close")

        # [핵심 수정] amountFixed 우선 사용
        dividend_raw = (
            current_item.get("amountFixed")
            if "amountFixed" in current_item
            else current_item.get("amount")
        )

        if price_raw and price_raw > 0 and dividend_raw is not None:
            one_year_before = current_item["date_obj"] - timedelta(days=365)

            dividends_in_past_year = sum(
                (
                    entry.get("amountFixed")
                    if "amountFixed" in entry
                    else entry.get("amount", 0)
                )
                for entry in valid_data[i::-1]
                if entry["date_obj"] >= one_year_before
                and (
                    entry.get("amount") is not None
                    or entry.get("amountFixed") is not None
                )
            )

            if dividends_in_past_year > 0:
                # 소수점 아래 10자리로 반올림하여 불필요한 미세 변경 방지
                current_item["yield"] = round(dividends_in_past_year / price_raw, 10)

    for item in backtest_data:
        item.pop("date_obj", None)

    return backtest_data


def main():
    # 커맨드라인 인자로 특정 티커 지정 가능
    import sys
    target_tickers = []
    if len(sys.argv) > 1:
        target_tickers = [arg.upper() for arg in sys.argv[1:]]
        print(f"\n--- [Specific Mode] Calculating Yield for: {', '.join(target_tickers)} ---")
    else:
        print("\n--- [Full Mode] Calculating Yield for Backtest Data ---")
    
    # DATA_LAYOUT_MODE 확인
    data_layout_mode = os.environ.get("DATA_LAYOUT_MODE", "flat").lower()
    
    # nav.json에서 티커 목록 가져오기
    nav_data = load_nav(Path("public/nav.json"))
    if not nav_data:
        print("❌ nav.json을 찾을 수 없습니다.")
        return
    
    tickers_to_process = []
    for entry in nav_data.get("nav", []):
        if entry.get("upcoming"):
            continue
        symbol = entry.get("symbol") or entry.get("yfSymbol")
        if not symbol:
            continue
        if target_tickers and symbol.upper() not in target_tickers:
            continue
        tickers_to_process.append({
            "symbol": symbol,
            "market": entry.get("market")
        })
    
    if target_tickers and not tickers_to_process:
        print(f"❌ 지정한 티커의 JSON 파일을 찾을 수 없습니다: {', '.join(target_tickers)}")
        return
    
    updated_count = 0

    for ticker_info in tqdm(tickers_to_process, desc="Calculating Yields"):
        symbol = ticker_info["symbol"]
        market = ticker_info["market"]
        file_path = get_data_file_path(symbol, market, layout=data_layout_mode)
        
        if not file_path.exists():
            continue
            
        data = load_json_file(file_path)
        if not data or "backtestData" not in data:
            continue

        original_backtest_data_str = json.dumps(
            data.get("backtestData", []), sort_keys=True
        )

        # 배당 데이터가 있는 경우에만 처리
        if any(
            item.get("amount") is not None or item.get("amountFixed") is not None
            for item in data["backtestData"]
        ):
            # 1단계: 중복 배당 데이터 정리
            cleaned_data = clean_duplicate_dividends(data["backtestData"])

            # 2단계: 배당률 계산
            new_backtest_data = calculate_yields(cleaned_data)
            new_backtest_data_str = json.dumps(new_backtest_data, sort_keys=True)

            if original_backtest_data_str != new_backtest_data_str:
                data["backtestData"] = new_backtest_data
                
                # 로컬 저장
                if save_json_file(file_path, data):
                    updated_count += 1
                    
                    # R2 업로드 시도
                    try:
                        from scripts.r2_helper import upload_json_to_r2
                        file_path_str = str(file_path).replace("\\", "/")
                        r2_key = file_path_str.split("public/", 1)[1]
                        upload_json_to_r2(data, r2_key)
                    except:
                        pass

    print(f"\n--- Yield Calculation Finished. Total files updated: {updated_count} ---")


if __name__ == "__main__":
    main()
