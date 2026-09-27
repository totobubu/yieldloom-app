import os
import json
import sys
from contextlib import suppress
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from scripts.popularity_utils import (  # noqa: E402
    load_nav_metadata,
    normalize_symbol,
)


def main():
    if sys.stdout.encoding != "utf-8":
        with suppress(AttributeError, ValueError):
            sys.stdout.reconfigure(encoding="utf-8")
    print("--- Starting Symbol Suffix Migration (.KS → .KQ) ---")

    if service_account_info := os.environ.get("FIRESTORE_SA_KEY"):
        try:
            cred = credentials.Certificate(json.loads(service_account_info))
            firebase_admin.initialize_app(cred)
        except Exception as e:
            print(f"Error initializing Firebase from environment: {e}")
            return
    else:
        local_key_path = "service-account-key.json"
        if not os.path.exists(local_key_path):
            print("Error: No authentication method found.")
            print("  - Environment variable FIRESTORE_SA_KEY not set")
            print(f"  - Local file {local_key_path} not found")
            return
        try:
            cred = credentials.Certificate(local_key_path)
            firebase_admin.initialize_app(cred)
        except Exception as e:
            print(f"Error initializing Firebase from file: {e}")
            return

    db = firestore.client()
    print("Firebase connection successful.")

    nav_metadata = load_nav_metadata()
    if not nav_metadata:
        print("Error: nav metadata is empty. Abort migration.")
        return

    users_ref = db.collection("userBookmarks")
    docs = list(users_ref.stream())

    updated_documents = 0
    converted_symbols = 0
    conflict_warnings = []

    for doc_snapshot in docs:
        doc_data = doc_snapshot.to_dict() or {}
        bookmarks = doc_data.get("bookmarks", {})
        if not bookmarks:
            continue

        updated_bookmarks = {}
        has_changes = False

        for symbol, details in bookmarks.items():
            canonical_symbol = normalize_symbol(symbol, nav_metadata)
            if canonical_symbol != symbol:
                has_changes = True
                converted_symbols += 1
            if canonical_symbol in updated_bookmarks and canonical_symbol != symbol:
                conflict_warnings.append(
                    f"{doc_snapshot.id}: {symbol} -> {canonical_symbol} (duplicate)"
                )
                # 기존 값은 존중하고 새로 변환된 값은 무시
                continue
            updated_bookmarks[canonical_symbol] = details

        if not has_changes:
            continue

        try:
            users_ref.document(doc_snapshot.id).set(
                {"bookmarks": updated_bookmarks}, merge=True
            )
            updated_documents += 1
        except Exception as e:
            print(f"Error updating document {doc_snapshot.id}: {e}")

    print(
        f"Migration finished. Updated documents: {updated_documents}, "
        f"converted symbols: {converted_symbols}"
    )
    if conflict_warnings:
        print("Conflicts detected (manual review recommended):")
        for warning in conflict_warnings:
            print(f"  - {warning}")


if __name__ == "__main__":
    main()

