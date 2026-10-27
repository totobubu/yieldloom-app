"""Observe Roundhill ticker announcements using the existing official ledger pipeline."""
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
from scripts.content_pipeline.providers.roundhill import ANNOUNCEMENT_GROUPS


ANNOUNCEMENT_WEEKDAYS = {ticker: weekday for weekday, tickers in ANNOUNCEMENT_GROUPS.values() for ticker in tickers}


def announcement_date(now: datetime, ticker: str = "TOPW") -> date:
    """Recovery runs target the most recent scheduled announcement day in Seoul."""
    local_date = now.astimezone(ZoneInfo("Asia/Seoul")).date()
    return local_date - timedelta(days=(local_date.weekday() - ANNOUNCEMENT_WEEKDAYS[ticker]) % 7)


def announcement_dates(declared: date, ticker: str) -> list[date]:
    # MAGY's email evidence includes Wednesday declarations. Recover only the
    # immediately preceding day, keeping earlier weeks outside this observation.
    if ticker == "MAGY" and declared.weekday() == ANNOUNCEMENT_WEEKDAYS[ticker]:
        return [declared, declared - timedelta(days=1)]
    return [declared]


def announcement_collected(database: ContentDatabase, declared: date,
                           public_dir: Path | None = None, ticker: str = "TOPW", *,
                           provider: str = "roundhill") -> bool:
    with database.connect() as connection:
        row = connection.execute(
            """
            SELECT provider_slug, ticker, declared_date, distribution_per_share,
                   currency, ex_date, record_date, payable_date, verification_status
            FROM distribution_events
            WHERE provider_slug = ? AND ticker = ?
              AND declared_date = ? AND currency = 'USD'
              AND verification_status IN ('official', 'cross_checked')
              AND CAST(distribution_per_share AS REAL) > 0
              AND declared_date <= ex_date AND ex_date <= record_date
              AND record_date <= payable_date
            LIMIT 1
            """,
            (provider, ticker, declared.isoformat()),
        ).fetchone()
    if row is None:
        return False
    if public_dir is None:
        return True
    try:
        payload = json.loads((public_dir / f"distribution-ticker-{ticker.lower()}.json").read_text(encoding="utf-8"))
        return any(all(event.get(key) == value for key, value in dict(row).items())
                   for event in payload["history"])
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def observe(database: ContentDatabase, declared: date, *, raw_dir: Path,
            public_dir: Path, legacy_data_dir: Path, require_announcement: bool = False,
            ticker: str = "TOPW") -> tuple[dict, int]:
    if ticker not in ANNOUNCEMENT_WEEKDAYS:
        raise ValueError(f"unsupported observation ticker: {ticker}")
    database.initialize()
    report = {"ticker": ticker, "declarationDate": declared.isoformat(), "attempted": False}
    dates = announcement_dates(declared, ticker)
    for candidate_date in dates:
        if announcement_collected(database, candidate_date, public_dir, ticker):
            return {**report, "status": "already_collected", "matchedDeclarationDate": candidate_date.isoformat()}, 0

    report["observations"] = []
    # Ordinary polls fetch one notice. Only final recovery expands to Wednesday.
    query_dates = dates if require_announcement else dates[:1]
    for candidate_date in query_dates:
        command = [
            sys.executable, "scripts/content_pipeline/refresh.py",
            "--scope", "ticker", "--provider", "roundhill", "--ticker", ticker,
            "--declaration-date", candidate_date.isoformat(), "--db", str(database.path),
            "--raw-dir", str(raw_dir), "--public-dir", str(public_dir),
            "--legacy-data-dir", str(legacy_data_dir),
        ]
        report["attempted"] = True
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        try:
            report["refresh"] = json.loads(result.stdout)
        except json.JSONDecodeError:
            report["refresh"] = {"stdout": result.stdout[-2000:], "stderr": result.stderr[-2000:]}
        report["observations"].append({
            "declarationDate": candidate_date.isoformat(), "refresh": report["refresh"],
        })
        if result.returncode:
            return {**report, "status": "failed", "exitCode": result.returncode}, 1
        if announcement_collected(database, candidate_date, public_dir, ticker):
            return {**report, "status": "collected", "matchedDeclarationDate": candidate_date.isoformat()}, 0
        if announcement_collected(database, candidate_date, ticker=ticker):
            return {**report, "status": "failed", "error": "collected announcement is missing from the public snapshot"}, 1
    # A successful HTTP response / no_change result is not a new announcement.
    return {**report, "status": "missing" if require_announcement else "pending"}, int(require_announcement)


def observe_group(database: ContentDatabase, declared: date, *, group: str, raw_dir: Path,
                  public_dir: Path, legacy_data_dir: Path, require_announcement: bool = False) -> tuple[dict, int]:
    weekday, targets = ANNOUNCEMENT_GROUPS[group]
    dates = [declared]
    if group != "topw" and declared.weekday() == weekday:
        dates.append(declared - timedelta(days=1))
    database.initialize()

    def completed():
        return {ticker: candidate.isoformat() for ticker in targets for candidate in dates
                if announcement_collected(database, candidate, public_dir, ticker)}

    initial = completed()
    report = {"group": group, "tickers": list(targets), "declarationDate": declared.isoformat(),
              "attempted": False, "publish": False, "observations": []}

    def result(status, code):
        found = completed()
        return {**report, "status": status, "publish": bool(set(found) - set(initial)),
                "matchedDeclarationDates": found, "completedTickers": list(found),
                "missingTickers": [ticker for ticker in targets if ticker not in found]}, code

    if len(initial) == len(targets):
        return result("already_collected", 0)
    query_dates = dates if require_announcement else dates[:1]
    for candidate in query_dates:
        found = completed()
        missing = [ticker for ticker in targets if ticker not in found]
        command = [sys.executable, "scripts/content_pipeline/refresh.py", "--scope", "provider",
                   "--provider", "roundhill", "--tickers", ",".join(missing),
                   "--declaration-date", candidate.isoformat(), "--db", str(database.path),
                   "--raw-dir", str(raw_dir), "--public-dir", str(public_dir),
                   "--legacy-data-dir", str(legacy_data_dir)]
        report["attempted"] = True
        refresh = subprocess.run(command, capture_output=True, text=True, check=False)
        try:
            payload = json.loads(refresh.stdout)
        except json.JSONDecodeError:
            payload = {"stdout": refresh.stdout[-2000:], "stderr": refresh.stderr[-2000:]}
        report["observations"].append({"declarationDate": candidate.isoformat(), "tickers": missing, "refresh": payload})
        if refresh.returncode:
            return result("failed", 1)
        if len(completed()) == len(targets):
            return result("collected", 0)
    return result("missing" if require_announcement else "pending", int(require_announcement))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--ticker", choices=sorted(ANNOUNCEMENT_WEEKDAYS))
    target.add_argument("--group", choices=sorted(ANNOUNCEMENT_GROUPS))
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--public-dir", type=Path, default=Path("public/content-studio"))
    parser.add_argument("--legacy-data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--declaration-date", type=date.fromisoformat)
    parser.add_argument("--require-announcement", action="store_true")
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    now = datetime.now(ZoneInfo("Asia/Seoul"))
    ticker = args.ticker or (ANNOUNCEMENT_GROUPS[args.group][1][0] if args.group else "TOPW")
    weekday = ANNOUNCEMENT_WEEKDAYS[ticker]
    declared = args.declaration_date or announcement_date(now, ticker)
    allowed_weekdays = {weekday}
    if ticker != "TOPW":
        allowed_weekdays.add((weekday - 1) % 7)
    if declared.weekday() not in allowed_weekdays or declared > now.date():
        parser.error("declaration date must match the ticker's announcement weekday and be on or before today in Asia/Seoul")
    options = {"raw_dir": args.raw_dir, "public_dir": args.public_dir,
               "legacy_data_dir": args.legacy_data_dir, "require_announcement": args.require_announcement}
    if args.group:
        report, code = observe_group(ContentDatabase(args.db), declared, group=args.group, **options)
    else:
        report, code = observe(ContentDatabase(args.db), declared, ticker=ticker, **options)
    report_path = args.report or Path(f"var/content-studio/{args.group or ticker.lower()}-observation.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as handle:
            handle.write(f"attempted={str(report['attempted']).lower()}\nstatus={report['status']}\n")
            handle.write(f"publish={str(report.get('publish', report['status'] == 'collected')).lower()}\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
