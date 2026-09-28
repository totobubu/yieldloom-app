"""Idempotent local operating pipeline for the Content Studio."""
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
from scripts.content_pipeline.export_price_snapshot import export_price_snapshot
from scripts.content_pipeline.generate_content import generate_all_bundles
from scripts.content_pipeline.reconcile_public_data import export_snapshot as export_reconciliation
from scripts.content_pipeline.weekly_digest import generate_weekly_digest
from scripts.content_pipeline.providers import PROVIDERS
from scripts.content_pipeline.record_collection_report import record_collection_report
from scripts.data_pipeline.register_history import register as register_history


def run_collect(provider: str, db: Path, raw_dir: Path) -> dict:
    command = [sys.executable, "scripts/content_pipeline/collect.py", "--provider", provider,
               "--db", str(db), "--raw-dir", str(raw_dir)]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    payload = {}
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"stdout": result.stdout[-2000:], "stderr": result.stderr[-2000:]}
    if payload.get("provider") == provider:
        record_collection_report(db, provider, payload)
    if result.returncode:
        raise RuntimeError(json.dumps(payload, ensure_ascii=False))
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the complete idempotent Content Studio pipeline")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--bundles", type=Path, default=Path("var/content-studio/generated"))
    parser.add_argument("--public-dir", type=Path, default=Path("public/content-studio"))
    parser.add_argument("--legacy-data-dir", type=Path, default=Path("public/data"),
                        help="read-only legacy dividend JSON location; reconciliation never writes it")
    parser.add_argument("--providers", nargs="*", choices=sorted(PROVIDERS), default=sorted(PROVIDERS))
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--week-ending", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()

    database = ContentDatabase(args.db)
    database.initialize()
    recovered = database.recover_interrupted_pipeline_runs()
    run_id = database.start_pipeline_run()
    report: dict = {"runId": run_id, "recoveredInterruptedRuns": recovered, "providers": {}, "steps": []}
    failed = False
    try:
        if not args.skip_collect:
            for provider in args.providers:
                try:
                    payload = run_collect(provider, args.db, args.raw_dir)
                    database.add_pipeline_step(run_id, "collect", "success", provider_slug=provider, details=payload)
                    report["providers"][provider] = payload
                except Exception as exc:
                    failed = True
                    message = str(exc)
                    database.add_pipeline_step(run_id, "collect", "failed", provider_slug=provider,
                                               retryable=True, message=message)
                    report["providers"][provider] = {"error": message, "retryable": True}
        else:
            database.add_pipeline_step(run_id, "collect", "skipped", message="--skip-collect")

        # Verified events only. Existing directory/event identifiers make this idempotent.
        bundles = generate_all_bundles(args.db, args.bundles, args.legacy_data_dir)
        database.add_pipeline_step(run_id, "generate-bundles", "success", details={"count": len(bundles)})
        export_calendar(args.bundles, Path("var/content-studio/content-calendar.json"), Path("var/content-studio/content-calendar.csv"))
        database.add_pipeline_step(run_id, "calendar", "success")
        generate_weekly_digest(args.db, args.week_ending, Path("var/content-studio/weekly"))
        database.add_pipeline_step(run_id, "weekly", "success")
        history_report = register_history(args.legacy_data_dir, args.db)
        database.add_pipeline_step(run_id, "register-history", "success", details=history_report)
        export_dashboard(args.db, args.public_dir / "dashboard.json")
        export_all(args.db, args.bundles, args.public_dir)
        price_coverage = export_price_snapshot(Path("public/nav.json"), args.public_dir / "distribution-index.json", Path("public"), args.public_dir / "price-index.json", args.public_dir / "price-quality.json")
        database.add_pipeline_step(run_id, "export-prices", "success", details=price_coverage)
        reconciliation = export_reconciliation(args.db, args.legacy_data_dir, args.public_dir / "reconciliation.json", onboard_missing=True)
        database.add_pipeline_step(run_id, "reconcile-public-data", "warning" if reconciliation["summary"].get("missing_date", 0) or reconciliation["summary"].get("amount_mismatch", 0) else "success",
                                   message="manual approval required for legacy-data differences",
                                   details=reconciliation["summary"])
        database.add_pipeline_step(run_id, "exports", "success")
    except Exception as exc:
        failed = True
        database.add_pipeline_step(run_id, "pipeline", "failed", retryable=False, message=str(exc))
        report["fatalError"] = str(exc)
    status = "failed" if failed else "success"
    database.finish_pipeline_run(run_id, status, report)
    print(json.dumps({"status": status, **report}, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
