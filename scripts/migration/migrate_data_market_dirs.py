#!/usr/bin/env python3
"""
기존 flat 구조의 public/data/*.json 파일을 시장별 디렉터리 구조로 복사/이동합니다.

기본 동작 (권장):
    python scripts/migrate_data_market_dirs.py
        -> flat → market 레이아웃으로 복사 (원본 유지)

옵션:
    --move           : 복사 대신 이동(원본 삭제)
    --overwrite      : 대상 파일이 있어도 덮어쓰기
    --dry-run        : 파일 시스템을 건드리지 않고 계획만 출력
    --symbol TICKER  : 특정 심볼만 (여러 번 지정 가능)
    --limit N        : 상위 N개만 처리 (테스트용)
    --source-layout  : 기본 flat, 필요 시 커스텀
    --dest-layout    : 기본 market (v2)
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import Iterable

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import (
    DATA_DIR,
    PUBLIC_DIR,
    load_json_file,
    get_data_file_path,
    normalize_market_name,
    detect_market_from_symbol,
)

NAV_PATH = PUBLIC_DIR / "nav.json"


def load_nav_symbols() -> list[dict]:
    payload = load_json_file(NAV_PATH)
    if not payload:
        raise FileNotFoundError(f"nav.json not found at {NAV_PATH}")
    entries = payload.get("nav")
    if not isinstance(entries, list):
        raise ValueError("nav.json format invalid: 'nav' must be a list")
    return entries


def select_targets(entries: list[dict], symbols: Iterable[str] | None) -> list[dict]:
    if not symbols:
        return entries
    symbol_set = {s.upper() for s in symbols}
    return [
        entry for entry in entries if entry.get("symbol", "").upper() in symbol_set
    ]


def determine_market(entry: dict) -> str | None:
    market = normalize_market_name(entry.get("market"))
    if market:
        return market
    return detect_market_from_symbol(entry.get("symbol"))


def migrate_symbol(
    symbol: str,
    market: str | None,
    *,
    source_layout: str,
    dest_layout: str,
    dry_run: bool,
    move: bool,
    overwrite: bool,
) -> tuple[bool, str]:
    src_path = get_data_file_path(symbol, market, layout=source_layout)
    dest_path = get_data_file_path(symbol, market, layout=dest_layout)

    if not src_path.exists():
        return False, f"[MISS] {symbol}: source not found ({src_path})"

    if dest_path.exists() and not overwrite and src_path.resolve() != dest_path.resolve():
        return False, f"[SKIP] {symbol}: destination exists ({dest_path})"

    if dry_run:
        action = "MOVE" if move else "COPY"
        return True, f"[PLAN] {action} {src_path} -> {dest_path}"

    dest_path.parent.mkdir(parents=True, exist_ok=True)

    if move:
        shutil.move(str(src_path), dest_path)
        return True, f"[MOVE] {symbol}: {src_path} -> {dest_path}"

    shutil.copy2(src_path, dest_path)
    return True, f"[COPY] {symbol}: {src_path} -> {dest_path}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="public/data 폴더를 시장별 구조로 재배치합니다.")
    parser.add_argument("--symbol", action="append", dest="symbols", help="특정 심볼만 처리 (여러 번 지정 가능)")
    parser.add_argument("--limit", type=int, default=None, help="상위 N개만 처리")
    parser.add_argument("--dry-run", action="store_true", help="실제 파일 복사 없이 계획만 출력")
    parser.add_argument("--move", action="store_true", help="복사 대신 이동(원본 삭제)")
    parser.add_argument("--overwrite", action="store_true", help="대상 파일이 이미 있어도 덮어쓰기")
    parser.add_argument("--source-layout", default="flat", help="소스 레이아웃 (기본: flat)")
    parser.add_argument("--dest-layout", default="market", help="대상 레이아웃 (기본: market)")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        entries = load_nav_symbols()
    except Exception as exc:
        print(f"[ERROR] {exc}")
        return 1

    targets = select_targets(entries, args.symbols)
    if args.limit is not None:
        targets = targets[: args.limit]

    if not targets:
        print("No symbols to process.")
        return 0

    succeeded = 0
    skipped = 0
    for entry in targets:
        symbol = entry.get("symbol")
        if not symbol:
            continue
        market = determine_market(entry)
        ok, message = migrate_symbol(
            symbol,
            market,
            source_layout=args.source_layout,
            dest_layout=args.dest_layout,
            dry_run=args.dry_run,
            move=args.move,
            overwrite=args.overwrite,
        )
        print(message)
        if ok:
            succeeded += 1
        else:
            skipped += 1

    print(
        f"\n완료: {succeeded}건 성공, {skipped}건 건너뜀/실패 "
        f"(source={args.source_layout}, dest={args.dest_layout}, move={args.move})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


