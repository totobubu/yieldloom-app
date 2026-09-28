"""Compare private screenshot OCR hints with the official collection state."""

from __future__ import annotations

import argparse
from io import BytesIO
import json
from pathlib import Path
from typing import Any

import pytesseract
from PIL import Image

from scripts.data_v2.collection_state import load_r2
from scripts.data_v2.evidence_store import get_bytes, get_evidence_client, get_json, key
from scripts.data_v2.ingest_email_evidence import extract_candidates
from scripts.data_v2.prepare_incremental_candidate import all_events


def compare(ocr: dict[str, Any], review: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    provider = review["provider"]
    results = []
    for candidate in ocr.get("candidates", []):
        matches = [event for event in events if event["provider"] == provider and event["ticker"] == candidate["ticker"]]
        exact = [event for event in matches if event["amount"] == candidate["amount"] and (not review.get("declaredDate") or event["declaredDate"] == review["declaredDate"])]
        results.append({"candidate": candidate, "status": "matched_official" if exact else "needs_review", "officialMatches": exact or matches})
    return {"schemaVersion": 1, "evidenceId": review["evidenceId"], "sourceType": "email_screenshot", "provider": provider, "overallStatus": "matched_official" if results and all(item["status"] == "matched_official" for item in results) else "needs_review", "results": results}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-id", required=True)
    parser.add_argument("--output", type=Path, default=Path("email-evidence-report.json"))
    parser.add_argument("--refresh-ocr", action="store_true", help="OCR the private original again instead of trusting stored OCR")
    args = parser.parse_args()
    client, bucket = get_evidence_client()
    review = get_json(client, bucket, key(args.evidence_id, "review.json"))
    ocr = get_json(client, bucket, key(args.evidence_id, "ocr.json"))
    if args.refresh_ocr:
        text = pytesseract.image_to_string(Image.open(BytesIO(get_bytes(client, bucket, review["originalKey"]))))
        ocr = {"schemaVersion": 1, "evidenceId": args.evidence_id, "engine": "tesseract", "text": text, "candidates": extract_candidates(text), "reprocessed": True}
    report = compare(ocr, review, all_events(load_r2()))
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"evidenceId": args.evidence_id, "status": report["overallStatus"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
