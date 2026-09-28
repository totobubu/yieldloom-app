"""Upload a local official-email screenshot and its OCR as private review evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytesseract
from PIL import Image

from scripts.data_v2.evidence_store import get_evidence_client, key, put_immutable, put_json_immutable


SUPPORTED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def extract_candidates(text: str) -> list[dict[str, str]]:
    """Conservative OCR hints; they are never release data."""
    candidates: list[dict[str, str]] = []
    for line in text.splitlines():
        ticker = re.search(r"\b([A-Z]{2,6})\b", line.upper())
        amount = re.search(r"(?<!\d)(\d+\.\d{2,8})(?!\d)", line)
        if ticker and amount:
            candidates.append({"ticker": ticker.group(1), "amount": amount.group(1), "line": line.strip()})
    return candidates


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--received-at", required=True, help="ISO-8601 date/time from the mailbox")
    parser.add_argument("--declared-date")
    parser.add_argument("--ticker-hint", action="append", default=[])
    parser.add_argument("--message-subject")
    parser.add_argument("--notes")
    parser.add_argument("--output", type=Path, help="Optional local, non-sensitive upload receipt JSON")
    args = parser.parse_args()
    if args.image.suffix.lower() not in SUPPORTED_SUFFIXES or not args.image.is_file():
        raise ValueError("image must be an existing PNG, JPG, JPEG, or WebP file")
    datetime.fromisoformat(args.received_at.replace("Z", "+00:00"))
    image_bytes = args.image.read_bytes()
    evidence_id = hashlib.sha256(image_bytes).hexdigest()
    text = pytesseract.image_to_string(Image.open(args.image))
    client, bucket = get_evidence_client()
    extension = args.image.suffix.lower().lstrip(".")
    original_key = key(evidence_id, f"original.{extension}")
    mime_type = mimetypes.guess_type(args.image.name)[0] or "application/octet-stream"
    ocr = {"schemaVersion": 1, "evidenceId": evidence_id, "engine": "tesseract", "text": text, "candidates": extract_candidates(text)}
    review = {
        "schemaVersion": 1,
        "evidenceId": evidence_id,
        "sourceType": "email_screenshot",
        "provider": args.provider,
        "receivedAt": args.received_at,
        "declaredDate": args.declared_date,
        "tickerHints": [value.upper() for value in args.ticker_hint],
        "messageSubject": args.message_subject,
        "notes": args.notes,
        "originalKey": original_key,
        "ocrKey": key(evidence_id, "ocr.json"),
        "status": "needs_review",
        "uploadedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }
    put_immutable(client, bucket, original_key, image_bytes, mime_type)
    put_json_immutable(client, bucket, key(evidence_id, "ocr.json"), ocr)
    put_json_immutable(client, bucket, key(evidence_id, "review.json"), review)
    receipt = {"evidenceId": evidence_id, "reviewKey": key(evidence_id, "review.json"), "originalStored": original_key}
    if args.output:
        args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
