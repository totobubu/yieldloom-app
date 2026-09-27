#!/usr/bin/env python3
"""
noDividends 플래그가 있는 종목들의 배당 상태를 체크하는 스크립트
배당이 새로 생긴 종목을 찾아냅니다.
"""

import os
import json
from pathlib import Path
import yfinance as yf
from tqdm import tqdm
import time

# 경로 설정
ROOT_DIR = Path(__file__).parent.parent.parent
NAV_DIR = ROOT_DIR / "public" / "nav"

def get_no_dividend_symbols():
    """noDividends 플래그가 있는 모든 심볼 수집"""
    symbols = []
    
    # 모든 시장 디렉토리 스캔
    for market_dir in ["NASDAQ", "NYSE", "bats"]:
        market_path = NAV_DIR / market_dir
        if not market_path.exists():
            continue
        
        for json_file in market_path.glob("*.json"):
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    if item.get("noDividends", False):
                        symbols.append({
                            "symbol": item["symbol"],
                            "yfSymbol": item.get("yfSymbol", item["symbol"]),
                            "koName": item.get("koName", ""),
                            "market": item.get("market", "")
                        })
    
    return symbols


def check_dividend_status(yf_symbol):
    """yfinance로 배당 데이터 확인"""
    try:
        ticker = yf.Ticker(yf_symbol)
        dividends = ticker.dividends
        
        if not dividends.empty:
            return True, len(dividends)
        return False, 0
    except Exception as e:
        return False, 0

def main():
    print("🔍 Checking No-Dividend Symbols Status")
    print("=" * 60)
    
    # noDividends 플래그가 있는 심볼 수집
    no_div_symbols = get_no_dividend_symbols()
    print(f"📊 Found {len(no_div_symbols)} symbols marked as noDividends\n")
    
    if len(no_div_symbols) == 0:
        print("✅ No symbols to check")
        return
    
    # 배당이 새로 생긴 종목 찾기
    newly_with_dividends = []
    
    print("Checking dividend status...")
    for symbol_info in tqdm(no_div_symbols, desc="Checking symbols"):
        yf_symbol = symbol_info["yfSymbol"]
        has_div, div_count = check_dividend_status(yf_symbol)
        
        if has_div:
            newly_with_dividends.append({
                **symbol_info,
                "dividends_count": div_count
            })
        
        # API 호출 제한 방지
        time.sleep(0.1)
    
    print("\n" + "=" * 60)
    print(f"📈 Check Results:")
    print(f"  📊 Total checked: {len(no_div_symbols)} symbols")
    print(f"  🎉 Found {len(newly_with_dividends)} symbols with new dividends")
    
    if newly_with_dividends:
        print("\n🎊 Symbols that now have dividends:")
        for item in newly_with_dividends:
            print(f"  ✅ {item['symbol']} ({item['koName']}): {item['dividends_count']} dividends")
        
        print("\n💡 Action Required:")
        print("  Run 'python scripts/data_pipeline/mark_all_no_dividends.py' to update flags")
    else:
        print("\n✅ All symbols still have no dividends")
    
    print("=" * 60)

if __name__ == "__main__":
    main()
