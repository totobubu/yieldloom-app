"""Build the product-neutral catalog portion of a Yieldloom core release.

The legacy nav.json remains an input during migration only.  None of its
presentation, asset, price-path, or chart-period fields are copied into the
core contract.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.metadata.registry import load_verified_links
from scripts.metadata.security_status import apply_status, load_statuses


def normalized_entry(row: dict[str, Any]) -> dict[str, Any] | None:
    symbol = str(row.get("symbol") or "").strip().upper()
    if not symbol:
        return None
    market = str(row.get("market") or "").strip().upper()
    currency = str(row.get("currency") or "").strip().upper()
    if not market or not currency:
        return None
    provider = row.get("officialProvider") or row.get("provider") or row.get("company")
    result = {
        "symbol": symbol,
        "isin": str(row["isin"]).strip().upper() if row.get("isin") else None,
        "market": market,
        "currency": currency,
        "koName": str(row["koName"]).strip() if row.get("koName") else None,
        "longName": str(row["longName"]).strip() if row.get("longName") else None,
        "active": bool(row.get("active", True)) and not bool(row.get("upcoming")),
        "officialProvider": str(provider).strip() if provider else None,
    }

    for field in ("ipoDate", "frequency", "noDividends"):
        if field in row:
            result[field] = row[field]
    return result

def main() -> int:
    parser = argparse.ArgumentParser(description="Create a core catalog seed from a legacy nav snapshot.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "data-v2" / "catalog-seed.json")
    args = parser.parse_args()
    links = load_verified_links()
    source = args.input.resolve()
    output = args.output.resolve()
    payload = json.loads(source.read_text(encoding="utf-8"))
    rows = payload.get("nav") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError("Legacy catalog input must contain a nav array")
    catalog: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        entry = normalized_entry(row)
        if entry is None:
            continue
        if entry['symbol'] in links:
            entry['underlying'] = links[entry['symbol']]['underlying']
        if entry["symbol"] in catalog:
            raise ValueError(f"Duplicate symbol in catalog seed: {entry['symbol']}")
        catalog[entry["symbol"]] = entry
    # Administrator-reviewed registrations need not exist in the legacy nav.
    # Keep their confirmed metadata when the migration seed is regenerated.
    if output.exists():
        previous = json.loads(output.read_text(encoding='utf-8'))
        for row in previous.get('instruments', []):
            if row.get('symbol') not in links or row['symbol'] in catalog:
                continue
            entry = normalized_entry(row)
            if entry is not None:
                entry['active'] = bool(row.get('active', True))
                entry['underlying'] = links[entry['symbol']]['underlying']
                catalog[entry['symbol']] = entry
    statuses = load_statuses()
    for symbol, status in statuses.items():
        if symbol not in catalog:
            entry = normalized_entry(status)
            if entry:
                catalog[symbol] = entry
    catalog = {symbol: apply_status(row, statuses) for symbol, row in catalog.items()}
    result = {
        "schemaVersion": 1,
        "source": "legacy-nav-seed",
        "instruments": [catalog[symbol] for symbol in sorted(catalog)],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Built catalog seed with {len(catalog)} instruments: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
