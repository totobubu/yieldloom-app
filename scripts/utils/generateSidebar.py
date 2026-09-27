#!/usr/bin/env python3
"""
Firestore 북마크 기반 사이드바 생성 스크립트

- popularity.json, market cap 등 중간 산출물 없이 바로 Firestore → sidebar/*.json 생성
- 선호도(북마크 카운트)를 100% 기준으로 정렬하며, 개수 제한 없이 모든 활성 티커를 포함
- 출력 대상: public/sidebar/sidebar-tickers-{us,kr}-{stocks,etfs}.json
"""

import json
import os
import sys
from collections import defaultdict
from contextlib import suppress
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

ROOT_DIR = Path(__file__).resolve().parents[2]  # scripts/utils/ -> scripts/ -> 프로젝트 루트
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
NAV_FILE = PUBLIC_DIR / "nav.json"
SIDEBAR_DIR = PUBLIC_DIR / "sidebar"
SYMBOL_ISIN_FILE = PUBLIC_DIR / "symbol-to-isin.json"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import (  # noqa: E402
    load_json_file,
    save_json_file,
    get_base_symbol,
)

KOREAN_ETF_BRANDS = {
    "KODEX",
    "TIGER",
    "KBSTAR",
    "ACE",
    "ARIRANG",
    "HANARO",
    "SOL",
    "PLUS",
    "RISE",
    "TIMEFOLIO",
    "KOSEF",
    "KINDEX",
    "TRUE",
    "FOCUS",
    "SMART",
    "QV",
    "TREX",
    "HK",
}

DAY_ORDER = {"월": 1, "화": 2, "수": 3, "목": 4, "금": 5}

CATEGORY_FILES = {
    "kr-stocks": "sidebar-tickers-kr-stocks.json",
    "kr-etfs": "sidebar-tickers-kr-etfs.json",
    "us-stocks": "sidebar-tickers-us-stocks.json",
    "us-etfs": "sidebar-tickers-us-etfs.json",
}


def ensure_utf8_stdout():
    if sys.stdout.encoding != "utf-8":
        with suppress(AttributeError, ValueError):
            sys.stdout.reconfigure(encoding="utf-8")


def initialize_firestore():
    if firebase_admin._apps:
        return firestore.client()

    service_account_info = os.environ.get("FIRESTORE_SA_KEY")
    cred = None

    if service_account_info:
        try:
            cred = credentials.Certificate(json.loads(service_account_info))
        except Exception as exc:
            raise RuntimeError(
                f"FIRESTORE_SA_KEY 환경 변수 파싱 실패: {exc}"
            ) from exc
    else:
        local_key_path = ROOT_DIR / "service-account-key.json"
        if not local_key_path.exists():
            raise RuntimeError(
                "Firebase 인증 정보가 없습니다. "
                "FIRESTORE_SA_KEY 환경 변수 또는 service-account-key.json 파일을 준비해 주세요."
            )
        cred = credentials.Certificate(str(local_key_path))

    firebase_admin.initialize_app(cred)
    return firestore.client()


def load_nav_entries():
    nav_payload = load_json_file(str(NAV_FILE))
    if not nav_payload:
        raise RuntimeError(f"nav.json을 찾을 수 없습니다: {NAV_FILE}")
    entries = [
        entry
        for entry in nav_payload.get("nav", [])
        if entry.get("symbol") and not entry.get("upcoming")
    ]
    print(f"✓ nav.json 로드 완료 (활성 티커 {len(entries)}개)")
    return entries


def normalize_symbol(value):
    if not value:
        return None
    return str(value).strip().upper()


def is_probable_isin(value):
    candidate = normalize_symbol(value)
    if not candidate:
        return None
    if len(candidate) == 12 and candidate[:2].isalpha() and candidate.isalnum():
        return candidate
    return None


def build_symbol_isin_map(nav_entries, data_isin_map=None):
    symbol_to_isin = {}
    for entry in nav_entries:
        symbol = normalize_symbol(entry.get("symbol"))
        isin = is_probable_isin(entry.get("isin"))
        if symbol and isin:
            symbol_to_isin[symbol] = isin

    snapshot = load_json_file(str(SYMBOL_ISIN_FILE)) or []
    if isinstance(snapshot, list):
        for item in snapshot:
            symbol = normalize_symbol(item.get("symbol"))
            isin = is_probable_isin(item.get("isin"))
            if symbol and isin:
                symbol_to_isin.setdefault(symbol, isin)

    if data_isin_map:
        for symbol, isin in data_isin_map.items():
            if symbol and isin:
                symbol_to_isin.setdefault(symbol, isin)

    return symbol_to_isin


def resolve_isin_from_bookmark(key, payload, symbol_to_isin):
    candidates = []
    if isinstance(payload, dict):
        for field in ("isin", "ISIN", "assetIsin"):
            candidates.append(payload.get(field))
        for field in ("symbol", "Symbol"):
            candidates.append(payload.get(field))
    candidates.append(key)

    for candidate in candidates:
        isin_candidate = is_probable_isin(candidate)
        if isin_candidate:
            return isin_candidate

        symbol_candidate = normalize_symbol(candidate)
        if symbol_candidate and symbol_candidate in symbol_to_isin:
            return symbol_to_isin[symbol_candidate]
    return None


def aggregate_preferences(db, symbol_to_isin):
    print("📥 Firestore 북마크 수집 중...")
    popularity_counts = defaultdict(int)

    users_ref = db.collection("userBookmarks")
    docs = users_ref.stream()

    total_entries = 0
    skipped = 0
    for doc in docs:
        bookmarks = doc.to_dict().get("bookmarks", {})
        if not isinstance(bookmarks, dict):
            continue
        for key, payload in bookmarks.items():
            resolved_isin = resolve_isin_from_bookmark(key, payload, symbol_to_isin)
            if not resolved_isin:
                skipped += 1
                continue
            popularity_counts[resolved_isin] += 1
            total_entries += 1

    print(
        f"✓ 북마크 처리 완료 (총 {total_entries}건, 매칭 실패 {skipped}건, "
        f"고유 ISIN {len(popularity_counts)})"
    )
    return popularity_counts


def _split_weekday_tokens(value):
    if not isinstance(value, str):
        return []
    tokens = []
    for part in value.split():
        for token in part.replace("/", " ").replace(",", " ").replace("·", " ").split():
            stripped = token.strip()
            if stripped:
                tokens.append(stripped)
    return tokens


def parse_group_labels(group_value):
    if group_value is None:
        return []
    labels = []
    if isinstance(group_value, dict):
        iterable = group_value.values()
    elif isinstance(group_value, (list, tuple, set)):
        iterable = group_value
    else:
        iterable = [group_value]

    for item in iterable:
        if isinstance(item, str):
            for token in _split_weekday_tokens(item):
                if token not in labels:
                    labels.append(token)
    return labels


def determine_group_order(group_value):
    labels = parse_group_labels(group_value)
    if labels:
        valid_orders = [DAY_ORDER[label] for label in labels if label in DAY_ORDER]
        if valid_orders:
            return min(valid_orders)
    if isinstance(group_value, str):
        return DAY_ORDER.get(group_value, 999)
    return 999


def load_auxiliary_metadata():
    yield_map = {}
    group_labels_map = {}
    group_value_map = {}
    isin_map = {}

    if not DATA_DIR.exists():
        return yield_map, group_value_map, group_labels_map, isin_map

    files = list(DATA_DIR.glob("*.json"))
    for subdir in DATA_DIR.iterdir():
        if subdir.is_dir():
            files.extend(subdir.glob("*.json"))

    for data_file in files:
        ticker_symbol = (
            Path(data_file).name.replace(".json", "").replace("-", ".").upper()
        )
        base_symbol = get_base_symbol(ticker_symbol)
        if not base_symbol:
            continue
        payload = load_json_file(str(data_file))
        if not payload:
            continue
        info = payload.get("tickerInfo", {})
        if not isinstance(info, dict):
            continue
        if "Yield" in info:
            yield_map[ticker_symbol] = info["Yield"]
        if "group" in info:
            group_value_map[base_symbol] = info["group"]
            labels = parse_group_labels(info["group"])
            if labels:
                group_labels_map[base_symbol] = labels
        isin_value = info.get("isin")
        resolved_isin = is_probable_isin(isin_value)
        if resolved_isin:
            isin_map[base_symbol] = resolved_isin

    print(
        "✓ 보조 메타데이터 로드 "
        f"(배당수익률 {len(yield_map)}개, 그룹 라벨 {len(group_labels_map)}개, ISIN {len(isin_map)}개)"
    )
    return yield_map, group_value_map, group_labels_map, isin_map


def infer_is_etf(nav_entry):
    value = nav_entry.get("isEtf")
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "yes", "etf"}:
            return True
        if lowered in {"false", "no", "stock"}:
            return False
    if nav_entry.get("company") or nav_entry.get("underlying"):
        return True
    ko_name = (nav_entry.get("koName") or "").upper()
    return any(ko_name.startswith(brand) for brand in KOREAN_ETF_BRANDS)


def build_sidebar_entries(
    nav_entries,
    popularity_counts,
    yield_map,
    group_value_map,
    group_labels_map,
    symbol_to_isin,
):
    entries = []
    for nav_entry in nav_entries:
        symbol = normalize_symbol(nav_entry.get("symbol"))
        isin = is_probable_isin(nav_entry.get("isin")) or (
            symbol and symbol_to_isin.get(symbol)
        )
        if isin:
            isin = is_probable_isin(isin) or normalize_symbol(isin)
        if not symbol or not isin:
            continue

        ticker = {
            "symbol": symbol,
            "isin": isin,
            "currency": nav_entry.get("currency"),
            "market": nav_entry.get("market"),
            "isEtf": infer_is_etf(nav_entry),
            "popularity": popularity_counts.get(isin, 0),
        }

        optional_fields = [
            "koName",
            "longName",
            "company",
            "logo",
            "frequency",
            "group",
            "underlying",
        ]
        for field in optional_fields:
            if nav_entry.get(field) is not None:
                ticker[field] = nav_entry[field]

        group_value = ticker.get("group") or group_value_map.get(symbol)
        if group_value is not None:
            ticker["group"] = group_value
            ticker["groupOrder"] = determine_group_order(group_value)
        else:
            ticker["groupOrder"] = 999

        group_labels = group_labels_map.get(symbol)
        if group_labels:
            ticker["groupLabels"] = group_labels
            if "group" not in ticker or not ticker["group"]:
                ticker["group"] = group_labels[0]

        if symbol in yield_map and yield_map[symbol] is not None:
            ticker["yield"] = yield_map[symbol]

        entries.append(ticker)

    print(f"✓ 사이드바용 티커 구성 완료 ({len(entries)}개, 선호도 {sum(1 for t in entries if t.get('popularity', 0) > 0)}개)")
    return entries


def bucketize(entries):
    buckets = {key: [] for key in CATEGORY_FILES}
    for entry in entries:
        if (entry.get("popularity") or 0) <= 0:
            continue
        currency = (entry.get("currency") or "").upper()
        is_etf = bool(entry.get("isEtf"))
        if currency == "USD":
            key = "us-etfs" if is_etf else "us-stocks"
        elif currency == "KRW":
            key = "kr-etfs" if is_etf else "kr-stocks"
        else:
            continue
        buckets[key].append(entry)
    return buckets


def sort_entries(entries):
    return sorted(
        entries,
        key=lambda item: (-item.get("popularity", 0), item.get("symbol") or ""),
    )


def save_sidebar_files(buckets):
    os.makedirs(SIDEBAR_DIR, exist_ok=True)
    for bucket, filename in CATEGORY_FILES.items():
        sorted_entries = sort_entries(buckets.get(bucket, []))
        output_path = SIDEBAR_DIR / filename
        save_json_file(str(output_path), sorted_entries)
        print(f"  - {bucket}: {len(sorted_entries)}개 저장 ({output_path.name})")


def main():
    ensure_utf8_stdout()
    print("=" * 80)
    print("📊 Firestore 기반 사이드바 재생성")
    print("=" * 80)

    nav_entries = load_nav_entries()
    (
        yield_map,
        group_value_map,
        group_labels_map,
        data_isin_map,
    ) = load_auxiliary_metadata()
    symbol_to_isin = build_symbol_isin_map(nav_entries, data_isin_map)

    db = initialize_firestore()
    popularity_counts = aggregate_preferences(db, symbol_to_isin)
    sidebar_entries = build_sidebar_entries(
        nav_entries,
        popularity_counts,
        yield_map,
        group_value_map,
        group_labels_map,
        symbol_to_isin,
    )
    buckets = bucketize(sidebar_entries)

    print("\n💾 파일 저장 중...")
    save_sidebar_files(buckets)

    print("\n✅ 사이드바 생성 완료")


if __name__ == "__main__":
    main()

