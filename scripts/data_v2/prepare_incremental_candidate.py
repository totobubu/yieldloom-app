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

from scripts.content_pipeline.providers import NoDataError, PROVIDERS, SourceCandidate
from scripts.data_v2.collection_schedule import due_reason, retry_at, schedule_for, source_key
from scripts.data_v2.collection_state import load_local, load_r2, save_r2

DEFAULT_PROVIDERS = sorted(PROVIDERS)


def candidate_from_source(source: dict[str, Any]) -> SourceCandidate:
    candidate = source.get("candidate") or {}
    return SourceCandidate(
        url=str(candidate.get("url") or source["url"]),
        source_type=str(candidate.get("sourceType") or "html"),
        published_at=candidate.get("publishedAt"),
        metadata=dict(candidate.get("metadata") or {}),
    )


def candidate_ticker(candidate: SourceCandidate, events: list[dict[str, Any]] | None = None) -> str:
    ticker = str(candidate.metadata.get("ticker") or "").upper()
    if ticker:
        return ticker
    event_tickers = {str(item["ticker"]).upper() for item in events or []}
    return next(iter(event_tickers)) if len(event_tickers) == 1 else "*"


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


def update_source(previous: dict[str, Any] | None, events: list[dict[str, Any]], content_sha256: str, now: str, candidate: SourceCandidate | None = None, official_published_at: str | None = None) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    previous_events = {event_key(row): row for row in (previous or {}).get("events", [])}
    incoming = {event_key(row): row for row in events}
    new = [row for key, row in incoming.items() if key not in previous_events]
    changed = [{"before": previous_events[key], "after": row} for key, row in incoming.items() if key in previous_events and comparable(previous_events[key]) != comparable(row)]
    suspected_removed = [row for key, row in previous_events.items() if key not in incoming]
    # Missing historical rows can be transient provider-page changes. Preserve them until a reviewer acts.
    merged = dict(previous_events)
    merged.update(incoming)
    observed = now
    history = list((previous or {}).get("announcementHistory", []))
    if not previous or previous.get("contentSha256") != content_sha256:
        history.append({"observedAt": observed, "officialPublishedAt": official_published_at} if official_published_at else {"observedAt": observed})
    history = history[-12:]
    candidate = candidate or candidate_from_source(previous or {"url": events[0]["officialUrl"] if events else ""})
    ticker = candidate_ticker(candidate, events)
    next_source = {
        "provider": events[0]["provider"] if events else (previous or {}).get("provider"),
        "ticker": ticker,
        "url": candidate.url,
        "sourceKey": source_key(str(events[0]["provider"] if events else (previous or {}).get("provider") or ""), ticker, candidate.url),
        "candidate": {"url": candidate.url, "sourceType": candidate.source_type, "publishedAt": candidate.published_at, "metadata": candidate.metadata},
        "contentSha256": content_sha256,
        "lastSuccessAt": now,
        "lastCheckedAt": now,
        "officialPublishedAt": official_published_at,
        "lastObservedAt": observed,
        "announcementHistory": history,
        "schedule": schedule_for(history, datetime.fromisoformat(now.replace("Z", "+00:00"))),
        "failureCount": 0,
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
    parser.add_argument("--now", help="UTC ISO timestamp for deterministic scheduling tests")
    args = parser.parse_args()
    providers = args.provider or DEFAULT_PROVIDERS
    state = load_local(args.state_file) if args.state_file else load_r2()
    next_state = {"schemaVersion": 2, "generatedAt": None, "sources": dict(state["sources"]), "catalogs": dict(state.get("catalogs", {}))}
    report: dict[str, Any] = {"schemaVersion": 2, "runId": args.run_id, "providers": {}, "summary": {"new": 0, "changed": 0, "suspectedRemoved": 0, "unchangedSources": 0, "failedSources": 0, "selectedSources": 0, "skippedSources": 0}}
    clock = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else datetime.now(timezone.utc)
    clock = clock.astimezone(timezone.utc).replace(microsecond=0)
    now = clock.isoformat()
    for slug in providers:
        provider_report: dict[str, Any] = {"status": "success", "sources": [], "new": [], "changed": [], "suspectedRemoved": [], "errors": []}
        adapter = PROVIDERS[slug]()
        known = [source for source in next_state["sources"].values() if source.get("provider") == slug]
        catalog = next_state["catalogs"].get(slug, {})
        catalog_checked = datetime.fromisoformat(catalog["lastDiscoveryAt"].replace("Z", "+00:00")).date() if catalog.get("lastDiscoveryAt") else None
        candidates = [candidate_from_source(source) for source in known]
        if not known or catalog_checked != clock.date():
            try:
                discovered = list(adapter.discover())
                candidates = list({(item.url, str(item.metadata)): item for item in [*candidates, *discovered]}.values())
                next_state["catalogs"][slug] = {"lastDiscoveryAt": now}
            except Exception as error:
                provider_report.update(status="failed", errors=[f"catalog discovery: {error}"])
                report["providers"][slug] = provider_report
                report["summary"]["failedSources"] += 1
                continue
        for candidate in candidates:
            ticker = candidate_ticker(candidate)
            key = source_key(slug, ticker, candidate.url)
            previous = next_state["sources"].get(key)
            if previous is None:
                previous = next((item for item in known if item.get("url") == candidate.url and item.get("ticker", "*") == ticker), None)
            reason = due_reason(previous, clock) if previous else "initial_observation"
            if not reason:
                report["summary"]["skippedSources"] += 1
                continue
            report["summary"]["selectedSources"] += 1
            try:
                document = adapter.fetch(candidate)
                if previous and previous.get("contentSha256") == document.content_sha256:
                    previous = dict(previous)
                    previous["lastCheckedAt"] = now
                    next_state["sources"][key] = previous
                    provider_report["sources"].append({"url": candidate.url, "ticker": ticker, "reason": reason, "status": "unchanged", "sha256": document.content_sha256})
                    report["summary"]["unchangedSources"] += 1
                    continue
                document = replace(
                    document,
                    published_at=candidate.published_at or document.published_at,
                    metadata={**document.metadata, **candidate.metadata},
                )
                events = [to_candidate(event, document) for event in adapter.parse(document) if event.verification_status in {"official", "cross_checked"}]
                if not events:
                    raise NoDataError("No releasable official events")
                updated, diff = update_source(previous, events, document.content_sha256, now, candidate, document.published_at)
                next_state["sources"][updated["sourceKey"]] = updated
                if key != updated["sourceKey"]:
                    next_state["sources"].pop(key, None)
                provider_report["sources"].append({"url": candidate.url, "ticker": updated["ticker"], "reason": reason, "status": "parsed", "sha256": document.content_sha256, "events": len(events)})
                for name, values in diff.items():
                    provider_report[name].extend(values)
                    report["summary"][name] += len(values)
            except NoDataError as error:
                provider_report["sources"].append({"url": candidate.url, "ticker": ticker, "reason": reason, "status": "no_change", "detail": str(error)})
            except Exception as error:
                provider_report["status"] = "partial" if provider_report["sources"] else "failed"
                provider_report["errors"].append(f"{candidate.url}: {error}")
                if previous:
                    previous = dict(previous)
                    previous["lastCheckedAt"] = now
                    previous["failureCount"] = int(previous.get("failureCount", 0)) + 1
                    previous["nextRetryAt"] = retry_at(clock, previous["failureCount"])
                    previous["schedule"] = {"mode": "observation", "confidence": "retry_pending"}
                    next_state["sources"][key] = previous
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
