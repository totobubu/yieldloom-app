"""Collect only changed official documents and retain a complete state snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.content_pipeline.providers import NoDataError, PROVIDERS
from scripts.data_v2.collection_state import empty_state, load_local, load_r2, save_r2

DEFAULT_PROVIDERS = ["amplify", "defiance", "globalx", "neos", "rex", "roundhill", "schwab", "yieldmax"]


def source_key(provider: str, url: str) -> str:
    return f"{provider}|{url}"


def event_key(event: dict[str, Any]) -> tuple[str, str, str, str]:
    return tuple(str(event[field]) for field in ("provider", "ticker", "declaredDate", "exDate"))


def to_candidate(event: Any, document: Any) -> dict[str, Any]:
    return {
        "provider": event.provider_slug,
        "ticker": event.ticker,
        "amount": event.distribution_per_share,
        "currency": event.currency,
        "declaredDate": event.declared_date,
        "exDate": event.ex_date,
        "recordDate": event.record_date,
        "payableDate": event.payable_date,
        "frequency": event.frequency,
        "officialUrl": event.official_url,
        "sourceSha256": document.content_sha256,
        "verificationStatus": event.verification_status,
        "collectionMethod": "official_fetch",
    }


def comparable(event: dict[str, Any]) -> dict[str, Any]:
    return {field: event.get(field) for field in ("amount", "recordDate", "payableDate", "frequency", "currency", "sourceSha256")}


def update_source(previous: dict[str, Any] | None, events: list[dict[str, Any]], content_sha256: str, now: str) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    previous_events = {event_key(row): row for row in (previous or {}).get("events", [])}
    incoming = {event_key(row): row for row in events}
    new = [row for key, row in incoming.items() if key not in previous_events]
    changed = [{"before": previous_events[key], "after": row} for key, row in incoming.items() if key in previous_events and comparable(previous_events[key]) != comparable(row)]
    suspected_removed = [row for key, row in previous_events.items() if key not in incoming]
    # Missing historical rows can be transient provider-page changes. Preserve them until a reviewer acts.
    merged = dict(previous_events)
    merged.update(incoming)
    next_source = {
        "provider": events[0]["provider"] if events else (previous or {}).get("provider"),
        "url": events[0]["officialUrl"] if events else (previous or {}).get("url"),
        "contentSha256": content_sha256,
        "lastSuccessAt": now,
        "parserVersion": "incremental-v1",
        "events": [merged[key] for key in sorted(merged)],
    }
    return next_source, {"new": new, "changed": changed, "suspectedRemoved": suspected_removed}


def all_events(state: dict[str, Any]) -> list[dict[str, Any]]:
    result: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for source in state["sources"].values():
        for event in source.get("events", []):
            identity = event_key(event)
            if identity in result and comparable(result[identity]) != comparable(event):
                raise ValueError(f"Conflicting state events for {identity}")
            result[identity] = event
    return [result[key] for key in sorted(result)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", action="append", choices=DEFAULT_PROVIDERS)
    parser.add_argument("--run-id", default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    parser.add_argument("--candidate-output", type=Path, default=Path("data-v2/candidates/incremental-events.json"))
    parser.add_argument("--report-output", type=Path, default=Path("data-v2/review/incremental-report.json"))
    parser.add_argument("--state-output", type=Path, default=Path("data-v2/review/collection-state.json"))
    parser.add_argument("--state-file", type=Path, help="Local state for offline validation; disables R2 reads/writes")
    args = parser.parse_args()
    providers = args.provider or DEFAULT_PROVIDERS
    state = load_local(args.state_file) if args.state_file else load_r2()
    next_state = {"schemaVersion": 1, "generatedAt": None, "sources": dict(state["sources"])}
    report: dict[str, Any] = {"schemaVersion": 1, "runId": args.run_id, "providers": {}, "summary": {"new": 0, "changed": 0, "suspectedRemoved": 0, "unchangedSources": 0, "failedSources": 0}}
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for slug in providers:
        provider_report: dict[str, Any] = {"status": "success", "sources": [], "new": [], "changed": [], "suspectedRemoved": [], "errors": []}
        adapter = PROVIDERS[slug]()
        try:
            candidates = list(adapter.discover())
        except Exception as error:
            provider_report.update(status="failed", errors=[str(error)])
            report["providers"][slug] = provider_report
            report["summary"]["failedSources"] += 1
            continue
        for candidate in candidates:
            key = source_key(slug, candidate.url)
            previous = next_state["sources"].get(key)
            try:
                document = adapter.fetch(candidate)
                if previous and previous.get("contentSha256") == document.content_sha256:
                    provider_report["sources"].append({"url": candidate.url, "status": "unchanged", "sha256": document.content_sha256})
                    report["summary"]["unchangedSources"] += 1
                    continue
                document = replace(document, published_at=candidate.published_at, metadata=candidate.metadata)
                events = [to_candidate(event, document) for event in adapter.parse(document) if event.verification_status in {"official", "cross_checked"}]
                if not events:
                    raise NoDataError("No releasable official events")
                updated, diff = update_source(previous, events, document.content_sha256, now)
                next_state["sources"][key] = updated
                provider_report["sources"].append({"url": candidate.url, "status": "parsed", "sha256": document.content_sha256, "events": len(events)})
                for name, values in diff.items():
                    provider_report[name].extend(values)
                    report["summary"][name] += len(values)
            except NoDataError as error:
                provider_report["sources"].append({"url": candidate.url, "status": "no_change", "detail": str(error)})
            except Exception as error:
                provider_report["status"] = "partial" if provider_report["sources"] else "failed"
                provider_report["errors"].append(f"{candidate.url}: {error}")
                report["summary"]["failedSources"] += 1
        report["providers"][slug] = provider_report
    candidate = all_events(next_state)
    for path, payload in ((args.candidate_output, candidate), (args.report_output, report), (args.state_output, next_state)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.state_file:
        args.state_file.parent.mkdir(parents=True, exist_ok=True)
        args.state_file.write_text(json.dumps(next_state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        save_r2(next_state, args.run_id)
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
