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

from scripts.content_pipeline.content_calendar import export_calendar
from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.export_dashboard import export_dashboard
from scripts.content_pipeline.export_system_logs import export_system_logs
from scripts.content_pipeline.generate_content import generate_all_bundles
from scripts.content_pipeline.providers import PROVIDERS
from scripts.content_pipeline.reconcile_public_data import export_snapshot as export_reconciliation
from scripts.content_pipeline.weekly_digest import generate_weekly_digest
from scripts.data_pipeline.register_history import register as register_history


def run_collect(provider: str, db: Path, raw_dir: Path, url: str | None = None) -> dict:
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
    if url:
        command.extend(["--url", url])
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"stdout": result.stdout[-1000:], "stderr": result.stderr[-1000:]}
    if result.returncode:
        raise RuntimeError(json.dumps(payload, ensure_ascii=False))
    return payload


def _ticker_target(database: ContentDatabase, ticker: str) -> tuple[str, str]:
    with database.connect() as connection:
        row = connection.execute(
            """SELECT provider_slug, official_url FROM distribution_events
               WHERE ticker = ? ORDER BY ex_date DESC, id DESC LIMIT 1""",
            (ticker,),
        ).fetchone()
    if row is None or row["provider_slug"] not in PROVIDERS:
        raise ValueError("ticker is not present in the official distribution index")
    return str(row["provider_slug"]), str(row["official_url"])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh official Content Studio data")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--bundles", type=Path, default=Path("var/content-studio/generated"))
    parser.add_argument("--public-dir", type=Path, default=Path("public/content-studio"))
    parser.add_argument("--legacy-data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--scope", choices=("all", "provider", "ticker"), default="all")
    parser.add_argument("--provider", choices=sorted(PROVIDERS))
    parser.add_argument("--ticker")
    parser.add_argument("--request-id")
    parser.add_argument("--week-ending", type=date.fromisoformat, default=date.today())
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    database = ContentDatabase(args.db)
    database.initialize()
    selected_url = None
    ticker = args.ticker.strip().upper() if args.ticker else None
    if args.scope == "provider":
        if not args.provider:
            parser.error("--scope provider requires --provider")
        providers = [args.provider]
    elif args.scope == "ticker":
        if not ticker:
            parser.error("--scope ticker requires --ticker")
        try:
            provider, selected_url = _ticker_target(database, ticker)
        except ValueError as exc:
            parser.error(str(exc))
        providers = [provider]
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
        "recoveredInterruptedRuns": recovered,
        "providers": {},
    }
    failed = False
    warned = False
    try:
        for provider in providers:
            try:
                payload = run_collect(provider, args.db, args.raw_dir, selected_url)
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
            onboard_missing=True,
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
