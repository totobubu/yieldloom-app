#!/usr/bin/env python3
"""
배당 데이터가 없는 종목들에 noDividends 플래그를 추가하는 스크립트
- 1년 이상 된 종목만 대상
"""

import os
import json
from pathlib import Path
from datetime import datetime, timedelta

# 경로 설정
ROOT_DIR = Path(__file__).parent.parent.parent
NAV_DIR = ROOT_DIR / "public" / "nav"
DATA_DIR = ROOT_DIR / "public" / "data"

def get_all_nav_symbols():
    """모든 nav 파일에서 심볼 정보 수집"""
    symbols = []
    
    # 모든 시장 디렉토리 스캔
    for market_dir in ["KOSDAQ", "KOSPI", "NASDAQ", "NYSE", "bats"]:
        market_path = NAV_DIR / market_dir
        if not market_path.exists():
            continue
        
        for json_file in market_path.glob("*.json"):
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    symbols.append({
                        "symbol": item["symbol"],
                        "market": item.get("market"),
                        "ipoDate": item.get("ipoDate"),
                        "noDividends": item.get("noDividends", False),
                        "file_path": json_file
                    })
    
    return symbols


def is_older_than_one_year(ipo_date_str):
    """IPO 날짜가 1년 이상 지났는지 확인"""
    if not ipo_date_str:
        return True  # IPO 날짜가 없으면 오래된 것으로 간주
    
    try:
        ipo_date = datetime.strptime(ipo_date_str, "%Y-%m-%d")
        one_year_ago = datetime.now() - timedelta(days=365)
        return ipo_date < one_year_ago
    except:
        return True

def has_dividend_data(symbol, market):
    """해당 심볼의 배당 데이터가 있는지 확인"""
    # market 서브디렉토리에서 찾기
    if market:
        market_lower = market.lower()
        data_file = DATA_DIR / market_lower / f"{symbol}.json"
        if data_file.exists():
            with open(data_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                dividends = data.get("dividends", [])
                return len(dividends) > 0
    
    # 루트에서 찾기
    data_file = DATA_DIR / f"{symbol}.json"
    if data_file.exists():
        with open(data_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            dividends = data.get("dividends", [])
            return len(dividends) > 0
    
    return False

def update_nav_file(file_path, symbol, add_flag):
    """nav 파일의 특정 심볼에 noDividends 플래그 추가/제거"""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    updated = False
    for item in data:
        if item["symbol"] == symbol:
            current_flag = item.get("noDividends", False)
            if add_flag and not current_flag:
                item["noDividends"] = True
                updated = True
            elif not add_flag and current_flag:
                del item["noDividends"]
                updated = True
            break
    
    if updated:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    
    return updated

def main():
    print("🔍 Checking All Symbols for No-Dividend Status")
    print("=" * 60)
    
    # 모든 심볼 수집
    all_symbols = get_all_nav_symbols()
    print(f"📊 Found {len(all_symbols)} total symbols\n")
    
    # 1년 이상 된 종목만 필터링
    old_symbols = [s for s in all_symbols if is_older_than_one_year(s["ipoDate"])]
    print(f"📅 {len(old_symbols)} symbols are older than 1 year\n")
    
    added_count = 0
    removed_count = 0
    already_marked_count = 0
    skipped_new_count = len(all_symbols) - len(old_symbols)
    
    for symbol_info in old_symbols:
        symbol = symbol_info["symbol"]
        market = symbol_info["market"]
        file_path = symbol_info["file_path"]
        already_marked = symbol_info["noDividends"]
        
        has_dividends = has_dividend_data(symbol, market)
        
        if has_dividends:
            # 배당 데이터가 있으면 플래그 제거
            if already_marked:
                if update_nav_file(file_path, symbol, False):
                    print(f"  ✅ {symbol}: Removed noDividends flag (has dividends now)")
                    removed_count += 1
        else:
            # 배당 데이터가 없으면 플래그 추가
            if already_marked:
                already_marked_count += 1
            else:
                if update_nav_file(file_path, symbol, True):
                    print(f"  🏷️  {symbol}: Added noDividends flag")
                    added_count += 1
    
    print("\n" + "=" * 60)
    print(f"📈 Summary:")
    print(f"  🏷️  Added noDividends: {added_count} symbols")
    print(f"  ✅ Removed noDividends: {removed_count} symbols")
    print(f"  ⏭️  Already marked: {already_marked_count} symbols")
    print(f"  🆕 Skipped (< 1 year old): {skipped_new_count} symbols")
    print(f"  📝 Total processed: {len(all_symbols)} symbols")

if __name__ == "__main__":
    main()
