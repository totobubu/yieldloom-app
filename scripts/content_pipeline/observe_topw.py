"""Observe TOPW's Monday announcement using the existing official ledger pipeline."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH


def announcement_date(now: datetime) -> date:
    """Tuesday's recovery run still targets the preceding Monday, in Seoul time."""
    local_date = now.astimezone(ZoneInfo("Asia/Seoul")).date()
    return local_date - timedelta(days=local_date.weekday())


def announcement_collected(database: ContentDatabase, declared: date,
                           public_dir: Path | None = None) -> bool:
    with database.connect() as connection:
        row = connection.execute(
            """
            SELECT provider_slug, ticker, declared_date, distribution_per_share,
                   currency, ex_date, record_date, payable_date, verification_status
            FROM distribution_events
            WHERE provider_slug = 'roundhill' AND ticker = 'TOPW'
              AND declared_date = ? AND currency = 'USD'
              AND verification_status IN ('official', 'cross_checked')
              AND CAST(distribution_per_share AS REAL) > 0
              AND declared_date <= ex_date AND ex_date <= record_date
              AND record_date <= payable_date
            LIMIT 1
            """,
            (declared.isoformat(),),
        ).fetchone()
    if row is None:
        return False
    if public_dir is None:
        return True
    try:
        payload = json.loads((public_dir / "distribution-ticker-topw.json").read_text(encoding="utf-8"))
        return any(all(event.get(key) == value for key, value in dict(row).items())
                   for event in payload["history"])
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def observe(database: ContentDatabase, declared: date, *, raw_dir: Path,
            public_dir: Path, legacy_data_dir: Path, require_announcement: bool = False) -> tuple[dict, int]:
    database.initialize()
    report = {"ticker": "TOPW", "declarationDate": declared.isoformat(), "attempted": False}
    if announcement_collected(database, declared, public_dir):
        return {**report, "status": "already_collected"}, 0

    command = [
        sys.executable, "scripts/content_pipeline/refresh.py",
        "--scope", "ticker", "--provider", "roundhill", "--ticker", "TOPW",
        "--declaration-date", declared.isoformat(), "--db", str(database.path),
        "--raw-dir", str(raw_dir), "--public-dir", str(public_dir),
        "--legacy-data-dir", str(legacy_data_dir),
    ]
    report["attempted"] = True
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    try:
        report["refresh"] = json.loads(result.stdout)
    except json.JSONDecodeError:
        report["refresh"] = {"stdout": result.stdout[-2000:], "stderr": result.stderr[-2000:]}
    if result.returncode:
        return {**report, "status": "failed", "exitCode": result.returncode}, 1
    if announcement_collected(database, declared, public_dir):
        return {**report, "status": "collected"}, 0
    if announcement_collected(database, declared):
        return {**report, "status": "failed", "error": "collected announcement is missing from the public snapshot"}, 1
    # A successful HTTP response / no_change result is not a new announcement.
    return {**report, "status": "missing" if require_announcement else "pending"}, int(require_announcement)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--public-dir", type=Path, default=Path("public/content-studio"))
    parser.add_argument("--legacy-data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--declaration-date", type=date.fromisoformat)
    parser.add_argument("--require-announcement", action="store_true")
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--report", type=Path, default=Path("var/content-studio/topw-observation.json"))
    args = parser.parse_args()
    now = datetime.now(ZoneInfo("Asia/Seoul"))
    declared = args.declaration_date or announcement_date(now)
    if declared.weekday() != 0 or declared > now.date():
        parser.error("declaration date must be a Monday on or before today in Asia/Seoul")
    report, code = observe(
        ContentDatabase(args.db), declared, raw_dir=args.raw_dir,
        public_dir=args.public_dir, legacy_data_dir=args.legacy_data_dir,
        require_announcement=args.require_announcement,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as handle:
            handle.write(f"attempted={str(report['attempted']).lower()}\nstatus={report['status']}\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
