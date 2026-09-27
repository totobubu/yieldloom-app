#!/usr/bin/env python3
"""
public/nav 디렉토리를 market/심볼 단위 JSON 파일 구조로 변환합니다.

기존 구조: public/nav/<MARKET>/<첫글자>.json (배열)
신규 구조: public/nav/<MARKET>/<symbol>.json (단일 티커 배열)

Usage:
    python scripts/migrate_nav_to_symbol_files.py
    python scripts/migrate_nav_to_symbol_files.py --dry-run
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List


ROOT_DIR = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT_DIR / "public"
NAV_JSON_PATH = PUBLIC_DIR / "nav.json"
NAV_DIR = PUBLIC_DIR / "nav"
EXCLUDED_FILES = {"logos-rules.json", "logos-brand.json"}


def sanitize_symbol(symbol: str) -> str:
    """
    심볼을 파일명으로 안전하게 변환합니다.
    (대문자 → 소문자, . / \\ : 등을 - 로 치환)
    """
    if not symbol:
        return "unknown"
    safe = (
        symbol.strip()
        .lower()
        .replace(".", "-")
        .replace("/", "-")
        .replace("\\", "-")
        .replace(":", "-")
        .replace("*", "-")
        .replace("?", "-")
        .replace('"', "")
        .replace("'", "")
    )
    return safe or "unknown"


def load_nav_entries() -> List[dict]:
    if not NAV_JSON_PATH.exists():
        raise FileNotFoundError(f"{NAV_JSON_PATH} not found")
    with NAV_JSON_PATH.open(encoding="utf-8") as fp:
        payload = json.load(fp)
    entries = payload.get("nav")
    if not isinstance(entries, list):
        raise ValueError("nav.json 구조가 잘못되었습니다. 'nav' 배열이 필요합니다.")
    return entries


def group_by_market(entries: List[dict]) -> Dict[str, List[dict]]:
    grouped: Dict[str, List[dict]] = {}
    for ticker in entries:
        if not isinstance(ticker, dict):
            continue
        market = ticker.get("market") or "UNKNOWN"
        grouped.setdefault(market, []).append(ticker)
    return grouped


def cleanup_market_dir(market_dir: Path) -> None:
    if not market_dir.exists():
        return
    for json_file in market_dir.glob("*.json"):
        if json_file.name in EXCLUDED_FILES:
            continue
        json_file.unlink(missing_ok=True)


def write_symbol_file(market_dir: Path, symbol: str, ticker: dict, dry_run: bool) -> None:
    filename = f"{sanitize_symbol(symbol)}.json"
    target_path = market_dir / filename
    if dry_run:
        print(f"[PLAN] write {target_path.relative_to(NAV_DIR)}")
        return
    market_dir.mkdir(parents=True, exist_ok=True)
    with target_path.open("w", encoding="utf-8") as fp:
        json.dump([ticker], fp, indent=2, ensure_ascii=False)


def migrate_nav_structure(dry_run: bool = False) -> None:
    entries = load_nav_entries()
    grouped = group_by_market(entries)
    markets = sorted(grouped.keys())

    print(f"[INFO] 총 {len(entries)}개 티커, {len(markets)}개 시장을 변환합니다.")

    for market in markets:
        market_dir = NAV_DIR / market
        tickers = grouped[market]
        print(f"\n[MARKET] {market}: {len(tickers)}개 티커")
        if not dry_run:
            cleanup_market_dir(market_dir)
        for ticker in tickers:
            symbol = ticker.get("symbol")
            if not symbol:
                print(f"  ⚠️ 시장 {market}에 심볼이 없는 항목이 있습니다. 건너뜀.")
                continue
            write_symbol_file(market_dir, symbol, ticker, dry_run=dry_run)

    print("\n✅ nav 디렉토리 마이그레이션 준비 완료.")
    if dry_run:
        print("    (dry-run 모드이므로 실제 파일은 변경되지 않았습니다.)")
    else:
        print("    실제 파일이 market/심볼 단위 구조로 업데이트되었습니다.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="public/nav 구조를 market/심볼 단위 JSON 파일로 변환합니다."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="실제 파일 쓰기 없이 계획만 출력합니다.",
    )
    return parser


def main(argv: List[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        migrate_nav_structure(dry_run=args.dry_run)
        return 0
    except Exception as exc:  # pragma: no cover - CLI utility
        print(f"[ERROR] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())


