"""Collect non-canonical dividend observations from licensed fallback services."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

if __package__ in {None, ""}:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH


MASSIVE_ENDPOINT = "https://api.massive.com/v3/reference/dividends"


def fetch_massive(ticker: str, api_key: str) -> tuple[bytes, str]:
    public_url = f"{MASSIVE_ENDPOINT}?{urlencode({'ticker': ticker, 'limit': 1000})}"
    request = Request(
        public_url,
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        return response.read(), public_url


def massive_observations(payload: bytes, source_url: str) -> list[dict]:
    document = json.loads(payload, parse_float=str, parse_int=str)
    rows = document.get("results", [])
    observations = []
    digest = hashlib.sha256(payload).hexdigest()
    for row in rows:
        amount = row.get("cash_amount")
        ex_date = row.get("ex_dividend_date")
        ticker = row.get("ticker")
        if amount is None or not ex_date or not ticker:
            continue
        observations.append({
            "ticker": ticker,
            "ex_date": ex_date,
            "amount_raw": str(amount),
            "currency": row.get("currency", "USD"),
            "declared_date": row.get("declaration_date"),
            "record_date": row.get("record_date"),
            "payable_date": row.get("pay_date"),
            "source_class": "licensed_vendor",
            "source_provider": "massive",
            "source_url": source_url,
            "content_sha256": digest,
            "verification_status": "third_party_only",
            "raw": row,
        })
    return observations


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect fallback dividend observations")
    parser.add_argument("--service", choices=("massive",), required=True)
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    ticker = args.ticker.strip().upper()
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if not api_key:
        parser.error("MASSIVE_API_KEY is required")
    payload, source_url = fetch_massive(ticker, api_key)
    observations = massive_observations(payload, source_url)
    if not args.dry_run:
        database = ContentDatabase(args.db)
        database.initialize()
        for observation in observations:
            database.add_distribution_observation(observation)
    print(json.dumps({
        "service": args.service,
        "ticker": ticker,
        "observations": len(observations),
        "canonicalEventsCreated": 0,
        "status": "success" if observations else "no_change",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
