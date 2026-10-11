"""Build the product-neutral catalog portion of a Yieldloom core release.

The legacy nav.json remains an input during migration only.  None of its
presentation, asset, price-path, or chart-period fields are copied into the
core contract.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]


def normalized_entry(row: dict[str, Any]) -> dict[str, Any] | None:
    symbol = str(row.get("symbol") or "").strip().upper()
    if not symbol:
        return None
    market = str(row.get("market") or "").strip().upper()
    currency = str(row.get("currency") or "").strip().upper()
    if not market or not currency:
        return None
    provider = row.get("officialProvider") or row.get("provider") or row.get("company")
    return {
        "symbol": symbol,
        "isin": str(row["isin"]).strip().upper() if row.get("isin") else None,
        "market": market,
        "currency": currency,
        "koName": str(row["koName"]).strip() if row.get("koName") else None,
        "longName": str(row["longName"]).strip() if row.get("longName") else None,
        "active": not bool(row.get("upcoming")),
        "officialProvider": str(provider).strip() if provider else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a core catalog seed from a legacy nav snapshot.")
    parser.add_argument("--input", type=Path, default=ROOT / "public" / "nav.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data-v2" / "catalog-seed.json")
    args = parser.parse_args()
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
        if entry["symbol"] in catalog:
            raise ValueError(f"Duplicate symbol in catalog seed: {entry['symbol']}")
        catalog[entry["symbol"]] = entry
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
