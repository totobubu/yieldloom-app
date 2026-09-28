"""Static admin-view exports. SQLite remains the source of truth for numbers."""
from __future__ import annotations

import json
import re
import sqlite3
import shutil
from decimal import Decimal
from pathlib import Path


DISTRIBUTION_PAGE_SIZE = 200
PUBLIC_RENDER_EX_DATE_RETENTION = 3


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def _ticker_file_stem(ticker: str) -> str:
    return re.sub(r"[^a-z0-9._-]", "_", ticker.lower())


def export_all(db: Path, bundles: Path, output: Path, *, legacy_exports: bool = False) -> None:
    connection = sqlite3.connect(db)
    connection.row_factory = sqlite3.Row
    try:
        events = [dict(row) for row in connection.execute("""
            SELECT e.*,
            (SELECT o.source_class FROM distribution_observations o
             WHERE o.canonical_event_id=e.id ORDER BY o.id DESC LIMIT 1) AS source_class,
            (SELECT o.source_provider FROM distribution_observations o
             WHERE o.canonical_event_id=e.id ORDER BY o.id DESC LIMIT 1) AS source_provider,
            (SELECT o.precision_digits FROM distribution_observations o
             WHERE o.canonical_event_id=e.id ORDER BY o.id DESC LIMIT 1) AS precision_digits,
            LAG(distribution_per_share) OVER (PARTITION BY ticker ORDER BY ex_date) AS previous_amount,
            AVG(CAST(distribution_per_share AS REAL)) OVER (PARTITION BY ticker ORDER BY ex_date ROWS BETWEEN 3 PRECEDING AND CURRENT ROW) AS average4,
            AVG(CAST(distribution_per_share AS REAL)) OVER (PARTITION BY ticker ORDER BY ex_date ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) AS average12
            FROM distribution_events e ORDER BY declared_date DESC, id DESC""")]
        providers = [dict(row) for row in connection.execute("""
            SELECT p.slug, p.display_name, p.parser_version, MAX(s.fetched_at) last_success,
            (SELECT prs.status FROM pipeline_run_steps prs WHERE prs.provider_slug=p.slug ORDER BY prs.id DESC LIMIT 1) last_status,
            (SELECT prs.message FROM pipeline_run_steps prs WHERE prs.provider_slug=p.slug ORDER BY prs.id DESC LIMIT 1) last_message
            FROM providers p LEFT JOIN source_documents s ON s.provider_slug=p.slug GROUP BY p.slug ORDER BY p.display_name""")]
        performance = [dict(row) for row in connection.execute("SELECT * FROM content_performance ORDER BY published_at DESC")]
        fallback_observations = [dict(row) for row in connection.execute("""
            SELECT id, ticker, ex_date, amount_raw, amount_normalized, currency,
                   declared_date, record_date, payable_date, source_class,
                   source_provider, source_url, content_sha256, precision_digits,
                   verification_status, observed_at
            FROM distribution_observations
            WHERE canonical_event_id IS NULL
            ORDER BY observed_at DESC, id DESC
            LIMIT 200
        """)]
        boundaries: dict[str, set[str]] = {}
        for row in connection.execute('''
            SELECT h.symbol, a.effective_date FROM corporate_action_observations a
            JOIN history_sources h ON h.listing_key=a.listing_key
            UNION SELECT h.symbol, f.effective_date FROM frequency_regime_observations f
            JOIN history_sources h ON h.listing_key=f.listing_key'''):
            boundaries.setdefault(row['symbol'], set()).add(row['effective_date'])
    finally:
        connection.close()
    # Raw provenance remains in SQLite. Public screens need only these fields.
    public_fields = {'id', 'provider_slug', 'ticker', 'distribution_per_share', 'currency',
                     'declared_date', 'ex_date', 'record_date', 'payable_date', 'frequency',
                     'roc_percent', 'official_url', 'verification_status',
                     'source_class', 'source_provider', 'precision_digits',
                     'previous_amount', 'average4', 'average12'}
    events = [{key: value for key, value in event.items() if key in public_fields} for event in events]
    # A change across different share bases or payout cadences is not growth.
    comparable: dict[str, list[dict]] = {}
    for event in sorted(events, key=lambda e: (e['ex_date'], e['id'])):
        history = comparable.setdefault(event['ticker'], [])
        event['comparisonBasis'] = 'provider_published'
        if history:
            previous = history[-1]
            changed = (previous.get('frequency') != event.get('frequency') or
                       any(previous['ex_date'] < d <= event['ex_date'] for d in boundaries.get(event['ticker'], set())))
            if changed:
                history.clear()
                event['comparisonBasis'] = 'corporate_action_or_frequency_change'
        event['previous_amount'] = history[-1]['distribution_per_share'] if history else None
        history.append(event)
        for window in (4, 12):
            sample = history[-window:]
            # Round only derived display metrics, never original distributions.
            event[f'average{window}'] = float(sum(Decimal(e['distribution_per_share']) for e in sample) / len(sample))
    # Public artefacts are deliberately much shorter-lived than the ledger.
    # A weekly fund may have many events while a quarterly fund has few; using
    # the last three *distinct ex-dates* per ticker treats both fairly without
    # guessing their distribution cadence.
    retained_ex_dates: dict[str, set[str]] = {}
    for event in sorted(events, key=lambda row: (row["ticker"], row["ex_date"]), reverse=True):
        dates = retained_ex_dates.setdefault(event["ticker"], set())
        if len(dates) < PUBLIC_RENDER_EX_DATE_RETENTION:
            dates.add(event["ex_date"])

    render_rows = []
    content_rows = []
    retained_event_ids: set[str] = set()
    seen_event_ids: set[int] = set()
    managed_event_ids: set[str] = set()
    for manifest_path in sorted(bundles.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        event_id = manifest.get("eventId")
        ticker = manifest.get("ticker")
        ex_date = manifest.get("exDate")
        if isinstance(event_id, int):
            managed_event_ids.add(str(event_id))
        if not isinstance(event_id, int) or not isinstance(ticker, str) or not isinstance(ex_date, str):
            continue
        if ex_date not in retained_ex_dates.get(ticker, set()):
            continue
        if event_id in seen_event_ids:
            continue
        seen_event_ids.add(event_id)
        retained_event_ids.add(str(event_id))
        files = manifest.get("files", {})
        content_rows.append({"manifest": manifest, "path": str(manifest_path.parent), "files": files})
        for name in files.values():
            source = manifest_path.parent / name
            if source.exists():
                destination = output / "renders" / str(event_id) / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
                render_rows.append({
                    "eventId": event_id,
                    "ticker": ticker,
                    "provider": manifest.get("provider", "unknown"),
                    "exDate": ex_date,
                    "verificationStatus": manifest.get("verificationStatus", "unverified"),
                    "officialUrl": manifest.get("officialUrl"),
                    "name": name,
                    "url": "/content-studio/renders/" + str(event_id) + "/" + name,
                })

    # Files under public/ are a generated delivery cache. The full bundle is
    # retained in var/content-studio/generated and the SQLite ledger, so it is
    # safe to remove only recognised, no-longer-public event directories.
    public_renders = output / "renders"
    if public_renders.exists():
        for directory in public_renders.iterdir():
            if directory.is_dir() and directory.name in managed_event_ids and directory.name not in retained_event_ids:
                shutil.rmtree(directory)
    # Keep the legacy complete export for integrations, but do not make the UI
    # download thousands of rows before it can render a tab.
    provider_events: dict[str, list[dict]] = {}
    for event in events:
        provider_events.setdefault(event["provider_slug"], []).append(event)
    provider_names = {provider["slug"]: provider["display_name"] for provider in providers}
    distribution_providers = []
    for slug, rows in sorted(provider_events.items(), key=lambda item: provider_names.get(item[0], item[0])):
        page_count = max(1, (len(rows) + DISTRIBUTION_PAGE_SIZE - 1) // DISTRIBUTION_PAGE_SIZE)
        distribution_providers.append({
            "slug": slug,
            "displayName": provider_names.get(slug, slug),
            "eventCount": len(rows),
            "pageCount": page_count,
            "latestExDate": rows[0].get("ex_date"),
        })
        for page in range(page_count) if legacy_exports else []:
            start = page * DISTRIBUTION_PAGE_SIZE
            _write(output / f"distribution-{slug}-{page + 1}.json", {
                "provider": distribution_providers[-1],
                "page": page + 1,
                "pageSize": DISTRIBUTION_PAGE_SIZE,
                "events": rows[start : start + DISTRIBUTION_PAGE_SIZE],
            })
    # The list view gets exactly one latest event per ticker. Full history is
    # fetched only after the editor opens that ticker's detail dialog.
    ticker_events: dict[str, list[dict]] = {}
    for event in events:
        ticker_events.setdefault(event["ticker"], []).append(event)
    ticker_index = []
    for ticker, rows in sorted(ticker_events.items()):
        history = sorted(rows, key=lambda row: (row["ex_date"], row["id"]), reverse=True)
        latest = history[0]
        history_url = f"/content-studio/distribution-ticker-{_ticker_file_stem(ticker)}.json"
        _write(output / history_url.removeprefix("/content-studio/"), {
            "ticker": ticker,
            "providerSlug": latest["provider_slug"],
            "history": history,
        })
        ticker_index.append({
            "ticker": ticker,
            "providerSlug": latest["provider_slug"],
            "latest": latest,
            "historyUrl": history_url,
            "historyCount": len(history),
        })
    _write(output / "distribution-index.json", {
        "providers": distribution_providers,
        "recentEvents": events[:100],
        "tickers": ticker_index,
        "fallbackObservations": fallback_observations,
        "marketData": "not_configured: NAV/price adapter required",
    })
    if legacy_exports:
        _write(output / "distributions.json", {"events": events, "marketData": "not_configured: NAV/price adapter required"})
    else:
        # Remove only recognised obsolete generated copies whose event IDs
        # still exist in the ledger and in the newly emitted ticker shards.
        event_ids = {event['id'] for event in events}
        obsolete = [output / 'distributions.json']
        for slug in provider_events:
            obsolete.extend(path for path in output.glob(f'distribution-{slug}-*.json')
                            if re.fullmatch(r'distribution-' + re.escape(slug) + r'-\d+\.json', path.name))
        for path in obsolete:
            if path.exists():
                old = json.loads(path.read_text(encoding='utf-8'))
                if isinstance(old.get('events'), list) and all(row.get('id') in event_ids for row in old['events']):
                    path.unlink()
    _write(output / "content.json", {"bundles": content_rows, "retention": {"perTickerDistinctExDates": PUBLIC_RENDER_EX_DATE_RETENTION}, "notionEditScope": ["title", "body", "channels", "approval status"]})
    _write(output / "sources.json", {"providers": providers})
    _write(output / "renders.json", {"renders": render_rows})
    _write(output / "archive.json", {"performance": performance, "reuseCandidates": sorted(performance, key=lambda row: row["views"], reverse=True)[:10]})
