#!/usr/bin/env python
"""시스템 전체에서 특정 티커들을 완전히 제거하는 스크립트

nav.json, nav/{{market}}/4.json, sidebar, calendar-events 등 모든 관련 파일에서 티커를 제거합니다.
"""

import json
from pathlib import Path
from typing import Set

# 제거할 티커 목록 (여기에 symbol을 추가하세요)
TICKERS_TO_REMOVE: list[str] = []


def normalize_symbol(symbol: str) -> str:
    """심볼에서 접미사를 제거하여 기본 심볼만 반환합니다."""
    if "." in symbol:
        return symbol.split(".")[0]
    return symbol


def should_remove_symbol(symbol: str, tickers_to_remove: Set[str]) -> bool:
    """심볼이 제거 대상인지 확인합니다."""
    base_symbol = normalize_symbol(symbol)
    return base_symbol in tickers_to_remove


def remove_tickers_from_nav_file(file_path: Path, tickers_to_remove: Set[str]) -> int:
    """nav.json 또는 nav/{{market}}/4.json 파일에서 티커들을 제거합니다."""
    if not file_path.exists():
        return 0

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, list):
            return 0

        original_len = len(data)
        data = [
            item
            for item in data
            if not should_remove_symbol(item.get("symbol", ""), tickers_to_remove)
        ]
        removed_count = original_len - len(data)

        if removed_count > 0:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            return removed_count

        return 0

    except Exception as e:
        print(f"[ERROR] {file_path} 처리 중 오류: {e}")
        return 0


def remove_tickers_from_sidebar_file(
    file_path: Path, tickers_to_remove: Set[str]
) -> int:
    """sidebar 파일에서 티커들을 제거합니다."""
    if not file_path.exists():
        return 0

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, list):
            return 0

        original_len = len(data)
        data = [
            item
            for item in data
            if not should_remove_symbol(item.get("symbol", ""), tickers_to_remove)
        ]
        removed_count = original_len - len(data)

        if removed_count > 0:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return removed_count

        return 0

    except Exception as e:
        print(f"[ERROR] {file_path} 처리 중 오류: {e}")
        return 0


def remove_tickers_from_calendar_file(
    file_path: Path, tickers_to_remove: Set[str]
) -> int:
    """calendar-events 파일에서 티커들을 제거합니다."""
    if not file_path.exists():
        return 0

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict):
            return 0

        removed_count = 0

        # calendar-events.json 구조: 날짜 -> 통화 -> 티커 배열
        # 또는 calendar/calendar-events-*.json 구조: 날짜 -> 티커 배열
        for date_key, date_value in list(data.items()):
            if isinstance(date_value, dict):
                # calendar-events.json 구조 (날짜 -> 통화 -> 티커 배열)
                for currency_key, tickers_list in date_value.items():
                    if isinstance(tickers_list, list):
                        original_len = len(tickers_list)
                        tickers_list[:] = [
                            t
                            for t in tickers_list
                            if not should_remove_symbol(
                                t.get("ticker", ""), tickers_to_remove
                            )
                        ]
                        removed_count += original_len - len(tickers_list)

                        # 빈 배열이면 제거
                        if len(tickers_list) == 0:
                            del date_value[currency_key]

                # 빈 객체가 되면 날짜 키 제거
                if len(date_value) == 0:
                    del data[date_key]

            elif isinstance(date_value, list):
                # calendar/calendar-events-*.json 구조 (날짜 -> 티커 배열)
                original_len = len(date_value)
                date_value[:] = [
                    t
                    for t in date_value
                    if not should_remove_symbol(t.get("ticker", ""), tickers_to_remove)
                ]
                removed_count += original_len - len(date_value)

                # 빈 배열이면 날짜 키 제거
                if len(date_value) == 0:
                    del data[date_key]

        if removed_count > 0:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return removed_count

        return 0

    except Exception as e:
        print(f"[ERROR] {file_path} 처리 중 오류: {e}")
        return 0


def main():
    """메인 함수"""
    # 제거할 티커 목록을 Set으로 변환 (빈 문자열 제거)
    tickers_to_remove = {t.strip() for t in TICKERS_TO_REMOVE if t.strip()}

    if not tickers_to_remove:
        print("[WARN] TICKERS_TO_REMOVE가 비어있습니다. 제거할 티커를 추가하세요.")
        return

    print(f"제거할 티커: {', '.join(sorted(tickers_to_remove))}\n")

    total_removed_files = 0
    total_removed_tickers = 0

    # nav.json 파일 처리
    nav_json = Path("public/nav.json")
    if nav_json.exists():
        removed = remove_tickers_from_nav_file(nav_json, tickers_to_remove)
        if removed > 0:
            print(f"[OK] {nav_json}: {removed}개 티커 제거됨")
            total_removed_files += 1
            total_removed_tickers += removed

    # nav/{{market}}/4.json 파일들 처리
    nav_dir = Path("public/nav")
    if nav_dir.exists():
        for market_dir in nav_dir.iterdir():
            if market_dir.is_dir():
                nav_file = market_dir / "4.json"
                if nav_file.exists():
                    removed = remove_tickers_from_nav_file(nav_file, tickers_to_remove)
                    if removed > 0:
                        print(f"[OK] {nav_file}: {removed}개 티커 제거됨")
                        total_removed_files += 1
                        total_removed_tickers += removed

    # sidebar 파일들 처리
    sidebar_files = [
        Path("public/sidebar-tickers.json"),
        Path("public/sidebar/sidebar-tickers-kr-stocks.json"),
        Path("public/sidebar/sidebar-tickers-kr-etfs.json"),
        Path("public/sidebar/sidebar-tickers-us-stocks.json"),
        Path("public/sidebar/sidebar-tickers-us-etfs.json"),
    ]

    for sidebar_file in sidebar_files:
        removed = remove_tickers_from_sidebar_file(sidebar_file, tickers_to_remove)
        if removed > 0:
            print(f"[OK] {sidebar_file}: {removed}개 티커 제거됨")
            total_removed_files += 1
            total_removed_tickers += removed

    # calendar 파일들 처리
    calendar_files = [
        Path("public/calendar-events.json"),
        Path("public/calendar/calendar-events-kr-stocks.json"),
        Path("public/calendar/calendar-events-kr-etfs.json"),
        Path("public/calendar/calendar-events-us-stocks.json"),
        Path("public/calendar/calendar-events-us-etfs.json"),
    ]

    for calendar_file in calendar_files:
        removed = remove_tickers_from_calendar_file(calendar_file, tickers_to_remove)
        if removed > 0:
            print(f"[OK] {calendar_file}: {removed}개 티커 제거됨")
            total_removed_files += 1
            total_removed_tickers += removed

    print(
        f"\n총 {total_removed_files}개 파일에서 {total_removed_tickers}개 티커가 제거되었습니다."
    )


if __name__ == "__main__":
    main()
