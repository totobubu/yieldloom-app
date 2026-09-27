# scripts\migrate_to_timeseries.py
import os
import json
import sys
from pathlib import Path
from tqdm import tqdm

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import (
    load_json_file,
    save_json_file,
    sanitize_ticker_for_filename,
    parse_numeric_value,
)
DATA_DIR = os.path.join(ROOT_DIR, "public", "data")


def main():
    print("--- Starting Migration to Time-Series Data Structure (with amountFixed) ---")
    files = [f for f in os.listdir(DATA_DIR) if f.endswith(".json")]

    for filename in tqdm(files, desc="Migrating files"):
        file_path = os.path.join(DATA_DIR, filename)
        data = load_json_file(file_path)
        if not data:
            continue

        prices = data.get("backtestData", {}).get("prices", [])
        dividends = data.get("backtestData", {}).get("dividends", [])
        manual_history = data.get("dividendHistory", [])

        timeseries_map = {}

        # 1. 가격 데이터 병합
        for price_entry in prices:
            date = price_entry.get("date")
            if date:
                timeseries_map[date] = price_entry

        # 2. 자동 수집 배당금 병합
        for div_entry in dividends:
            date = div_entry.get("date")
            if date:
                if date not in timeseries_map:
                    timeseries_map[date] = {"date": date}
                timeseries_map[date]["amount"] = div_entry.get("amount")

        # 3. [핵심 수정] 수동 입력 데이터를 amountFixed로 저장
        for history_entry in manual_history:
            try:
                date_obj = datetime.strptime(
                    history_entry["배당락"].replace(" ", ""), "%y.%m.%d"
                )
                date_str = date_obj.strftime("%Y-%m-%d")
                manual_amount = parse_numeric_value(history_entry.get("배당금"))

                if date_str not in timeseries_map:
                    timeseries_map[date_str] = {"date": date_str}

                if manual_amount is not None:
                    # 수동 값은 amountFixed에 저장하여 영구 보존
                    timeseries_map[date_str]["amountFixed"] = manual_amount
            except (ValueError, KeyError):
                continue

        new_backtest_data = sorted(timeseries_map.values(), key=lambda x: x["date"])

        data["backtestData"] = new_backtest_data
        data.pop("dividendHistory", None)

        save_json_file(file_path, data)

    print("\n🎉 Migration complete! Manual dividend data is saved in 'amountFixed'.")


if __name__ == "__main__":
    from datetime import datetime  # main 스코프에서 사용하기 위해 추가

    main()
