#!/usr/bin/env python3
"""
public/data/* 에 저장된 실제 심볼 파일을 기준으로 public/nav 심볼을 교정합니다.

- 한국 티커가 .KQ → .KS로 이동했을 경우 nav.json 및 nav/<MARKET>/<symbol>.json을
  새로운 심볼로 통일합니다.
- 기본적으로 모든 시장을 대상하지만 --market 옵션으로 제한할 수 있습니다.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

import sys

try:
    from scripts.cloud.r2_helper import list_r2_files
except ImportError:
    def list_r2_files(prefix=""): return []

ROOT_DIR = Path(__file__).resolve().parents[2]  # scripts/utils/ -> scripts/ -> 프로젝트 루트
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
NAV_JSON_PATH = PUBLIC_DIR / "nav.json"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

MARKET_SUBDIR_ALIASES = {
    "KOSPI": "kospi",
    "KOSDAQ": "kosdaq",
    "KONEX": "konex",
    "KRX": "krx",
    "NYSE": "nyse",
    "NASDAQ": "nasdaq",
    "AMEX": "amex",
}

SUFFIX_TO_MARKET = {
    ".KS": "KOSPI",
    ".KQ": "KOSDAQ",
    ".KN": "KONEX",
}

DEFAULT_SUFFIX_FALLBACKS = [".KS", ".KQ"]


def sanitize_symbol(symbol: str) -> str:
    return (
        symbol.replace(".", "-")
        .replace("/", "-")
        .replace("\\", "-")
        .replace(":", "-")
        .lower()
    )


def get_market_name(entry_market: Optional[str], symbol: str) -> Optional[str]:
    if entry_market:
        return entry_market.upper()
    upper = symbol.upper()
    for suffix, market in SUFFIX_TO_MARKET.items():
        if upper.endswith(suffix):
            return market
    return None


def get_market_dir(market: Optional[str]) -> Path:
    normalized = (market or "misc").strip().upper()
    subdir = MARKET_SUBDIR_ALIASES.get(normalized, normalized.lower())
    return DATA_DIR / subdir


def get_candidate_suffixes(symbol: str, fallbacks: Iterable[str]) -> List[str]:
    suffixes: List[str] = []
    for fallback in fallbacks:
        if not fallback:
            continue
        trimmed = str(fallback).strip().upper()
        if not trimmed:
            continue
        if trimmed.startswith("."):
            suffixes.append(trimmed)
        elif "." in trimmed:
            suffixes.append(trimmed)
        else:
            suffixes.append(f".{trimmed}")
    upper = symbol.upper()
    if upper.endswith(".KQ") and ".KS" not in suffixes:
        suffixes.insert(0, ".KS")
    if upper.endswith(".KS") and ".KQ" not in suffixes:
        suffixes.append(".KQ")
    return suffixes


def build_symbol_candidates(symbol: str, fallbacks: Iterable[str]) -> List[str]:
    candidates = [symbol.upper()]
    if "." in symbol:
        base = symbol.rsplit(".", 1)[0]
    else:
        base = symbol
    suffixes = get_candidate_suffixes(symbol, fallbacks)
    for suffix in suffixes:
        if suffix.count(".") == 1 and suffix.startswith("."):
            candidate = f"{base}{suffix}"
        else:
            candidate = suffix
        if candidate not in candidates:
            candidates.append(candidate)
    return candidates


def find_existing_symbol_file(
    entry: dict, data_root: Path, r2_files_set: Optional[set] = None
) -> Tuple[Optional[str], Optional[Path]]:
    symbol = entry.get("symbol")
    if not isinstance(symbol, str):
        return None, None
    yf_symbol = entry.get("yfSymbol")
    candidates = [yf_symbol] if yf_symbol else [symbol]
    entry_market = entry.get("market")

    def check_path(path_obj: Path) -> bool:
        if path_obj.exists():
            return True
        if r2_files_set:
            try:
                # public/data/... -> data/...
                rel = path_obj.relative_to(PUBLIC_DIR).as_posix()
                if rel in r2_files_set:
                    return True
            except ValueError:
                pass
        return False

    # Market layout
    for candidate in candidates:
        target_market = get_market_name(entry_market, candidate)
        market_dir = get_market_dir(target_market)
        candidate_path = market_dir / f"{sanitize_symbol(candidate)}.json"
        if check_path(candidate_path):
            return candidate, candidate_path

    # Fallback: flat layout
    for candidate in candidates:
        flat_path = data_root / f"{sanitize_symbol(candidate)}.json"
        if check_path(flat_path):
            return candidate, flat_path

    return None, None


def load_nav_entries() -> List[dict]:
    if not NAV_JSON_PATH.exists():
        print(f"[WARN] {NAV_JSON_PATH} not found. Skipping sync operation.")
        return []
    with NAV_JSON_PATH.open(encoding="utf-8") as fp:
        payload = json.load(fp)
    entries = payload.get("nav")
    if not isinstance(entries, list):
        raise ValueError("nav.json 구조가 잘못되었습니다.")
    return entries


def dump_nav_entries(entries: List[dict]) -> None:
    with NAV_JSON_PATH.open("w", encoding="utf-8") as fp:
        json.dump({"nav": entries}, fp, indent=2, ensure_ascii=False)
        fp.write("\n")


def filter_entries(
    entries: List[dict],
    symbols: Optional[List[str]] = None,
    markets: Optional[List[str]] = None,
) -> List[dict]:
    candidates = entries
    if symbols:
        symbol_set = {sym.upper() for sym in symbols}
        candidates = [
            entry
            for entry in candidates
            if str(entry.get("symbol", "")).upper() in symbol_set
        ]
    if markets:
        market_set = {m.upper() for m in markets}
        candidates = [
            entry
            for entry in candidates
            if str(entry.get("market", "")).upper() in market_set
        ]
    return candidates


def sync_nav_symbols(
    symbols: Optional[List[str]] = None,
    markets: Optional[List[str]] = None,
    dry_run: bool = False,
    sync_nav_files: bool = True,
) -> None:
    entries = load_nav_entries()
    if not entries:
        print("[INFO] nav.json이 없거나 비어있어 동기화를 건너뜁니다.")
        return
    targets = filter_entries(entries, symbols, markets)

    if not targets:
        print("처리할 항목이 없습니다.")
        return

    updated = []
    missing = []

    # R2 파일 목록 조회
    r2_files_set = set()
    try:
        r2_files_set = set(list_r2_files("data/"))
        if r2_files_set:
            print(f"[INFO] R2에서 {len(r2_files_set)}개 파일 목록을 로드했습니다.")
    except Exception as e:
        print(f"[WARN] R2 목록 조회 실패: {e}")

    for entry in targets:
        original_symbol = entry.get("symbol")
        market = entry.get("market")
        resolved_symbol, path = find_existing_symbol_file(entry, DATA_DIR, r2_files_set)
        if not resolved_symbol or not path:
            missing.append(original_symbol)
            continue
        if resolved_symbol != original_symbol:
            entry["symbol"] = resolved_symbol
            # market 정보가 없으면 파일 위치 기반으로 추정
            if not market:
                entry["market"] = (
                    path.parent.name.upper()
                    if path.parent != DATA_DIR
                    else None
                )
            updated.append((original_symbol, resolved_symbol))

    if not updated:
        print("변경된 심볼이 없습니다.")
        return

    print(f"[INFO] 총 {len(updated)}건의 심볼을 업데이트합니다.")
    for old, new in updated[:50]:
        print(f"  • {old} -> {new}")
    if len(updated) > 50:
        print(f"  ... 외 {len(updated) - 50}건")

    if missing:
        print(f"[WARN] 데이터 파일을 찾지 못한 티커: {len(missing)}건")

    if dry_run:
        print("[DRY-RUN] 파일은 수정하지 않았습니다.")
        return

    dump_nav_entries(entries)
    print(f"[DONE] nav.json 저장 완료 ({NAV_JSON_PATH})")

    if sync_nav_files:
        try:
            from scripts.migrate_nav_to_symbol_files import migrate_nav_structure  # type: ignore
        except Exception as exc:  # pragma: no cover
            print(f"[WARN] nav 디렉토리 동기화를 건너뜁니다: {exc}")
        else:
            print("[INFO] public/nav 디렉토리를 심볼 구조로 동기화합니다...")
            migrate_nav_structure(dry_run=False)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="public/data 구조를 기준으로 nav 심볼을 동기화합니다."
    )
    parser.add_argument(
        "--symbol",
        action="append",
        dest="symbols",
        help="특정 심볼만 처리 (여러 번 지정 가능)",
    )
    parser.add_argument(
        "--market",
        action="append",
        dest="markets",
        help="특정 시장만 처리 (예: KOSDAQ, KOSPI)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="변경 사항을 출력만 하고 저장하지 않습니다.",
    )
    parser.add_argument(
        "--no-sync-nav-files",
        action="store_true",
        help="nav/<MARKET>/<symbol>.json 동기화를 생략합니다.",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    sync_nav_symbols(
        symbols=args.symbols,
        markets=args.markets,
        dry_run=args.dry_run,
        sync_nav_files=not args.no_sync_nav_files,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


