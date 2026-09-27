#!/usr/bin/env python3
"""
failed_both 종목들을 분류하는 스크립트
- 상장폐지된 종목
- 배당이 없는 종목 (활성 상태)
"""

import os
import json
import yfinance as yf
from pathlib import Path
from tqdm import tqdm
import time

# 경로 설정
ROOT_DIR = Path(__file__).parent.parent.parent
REPORT_FILE = Path(__file__).parent / "korean_suffix_report.json"
OUTPUT_FILE = Path(__file__).parent / "failed_symbols_classified.json"

def load_report():
    """리포트 파일 로드"""
    with open(REPORT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def check_symbol_status(symbol, suffixes):
    """
    심볼의 상태 확인
    Returns: (status, working_suffix, info)
    status: 'delisted', 'no_dividends', 'has_data'
    """
    for suffix in suffixes:
        yf_symbol = symbol + suffix
        
        try:
            ticker = yf.Ticker(yf_symbol)
            
            # 기본 정보 확인
            info = ticker.info
            
            # 가격 데이터 확인 (상장폐지 여부)
            hist = ticker.history(period="5d")
            
            if hist.empty:
                # 가격 데이터가 없으면 다음 접미사 시도
                continue
            
            # 가격 데이터가 있으면 활성 종목
            dividends = ticker.dividends
            
            if dividends.empty:
                return 'no_dividends', suffix, {
                    'longName': info.get('longName', ''),
                    'quoteType': info.get('quoteType', ''),
                    'market': info.get('market', '')
                }
            else:
                return 'has_data', suffix, {
                    'longName': info.get('longName', ''),
                    'quoteType': info.get('quoteType', ''),
                    'market': info.get('market', ''),
                    'dividends_count': len(dividends)
                }
        
        except Exception as e:
            # 에러 발생 시 다음 접미사 시도
            continue
    
    # 모든 접미사에서 실패 = 상장폐지
    return 'delisted', None, {}

def main():
    print("🔍 Classifying Failed Symbols")
    print("=" * 60)
    
    # 리포트 로드
    report = load_report()
    failed_both = report.get("failed_both", [])
    
    print(f"📊 Found {len(failed_both)} symbols to classify\n")
    
    classification = {
        "delisted": [],
        "no_dividends": [],
        "has_data": [],  # 실제로 배당 데이터가 있는 경우
        "timestamp": report.get("timestamp")
    }
    
    for item in tqdm(failed_both, desc="Classifying symbols"):
        symbol = item["symbol"]
        suffixes = item["tried_suffixes"]
        
        status, working_suffix, info = check_symbol_status(symbol, suffixes)
        
        result = {
            "symbol": symbol,
            "tried_suffixes": suffixes
        }
        
        if working_suffix:
            result["working_suffix"] = working_suffix
            result["info"] = info
        
        classification[status].append(result)
        
        # API 호출 제한 방지
        time.sleep(0.1)
    
    # 결과 저장
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(classification, f, indent=4, ensure_ascii=False)
    
    print("\n" + "=" * 60)
    print(f"📈 Classification Summary:")
    print(f"  🪦 Delisted: {len(classification['delisted'])} symbols")
    print(f"  📭 No Dividends (Active): {len(classification['no_dividends'])} symbols")
    print(f"  ✅ Has Data (False Negative): {len(classification['has_data'])} symbols")
    print(f"  📄 Report saved to: {OUTPUT_FILE}")
    
    # 상세 정보 출력
    if classification['has_data']:
        print(f"\n⚠️  Found {len(classification['has_data'])} symbols with data:")
        for item in classification['has_data'][:10]:  # 처음 10개만
            print(f"    - {item['symbol']}{item['working_suffix']}: {item['info'].get('longName', 'N/A')}")
        if len(classification['has_data']) > 10:
            print(f"    ... and {len(classification['has_data']) - 10} more")

if __name__ == "__main__":
    main()
