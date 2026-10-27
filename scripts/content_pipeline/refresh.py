"""Targeted Content Studio refresh entry point used by scheduled and UI jobs."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.export_dashboard import export_dashboard
from scripts.content_pipeline.export_system_logs import export_system_logs
from scripts.content_pipeline.providers import PROVIDERS
from scripts.content_pipeline.roundhill_schedule import parse_dates
from scripts.content_pipeline.record_collection_report import record_collection_report
from scripts.content_pipeline.reconcile_public_data import export_snapshot as export_reconciliation
from scripts.data_pipeline.register_history import register as register_history


def run_collect(provider: str, db: Path, raw_dir: Path, url: str | None = None,
                ex_date: date | None = None, ticker: str | None = None,
                declaration_date: date | None = None, tickers: list[str] | None = None,
                declaration_dates: list[date] | None = None) -> dict:
    command = [
        sys.executable,
        "scripts/content_pipeline/collect.py",
        "--provider",
        provider,
        "--db",
        str(db),
        "--raw-dir",
        str(raw_dir),
    ]
    if ticker:
        command.extend(["--ticker", ticker])
    if tickers:
        command.extend(["--tickers", ",".join(tickers)])
    if url:
        command.extend(["--url", url])
    if ex_date:
        command.extend(["--ex-date", ex_date.isoformat()])
    if declaration_date:
        command.extend(["--declaration-date", declaration_date.isoformat()])
    if declaration_dates:
        command.extend(["--declaration-dates", ",".join(day.isoformat() for day in declaration_dates)])
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"stdout": result.stdout[-1000:], "stderr": result.stderr[-1000:]}
    if payload.get("provider") == provider:
        record_collection_report(db, provider, payload)
    if result.returncode:
        raise RuntimeError(json.dumps(payload, ensure_ascii=False))
    return payload


def _ticker_target(database: ContentDatabase, ticker: str) -> tuple[str, str]:
    with database.connect() as connection:
        row = connection.execute(
            """
            SELECT provider_slug, official_url FROM (
                SELECT provider_slug, official_url, 0 AS priority, ex_date AS observed_at
                FROM distribution_events WHERE ticker = ?
                UNION ALL
                SELECT provider_slug, official_url, 1 AS priority, last_seen_at AS observed_at
                FROM provider_funds WHERE ticker = ? AND official_url IS NOT NULL
            )
            ORDER BY priority, observed_at DESC LIMIT 1
            """,
            (ticker, ticker),
        ).fetchone()
    if row is None or row["provider_slug"] not in PROVIDERS:
        raise ValueError("ticker is not present in the official distribution or catalog index")
    return str(row["provider_slug"]), str(row["official_url"])


def insights_targets(public_dir: Path, ticker: str | None = None,
                     provider: str | None = None, ex_date: date | None = None) -> list[str] | None:
    if ticker:
        return [ticker]
    if not provider and not ex_date:
        return None
    symbols = set()
    for path in public_dir.glob("distribution-ticker-*.json"):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for row in payload.get("history", []):
            if row.get("currency") != "USD" or (provider and row.get("provider_slug") != provider):
                continue
            if ex_date and row.get("ex_date") != ex_date.isoformat():
                continue
            if row.get("ticker"):
                symbols.add(str(row["ticker"]))
    return sorted(symbols)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh official Content Studio data")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--bundles", type=Path, default=Path("var/content-studio/generated"))
    parser.add_argument("--public-dir", type=Path, default=Path("public/content-studio"))
    parser.add_argument("--legacy-data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--scope", choices=("all", "provider", "ticker", "ex_date"), default="all")
    parser.add_argument("--provider", choices=sorted(PROVIDERS))
    parser.add_argument("--ticker")
    parser.add_argument("--tickers")
    parser.add_argument("--ex-date", type=date.fromisoformat)
    dated = parser.add_mutually_exclusive_group()
    dated.add_argument("--declaration-date", type=date.fromisoformat)
    dated.add_argument("--declaration-dates", type=parse_dates)
    parser.add_argument("--request-id")
    parser.add_argument("--week-ending", type=date.fromisoformat, default=date.today())
    parser.add_argument("--with-insights", action="store_true", help="ROC와 미국 주식·ETF 유용한 정보도 누적 수집")
    return parser


def main() -> int:
    parser = build_parser()
    parser.add_argument('--include-editorial', action='store_true', help='Also generate legacy blog bundles, editorial calendar and weekly scripts')
    args = parser.parse_args()
    database = ContentDatabase(args.db)
    database.initialize()
    selected_url = None
    ticker = args.ticker.strip().upper() if args.ticker else None
    tickers = sorted({value.strip().upper() for value in (args.tickers or "").split(",") if value.strip()})
    dated = bool(args.declaration_date or args.declaration_dates)
    if args.tickers and (args.scope != "provider" or args.provider not in {"roundhill", "yieldmax"} or ticker or not dated):
        parser.error("--tickers requires a supported provider, declaration date(s), provider scope and no --ticker")
    if dated and (
        args.provider not in {"roundhill", "yieldmax"} or args.ex_date
        or not ((args.scope == "ticker" and ticker in PROVIDERS[args.provider].tracked_symbols)
                or (args.scope == "provider" and tickers and all(value in PROVIDERS[args.provider].tracked_symbols for value in tickers)))
    ):
        parser.error("declaration dates require a supported provider and configured ticker target(s)")
    if args.scope == "ticker" and ticker:
        from scripts.content_pipeline.stock_collection import collect_stock, is_us_stock
        catalog = json.loads((Path(__file__).resolve().parents[2] / 'data-v2/catalog-seed.json').read_text())["instruments"]
        instrument = next((row for row in catalog if row["symbol"] == ticker), None)
        if instrument and is_us_stock(instrument):
            database.recover_interrupted_pipeline_runs()
            result = collect_stock(ticker, database, args.raw_dir, args.public_dir, args.request_id)
            export_dashboard(args.db, args.public_dir / "dashboard.json")
            export_system_logs(args.db, args.public_dir / "system-logs.json")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1 if result["status"] == "failed" else 0
    if args.scope == "provider":
        if not args.provider:
            parser.error("--scope provider requires --provider")
        providers = [args.provider]
    elif args.scope == "ticker":
        if not ticker:
            parser.error("--scope ticker requires --ticker")
        if dated:
            # Scheduled announcements must discover today's notice, rather than
            # replaying the dated URL stored with a previous distribution.
            provider = args.provider
        else:
            try:
                provider, selected_url = _ticker_target(database, ticker)
            except ValueError as exc:
                parser.error(str(exc))
        providers = [provider]
    elif args.scope == "ex_date":
        if not args.ex_date:
            parser.error("--scope ex_date requires --ex-date")
        providers = sorted(PROVIDERS)
    else:
        providers = sorted(PROVIDERS)

    recovered = database.recover_interrupted_pipeline_runs()
    before = database.summary()
    run_id = database.start_pipeline_run()
    report = {
        "runId": run_id,
        "requestId": args.request_id,
        "scope": args.scope,
        "provider": providers[0] if args.scope in {"provider", "ticker"} else None,
        "ticker": ticker,
        "tickers": tickers,
        "exDate": args.ex_date.isoformat() if args.ex_date else None,
        "declarationDate": args.declaration_date.isoformat() if args.declaration_date else None,
        "declarationDates": [day.isoformat() for day in args.declaration_dates or []],
        "recoveredInterruptedRuns": recovered,
        "providers": {},
    }
    failed = False
    warned = False
    try:
        for provider in providers:
            try:
                payload = run_collect(
                    provider, args.db, args.raw_dir, selected_url, args.ex_date, ticker,
                    args.declaration_date, tickers or None, **({"declaration_dates": args.declaration_dates} if args.declaration_dates else {}),
                )
                step_status = "warning" if payload.get("status") == "partial" else "success"
                warned = warned or step_status == "warning"
                database.add_pipeline_step(
                    run_id,
                    "collect",
                    step_status,
                    provider_slug=provider,
                    retryable=step_status == "warning",
                    message="some official sources failed" if step_status == "warning" else "",
                    details=payload,
                )
                report["providers"][provider] = payload
            except Exception as exc:
                failed = True
                message = str(exc)
                database.add_pipeline_step(
                    run_id,
                    "collect",
                    "failed",
                    provider_slug=provider,
                    retryable=True,
                    message=message,
                )
                report["providers"][provider] = {"error": message, "retryable": True}

        if args.include_editorial:
            from scripts.content_pipeline.content_calendar import export_calendar
            from scripts.content_pipeline.generate_content import generate_all_bundles
            from scripts.content_pipeline.weekly_digest import generate_weekly_digest

            bundles = generate_all_bundles(args.db, args.bundles, args.legacy_data_dir)
            database.add_pipeline_step(run_id, "generate-bundles", "success", details={"count": len(bundles)})
            export_calendar(
                args.bundles,
                Path("var/content-studio/content-calendar.json"),
                Path("var/content-studio/content-calendar.csv"),
            )
            database.add_pipeline_step(run_id, "calendar", "success")
            generate_weekly_digest(args.db, args.week_ending, Path("var/content-studio/weekly"))
            database.add_pipeline_step(run_id, "weekly", "success")
        history_report = register_history(args.legacy_data_dir, args.db)
        database.add_pipeline_step(run_id, "register-history", "success", details=history_report)
        export_all(args.db, args.bundles, args.public_dir)
        reconciliation = export_reconciliation(
            args.db,
            args.legacy_data_dir,
            args.public_dir / "reconciliation.json",
            # Announcement polling must not start unrelated ticker onboarding
            # (which can fetch other issuers while scanning the shared ledger).
            onboard_missing=not dated,
        )
        has_differences = bool(
            reconciliation["summary"].get("missing_date", 0)
            or reconciliation["summary"].get("amount_mismatch", 0)
        )
        database.add_pipeline_step(
            run_id,
            "reconcile-public-data",
            "warning" if has_differences else "success",
            message="manual approval required for legacy-data differences" if has_differences else "",
            details=reconciliation["summary"],
        )
        database.add_pipeline_step(run_id, "exports", "success")
        if args.with_insights:
            targets = insights_targets(args.public_dir, ticker, args.provider if args.scope == "provider" else None,
                                       args.ex_date if args.scope == "ex_date" else None)
            command = [sys.executable, "scripts/utils/collect_security_insights.py", "--resume",
                       "--content-dir", str(args.public_dir)]
            for target in targets or []:
                command.extend(["--symbol", target])
            result = subprocess.run(command, capture_output=True, text=True, check=False) if targets != [] else subprocess.CompletedProcess(command, 0, "No insight targets in selected scope", "")
            insight_status = "success" if result.returncode == 0 else "warning"
            warned = warned or insight_status == "warning"
            details = {"exitCode": result.returncode, "output": result.stdout[-2000:], "errors": result.stderr[-1000:]}
            report["securityInsights"] = details
            database.add_pipeline_step(run_id, "security-insights", insight_status,
                                       message="Inspect enrichment source failures" if result.returncode else "", details=details)
    except Exception as exc:
        failed = True
        database.add_pipeline_step(run_id, "pipeline", "failed", message=str(exc))
        report["fatalError"] = str(exc)

    after = database.summary()
    report["addedEvents"] = max(0, after["distribution_events"] - before["distribution_events"])
    report["addedSources"] = max(0, after["source_documents"] - before["source_documents"])
    if failed:
        report["outcome"] = "failed"
    elif warned:
        report["outcome"] = "partial"
    elif report["addedEvents"] == 0 and report["addedSources"] == 0:
        report["outcome"] = "no_change"
    else:
        report["outcome"] = "success"
    database.finish_pipeline_run(run_id, "failed" if failed else "warning" if warned else "success", report)
    export_dashboard(args.db, args.public_dir / "dashboard.json")
    export_system_logs(args.db, args.public_dir / "system-logs.json")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
