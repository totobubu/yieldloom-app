# scripts/scraper_info.py
import time
import json
import sys
from pathlib import Path
import yfinance as yf
from datetime import datetime
from tqdm import tqdm

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import (
    load_json_file,
    save_json_file,
    sanitize_ticker_for_filename,
    get_kst_now,
    should_skip_update_timestamp,
)

# data_file_path는 utils 디렉토리를 직접 경로에 추가하여 import
sys.path.insert(0, str(ROOT_DIR / "scripts" / "utils"))
from data_file_path import get_data_file_path, find_existing_data_file


def fetch_bulk_ticker_info_batch(ticker_symbols_batch):
    bulk_data = {}
    try:
        tickers = yf.Tickers(ticker_symbols_batch)
        for symbol, ticker_obj in tickers.tickers.items():
            try:
                bulk_data[symbol] = ticker_obj.info
            except Exception:
                bulk_data[symbol] = None
        return bulk_data
    except Exception as e:
        print(f"  -> Critical error during batch fetch: {e}")
        return {symbol: None for symbol in ticker_symbols_batch}


def process_single_ticker_info(info):
    # Yahoo Finance에서 정보를 못 가져온 경우에도 기본 구조는 반환
    # (신규 상장 ETF의 경우 정보가 없을 수 있음)
    if not info:
        return {}  # 빈 dict 반환 (None이 아님)

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
        "regularMarketPrice": info.get("regularMarketPrice"),
        "englishName": info.get("longName"),
        "earningsDate": earnings_date,
        "enterpriseValue": info.get("enterpriseValue"),
        "marketCap": info.get("marketCap"),
        "Volume": info.get("volume"),
        "AvgVolume": info.get("averageVolume"),
        "sharesOutstanding": info.get("sharesOutstanding"),
        "52Week": fifty_two_week_range,
        "Yield": yield_val,
        "dividendRate": info.get("dividendRate"),
        "payoutRatio": info.get("payoutRatio"),
    }


def main():
    nav_data = load_json_file("public/nav.json")
    if not nav_data:
        return
    
    # 커맨드라인 인자로 특정 티커 지정 가능
    target_tickers = []
    if len(sys.argv) > 1:
        target_tickers = [arg.upper() for arg in sys.argv[1:]]
        print(f"\n--- Starting Ticker Info Update for specific tickers: {', '.join(target_tickers)} ---")
    else:
        print("\n--- Starting Daily Ticker Info Update (RAW DATA) ---")
    
    active_tickers_from_nav = [
        item for item in nav_data.get("nav", []) if not item.get("upcoming")
    ]
    
    # 특정 티커만 처리하는 경우 필터링
    if target_tickers:
        active_tickers_from_nav = [
            item for item in active_tickers_from_nav 
            if item["symbol"] in target_tickers
        ]
        if not active_tickers_from_nav:
            print(f"❌ 지정한 티커를 nav.json에서 찾을 수 없습니다: {', '.join(target_tickers)}")
            return
        print(f"📌 {len(active_tickers_from_nav)}개 티커 처리 예정")
    
    active_symbols = [item["symbol"] for item in active_tickers_from_nav]

    batch_size = 100
    all_bulk_info = {}
    for i in tqdm(
        range(0, len(active_symbols), batch_size),
        desc="Fetching All Ticker Info in Batches",
    ):
        batch = active_symbols[i : i + batch_size]
        batch_info = fetch_bulk_ticker_info_batch(batch)
        all_bulk_info.update(batch_info)
        if i + batch_size < len(active_symbols):
            time.sleep(1)

    total_changed_files = 0
    now_kst_str = get_kst_now().strftime("%Y-%m-%d %H:%M:%S KST")

    for info_from_nav in tqdm(
        active_tickers_from_nav, desc="Processing Raw Ticker Info"
    ):
        ticker_symbol = info_from_nav.get("symbol")
        raw_dynamic_info = all_bulk_info.get(ticker_symbol)
        dynamic_info = process_single_ticker_info(raw_dynamic_info)
        # dynamic_info가 빈 dict여도 계속 진행 (신규 티커의 경우)

        # nav.json의 dataPaths 사용
        data_path = (
            info_from_nav.get("dataPaths")[0] if info_from_nav.get("dataPaths") else None
        )
        if data_path:
            # dataPath는 "data/market/ticker.json" 형식이므로 "public/" 추가
            file_path = f"public/{data_path}"
        else:
            # fallback: market 정보를 사용하여 올바른 경로 생성
            market = info_from_nav.get("market")
            # 기존 파일 찾기 시도
            existing_file = find_existing_data_file(ticker_symbol, market)
            if existing_file:
                file_path = str(existing_file)
            else:
                # 새 파일 경로 생성 (market 서브디렉토리 사용)
                file_path = str(get_data_file_path(ticker_symbol, market))
        
        existing_data = load_json_file(file_path) or {}
        
        # 파일이 새로 생성되는 경우, tickerInfo를 먼저 배치하기 위해 순서 보장
        if not existing_data:
            existing_data = {"tickerInfo": {}, "backtestData": []}
        
        old_info = existing_data.get("tickerInfo", {})

        new_info = {
            "Symbol": ticker_symbol,
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

        compare_old = {
            k: v for k, v in old_info.items() if k not in ["Update", "changes"]
        }
        compare_new = {
            k: v for k, v in new_info.items() if k not in ["Update", "changes"]
        }

        data_changed = json.dumps(compare_old, sort_keys=True) != json.dumps(
            compare_new, sort_keys=True
        )

        # 정책: 데이터 변경이 없으면 Update 필드 유지하고 저장 안함
        if should_skip_update_timestamp(old_info.get("Update"), data_changed):
            new_info["Update"] = old_info.get("Update")  # 기존 Update 유지
            continue  # 데이터 변경이 없으면 저장하지 않음

        # 데이터 변경이 있으면 Update 필드 갱신하고 저장
        existing_data["tickerInfo"] = new_info
        
        # 로컬 저장
        if save_json_file(file_path, existing_data):
            total_changed_files += 1
            
            # R2 업로드 시도
            try:
                from scripts.r2_helper import upload_json_to_r2
                r2_key = f"data/{sanitize_ticker_for_filename(ticker_symbol)}.json"
                upload_json_to_r2(existing_data, r2_key)
            except:
                pass  # R2 실패해도 로컬 저장은 성공

    print(
        f"\n--- Ticker Info Update Finished. Total files updated: {total_changed_files} ---"
    )


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ['-h', '--help']:
        print("""
사용법:
  python scripts/scraper_info.py              # 모든 티커 업데이트
  python scripts/scraper_info.py UX           # UX 티커만 업데이트
  python scripts/scraper_info.py UX NVDY TSLY  # 여러 티커 업데이트
        """)
        sys.exit(0)
    
    main()
