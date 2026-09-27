#!/usr/bin/env python3
# scripts/detect_shares_outstanding.py
"""
nav 파일들에 sharesOutstanding 필드를 추가하는 스크립트

각 티커가 Yahoo Finance에서 sharesOutstanding 데이터를 제공하는지 확인하고
nav/*/*.json 파일에 sharesOutstanding: true/false 필드를 추가합니다.

사용법:
  python scripts/detect_shares_outstanding.py           # 전체
  python scripts/detect_shares_outstanding.py WEED MAGS # 특정 티커만
"""

import os
import json
import yfinance as yf
from pathlib import Path
from tqdm import tqdm
import time
import sys

# 경로 설정
ROOT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT_DIR / "public"
NAV_DIR = PUBLIC_DIR / "nav"


def check_shares_outstanding_batch(symbols):
    """배치로 sharesOutstanding 확인"""
    try:
        tickers = yf.Tickers(" ".join(symbols))
        shares_data = {}
        
        for symbol in symbols:
            try:
                ticker_obj = tickers.tickers.get(symbol)
                if ticker_obj and ticker_obj.info:
                    shares = ticker_obj.info.get("sharesOutstanding")
                    shares_data[symbol] = shares is not None and shares > 0
                else:
                    shares_data[symbol] = False
            except Exception:
                shares_data[symbol] = False
        
        return shares_data
    
    except Exception as e:
        print(f"[ERROR] Batch fetch error: {e}")
        return {symbol: False for symbol in symbols}


def main():
    # Windows UTF-8 출력 설정
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    print("=" * 80)
    print("[Detect] Shares Outstanding Detection")
    print("=" * 80)
    
    # 커맨드라인 인자로 특정 티커 지정 가능
    target_tickers = []
    if len(sys.argv) > 1:
        target_tickers = [arg.upper() for arg in sys.argv[1:]]
        print(f"[INFO] [Specific Mode] Checking {len(target_tickers)} ticker(s): {', '.join(target_tickers)}")
    else:
        print("[INFO] [Full Mode] Checking all tickers")
    
    # nav 파일들 읽기
    nav_sources = {}
    all_tickers = []
    
    market_dirs = [d for d in os.listdir(NAV_DIR) if os.path.isdir(NAV_DIR / d)]
    
    for market in market_dirs:
        market_path = NAV_DIR / market
        nav_files = [f for f in os.listdir(market_path) if f.endswith(".json")]
        
        for filename in nav_files:
            file_path = market_path / filename
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    tickers = json.load(f)
                    nav_sources[str(file_path)] = tickers
                    all_tickers.extend(tickers)
            except (IOError, json.JSONDecodeError) as e:
                print(f"[WARNING] Could not read {file_path}: {e}")
    
    # 특정 티커만 필터링
    if target_tickers:
        all_tickers = [t for t in all_tickers if t.get("symbol") in target_tickers]
        if not all_tickers:
            print(f"[ERROR] 지정한 티커를 nav 파일에서 찾을 수 없습니다: {', '.join(target_tickers)}")
            return
    
    print(f"[INFO] Total tickers to check: {len(all_tickers)}\n")
    
    # 심볼 목록 추출
    symbols = [t["symbol"] for t in all_tickers if t.get("symbol")]
    
    # 배치로 sharesOutstanding 확인
    BATCH_SIZE = 100
    shares_status = {}
    
    for i in tqdm(range(0, len(symbols), BATCH_SIZE), desc="Checking batches", unit="batch"):
        batch = symbols[i:i + BATCH_SIZE]
        batch_status = check_shares_outstanding_batch(batch)
        shares_status.update(batch_status)
        
        # Rate Limit 방지
        if i + BATCH_SIZE < len(symbols):
            time.sleep(1)
    
    # nav 파일들에 필드 추가
    updated_files = 0
    updated_tickers = 0
    
    for file_path, tickers in nav_sources.items():
        has_changed = False
        
        for ticker in tickers:
            symbol = ticker.get("symbol")
            if not symbol:
                continue
            
            # 특정 티커만 처리하는 경우 필터링
            if target_tickers and symbol not in target_tickers:
                continue
            
            if symbol in shares_status:
                old_value = ticker.get("sharesOutstanding")
                new_value = shares_status[symbol]
                
                # 값이 변경되었거나 없었으면 업데이트 (null은 덮어쓰기)
                if old_value is None or old_value != new_value:
                    ticker["sharesOutstanding"] = new_value
                    has_changed = True
                    updated_tickers += 1
        
        # 변경된 파일만 저장
        if has_changed:
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(tickers, f, indent=4, ensure_ascii=False)
                updated_files += 1
            except IOError as e:
                print(f"[ERROR] Could not write to {file_path}: {e}")
    
    # 통계
    has_shares = sum(1 for v in shares_status.values() if v)
    no_shares = sum(1 for v in shares_status.values() if not v)
    
    print("\n" + "=" * 80)
    print("[COMPLETE] Detection Complete!")
    print("=" * 80)
    print(f"[INFO] Has sharesOutstanding: {has_shares} tickers")
    print(f"[INFO] No sharesOutstanding: {no_shares} tickers")
    print(f"[INFO] Updated {updated_tickers} tickers in {updated_files} files")
    print("=" * 80)
    
    # 상세 정보
    if no_shares > 0 and no_shares <= 50:
        print("\n[INFO] Tickers without sharesOutstanding:")
        for symbol, has in shares_status.items():
            if not has:
                print(f"  - {symbol}")


if __name__ == "__main__":
    main()

