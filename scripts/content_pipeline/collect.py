from __future__ import annotations

import argparse
import json
from dataclasses import replace
from datetime import date
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.providers import NoDataError, PROVIDERS, SourceCandidate


def candidate_tickers(candidate: SourceCandidate) -> list[str]:
    values: list[str] = []
    ticker = candidate.metadata.get("ticker")
    if isinstance(ticker, str):
        values.append(ticker)
    tickers = candidate.metadata.get("tickers")
    if isinstance(tickers, (list, tuple, set)):
        values.extend(str(value) for value in tickers)
    return sorted({value.strip().upper() for value in values if value.strip()})


def stable_event_key(event) -> tuple[str, str, str, str]:
    """Return the issuer-event identity without relying on a SQLite row ID."""
    return (
        event.provider_slug,
        event.ticker,
        event.declared_date,
        event.ex_date,
    )


def event_snapshot(event) -> dict[str, str | None]:
    """Fields whose disagreement must never silently replace an earlier source."""
    return {
        "amount": event.distribution_per_share,
        "recordDate": event.record_date,
        "payableDate": event.payable_date,
        "frequency": event.frequency,
        "rocPercent": event.roc_percent,
        "verificationStatus": event.verification_status,
        "verificationNote": event.verification_note,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect official ETF distributions")
    parser.add_argument("--provider", choices=sorted(PROVIDERS), required=True)
    parser.add_argument("--ticker", help="Persist events only for this ticker")
    parser.add_argument("--tickers", help="Comma-separated registered Roundhill tickers for one declaration date")
    parser.add_argument("--url", help="Parse one explicit allowed official URL")
    parser.add_argument("--ex-date", type=date.fromisoformat,
                        help="Keep only events matching this ISO ex-dividend date")
    parser.add_argument("--declaration-date", type=date.fromisoformat,
                        help="Fetch one Roundhill ticker's notice for this declaration date")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-sources", type=int,
                        help="candidate cap; provider default is used when omitted")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    adapter = PROVIDERS[args.provider]()
    target_tickers = {value.strip().upper() for value in (args.tickers or args.ticker or "").split(",") if value.strip()}
    if args.ticker and (len(target_tickers) != 1 or "," in args.ticker):
        parser.error("--ticker accepts one symbol; use --tickers for a Roundhill group")
    if args.tickers and (args.provider != "roundhill" or args.ticker or not args.declaration_date):
        parser.error("--tickers requires --provider roundhill and --declaration-date, without --ticker")
    if args.declaration_date and (
        args.provider != "roundhill" or not target_tickers or args.url or args.ex_date
        or any(ticker not in adapter.tracked_symbols for ticker in target_tickers)
    ):
        parser.error("--declaration-date requires a registered Roundhill --ticker and no --url/--ex-date")
    database = None
    if not args.dry_run:
        database = ContentDatabase(args.db)
        database.initialize()
        database.upsert_provider(
            adapter.slug,
            adapter.display_name,
            adapter.official_homepage,
            adapter.parser_version,
        )

    if args.declaration_date:
        candidates = list(adapter.discover_for_declaration_date(args.declaration_date, ",".join(sorted(target_tickers))))
    elif args.url:
        candidates = [SourceCandidate(url=args.url, source_type="explicit_official_url")]
    elif args.ex_date:
        candidates = list(adapter.discover_for_ex_date(args.ex_date))
    else:
        candidates = list(adapter.discover())
    seed_candidates = list(adapter.catalog_seed())
    if target_tickers:
        seed_candidates = [candidate for candidate in seed_candidates if target_tickers.intersection(candidate_tickers(candidate))]
    if database:
        for candidate in [*seed_candidates, *candidates]:
            for ticker in candidate_tickers(candidate):
                if target_tickers and ticker not in target_tickers:
                    continue
                database.upsert_provider_fund(
                    adapter.slug, ticker, candidate.url, candidate.source_type
                )
    report = {
        "provider": adapter.slug,
        "sources": [],
        "events": 0,
        "catalogTickers": sorted({
            ticker for candidate in seed_candidates for ticker in candidate_tickers(candidate)
            if not target_tickers or ticker in target_tickers
        }),
        "noData": [],
        "errors": [],
        "duplicates": [],
        "conflicts": [],
    }
    # Two official tables can repeat a row.  Keep the first immutable source
    # as the canonical event and surface exact duplicates or disagreements in
    # the run report; do not let a later table silently revise the ledger.
    seen_events: dict[tuple[str, str, str, str], tuple[dict[str, str | None], str]] = {}

    max_sources = args.max_sources if args.max_sources is not None else len(candidates)
    selected_candidates = candidates[:max_sources]

    def outcomes():
        yield from adapter.fetch_many(selected_candidates)
        if selected_candidates and args.provider == "roundhill" and target_tickers and args.declaration_date:
            collected = {key[1] for key in seen_events if key[2] == args.declaration_date.isoformat()}
            missing = sorted(target_tickers - collected)
            if missing:
                yield from adapter.fetch_many([adapter.issuer_candidate(ticker) for ticker in missing])

    for outcome in outcomes():
        candidate = outcome.candidate
        try:
            if outcome.error:
                report["errors"].append({
                    "url": candidate.url,
                    "error": str(outcome.error),
                    "code": outcome.error.code,
                    "retryable": outcome.error.retryable,
                    "fetchMode": adapter.fetch_mode,
                })
                continue
            assert outcome.document is not None
            document = outcome.document
            suffix = ".json" if document.source_type.endswith("_json") else ".txt" if document.metadata.get("browserContent") == "text" or adapter.browser_content == "text" else ".html"
            raw_path = args.raw_dir / adapter.slug / f"{document.content_sha256}{suffix}"
            if not args.dry_run:
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_bytes(document.content)
                document = replace(document, local_path=str(raw_path))
                source_id = database.add_source_document(document)
            else:
                source_id = None

            if candidate.metadata.get("catalogOnly") is True:
                catalog_candidates = adapter.parse_catalog(document)
                catalog_tickers: list[str] = []
                for catalog_candidate in catalog_candidates:
                    for ticker in candidate_tickers(catalog_candidate):
                        if target_tickers and ticker not in target_tickers:
                            continue
                        catalog_tickers.append(ticker)
                        if database:
                            database.upsert_provider_fund(
                                adapter.slug,
                                ticker,
                                catalog_candidate.url,
                                catalog_candidate.source_type,
                            )
                report["catalogTickers"] = sorted(set(
                    [*report["catalogTickers"], *catalog_tickers]
                ))
                report["sources"].append({
                    "url": candidate.url,
                    "sha256": document.content_sha256,
                    "events": 0,
                    "catalogTickers": len(set(catalog_tickers)),
                    "fetchMode": document.metadata.get("fetchMode", adapter.fetch_mode),
                })
                continue

            events = adapter.parse(document)
            if target_tickers:
                events = [event for event in events if event.ticker.upper() in target_tickers]
                if not events:
                    raise NoDataError(f"no official events matched tickers {','.join(sorted(target_tickers))}")
            if args.ex_date:
                events = [event for event in events if event.ex_date == args.ex_date.isoformat()]
                if not events:
                    raise NoDataError(f"no official events matched ex-date {args.ex_date.isoformat()}")
            if args.declaration_date:
                events = [event for event in events if event.declared_date == args.declaration_date.isoformat()]
                if not events:
                    raise NoDataError(f"no official events matched declaration date {args.declaration_date.isoformat()}")
                for event in events:
                    if not (
                        event.declared_date == args.declaration_date.isoformat()
                        and event.record_date and event.payable_date
                        and event.declared_date <= event.ex_date <= event.record_date <= event.payable_date
                    ):
                        raise ValueError("dated announcement has incomplete or inconsistent distribution dates")
            accepted_events = []
            for event in events:
                key = stable_event_key(event)
                snapshot = event_snapshot(event)
                previous = seen_events.get(key)
                if previous:
                    previous_snapshot, previous_url = previous
                    duplicate = {
                        "eventKey": ":".join(key),
                        "firstUrl": previous_url,
                        "duplicateUrl": document.source_url,
                    }
                    if previous_snapshot == snapshot:
                        report["duplicates"].append(duplicate)
                    else:
                        report["conflicts"].append({
                            **duplicate,
                            "first": previous_snapshot,
                            "duplicate": snapshot,
                        })
                    continue
                seen_events[key] = (snapshot, document.source_url)
                accepted_events.append(event)
            if not args.dry_run:
                for event in accepted_events:
                    database.upsert_distribution_event(event, source_id)
            report["sources"].append(
                {
                    "url": candidate.url,
                    "sha256": document.content_sha256,
                    "events": len(accepted_events),
                    "fetchMode": document.metadata.get("fetchMode", adapter.fetch_mode),
                }
            )
            report["events"] += len(accepted_events)
        except NoDataError as exc:
            report["noData"].append({"url": candidate.url, "message": str(exc)})
        except Exception as exc:
            report["errors"].append({"url": candidate.url, "error": str(exc)})

    if (report["errors"] or report["conflicts"]) and report["sources"]:
        report["status"] = "partial"
    elif report["errors"]:
        report["status"] = "failed"
    elif report["sources"]:
        report["status"] = "success"
    else:
        report["status"] = "no_change"
    if hasattr(adapter, "http_requests"):
        report["httpRequests"] = adapter.http_requests
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
