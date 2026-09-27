#!/usr/bin/env python3
"""
yfSymbol이 실제로 Yahoo Finance에서 조회 가능한지 검증하는 스크립트

사용법:
    python scripts/validate_yf_symbols.py --dry-run  # 미리보기
    python scripts/validate_yf_symbols.py            # 실제 검증 및 수정
    python scripts/validate_yf_symbols.py --symbol 460270  # 특정 티커만
"""

import argparse
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import requests

ROOT_DIR = Path(__file__).parent.parent
NAV_DIR = ROOT_DIR / "public" / "nav"
NAV_FILE_PATH = ROOT_DIR / "public" / "nav.json"

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

MARKET_TO_SUFFIX = {
    "KOSPI": ".KS",
    "KOSDAQ": ".KQ",
    "KONEX": ".KN",
}


def probe_yf_symbol(symbol: str) -> Tuple[bool, Optional[str]]:
    """Yahoo Finance API로 심볼 조회 가능 여부 확인"""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d"
    try:
        response = requests.get(url, headers=YF_HEADERS, timeout=10)
        if response.status_code == 404:
            return False, "404 Not Found"
        
        data = response.json()
        if data.get("chart", {}).get("error"):
            error_desc = data["chart"]["error"].get("description", "Unknown error")
            return False, error_desc
        
        result = data.get("chart", {}).get("result", [])
        if not result or not result[0].get("timestamp"):
            return False, "Empty data"
        
        return True, None
    except Exception as e:
        return False, str(e)


def find_valid_yf_symbol(base_symbol: str, market: str) -> Optional[str]:
    """base symbol과 market을 기반으로 유효한 yfSymbol 찾기"""
    # market에 따른 기본 접미사
    default_suffix = MARKET_TO_SUFFIX.get(market)
    
    # 후보 심볼들
    candidates = []
    if default_suffix:
        candidates.append(f"{base_symbol}{default_suffix}")
    
    # 다른 접미사도 시도
    for suffix in [".KS", ".KQ", ".KN"]:
        candidate = f"{base_symbol}{suffix}"
        if candidate not in candidates:
            candidates.append(candidate)
    
    # 각 후보를 검증
    for candidate in candidates:
        is_valid, error = probe_yf_symbol(candidate)
        if is_valid:
            return candidate
        time.sleep(0.1)  # API 레이트 리밋 방지
    
    return None


def process_nav_file(file_path: Path, dry_run: bool = False) -> Dict[str, int]:
    """nav 파일의 티커들을 검증하고 수정"""
    stats = {"processed": 0, "fixed": 0, "failed": 0, "skipped": 0}
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            tickers = json.load(f)
    except Exception as e:
        print(f"⚠️ 파일 읽기 실패: {file_path} - {e}")
        return stats
    
    if not isinstance(tickers, list):
        return stats
    
    file_updated = False
    
    for ticker in tickers:
        if not isinstance(ticker, dict):
            continue
        
        symbol = ticker.get("symbol")
        market = ticker.get("market")
        current_yf_symbol = ticker.get("yfSymbol")
        
        if not symbol or not market:
            continue
        
        stats["processed"] += 1
        
        # 한국 시장만 처리
        if market not in ("KOSPI", "KOSDAQ", "KONEX"):
            continue
        
        # yfSymbol이 없으면 생성
        if not current_yf_symbol:
            valid_yf_symbol = find_valid_yf_symbol(symbol, market)
            if valid_yf_symbol:
                ticker["yfSymbol"] = valid_yf_symbol
                file_updated = True
                stats["fixed"] += 1
                print(f"  ✅ {symbol}: yfSymbol 추가 → {valid_yf_symbol}")
            else:
                stats["failed"] += 1
                print(f"  ❌ {symbol}: 유효한 yfSymbol을 찾을 수 없음")
            continue
        
        # yfSymbol 검증
        is_valid, error = probe_yf_symbol(current_yf_symbol)
        if is_valid:
            stats["skipped"] += 1
            continue
        
        # 잘못된 yfSymbol 수정
        print(f"  ⚠️ {symbol}: {current_yf_symbol} 검증 실패 ({error})")
        valid_yf_symbol = find_valid_yf_symbol(symbol, market)
        
        if valid_yf_symbol:
            ticker["yfSymbol"] = valid_yf_symbol
            file_updated = True
            stats["fixed"] += 1
            print(f"     → {valid_yf_symbol}로 수정")
        else:
            stats["failed"] += 1
            print(f"     ❌ 유효한 대체 심볼을 찾을 수 없음")
        
        time.sleep(0.2)  # API 레이트 리밋 방지
    
    if file_updated and not dry_run:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(tickers, f, indent=4, ensure_ascii=False)
        print(f"  💾 {file_path.name} 저장 완료")
    
    return stats


def process_specific_symbol(symbol: str, dry_run: bool = False) -> None:
    """특정 심볼만 검증"""
    # nav.json에서 찾기
    try:
        with open(NAV_FILE_PATH, "r", encoding="utf-8") as f:
            nav_data = json.load(f)
    except Exception as e:
        print(f"❌ nav.json 읽기 실패: {e}")
        return
    
    ticker = None
    for t in nav_data.get("nav", []):
        if t.get("symbol") == symbol.upper():
            ticker = t
            break
    
    if not ticker:
        print(f"❌ {symbol} 티커를 nav.json에서 찾을 수 없습니다.")
        return
    
    market = ticker.get("market")
    current_yf_symbol = ticker.get("yfSymbol")
    
    print(f"\n티커: {symbol}")
    print(f"Market: {market}")
    print(f"현재 yfSymbol: {current_yf_symbol}")
    
    if current_yf_symbol:
        is_valid, error = probe_yf_symbol(current_yf_symbol)
        print(f"검증 결과: {'✅ 유효' if is_valid else f'❌ 실패 ({error})'}")
    
    valid_yf_symbol = find_valid_yf_symbol(symbol, market or "KOSDAQ")
    if valid_yf_symbol:
        print(f"권장 yfSymbol: {valid_yf_symbol}")
        if not dry_run and valid_yf_symbol != current_yf_symbol:
            print(f"💡 수정하려면 nav 파일을 직접 수정하거나 전체 검증을 실행하세요.")


def main():
    parser = argparse.ArgumentParser(
        description="yfSymbol이 실제로 Yahoo Finance에서 조회 가능한지 검증"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="실제로 수정하지 않고 미리보기만 수행",
    )
    parser.add_argument(
        "--symbol",
        help="특정 심볼만 검증 (예: 460270)",
    )
    parser.add_argument(
        "--market",
        choices=["KOSPI", "KOSDAQ", "KONEX"],
        help="특정 시장만 처리",
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("yfSymbol 검증 스크립트")
    print("=" * 60)
    
    if args.dry_run:
        print("🔍 DRY-RUN 모드: 실제로 수정하지 않습니다.\n")
    
    if args.symbol:
        process_specific_symbol(args.symbol, dry_run=args.dry_run)
        return
    
    # 전체 nav 파일 처리
    markets_to_process = [args.market] if args.market else ["KOSPI", "KOSDAQ", "KONEX"]
    
    total_stats = {"processed": 0, "fixed": 0, "failed": 0, "skipped": 0}
    
    for market in markets_to_process:
        market_dir = NAV_DIR / market
        if not market_dir.exists():
            continue
        
        print(f"\n📁 {market} 시장 처리 중...")
        json_files = list(market_dir.glob("*.json"))
        
        for file_path in sorted(json_files):
            print(f"\n  파일: {file_path.name}")
            stats = process_nav_file(file_path, dry_run=args.dry_run)
            for key in total_stats:
                total_stats[key] += stats[key]
    
    print("\n" + "=" * 60)
    print("📊 처리 결과 요약")
    print("=" * 60)
    print(f"  처리된 티커: {total_stats['processed']}개")
    print(f"  수정된 티커: {total_stats['fixed']}개")
    print(f"  실패한 티커: {total_stats['failed']}개")
    print(f"  건너뛴 티커: {total_stats['skipped']}개")
    
    if args.dry_run and total_stats["fixed"] > 0:
        print("\n💡 실제로 수정하려면 --dry-run 옵션을 제거하고 다시 실행하세요.")
    elif not args.dry_run and total_stats["fixed"] > 0:
        print("\n✅ 수정 완료! 이제 'npm run generate-nav'를 실행하여 nav.json을 업데이트하세요.")


if __name__ == "__main__":
    main()

