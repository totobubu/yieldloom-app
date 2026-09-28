"""Build a deterministic Yieldloom data-v2 release from reviewed candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ALLOWED_STATUSES = {"official", "cross_checked"}


def dump(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def event_id(event: dict[str, object]) -> str:
    value = "|".join(str(event[key]) for key in ("provider", "ticker", "declaredDate", "exDate", "amount"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def normalize(event: dict[str, object]) -> dict[str, object]:
    required = ("provider", "ticker", "amount", "declaredDate", "exDate", "officialUrl", "sourceSha256", "verificationStatus")
    missing = [key for key in required if not event.get(key)]
    if missing:
        raise ValueError(f"candidate is missing {', '.join(missing)}")
    status = str(event["verificationStatus"])
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"candidate {event['ticker']} is not releasable: {status}")
    amount = str(event["amount"])
    return {
        "eventId": event_id(event),
        "provider": str(event["provider"]),
        "ticker": str(event["ticker"]).upper(),
        "amount": {"raw": amount, "decimal": amount, "currency": str(event.get("currency") or "USD")},
        "declaredDate": str(event["declaredDate"]),
        "exDate": str(event["exDate"]),
        "recordDate": event.get("recordDate"),
        "payableDate": event.get("payableDate"),
        "frequency": event.get("frequency"),
        "verificationStatus": status,
        "source": {"url": str(event["officialUrl"]), "contentSha256": str(event["sourceSha256"])},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data-v2/candidates/pilot-events.json"))
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output", type=Path, default=Path("data-v2"))
    args = parser.parse_args()
    source = args.input if args.input.is_absolute() else ROOT / args.input
    output = args.output if args.output.is_absolute() else ROOT / args.output
    candidates = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(candidates, list):
        raise ValueError("candidate input must be an array")

    events = [normalize(item) for item in candidates]
    seen = set()
    for event in events:
        if event["eventId"] in seen:
            raise ValueError(f"duplicate event: {event['eventId']}")
        seen.add(event["eventId"])
    events.sort(key=lambda item: (str(item["provider"]), str(item["ticker"]), str(item["exDate"]), str(item["eventId"])))

    generated: list[Path] = []
    by_provider_year: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    by_ticker: dict[str, list[dict[str, object]]] = defaultdict(list)
    for event in events:
        by_provider_year[(str(event["provider"]), str(event["exDate"])[:4])].append(event)
        by_ticker[str(event["ticker"])].append(event)
    for (provider, year), rows in sorted(by_provider_year.items()):
        path = output / "providers" / provider / f"events-{year}.json"
        dump(path, rows)
        generated.append(path)
    ticker_index = []
    for ticker, rows in sorted(by_ticker.items()):
        rows.sort(key=lambda item: (str(item["exDate"]), str(item["eventId"])), reverse=True)
        path = output / "tickers" / f"{ticker}.json"
        dump(path, {"ticker": ticker, "provider": rows[0]["provider"], "events": rows})
        generated.append(path)
        ticker_index.append({"ticker": ticker, "provider": rows[0]["provider"], "latest": rows[0], "historyPath": f"tickers/{ticker}.json", "historyCount": len(rows)})
    index_path = output / "index.json"
    dump(index_path, {"providers": sorted({str(row["provider"]) for row in events}), "tickers": ticker_index})
    generated.append(index_path)
    manifest = {
        "schemaVersion": 1,
        "releaseId": args.release_id,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "indexPath": "index.json",
        "files": [{"path": str(path.relative_to(output)).replace("\\", "/"), "sha256": sha256(path)} for path in sorted(generated)],
    }
    dump(output / "manifest.json", manifest)
    print(f"Built {args.release_id}: {len(events)} events, {len(generated)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
