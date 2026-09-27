# scripts/clean_data.py

import os
import json
from datetime import datetime, timedelta
from tqdm import tqdm

PUBLIC_DIR = "public"
DATA_DIR = os.path.join(PUBLIC_DIR, "data")


def main():
    # 커맨드라인 인자로 특정 티커 지정 가능
    import sys
    target_tickers = []
    if len(sys.argv) > 1:
        target_tickers = [arg.upper() for arg in sys.argv[1:]]
        print(f"--- [Specific Mode] Data Cleaning for: {', '.join(target_tickers)} ---")
    else:
        print("--- [Full Mode] Starting Data Cleaning Process ---")
    
    files = [f for f in os.listdir(DATA_DIR) if f.endswith(".json")]
    
    # 특정 티커만 필터링
    if target_tickers:
        files = [
            f for f in files 
            if f.replace(".json", "").replace("-", ".").upper() in target_tickers
        ]
        if not files:
            print(f"❌ 지정한 티커의 JSON 파일을 찾을 수 없습니다: {', '.join(target_tickers)}")
            return

    today = datetime.now()
    # 문제 2: 오늘로부터 7일 전 날짜를 기준으로 설정
    cutoff_date = today - timedelta(days=7)

    cleaned_count = 0

    for filename in tqdm(files, desc="Cleaning data files"):
        file_path = os.path.join(DATA_DIR, filename)

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            continue

        if "backtestData" not in data or not data["backtestData"]:
            continue

        original_data_str = json.dumps(data["backtestData"], sort_keys=True)

        cleaned_data = []
        for item in data["backtestData"]:
            # 문제 3: date 키만 있는 불완전 데이터 제거
            if len(item.keys()) == 1 and "date" in item:
                continue

            # 문제 2: 오래된 expected/forecasted 데이터 제거
            is_old_prediction = False
            if item.get("expected") or item.get("forecasted"):
                # 실지급 데이터가 아닌 순수 예측 데이터인지 확인
                if "amount" not in item and "amountFixed" not in item:
                    try:
                        item_date = datetime.strptime(item["date"], "%Y-%m-%d")
                        if item_date < cutoff_date:
                            is_old_prediction = True
                    except (ValueError, TypeError):
                        pass  # 날짜 형식이 잘못된 경우 무시

            if is_old_prediction:
                continue

            cleaned_data.append(item)

        # 문제 1: 20xx -> 19xx 날짜 오류 수정 및 중복 제거
        processed_items = {}
        for item in cleaned_data:
            try:
                date_obj = datetime.strptime(item["date"], "%Y-%m-%d")
                # 현재 년도+1 보다 크면 100년 빼기 (예: 2025년 기준 2027년 이상은 오류로 간주)
                if date_obj.year > today.year + 1:
                    date_obj = date_obj.replace(year=date_obj.year - 100)

                date_str = date_obj.strftime("%Y-%m-%d")

                # 중복 날짜 병합: 기존 항목에 새 항목의 데이터를 덮어씀
                if date_str in processed_items:
                    processed_items[date_str].update(item)
                else:
                    processed_items[date_str] = item
                # 날짜 키 자체도 수정된 값으로 업데이트
                processed_items[date_str]["date"] = date_str

            except (ValueError, TypeError):
                # 날짜 파싱 실패 시 원본 그대로 유지 (이미 처리된 중복일 수 있음)
                if item["date"] not in processed_items:
                    processed_items[item["date"]] = item

        final_data = sorted(list(processed_items.values()), key=lambda x: x["date"])
        data["backtestData"] = final_data

        new_data_str = json.dumps(final_data, sort_keys=True)

        if original_data_str != new_data_str:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            cleaned_count += 1

    print(f"\n--- Data Cleaning Finished. Total files updated: {cleaned_count} ---")


if __name__ == "__main__":
    main()
