# scripts/update_market_cap.py
"""
매일 실행되어 현재 시가총액(marketCap)을 각 티커의 backtestData에 추가하는 스크립트
Yahoo Finance를 사용하여 현재 시가총액을 가져옵니다 (무료, 제한 없음).
"""

import json
import yfinance as yf
from datetime import datetime
from pathlib import Path
from tqdm import tqdm
import time

# --- 경로 설정 ---
ROOT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
NAV_FILE = PUBLIC_DIR / "nav.json"

# 공통 유틸리티 import
import sys

sys.path.insert(0, str(ROOT_DIR / "scripts" / "utils"))
from data_file_path import get_data_file_path, find_existing_data_file


def update_ticker_market_cap(symbol, today_str, market_cap, market=None):
    """특정 티커의 최근 날짜 backtestData에 marketCap 추가"""
    # 기존 파일 찾기 (market 서브디렉토리와 루트 모두 확인)
    file_path = find_existing_data_file(symbol, market)
    if not file_path:
        # 파일이 없으면 market 정보로 새 경로 생성
        file_path = get_data_file_path(symbol, market)

    if not file_path.exists():
        return False

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        backtest_data = data.get("backtestData", [])
        if not backtest_data:
            return False

        # 오늘 날짜의 데이터 찾기
        today_entry = None
        for entry in backtest_data:
            if entry.get("date") == today_str:
                today_entry = entry
                break

        # 오늘 날짜가 없으면 가장 최근 항목 찾기 (날짜 역순 정렬)
        if not today_entry:
            # 날짜순으로 정렬된 backtestData에서 가장 최근 항목 찾기
            sorted_data = sorted(
                backtest_data, key=lambda x: x.get("date", ""), reverse=True
            )
            if sorted_data:
                today_entry = sorted_data[0]  # 가장 최근 항목
            else:
                return False

        # 이미 marketCap이 있으면 스킵 (같은 날짜에 중복 추가 방지)
        if "marketCap" in today_entry and today_entry["marketCap"] is not None:
            return False

        # marketCap이 None이면 스킵
        if market_cap is None:
            return False

        # marketCap 추가
        today_entry["marketCap"] = market_cap

        # 파일 저장
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return True

    except Exception as e:
        print(f"❌ Error updating {symbol}: {e}")
        return False


def main():
    # nav.json에서 활성 티커 목록 가져오기
    try:
        with open(NAV_FILE, "r", encoding="utf-8") as f:
            nav_data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Error: nav.json not found at {NAV_FILE}")
        return

    active_tickers = [
        {"symbol": t["symbol"], "market": t.get("market")}
        for t in nav_data.get("nav", [])
        if t.get("symbol") and not t.get("upcoming", False)
    ]

    # 커맨드라인 인자로 특정 티커 지정 가능
    import sys

    target_tickers = []
    if len(sys.argv) > 1:
        target_tickers = [arg.upper() for arg in sys.argv[1:]]
        active_tickers = [t for t in active_tickers if t["symbol"] in target_tickers]
        if not active_tickers:
            print(
                f"❌ 지정한 티커를 nav.json에서 찾을 수 없습니다: {', '.join(target_tickers)}"
            )
            return
        print("=" * 70)
        print(f"📈 [Specific Mode] Market Cap Update: {', '.join(target_tickers)}")
        print("=" * 70)
    else:
        print("=" * 70)
        print("📈 [Full Mode] Daily Market Cap Update (Yahoo Finance)")
        print("=" * 70)

    if not active_tickers:
        print("⚠️  No active tickers found in nav.json")
        return

    today_str = datetime.now().strftime("%Y-%m-%d")
    print(f"📊 Total active tickers: {len(active_tickers)}")
    print(f"📅 Today's date: {today_str} (없으면 최근 날짜에 추가)")
    print(f"⚠️  Rate Limit 방지: 개별 처리 + 대기 시간 적용\n")

    updated_count = 0
    skipped_count = 0
    rate_limit_count = 0

    # 개별 처리 (Rate Limit 방지)
    for idx, ticker_info in enumerate(tqdm(active_tickers, desc="시가총액 개별 수집")):
        symbol = ticker_info["symbol"]
        market = ticker_info.get("market")
        try:
            # 개별 Ticker로 처리
            ticker_obj = yf.Ticker(symbol)

            try:
                info = ticker_obj.info
                market_cap = info.get("marketCap") if info else None
            except Exception as e:
                error_msg = str(e)
                if "Too Many Requests" in error_msg or "Rate limit" in error_msg:
                    rate_limit_count += 1
                    # Rate Limit 발생 시 대기 후 재시도
                    time.sleep(3)
                    try:
                        info = ticker_obj.info
                        market_cap = info.get("marketCap") if info else None
                    except:
                        market_cap = None
                else:
                    market_cap = None

            result = update_ticker_market_cap(symbol, today_str, market_cap, market)
            if result:
                updated_count += 1
            else:
                skipped_count += 1

            # Rate Limit 방지: 100개마다 추가 대기
            if (idx + 1) % 100 == 0:
                time.sleep(2)

        except Exception as e:
            error_msg = str(e)
            if "Too Many Requests" in error_msg or "Rate limit" in error_msg:
                rate_limit_count += 1
            skipped_count += 1

    print("\n" + "=" * 70)
    print(f"✅ Successfully updated: {updated_count} tickers")
    print(f"⏭️  Skipped: {skipped_count} tickers")
    if rate_limit_count > 0:
        print(f"⚠️  Rate Limit 발생: {rate_limit_count}개 (재시도 적용)")
    print("=" * 70)


if __name__ == "__main__":
    main()
