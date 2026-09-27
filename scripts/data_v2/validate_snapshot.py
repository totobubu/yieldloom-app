"""Validate a small, immutable Yieldloom dividend-data release.

The validator deliberately uses Decimal and raw JSON text values. It is safe to
run before an R2 upload and does not contact any external service.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
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
        errors.extend(valid_amount(event.get("amount"), f"{path}[{index}].amount"))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data-v2"))
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

    if errors:
        print("Snapshot validation failed:", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"Snapshot valid: {manifest.get('releaseId')} ({len(files)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
