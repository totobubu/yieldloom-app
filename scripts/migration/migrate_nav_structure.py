import os
import json
import yfinance as yf
from tqdm import tqdm
import time

ROOT_DIR = os.getcwd()
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
NAV_DIR = os.path.join(PUBLIC_DIR, "nav")


# [핵심 수정] EXCHANGE_MAP을 더 명확하게 정의하고 NYSE Arca를 NYSE로 통합
EXCHANGE_MAP = {
    "NYQ": "NYSE",  # New York Stock Exchange
    "NMS": "NASDAQ",  # NASDAQ
    "PCX": "NYSE",  # NYSE Arca -> NYSE로 통합
    "BATS": "NASDAQ",  # CBOE -> NASDAQ으로 통합 (ETF 등)
    "KOE": "KOSDAQ",
    "KSC": "KOSPI",
}
DEFAULT_MARKET = "NASDAQ"  # 매핑 정보가 없는 경우 기본값


def get_exchange_for_ticker(ticker_symbol):
    """yfinance를 통해 티커의 거래소 정보를 가져옵니다."""
    try:
        ticker = yf.Ticker(ticker_symbol)
        exchange = ticker.info.get("exchange")
        return exchange
    except Exception:
        # 가끔 네트워크 오류나 잘못된 티커로 인해 실패할 수 있음
        return None


def main():
    print(
        "--- Starting Migration of old nav structure to new market-based structure ---"
    )

    old_files = [
        f for f in os.listdir(NAV_DIR) if f.endswith(".json") and len(f) == 6
    ]  # a.json, b.json ...
    if not old_files:
        print("No old structure files found. Migration might be already complete.")
        return

    all_tickers = []
    for filename in old_files:
        file_path = os.path.join(NAV_DIR, filename)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                all_tickers.extend(json.load(f))
        except (IOError, json.JSONDecodeError) as e:
            print(f"Could not read or parse {filename}: {e}")

    print(f"Found {len(all_tickers)} total tickers to migrate.")

    migrated_data = {}  # {'NYSE': {'a': [...], 'b': [...]}, 'NASDAQ': ...}

    for ticker_data in tqdm(all_tickers, desc="Migrating tickers"):
        symbol = ticker_data["symbol"]
        exchange_code = get_exchange_for_ticker(symbol)

        # [핵심 수정] 수정된 EXCHANGE_MAP을 사용하여 market 결정
        market = EXCHANGE_MAP.get(exchange_code, DEFAULT_MARKET)
        if exchange_code in EXCHANGE_MAP:
            market = EXCHANGE_MAP[exchange_code]
        elif exchange_code == "PCX":  # NYSE Arca는 NYSE로 통합
            market = "NYSE"

        # market 디렉토리 준비
        if market not in migrated_data:
            migrated_data[market] = {}

        # 파일명(첫 글자) 준비
        first_char = symbol[0].lower()
        if not "a" <= first_char <= "z":
            first_char = "etc"

        if first_char not in migrated_data[market]:
            migrated_data[market][first_char] = []

        # 기존 데이터에 market 정보 추가 후 저장
        ticker_data["market"] = market
        migrated_data[market][first_char].append(ticker_data)

        time.sleep(0.1)  # API 속도 제한 방지

    # 재구성된 데이터를 파일로 저장
    for market, files in migrated_data.items():
        market_path = os.path.join(NAV_DIR, market)
        os.makedirs(market_path, exist_ok=True)
        for char, tickers in files.items():
            tickers.sort(key=lambda x: x["symbol"])
            file_path = os.path.join(market_path, f"{char}.json")
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(tickers, f, indent=4, ensure_ascii=False)

    print("\n🎉 Migration successful!")
    print(
        "You can now delete the old source files (a.json, b.json, etc.) from the 'public/nav' directory."
    )

    # 마이그레이션이 완료되면 기존 파일들을 삭제하는 것을 권장
    # for filename in old_files:
    #     os.remove(os.path.join(NAV_DIR, filename))
    # print("Old files have been removed.")


if __name__ == "__main__":
    main()
