"""Validate a small, immutable Yieldloom dividend-data release.

The validator deliberately uses Decimal and raw JSON text values. It is safe to
run before an R2 upload and does not contact any external service.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def valid_amount(value: object, location: str) -> list[str]:
    if not isinstance(value, dict):
        return [f"{location}: amount must be an object"]
    raw = value.get("raw")
    decimal = value.get("decimal")
    if not isinstance(raw, str) or not isinstance(decimal, str):
        return [f"{location}: raw and decimal must be strings"]
    try:
        raw_value = Decimal(raw)
        decimal_value = Decimal(decimal)
    except InvalidOperation:
        return [f"{location}: amount is not a decimal string"]
    if not raw_value.is_finite() or not decimal_value.is_finite() or raw_value <= 0:
        return [f'{location}: amount must be finite and positive']
    if not re.fullmatch(r'[A-Z]{3}', str(value.get('currency', ''))):
        return [f'{location}: currency must be an ISO currency code']
    if raw_value != decimal_value:
        return [f"{location}: raw and decimal values differ"]
    if raw != decimal:
        return [f"{location}: precision changed ({raw!r} != {decimal!r})"]
    return []


def validate_event_file(path: Path) -> list[str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"), parse_float=Decimal)
    except (OSError, json.JSONDecodeError) as error:
        return [f"{path}: invalid JSON: {error}"]
    if not isinstance(payload, list):
        return [f"{path}: provider event file must contain an array"]
    errors: list[str] = []
    for index, event in enumerate(payload):
        if not isinstance(event, dict):
            errors.append(f"{path}[{index}]: event must be an object")
            continue
        errors.extend(validate_event(event, f"{path}[{index}]"))
    return errors


def validate_event(event: dict, location: str) -> list[str]:
    errors = valid_amount(event.get("amount"), f"{location}.amount")
    if event.get("verificationStatus") not in {"official", "cross_checked"}:
        errors.append(f"{location}: unapproved verification status")
    for field in ("declaredDate", "exDate"):
        try:
            value = event.get(field)
            if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
                raise ValueError()
        except (ValueError, TypeError):
            errors.append(f"{location}: invalid {field}")
    if not isinstance(event.get("ticker"), str) or not event.get("eventId"):
        errors.append(f"{location}: missing ticker or eventId")
    source = event.get("source", {})
    if not isinstance(source, dict) or not str(source.get("url", "")).startswith("https://") or not re.fullmatch(r"[a-f0-9]{64}", str(source.get("contentSha256", ""))):
        errors.append(f"{location}: invalid source evidence")
    return errors


def validate_catalog_file(path: Path) -> list[str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"{path}: invalid JSON: {error}"]
    if path.name == "search-index.json":
        rows = payload.get("instruments") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return [f"{path}: catalog search index must contain instruments"]
        return [f"{path}: invalid catalog entry" for row in rows if not isinstance(row, dict) or not isinstance(row.get("symbol"), str) or not isinstance(row.get("instrumentPath"), str)]
    if not isinstance(payload, dict) or not isinstance(payload.get("symbol"), str):
        return [f"{path}: catalog instrument must contain symbol"]
    forbidden = {"dataPaths", "periods", "logo", "price", "regularMarketPrice"} & set(payload)
    return [f"{path}: product fields are not allowed in core catalog: {', '.join(sorted(forbidden))}"] if forbidden else []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data-v2"))
    parser.add_argument("--allow-bootstrap", action="store_true", help="Inspect an empty migration placeholder; never use for publishing")
    args = parser.parse_args()
    root = args.data_dir
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        print(f"Missing manifest: {manifest_path}", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if not isinstance(files, list):
        print("manifest.files must be an array", file=sys.stderr)
        return 1

    errors: list[str] = []
    if not files and args.allow_bootstrap and manifest.get("releaseId") == "bootstrap":
        print("Bootstrap placeholder only; not a publishable release")
        return 0
    if manifest.get("schemaVersion") != 2 or not files or manifest.get("indexPath") != "index.json" or manifest.get("catalogSearchIndexPath") != "catalog/search-index.json":
        errors.append("manifest must describe a non-empty schema v2 release with index and catalog")
    paths = {entry.get("path") for entry in files if isinstance(entry, dict)}
    if not {"index.json", "catalog/search-index.json"}.issubset(paths):
        errors.append("required release indexes missing from manifest")
    if len(paths) != len(files):
        errors.append("duplicate or invalid manifest paths")
    for entry in files:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            errors.append("manifest file entry must include a path")
            continue
        relative = Path(entry["path"])
        if relative.is_absolute() or ".." in relative.parts:
            errors.append(f"unsafe manifest path: {entry['path']}")
            continue
        path = root / relative
        if not path.is_file():
            errors.append(f"missing manifest file: {relative}")
            continue
        expected_hash = entry.get("sha256")
        actual_hash = sha256(path)
        if expected_hash != actual_hash:
            errors.append(f"hash mismatch: {relative}")
        if relative.parts[:1] == ("providers",) and relative.name.startswith("events-"):
            errors.extend(validate_event_file(path))
        if relative.parts[:1] == ("catalog",):
            errors.extend(validate_catalog_file(path))
        if relative.parts[:1] == ("tickers",):
            payload = json.loads(path.read_text(encoding="utf-8"))
            events = payload.get("events") if isinstance(payload, dict) else None
            if not isinstance(events, list) or payload.get("ticker") != relative.stem:
                errors.append(f"{relative}: invalid ticker read model")
            else:
                seen = set()
                for event in events:
                    if not isinstance(event, dict):
                        errors.append(f"{relative}: invalid event")
                        continue
                    errors.extend(validate_event(event, str(relative)))
                    if event.get("ticker") != payload["ticker"] or event.get("eventId") in seen:
                        errors.append(f"{relative}: mismatched or duplicate event")
                    seen.add(event.get("eventId"))
        if relative.as_posix() in {"index.json", "catalog/search-index.json"}:
            payload = json.loads(path.read_text(encoding="utf-8"))
            for row in payload.get("tickers", payload.get("instruments", [])):
                reference = row.get("historyPath", row.get("instrumentPath"))
                if reference not in paths:
                    errors.append(f"{relative}: reference absent from manifest: {reference}")
        if relative.parts[:2] == ("catalog", "instruments"):
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("dividendHistoryPath") and payload["dividendHistoryPath"] not in paths:
                errors.append(f"{relative}: dividend history absent from manifest")

    if errors:
        print("Snapshot validation failed:", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"Snapshot valid: {manifest.get('releaseId')} ({len(files)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
