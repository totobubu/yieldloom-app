#!/usr/bin/env python3
"""
잘못 표시된 noDividends 필드를 제거하는 스크립트
실제 배당 데이터가 있는 경우 noDividends 필드를 삭제
"""

import os
import json
from pathlib import Path

# 경로 설정
ROOT_DIR = Path(__file__).parent.parent.parent
NAV_DIR = ROOT_DIR / "public" / "nav"
DATA_DIR = ROOT_DIR / "public" / "data"

def has_dividend_data(symbol, market):
    """
    실제 배당 데이터 파일을 확인하여 배당이 있는지 체크
    Returns: True if dividends exist, False otherwise
    """
    # 시장명을 소문자로 변환 (파일명은 소문자)
    market_lower = market.lower()
    symbol_lower = symbol.lower()

    data_file = DATA_DIR / market_lower / f"{symbol_lower}.json"

    if not data_file.exists():
        return False

    try:
        with open(data_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        # backtestData 배열에서 amount가 0보다 큰 배당 데이터가 있는지 확인
        if "backtestData" in data and isinstance(data["backtestData"], list):
            for item in data["backtestData"]:
                if item.get("amount", 0) > 0:
                    return True

        return False
    except Exception as e:
        print(f"    Error reading {data_file}: {e}")
        return False

def scan_and_fix_nav_files(market_dirs):
    """
    모든 nav 파일을 스캔하여 잘못된 noDividends 필드 제거
    """
    total_checked = 0
    total_fixed = 0
    fixed_symbols = []

    for market_dir in market_dirs:
        market_path = NAV_DIR / market_dir

        if not market_path.exists():
            continue

        print(f"\nScanning {market_dir}...")

        # 모든 JSON 파일 스캔
        for nav_file in market_path.glob("*.json"):
            try:
                with open(nav_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                modified = False

                for item in data:
                    # noDividends가 True로 표시된 경우만 확인
                    if item.get("noDividends") == True:
                        symbol = item.get("symbol")
                        total_checked += 1

                        # 실제 배당 데이터가 있는지 확인
                        if has_dividend_data(symbol, market_dir):
                            print(f"  {symbol}: Found dividends - removing noDividends flag")
                            del item["noDividends"]
                            modified = True
                            total_fixed += 1
                            fixed_symbols.append(f"{symbol} ({market_dir})")

                # 변경사항이 있으면 파일 저장
                if modified:
                    with open(nav_file, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=4, ensure_ascii=False)

            except Exception as e:
                print(f"  Error processing {nav_file}: {e}")

    return total_checked, total_fixed, fixed_symbols

def main():
    print("Removing Wrong noDividends Flags")
    print("=" * 60)

    market_dirs = ["KOSDAQ", "KOSPI", "NASDAQ", "NYSE", "bats"]

    total_checked, total_fixed, fixed_symbols = scan_and_fix_nav_files(market_dirs)

    print("\n" + "=" * 60)
    print(f"Summary:")
    print(f"  Total checked: {total_checked} symbols with noDividends flag")
    print(f"  Fixed: {total_fixed} symbols")
    print(f"  Remaining: {total_checked - total_fixed} symbols")

    if fixed_symbols:
        print(f"\nFixed symbols (had dividend data):")
        for symbol in fixed_symbols:
            print(f"    - {symbol}")

if __name__ == "__main__":
    main()
