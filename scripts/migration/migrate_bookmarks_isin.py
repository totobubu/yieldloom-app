#!/usr/bin/env python3
"""
기존 Firestore userBookmarks 문서를 업데이트해 각 북마크에 ISIN 정보를 채워 넣고,
키를 symbol 기반으로 정규화하기 위한 보조 스크립트입니다.

실행 순서:
1. FIRESTORE_SA_KEY 환경 변수 또는 service-account-key.json 파일 준비
2. python scripts/migrate_bookmarks_isin.py
"""

import os
import sys
import json
from contextlib import suppress

import firebase_admin
from firebase_admin import credentials, firestore

from scripts.popularity_utils import load_symbol_to_isin_map, load_nav_metadata, normalize_symbol


def ensure_console_encoding():
    if sys.stdout.encoding != "utf-8":
        with suppress(AttributeError, ValueError):
            sys.stdout.reconfigure(encoding="utf-8")


def init_firebase():
    if service_account_info := os.environ.get("FIRESTORE_SA_KEY"):
        cred = credentials.Certificate(json.loads(service_account_info))
        firebase_admin.initialize_app(cred)
        return

    local_key_path = "service-account-key.json"
    if not os.path.exists(local_key_path):
        raise RuntimeError(
            "No Firebase credentials found. Set FIRESTORE_SA_KEY or place service-account-key.json"
        )
    cred = credentials.Certificate(local_key_path)
    firebase_admin.initialize_app(cred)


def resolve_symbol_and_isin(key, value, nav_metadata, isin_to_symbol, symbol_to_isin):
    entry_symbol = None
    entry_isin = None

    if isinstance(value, dict):
        entry_symbol = value.get("symbol") or key
        entry_isin = value.get("isin")
    else:
        entry_symbol = key

    if entry_symbol:
        entry_symbol = entry_symbol.upper()
    if entry_isin:
        entry_isin = entry_isin.upper()

    canonical_symbol = None
    if entry_symbol:
        canonical_symbol = normalize_symbol(entry_symbol, nav_metadata)
    if entry_isin and not canonical_symbol:
        canonical_symbol = isin_to_symbol.get(entry_isin, canonical_symbol)
    if not canonical_symbol and entry_symbol:
        canonical_symbol = entry_symbol
    if not canonical_symbol and entry_isin:
        canonical_symbol = isin_to_symbol.get(entry_isin)

    if canonical_symbol:
        canonical_symbol = canonical_symbol.upper()
    resolved_isin = entry_isin or symbol_to_isin.get(canonical_symbol or "")
    if resolved_isin:
        resolved_isin = resolved_isin.upper()

    return canonical_symbol, resolved_isin


def main():
    ensure_console_encoding()
    init_firebase()
    db = firestore.client()

    print("✅ Firebase connection established.")

    nav_metadata = load_nav_metadata()
    symbol_to_isin = load_symbol_to_isin_map()
    isin_to_symbol = {isin: symbol for symbol, isin in symbol_to_isin.items()}

    users_ref = db.collection("userBookmarks")
    docs = list(users_ref.stream())
    print(f"📄 Loaded {len(docs)} user bookmark documents.")

    updated_docs = 0
    for doc in docs:
        data = doc.to_dict() or {}
        raw_bookmarks = data.get("bookmarks", {})
        if not raw_bookmarks:
            continue

        normalized = {}
        changed = False

        for key, value in raw_bookmarks.items():
            symbol, isin = resolve_symbol_and_isin(
                key, value, nav_metadata, isin_to_symbol, symbol_to_isin
            )
            if not symbol or not isin:
                continue

            payload = value.copy() if isinstance(value, dict) else {}
            payload["symbol"] = symbol
            payload["isin"] = isin

            normalized[symbol] = payload
            if symbol != key or payload != value:
                changed = True

        if not changed:
            continue

        doc.reference.update({"bookmarks": normalized})
        updated_docs += 1
        print(f"  • Updated {doc.id}: {len(normalized)} bookmarks")

    print(f"\n🎉 Migration finished. Updated {updated_docs} documents.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"❌ Migration failed: {exc}")
        sys.exit(1)

