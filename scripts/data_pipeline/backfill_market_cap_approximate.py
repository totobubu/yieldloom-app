# scripts/backfill_market_cap_approximate.py
"""
일회성 스크립트: 과거 backtestData에 marketCap을 근사값으로 채우기
공식: marketCap ≈ sharesOutstanding (현재) × close (과거)

주의: 
- 근사값입니다 (정확도 85~95%)
- 발행주식수가 변하지 않았다고 가정
- 주식분할/증자가 있었다면 오차 발생
"""

import json
import yfinance as yf
from pathlib import Path
from tqdm import tqdm
import time

# --- 경로 설정 ---
ROOT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
NAV_FILE = PUBLIC_DIR / "nav.json"


def get_shares_outstanding_batch(symbols):
    """Yahoo Finance에서 여러 티커의 발행주식수를 배치로 가져오기"""
    try:
        tickers = yf.Tickers(" ".join(symbols))
        shares_data = {}
        
        for symbol in symbols:
            try:
                ticker_obj = tickers.tickers.get(symbol)
                if ticker_obj and ticker_obj.info:
                    shares = ticker_obj.info.get("sharesOutstanding")
                    shares_data[symbol] = shares if shares else None
                else:
                    shares_data[symbol] = None
            except Exception:
                shares_data[symbol] = None
        
        return shares_data
    
    except Exception as e:
        print(f"[ERROR] Batch fetch error: {e}")
        return {symbol: None for symbol in symbols}


def backfill_ticker_approximate(symbol, shares_outstanding):
    """특정 티커의 과거 데이터에 marketCap 근사값 추가"""
    sanitized_symbol = symbol.replace(".", "-").lower()
    file_path = DATA_DIR / f"{sanitized_symbol}.json"

    if not file_path.exists():
        return {"symbol": symbol, "status": "no_file", "updated": 0}

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        backtest_data = data.get("backtestData", [])
        if not backtest_data:
            return {"symbol": symbol, "status": "no_data", "updated": 0}

        # sharesOutstanding이 없으면 스킵
        if shares_outstanding is None:
            return {"symbol": symbol, "status": "no_shares", "updated": 0}

        # 과거 데이터에 marketCap 계산
        updated_count = 0
        for entry in backtest_data:
            # 이미 marketCap이 있으면 스킵
            if entry.get("marketCap"):
                continue
            
            # close 가격이 있어야 계산 가능
            close_price = entry.get("close")
            if close_price is None or close_price <= 0:
                continue
            
            # 근사값 계산: marketCap = sharesOutstanding × close
            entry["marketCap"] = int(shares_outstanding * close_price)
            updated_count += 1

        if updated_count > 0:
            # 파일 저장
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            return {"symbol": symbol, "status": "success", "updated": updated_count}
        else:
            return {"symbol": symbol, "status": "already_filled", "updated": 0}

    except Exception as e:
        return {"symbol": symbol, "status": "error", "error": str(e), "updated": 0}


def main():
    import sys
    import io
    # Windows에서 UTF-8 출력을 위한 설정
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    print("=" * 80)
    print("[Backfill] Historical Market Cap (Approximate Values)")
    print("=" * 80)
    print("[Formula] marketCap ≈ sharesOutstanding (current) × close (historical)")
    print("[Note] This is an approximation (85~95% accuracy)")
    print("=" * 80)

    # nav.json에서 활성 티커 목록 가져오기
    try:
        with open(NAV_FILE, "r", encoding="utf-8") as f:
            nav_data = json.load(f)
    except FileNotFoundError:
        print(f"[ERROR] nav.json not found at {NAV_FILE}")
        return

    active_tickers = [
        t["symbol"]
        for t in nav_data.get("nav", [])
        if t.get("symbol") and not t.get("upcoming", False)
    ]

    if not active_tickers:
        print("[WARNING] No active tickers found in nav.json")
        return

    # 커맨드라인 인자로 특정 티커 지정 가능
    import sys
    target_tickers = []
    if len(sys.argv) > 1:
        target_tickers = [arg.upper() for arg in sys.argv[1:]]
        active_tickers = [t for t in active_tickers if t in target_tickers]
        if not active_tickers:
            print(f"[ERROR] 지정한 티커를 nav.json에서 찾을 수 없습니다: {', '.join(target_tickers)}")
            return
        print(f"[INFO] [Specific Mode] Processing {len(active_tickers)} ticker(s): {', '.join(target_tickers)}")
    else:
        print(f"\n[INFO] [Full Mode] Total active tickers: {len(active_tickers)}")
        
        # 사용자 확인
        print("\n[WARNING] This will calculate approximate marketCap for ALL historical data.")
        print("[WARNING] Existing marketCap values will be preserved.")
        response = input("\nProceed? (yes/no): ").strip().lower()
        
        if response != "yes":
            print("[ABORT] Aborted by user.")
            return

    print("\n" + "=" * 80)
    print("Starting backfill process...")
    print("=" * 80 + "\n")

    # 배치 크기
    BATCH_SIZE = 100
    
    results = {
        "success": 0,
        "already_filled": 0,
        "no_shares": 0,
        "no_file": 0,
        "no_data": 0,
        "error": 0,
        "total_entries_updated": 0
    }

    # 배치로 처리
    for i in tqdm(
        range(0, len(active_tickers), BATCH_SIZE),
        desc="Processing batches",
        unit="batch"
    ):
        batch = active_tickers[i:i + BATCH_SIZE]
        
        # 배치로 sharesOutstanding 가져오기
        shares_data = get_shares_outstanding_batch(batch)
        
        # 각 티커 처리
        for symbol in batch:
            shares = shares_data.get(symbol)
            result = backfill_ticker_approximate(symbol, shares)
            
            status = result["status"]
            results[status] = results.get(status, 0) + 1
            results["total_entries_updated"] += result["updated"]
        
        # 다음 배치 전 잠시 대기 (API 안정성)
        if i + BATCH_SIZE < len(active_tickers):
            time.sleep(1)

    # 최종 결과
    print("\n" + "=" * 80)
    print("[COMPLETE] Backfill Complete!")
    print("=" * 80)
    print(f"[SUCCESS] Success: {results['success']} tickers")
    print(f"[INFO] Already filled: {results['already_filled']} tickers")
    print(f"[WARNING] No shares data: {results['no_shares']} tickers")
    print(f"[WARNING] No file: {results['no_file']} tickers")
    print(f"[WARNING] No backtest data: {results['no_data']} tickers")
    print(f"[ERROR] Error: {results['error']} tickers")
    print(f"\n[INFO] Total entries updated: {results['total_entries_updated']:,}")
    print("=" * 80)
    
    print("\n[INFO] Next steps:")
    print("1. Check a few ticker files to verify the data")
    print("2. Future data will be collected automatically (daily)")
    print("3. Run this script again only if you add new tickers")


if __name__ == "__main__":
    main()





