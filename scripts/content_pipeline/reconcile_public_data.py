"""Compare official SQLite events with legacy ``public/data`` records.

This tool is intentionally review-gated: scanning only records a comparison;
it never writes a ticker JSON file.  A reviewer must explicitly select a
review id and action before a proposed patch can be applied.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH

TOLERANCE = Decimal("0.000001")
REVIEWABLE = {"missing_date", "amount_mismatch", "expected_only", "needs_review"}
AUDIT_CONFLICTS = {"amount_mismatch", "needs_review"}
AUDIT_PENDING = {"missing_date", "expected_only", "missing_data_file"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _ticker_files(data_dir: Path) -> dict[str, Path]:
    """Index by ticker filename; a duplicated filename is deliberately ignored."""
    candidates: dict[str, list[Path]] = {}
    for path in data_dir.glob("*/*.json"):
        candidates.setdefault(path.stem.upper(), []).append(path)
    return {ticker: paths[0] for ticker, paths in candidates.items() if len(paths) == 1}


def _legacy_file_audit(data_dir: Path, events: list[sqlite3.Row],
                       reviews: list[dict[str, Any]]) -> dict[str, Any]:
    """Inventory legacy files without treating an unreviewed history as verified."""
    paths_by_ticker: dict[str, list[Path]] = {}
    for path in data_dir.glob("*/*.json"):
        paths_by_ticker.setdefault(path.stem.upper(), []).append(path)

    event_counts: dict[str, int] = {}
    for event in events:
        ticker = event["ticker"].upper()
        event_counts[ticker] = event_counts.get(ticker, 0) + 1
    review_statuses: dict[str, list[str]] = {}
    for review in reviews:
        review_statuses.setdefault(review["ticker"].upper(), []).append(review["status"])

    rows: list[dict[str, Any]] = []
    summary: dict[str, int] = {}
    for ticker in sorted(set(paths_by_ticker) | set(event_counts)):
        paths = paths_by_ticker.get(ticker, [])
        statuses = review_statuses.get(ticker, [])
        row: dict[str, Any] = {
            "ticker": ticker,
            "path": paths[0].as_posix() if len(paths) == 1 else None,
            "fileCount": len(paths),
            "sha256": None,
            "rowCount": 0,
            "priceRowCount": 0,
            "actualRowCount": 0,
            "expectedRowCount": 0,
            "forecastRowCount": 0,
            "placeholderRowCount": 0,
            "malformedRowCount": 0,
            "duplicateDateCount": 0,
            "earliestDate": None,
            "latestDate": None,
            "officialEventCount": event_counts.get(ticker, 0),
            "matchedOfficialEventCount": sum(status in {"matched", "applied"} for status in statuses),
            "conflictCount": sum(status in AUDIT_CONFLICTS for status in statuses),
            "pendingComparisonCount": sum(status in AUDIT_PENDING for status in statuses),
        }
        if not paths:
            status = "missing_legacy_file"
        elif len(paths) > 1:
            status = "duplicate_ticker_files"
            row["paths"] = [path.as_posix() for path in paths]
        else:
            path = paths[0]
            row["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                history = payload.get("backtestData")
                if isinstance(history, dict) and not history:
                    status = "uninitialized_file"
                    row["status"] = status
                    summary[status] = summary.get(status, 0) + 1
                    rows.append(row)
                    continue
                if not isinstance(history, list):
                    raise ValueError("backtestData is not an array")
                row["rowCount"] = len(history)
                dates: list[str] = []
                for item in history:
                    if not isinstance(item, dict) or not isinstance(item.get("date"), str):
                        row["malformedRowCount"] += 1
                        continue
                    dates.append(item["date"])
                    if item.get("expected") is True:
                        row["expectedRowCount"] += 1
                    if item.get("forecasted") is True:
                        row["forecastRowCount"] += 1
                    has_distribution = (_decimal(item.get("amount")) is not None
                                        or _decimal(item.get("amountFixed")) is not None)
                    has_price = _decimal(item.get("close")) is not None
                    if has_price:
                        row["priceRowCount"] += 1
                    if has_distribution:
                        row["actualRowCount"] += 1
                    elif (item.get("expected") is not True
                          and item.get("forecasted") is not True
                          and not has_price):
                        row["placeholderRowCount"] += 1
                row["duplicateDateCount"] = len(dates) - len(set(dates))
                if dates:
                    row["earliestDate"], row["latestDate"] = min(dates), max(dates)
                if row["malformedRowCount"] or row["duplicateDateCount"]:
                    status = "invalid_rows"
                elif row["conflictCount"]:
                    status = "official_conflict"
                elif row["pendingComparisonCount"]:
                    status = "pending_official_comparison"
                elif row["matchedOfficialEventCount"]:
                    status = "partially_verified"
                elif row["officialEventCount"]:
                    status = "pending_official_comparison"
                else:
                    status = "no_official_coverage"
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
                status = "invalid_file"
                row["error"] = str(exc)
        row["status"] = status
        summary[status] = summary.get(status, 0) + 1
        rows.append(row)
    return {
        "summary": summary,
        "tickers": rows,
        "method": "A file is only partially_verified when at least one official event matches; this does not verify its full history.",
    }


def run_new_ticker_workflow(tickers: list[str]) -> dict[str, Any]:
    """Create absent legacy ticker JSON files through the established workflow."""
    command = [sys.executable, "scripts/workflows/run_new_ticker_workflow.py", *sorted(set(tickers))]
    result = subprocess.run(command, cwd=Path(__file__).resolve().parents[2], text=True, capture_output=True, check=False)
    return {
        "tickers": sorted(set(tickers)), "status": "success" if result.returncode == 0 else "failed",
        "retryable": True, "exitCode": result.returncode,
        "stdout": result.stdout[-2000:], "stderr": result.stderr[-2000:],
    }


def _status(event: sqlite3.Row, path: Path | None) -> tuple[str, dict[str, Any], dict[str, Any]]:
    official = _decimal(event["distribution_per_share"])
    proposal = {"date": event["ex_date"], "amount": float(official), "amountFixed": float(official), "expected": False}
    comparison: dict[str, Any] = {
        "officialAmount": str(official), "officialUrl": event["official_url"],
        "verificationStatus": event["verification_status"], "legacy": None,
    }
    if path is None:
        return "missing_data_file", comparison, proposal
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("backtestData", [])
    matches = [row for row in rows if str(row.get("date")) == event["ex_date"]]
    comparison["legacy"] = matches
    if not matches:
        return "missing_date", comparison, proposal
    row = matches[-1]
    if row.get("expected") is True and _decimal(row.get("amount")) is None and _decimal(row.get("amountFixed")) is None:
        return "expected_only", comparison, proposal
    amounts = {key: _decimal(row.get(key)) for key in ("amount", "amountFixed")}
    matching_fields = [key for key, value in amounts.items() if value is not None and abs(value - official) <= TOLERANCE]
    comparison["matchingFields"] = matching_fields
    if matching_fields and row.get("expected") is not True:
        return "matched", comparison, proposal
    if row.get("expected") is True:
        return "expected_only", comparison, proposal
    return "amount_mismatch", comparison, proposal


def scan(db_path: Path, data_dir: Path, *, onboard_missing: bool = True) -> dict[str, Any]:
    ContentDatabase(db_path).initialize()
    files = _ticker_files(data_dir)
    summary: dict[str, int] = {}
    onboarding: dict[str, Any] | None = None
    connection = sqlite3.connect(db_path)
    try:
        connection.row_factory = sqlite3.Row
        events = connection.execute("""
            SELECT id, ticker, ex_date, distribution_per_share, official_url, verification_status
            FROM distribution_events
            WHERE verification_status IN ('official', 'cross_checked', 'needs_review')
            ORDER BY ex_date DESC, ticker
        """).fetchall()
        missing_tickers = sorted({event["ticker"] for event in events
                                  if event["verification_status"] != "needs_review"
                                  and event["ticker"].upper() not in files})
        if missing_tickers and onboard_missing:
            onboarding = run_new_ticker_workflow(missing_tickers)
            files = _ticker_files(data_dir)
        for event in events:
            path = files.get(event["ticker"].upper())
            status, comparison, proposal = _status(event, path)
            if onboarding and event["ticker"] in onboarding["tickers"]:
                comparison["newTickerWorkflow"] = {
                    "status": onboarding["status"], "retryable": onboarding["retryable"],
                    "exitCode": onboarding["exitCode"],
                }
            # Collection findings still take precedence over a coincidental number match.
            if event["verification_status"] == "needs_review":
                status = "needs_review"
            stamp = now()
            connection.execute("""
                INSERT INTO public_data_reconciliation_reviews
                    (event_id, ticker, ex_date, data_path, status, comparison_json, proposed_patch_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(event_id) DO UPDATE SET
                    ticker=excluded.ticker, ex_date=excluded.ex_date, data_path=excluded.data_path,
                    status=CASE WHEN public_data_reconciliation_reviews.status IN ('approved','rejected','applied')
                                THEN public_data_reconciliation_reviews.status ELSE excluded.status END,
                    comparison_json=excluded.comparison_json, proposed_patch_json=excluded.proposed_patch_json,
                    updated_at=excluded.updated_at
            """, (event["id"], event["ticker"], event["ex_date"], str(path) if path else None, status,
                  _json(comparison), _json(proposal), stamp, stamp))
            summary[status] = summary.get(status, 0) + 1
        connection.commit()
        reviews = [dict(row) for row in connection.execute("""
            SELECT r.id, r.event_id, r.ticker, r.ex_date, r.data_path, r.status,
                   r.comparison_json, r.proposed_patch_json, r.reviewed_by, r.reviewed_at, r.applied_at, r.updated_at,
                   e.provider_slug, e.distribution_per_share, e.official_url
            FROM public_data_reconciliation_reviews r JOIN distribution_events e ON e.id=r.event_id
            ORDER BY r.ex_date DESC, r.ticker
        """)]
        legacy_audit = _legacy_file_audit(data_dir, events, reviews)
    finally:
        connection.close()
    return {"generatedAt": now(), "summary": summary, "reviews": reviews, "legacyAudit": legacy_audit,
            "newTickerWorkflow": onboarding,
            "manualApprovalRequired": sorted(REVIEWABLE), "writeMode": "approval-gated"}


def export_snapshot(db_path: Path, data_dir: Path, output: Path, *, onboard_missing: bool = True) -> dict[str, Any]:
    result = scan(db_path, data_dir, onboard_missing=onboard_missing)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return result


def apply_review(db_path: Path, review_id: int, reviewer: str, action: str) -> dict[str, Any]:
    if not reviewer.strip():
        raise ValueError("--reviewer is required for an approval")
    connection = sqlite3.connect(db_path)
    try:
        connection.row_factory = sqlite3.Row
        review = connection.execute("SELECT * FROM public_data_reconciliation_reviews WHERE id=?", (review_id,)).fetchone()
        if review is None:
            raise ValueError(f"review {review_id} not found")
        if review["status"] not in REVIEWABLE:
            raise ValueError(f"review {review_id} is {review['status']}; only unresolved differences can be applied")
        if not review["data_path"]:
            raise ValueError("no legacy ticker file exists; create the ticker file through the existing data onboarding workflow")
        path = Path(review["data_path"])
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("backtestData")
        if not isinstance(rows, list):
            raise ValueError("legacy ticker JSON has no backtestData array")
        proposal = json.loads(review["proposed_patch_json"])
        indices = [index for index, row in enumerate(rows) if str(row.get("date")) == review["ex_date"]]
        if action == "append":
            if indices:
                raise ValueError("a record already exists for this ex-date; use replace only after review")
            rows.append(proposal)
        elif action == "replace":
            if not indices:
                raise ValueError("no record exists for this ex-date; use append")
            rows[indices[-1]] = proposal
        else:
            raise ValueError("action must be append or replace")
        rows.sort(key=lambda row: str(row.get("date", "")))
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        after = hashlib.sha256(path.read_bytes()).hexdigest()
        stamp = now()
        comparison = json.loads(review["comparison_json"])
        comparison["approval"] = {"action": action, "beforeSha256": before, "afterSha256": after}
        connection.execute("""
            UPDATE public_data_reconciliation_reviews
            SET status='applied', reviewed_by=?, reviewed_at=?, applied_at=?, updated_at=?,
                comparison_json=?
            WHERE id=?
        """, (reviewer.strip(), stamp, stamp, stamp, _json(comparison), review_id))
        connection.commit()
    finally:
        connection.close()
    return {"reviewId": review_id, "status": "applied", "action": action, "path": str(path), "reviewer": reviewer.strip()}


def reject_review(db_path: Path, review_id: int, reviewer: str, reason: str) -> dict[str, Any]:
    """Reject one unresolved proposal without modifying the legacy ticker file."""
    if not reviewer.strip():
        raise ValueError("--reviewer is required for a rejection")
    if not reason.strip():
        raise ValueError("--reason is required for a rejection")
    connection = sqlite3.connect(db_path)
    try:
        connection.row_factory = sqlite3.Row
        review = connection.execute(
            "SELECT * FROM public_data_reconciliation_reviews WHERE id=?", (review_id,)
        ).fetchone()
        if review is None:
            raise ValueError(f"review {review_id} not found")
        if review["status"] not in REVIEWABLE:
            raise ValueError(
                f"review {review_id} is {review['status']}; only unresolved differences can be rejected"
            )
        comparison = json.loads(review["comparison_json"])
        stamp = now()
        comparison["rejection"] = {
            "reason": reason.strip(),
            "reviewer": reviewer.strip(),
            "reviewedAt": stamp,
        }
        connection.execute(
            """
            UPDATE public_data_reconciliation_reviews
            SET status='rejected', reviewed_by=?, reviewed_at=?, updated_at=?,
                comparison_json=?
            WHERE id=?
            """,
            (reviewer.strip(), stamp, stamp, _json(comparison), review_id),
        )
        connection.commit()
    finally:
        connection.close()
    return {
        "reviewId": review_id,
        "status": "rejected",
        "reviewer": reviewer.strip(),
        "reason": reason.strip(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile official Content Studio events with public/data ticker JSON")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--output", type=Path, default=Path("public/content-studio/reconciliation.json"))
    parser.add_argument("--apply-review", type=int)
    parser.add_argument("--reject-review", type=int)
    parser.add_argument("--reviewer")
    parser.add_argument("--action", choices=("append", "replace"))
    parser.add_argument("--reason")
    parser.add_argument("--skip-onboard-missing", action="store_true",
                        help="do not run the established new-ticker workflow for absent official ticker JSON files")
    args = parser.parse_args()
    if args.apply_review is not None and args.reject_review is not None:
        parser.error("select either --apply-review or --reject-review")
    if args.reject_review is not None:
        if not args.reviewer or not args.reason:
            parser.error("--reject-review requires --reviewer and --reason")
        print(json.dumps(
            reject_review(args.db, args.reject_review, args.reviewer, args.reason),
            ensure_ascii=False,
            indent=2,
        ))
        export_snapshot(args.db, args.data_dir, args.output, onboard_missing=not args.skip_onboard_missing)
        return 0
    if args.apply_review is not None:
        if not args.reviewer or not args.action:
            parser.error("--apply-review requires --reviewer and --action")
        print(json.dumps(apply_review(args.db, args.apply_review, args.reviewer, args.action), ensure_ascii=False, indent=2))
        export_snapshot(args.db, args.data_dir, args.output, onboard_missing=not args.skip_onboard_missing)
        return 0
    print(json.dumps(export_snapshot(args.db, args.data_dir, args.output, onboard_missing=not args.skip_onboard_missing), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
