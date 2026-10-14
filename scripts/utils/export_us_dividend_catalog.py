"""Register freshly verified US dividend stocks in the product search catalog."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
MARKETS = {"NASDAQ", "NYSE", "NYSEARCA", "AMEX", "BATS"}


def build_catalog(report: dict, today: date) -> dict:
    if report.get("schemaVersion") != 1 or report.get("lookbackDays") != 365:
        raise ValueError("Unsupported discovery report")
    as_of = report.get("verificationAsOfDate") or report.get("collectedAt", "")[:10]
    if as_of != today.isoformat():
        raise ValueError("Refresh dividend verification before registering a stale report")
    cutoff = today - timedelta(days=365)
    instruments = {}
    for stock in report["stocks"]:
        verification = stock.get("dividendVerification", {})
        if verification.get("status") != "verified":
            continue
        ticker = stock["symbol"]
        if not re.fullmatch(r"[A-Z]{1,5}(?:-[A-Z])?", ticker) or stock.get("market") not in MARKETS:
            raise ValueError(f"Invalid US stock metadata: {ticker}")
        if ticker in instruments:
            raise ValueError(f"Duplicate verified symbol: {ticker}")
        if verification.get("source") != "Yahoo Finance":
            raise ValueError(f"Unexpected dividend source: {ticker}")
        if verification.get("asOfDate", as_of) != as_of:
            raise ValueError(f"Stale stock verification: {ticker}")
        if verification.get("currency") != "USD" or verification.get("instrumentType") != "EQUITY":
            raise ValueError(f"Not a USD equity: {ticker}")
        events = verification.get("events", [])
        if not events:
            raise ValueError(f"Verified stock has no dividend evidence: {ticker}")
        for event in events:
            ex_date = date.fromisoformat(event["exDate"])
            amount = float(event["amount"])
            if not cutoff <= ex_date <= today or not math.isfinite(amount) or amount <= 0:
                raise ValueError(f"Invalid dividend evidence: {ticker}")
        latest = max(events, key=lambda event: event["exDate"])
        instruments[ticker] = {
            "symbol": ticker, "longName": verification.get("longName") or stock["name"],
            "market": stock["market"], "currency": "USD", "active": True, "securityType": "stock",
            "dividendEtfs": [{"ticker": holding["etf"], "weightPercent": holding["weightPercent"],
                "asOfDate": holding["asOfDate"], "sourceUrl": holding["sourceUrl"]
                    if holding["sourceUrl"].startswith("https://") else None}
                for holding in stock.get("etfHoldings", [])],
            "dividendEvidence": {"source": "Yahoo Finance", "dateBasis": "ex-dividend date",
                "sourceUrl": verification.get("sourceUrl") or
                    "https://finance.yahoo.com/quote/" + ticker + "/history/?filter=div",
                "asOfDate": as_of, "lookbackStart": cutoff.isoformat(),
                "latestExDate": latest["exDate"], "latestAmount": latest["amount"],
                "eventCount": len(events), "regularVsSpecial": "unclassified"},
        }
    return {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
            "verificationAsOfDate": as_of,
            "instruments": [instruments[ticker] for ticker in sorted(instruments)]}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="검증된 미국 배당주를 앱 검색 목록에 등록")
    parser.add_argument("--input", type=Path, default=ROOT / "var/data-management/us-dividend-discovery.json")
    parser.add_argument("--output", type=Path, default=ROOT / "public/us-dividend-stocks.json")
    args = parser.parse_args(argv)
    catalog = build_catalog(json.loads(args.input.read_text(encoding="utf-8")), datetime.now(timezone.utc).date())
    # Refuse to erase a previously collected list on an empty/failed run.
    if not catalog["instruments"]:
        raise ValueError("No verified dividend stocks; existing catalog retained")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(args.output.name + ".tmp")
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(f"Registered {len(catalog['instruments'])} verified dividend stocks: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
