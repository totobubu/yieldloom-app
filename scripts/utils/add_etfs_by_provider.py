import os
import sys
import json
import yfinance as yf
from tqdm import tqdm

# --- 경로 설정 및 상수 ---
ROOT_DIR = os.getcwd()
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
NAV_DIR = os.path.join(PUBLIC_DIR, "nav")
NAV_FILE_PATH = os.path.join(PUBLIC_DIR, "nav.json")
DEFAULT_MARKET = "NASDAQ"


def main():
    if len(sys.argv) < 2:
        print('Usage: python scripts/add_etfs_by_provider.py "<Provider Name>"')
        return

    provider_name = sys.argv[1]
    provider_name_lower = provider_name.lower()

    print(f"--- Updating company info for '{provider_name}' ETFs ---")

    try:
        with open(NAV_FILE_PATH, "r", encoding="utf-8") as f:
            nav_data = json.load(f)
        all_symbols = [
            t["symbol"]
            for t in nav_data.get("nav", [])
            if t.get("currency") == "USD" and not t.get("koName")
        ]
    except (FileNotFoundError, json.JSONDecodeError):
        print(f"❌ Error: nav.json not found or is invalid.")
        return

    print(f"Analyzing {len(all_symbols)} existing US tickers...")

    tickers_to_update = []
    batch_size = 100

    # sharesOutstanding 데이터도 함께 수집
    shares_data = {}
    
    for i in tqdm(
        range(0, len(all_symbols), batch_size),
        desc=f"Checking for {provider_name} ETFs",
    ):
        batch = all_symbols[i : i + batch_size]
        tickers_info = yf.Tickers(batch)

        for symbol, ticker_obj in tickers_info.tickers.items():
            try:
                info = ticker_obj.info
                fund_family = info.get("fund_family", "").lower()
                
                if provider_name_lower in fund_family:
                    tickers_to_update.append(symbol)
                    
                    # sharesOutstanding 확인
                    shares = info.get("sharesOutstanding")
                    shares_data[symbol] = shares is not None and shares > 0
            except Exception:
                continue

    if not tickers_to_update:
        print(f"No tickers found with fund family '{provider_name}'.")
        return

    print(f"\nFound {len(tickers_to_update)} ETFs. Updating nav source files...")

    updated_count = 0

    # nav 소스 파일들을 모두 읽어 메모리에 로드
    nav_sources = {}
    market_dirs = [
        d for d in os.listdir(NAV_DIR) if os.path.isdir(os.path.join(NAV_DIR, d))
    ]
    for market in market_dirs:
        market_path = os.path.join(NAV_DIR, market)
        files = [f for f in os.listdir(market_path) if f.endswith(".json")]
        for filename in files:
            file_path = os.path.join(market_path, filename)
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    nav_sources[file_path] = json.load(f)
            except (IOError, json.JSONDecodeError):
                nav_sources[file_path] = []

    # 전체 소스에서 티커를 찾아 company 및 sharesOutstanding 정보 업데이트
    for file_path, tickers in nav_sources.items():
        file_has_changed = False
        for ticker_data in tickers:
            symbol = ticker_data["symbol"]
            if symbol in tickers_to_update:
                # company 업데이트
                if ticker_data.get("company") != provider_name:
                    ticker_data["company"] = provider_name
                    file_has_changed = True
                    updated_count += 1
                
                # sharesOutstanding 업데이트
                if symbol in shares_data:
                    old_shares = ticker_data.get("sharesOutstanding")
                    new_shares = shares_data[symbol]
                    if old_shares != new_shares:
                        ticker_data["sharesOutstanding"] = new_shares
                        file_has_changed = True

        if file_has_changed:
            tickers.sort(key=lambda x: x["symbol"])
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(tickers, f, indent=4, ensure_ascii=False)

    print(
        f"\n🎉 Successfully updated {updated_count} tickers with company name '{provider_name}'."
    )
    print("Please run 'npm run generate-nav' to apply changes.")


if __name__ == "__main__":
    main()
