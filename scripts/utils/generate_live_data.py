# scripts/generate_live_data.py
import os
import json
import yfinance as yf
import pandas as pd

# --- 경로 설정 ---
ROOT_DIR = os.getcwd()
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
DATA_DIR = os.path.join(PUBLIC_DIR, "data")
NAV_FILE_PATH = os.path.join(PUBLIC_DIR, "nav.json")
OUTPUT_FILE = os.path.join(PUBLIC_DIR, "live-data.json")


def main():
    print("--- Starting Live Data Generation ---")

    try:
        with open(NAV_FILE_PATH, "r", encoding="utf-8") as f:
            nav_data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Error: nav.json not found at {NAV_FILE_PATH}")
        return

    active_tickers = [
        t["symbol"]
        for t in nav_data.get("nav", [])
        if t.get("symbol") and not t.get("upcoming", False)
    ]

    if not active_tickers:
        print("No active tickers found to fetch.")
        return

    print(f"Found {len(active_tickers)} active tickers to fetch.")

    batch_size = 100
    all_live_data = []

    for i in range(0, len(active_tickers), batch_size):
        batch = active_tickers[i : i + batch_size]
        print(
            f"Fetching batch {i // batch_size + 1}/{(len(active_tickers) + batch_size - 1) // batch_size}..."
        )

        # [핵심 수정] auto_adjust=True 인자를 명시적으로 추가하여 FutureWarning를 제거합니다.
        data = yf.download(batch, period="1d", progress=False, auto_adjust=True)

        if not data.empty and "Close" in data:
            # yf.download는 여러 티커에 대해 multi-level column을 가진 DataFrame을 반환합니다.
            close_prices = data["Close"].iloc[-1]

            for ticker in batch:
                price = close_prices.get(ticker)
                if pd.notna(price):
                    all_live_data.append({"symbol": ticker, "price": price})

    # Yield 정보 추가
    for item in all_live_data:
        file_path = os.path.join(
            DATA_DIR, f"{item['symbol'].replace('.', '-').lower()}.json"
        )
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                ticker_data = json.load(f)
                yield_str = ticker_data.get("tickerInfo", {}).get("Yield", "0.0%")
                # '%'를 제거하고 float으로 변환
                yield_val = float(yield_str.replace("%", "").strip())
                item["yield"] = yield_val
        except (FileNotFoundError, ValueError, KeyError):
            item["yield"] = 0.0

    try:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(all_live_data, f, indent=2)
        print(
            f"Successfully generated {OUTPUT_FILE} with {len(all_live_data)} tickers."
        )
    except IOError as e:
        print(f"❌ Error writing to {OUTPUT_FILE}: {e}")


if __name__ == "__main__":
    main()
