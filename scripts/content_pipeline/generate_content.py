from __future__ import annotations

import argparse
import json
import sqlite3
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.content_templates import (
    ContentEvent,
    MonthlyDistribution,
    blog_cover_html,
    naver_markdown,
    social_square_html,
    toss_text,
)
from scripts.content_pipeline.database import DEFAULT_DB_PATH
from scripts.content_pipeline.models import utc_now_iso


ELIGIBLE_STATUSES = ("official", "cross_checked")


@lru_cache(maxsize=512)
def legacy_previous_distribution(ticker: str, ex_date: str, data_dir: str) -> str | None:
    """Read the latest actual legacy dividend before an event, without mutating it."""
    root = Path(data_dir)
    matches = list(root.glob(f"*/{ticker.lower()}.json"))
    if len(matches) != 1:
        return None
    try:
        rows = json.loads(matches[0].read_text(encoding="utf-8")).get("backtestData", [])
    except (OSError, json.JSONDecodeError):
        return None
    candidates: list[tuple[str, Decimal]] = []
    for row in rows:
        date = str(row.get("date", ""))
        if date >= ex_date or row.get("expected") is True:
            continue
        value = row.get("amountFixed")
        if value is None:
            value = row.get("amount")
        try:
            amount = Decimal(str(value))
        except (InvalidOperation, ValueError):
            continue
        if amount > 0:
            candidates.append((date, amount))
    if not candidates:
        return None
    return format(max(candidates, key=lambda item: item[0])[1], "f")


@lru_cache(maxsize=512)
def legacy_monthly_distributions(ticker: str, ex_date: str, current_amount: str,
                                 data_dir: str) -> tuple[MonthlyDistribution, ...]:
    """Build a four-month weekly payout table from actual legacy records."""
    root = Path(data_dir)
    matches = list(root.glob(f"*/{ticker.lower()}.json"))
    if len(matches) != 1:
        return ()
    try:
        rows = json.loads(matches[0].read_text(encoding="utf-8")).get("backtestData", [])
    except (OSError, json.JSONDecodeError):
        return ()
    payouts: dict[str, Decimal] = {}
    for row in rows:
        date = str(row.get("date", ""))
        if len(date) != 10 or date > ex_date or row.get("expected") is True:
            continue
        value = row.get("amountFixed")
        if value is None:
            value = row.get("amount")
        try:
            amount = Decimal(str(value))
        except (InvalidOperation, ValueError):
            continue
        if amount > 0:
            payouts[date] = amount
    # The collected official amount wins over an old local projection for its ex-date.
    payouts[ex_date] = Decimal(current_amount)
    grouped: dict[str, list[tuple[str, Decimal]]] = {}
    for date, amount in payouts.items():
        grouped.setdefault(date[:7], []).append((date, amount))
    latest_months = sorted(grouped, reverse=True)[:4]
    # A monthly/quarterly payer must not get a misleading weekly comparison table.
    if not latest_months or max(len(grouped[month]) for month in latest_months) < 2:
        return ()
    return tuple(
        MonthlyDistribution(
            month=f"{month[2:4]}.{month[5:7]}",
            total=format(sum(amount for _, amount in sorted(grouped[month])), "f"),
            amounts=tuple(format(amount, "f") for _, amount in sorted(grouped[month])),
        )
        for month in latest_months
    )


def load_event(database_path: Path, event_id: int | None, allow_review: bool,
               legacy_data_dir: Path = Path("public/data")) -> ContentEvent:
    statuses = (*ELIGIBLE_STATUSES, "needs_review") if allow_review else ELIGIBLE_STATUSES
    placeholders = ",".join("?" for _ in statuses)
    id_filter = "AND e.id = ?" if event_id is not None else ""
    parameters: list[object] = [*statuses]
    if event_id is not None:
        parameters.append(event_id)
    query = f"""
        SELECT e.*,
            (
                SELECT previous.distribution_per_share
                FROM distribution_events previous
                WHERE previous.ticker = e.ticker
                  AND previous.ex_date < e.ex_date
                  AND previous.verification_status IN ('official', 'cross_checked')
                ORDER BY previous.ex_date DESC
                LIMIT 1
            ) AS previous_distribution
        FROM distribution_events e
        WHERE e.verification_status IN ({placeholders}) {id_filter}
        ORDER BY e.declared_date DESC, e.id DESC
        LIMIT 1
    """
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(query, parameters).fetchone()
    finally:
        connection.close()
    if row is None:
        qualifier = f"event {event_id}" if event_id is not None else "an eligible event"
        raise SystemExit(f"Could not find {qualifier}; only verified events are generated by default.")
    previous_distribution = row["previous_distribution"]
    previous_source = "sqlite" if previous_distribution else None
    if not previous_distribution:
        previous_distribution = legacy_previous_distribution(row["ticker"], row["ex_date"], str(legacy_data_dir))
        previous_source = "public-data" if previous_distribution else None
    monthly_distributions = legacy_monthly_distributions(
        row["ticker"], row["ex_date"], row["distribution_per_share"], str(legacy_data_dir)
    )
    return ContentEvent(
        id=int(row["id"]),
        provider_slug=row["provider_slug"],
        ticker=row["ticker"],
        fund_name=row["fund_name"],
        distribution_per_share=row["distribution_per_share"],
        currency=row["currency"],
        declared_date=row["declared_date"],
        ex_date=row["ex_date"],
        payable_date=row["payable_date"],
        official_url=row["official_url"],
        verification_status=row["verification_status"],
        previous_distribution=previous_distribution,
        previous_distribution_source=previous_source,
        monthly_distributions=monthly_distributions,
    )


def generate_bundle(event: ContentEvent, output_root: Path, *, bundle_dir: Path | None = None) -> Path:
    bundle_dir = bundle_dir or output_root / f"{event.declared_date}-{event.ticker.lower()}-{event.id}"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "toss.txt": toss_text(event),
        "naver-blog.md": naver_markdown(event),
        "social-square.html": social_square_html(event),
        "blog-cover.html": blog_cover_html(event),
    }
    for name, content in files.items():
        (bundle_dir / name).write_text(content, encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "generatedAt": utc_now_iso(),
        "eventId": event.id,
        "provider": event.provider_slug,
        "ticker": event.ticker,
        "title": f"{event.ticker} 배당 발표: 주당 ${event.amount_display}",
        "declaredDate": event.declared_date,
        "exDate": event.ex_date,
        "payableDate": event.payable_date,
        "distributionPerShare": event.distribution_per_share,
        "currency": event.currency,
        "changeLabel": event.change_label,
        "previousDistribution": event.previous_distribution,
        "previousDistributionSource": event.previous_distribution_source,
        "monthlyDistributions": [
            {"month": item.month, "total": item.total, "amounts": list(item.amounts)}
            for item in event.monthly_distributions
        ],
        "verificationStatus": event.verification_status,
        "officialUrl": event.official_url,
        "files": {
            **{name: name for name in files},
            "social-square.png": "social-square.png",
            "blog-cover.png": "blog-cover.png",
        },
    }
    (bundle_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return bundle_dir


def generate_all_bundles(database_path: Path, output_root: Path,
                         legacy_data_dir: Path = Path("public/data")) -> list[Path]:
    """Generate once per verified ledger event; directory naming is the idempotency key."""
    connection = sqlite3.connect(database_path)
    try:
        event_ids = [row[0] for row in connection.execute(
            "SELECT id FROM distribution_events WHERE verification_status IN ('official', 'cross_checked') ORDER BY id"
        )]
    finally:
        connection.close()
    return [generate_bundle(load_event(database_path, event_id, False, legacy_data_dir), output_root) for event_id in event_ids]


def refresh_existing_bundles(database_path: Path, output_root: Path,
                             legacy_data_dir: Path = Path("public/data")) -> list[Path]:
    """Regenerate existing directories by stable declared-date/ticker identity.

    SQLite row IDs are runtime details and must not be used to reopen an older
    bundle after a database rebuild.
    """
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    refreshed: list[Path] = []
    for manifest_path in output_root.glob("*/manifest.json"):
        name = manifest_path.parent.name
        try:
            declared_date, remainder = name[:10], name[11:]
            ticker = remainder.rsplit("-", 1)[0].upper()
            row = connection.execute("""
                SELECT id FROM distribution_events
                WHERE ticker=? AND declared_date=? AND verification_status IN ('official', 'cross_checked')
                ORDER BY id DESC LIMIT 1
            """, (ticker, declared_date)).fetchone()
            if row is None:
                continue
            event = load_event(database_path, int(row["id"]), False, legacy_data_dir)
            refreshed.append(generate_bundle(event, output_root, bundle_dir=manifest_path.parent))
        except (OSError, ValueError, IndexError, sqlite3.Error):
            continue
    connection.close()
    return refreshed


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a verified distribution content bundle")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--event-id", type=int)
    parser.add_argument("--allow-review", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("var/content-studio/generated"))
    parser.add_argument("--legacy-data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--refresh-existing", action="store_true",
                        help="regenerate existing bundle directories only")
    args = parser.parse_args()
    if args.refresh_existing:
        refreshed = refresh_existing_bundles(args.db, args.output, args.legacy_data_dir)
        print(json.dumps({"refreshed": len(refreshed)}, ensure_ascii=False))
        return 0
    event = load_event(args.db, args.event_id, args.allow_review, args.legacy_data_dir)
    bundle = generate_bundle(event, args.output)
    print(bundle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
