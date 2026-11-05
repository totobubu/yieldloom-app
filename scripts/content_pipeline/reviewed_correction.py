"""Apply an explicitly reviewed issuer correction, preserving event IDs and evidence."""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.models import utc_now_iso
from scripts.content_pipeline.providers.base import SourceCandidate
from scripts.content_pipeline.providers.yieldmax import YieldMaxAdapter

MANIFEST = {
    'id': 'yieldmax-monthly-2026-11',
    'source': 'https://www.globenewswire.com/news-release/2026/11/03/3394019/0/en/yieldmax-etfs-announces-distributions-on-bigy-rnty-and-soxy.html',
    'amounts': {'BIGY': '0.4977', 'RNTY': '0.4785', 'SOXY': '0.7730'},
    'before': {'declared_date': '2026-11-04', 'ex_date': '2026-11-04',
               'record_date': '2026-11-05', 'payable_date': '2026-11-05', 'frequency': 'weekly'},
    'after': {'declared_date': '2026-11-03', 'ex_date': '2026-11-04',
              'record_date': '2026-11-04', 'payable_date': '2026-11-05', 'frequency': 'monthly'},
}


def apply_correction(database, document, *, apply=False):
    """Fail before changing any event when the reviewed before/after facts differ."""
    if document.source_url != MANIFEST['source'] or document.provider_slug != 'yieldmax':
        raise ValueError('unreviewed correction source')
    events = YieldMaxAdapter().parse(document)
    if {event.ticker for event in events} != set(MANIFEST['amounts']) or len(events) != 3:
        raise ValueError('correction source must contain exactly the three reviewed tickers')
    plans = []
    with database.connect() as connection:
        for event in events:
            values = asdict(event)
            if (any(values[k] != v for k, v in MANIFEST['after'].items())
                    or event.distribution_per_share != MANIFEST['amounts'][event.ticker]
                    or event.currency != 'USD'):
                raise ValueError('official source no longer matches reviewed correction')
            rows = connection.execute('''SELECT * FROM distribution_events
                WHERE provider_slug='yieldmax' AND ticker=? AND ex_date=?''',
                (event.ticker, event.ex_date)).fetchall()
            if len(rows) != 1:
                raise ValueError('correction requires exactly one existing event per ticker/ex-date')
            row = dict(rows[0])
            existing = connection.execute('''SELECT * FROM reviewed_distribution_corrections
                WHERE correction_id=? AND event_id=?''', (MANIFEST['id'], row['id'])).fetchone()
            expected = MANIFEST['after'] if existing else MANIFEST['before']
            expected_url = MANIFEST['source'] if existing else f'https://yieldmaxetfs.com/our-etfs/{event.ticker.lower()}/'
            if (any(row[k] != v for k, v in expected.items())
                    or row['distribution_per_share'] != event.distribution_per_share
                    or row['currency'] != 'USD' or row['official_url'] != expected_url
                    or row['verification_status'] != 'official'
                    or (existing and row['event_key'] != event.event_key)):
                raise ValueError('existing event changed since the correction was reviewed')
            plans.append((row, event, bool(existing)))
    report = {'correctionId': MANIFEST['id'], 'sourceUrl': document.source_url,
              'sourceSha256': document.content_sha256, 'apply': apply,
              'events': [{'id': row['id'], 'ticker': event.ticker, 'before': MANIFEST['before'],
                          'after': MANIFEST['after'], 'alreadyApplied': existing}
                         for row, event, existing in plans]}
    if not apply:
        return report
    source_id = database.add_source_document(document)
    with database.connect() as connection:
        # The entire batch is one transaction; compare again under the write lock.
        connection.execute('BEGIN IMMEDIATE')
        for row, event, existing in plans:
            current = dict(connection.execute('SELECT * FROM distribution_events WHERE id=?', (row['id'],)).fetchone())
            if current != row:
                raise ValueError('event changed while preparing correction')
            if existing:
                continue
            # The existing revision trigger records the complete OLD row, including
            # its source document, dates, ROC and frequency. No row is deleted.
            connection.execute('''UPDATE distribution_events SET declared_date=?, record_date=?,
                frequency=?, event_key=?, source_document_id=?, official_url=?, updated_at=? WHERE id=?''',
                (event.declared_date, event.record_date, event.frequency, event.event_key,
                 source_id, document.source_url, utc_now_iso(), row['id']))
            connection.execute('''INSERT INTO reviewed_distribution_corrections
                (correction_id,event_id,prior_event_key,corrected_event_key,prior_snapshot_json,
                 corrected_snapshot_json,source_document_id,applied_at) VALUES (?,?,?,?,?,?,?,?)''',
                (MANIFEST['id'],row['id'],row['event_key'],event.event_key,json.dumps(row,sort_keys=True),
                 json.dumps(asdict(event),sort_keys=True),source_id,utc_now_iso()))
            connection.execute('''INSERT INTO distribution_observations
                (canonical_event_id,ticker,ex_date,amount_raw,amount_normalized,currency,declared_date,
                 record_date,payable_date,source_class,source_provider,source_url,content_sha256,
                 precision_digits,verification_status,raw_json,observed_at)
                VALUES (?,?,?,?,?,?,?,?,?,'issuer_official','yieldmax',?,?,4,'official',?,?)''',
                (row['id'],event.ticker,event.ex_date,event.distribution_per_share,event.distribution_per_share,
                 'USD',event.declared_date,event.record_date,event.payable_date,document.source_url,
                 document.content_sha256,json.dumps({'correctionId':MANIFEST['id'],
                     'retainedRocSourceDocumentId':row['source_document_id']}),utc_now_iso()))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--correction', choices=[MANIFEST['id']], required=True)
    parser.add_argument('--apply', action='store_true', help='Apply the reviewed correction; default is inspection only')
    parser.add_argument('--db', type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument('--raw-dir', type=Path, default=Path('var/content-studio/raw'))
    parser.add_argument('--public-dir', type=Path, default=Path('public/content-studio'))
    parser.add_argument('--github-output', type=Path)
    args = parser.parse_args()
    database = ContentDatabase(args.db)
    if not args.db.is_file():
        parser.error('existing official ledger is required')
    database.initialize()
    document = YieldMaxAdapter().fetch(SourceCandidate(MANIFEST['source'], 'official_press_release'))
    # Verify every before/after field before persisting the new source or changing events.
    apply_correction(database, document)
    if args.apply:
        from dataclasses import replace
        path = args.raw_dir / 'yieldmax' / (document.content_sha256 + '.html')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(document.content)
        document = replace(document, local_path=str(path))
    report = apply_correction(database, document, apply=args.apply)
    if args.apply:
        from scripts.content_pipeline.export_admin_data import export_all
        from scripts.content_pipeline.export_dashboard import export_dashboard
        from scripts.content_pipeline.export_system_logs import export_system_logs
        from scripts.content_pipeline.reconcile_public_data import export_snapshot as export_reconciliation
        export_all(args.db, Path('var/content-studio/generated'), args.public_dir)
        export_reconciliation(args.db, Path('public/data'), args.public_dir/'reconciliation.json', onboard_missing=False)
        export_dashboard(args.db, args.public_dir/'dashboard.json')
        export_system_logs(args.db, args.public_dir/'system-logs.json')
    report.update(status='corrected' if args.apply else 'checked', attempted=args.apply,
                  publish=args.apply, stateChanged=args.apply)
    path = Path('var/content-studio/yieldmax-observation.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if args.github_output:
        with args.github_output.open('a') as handle:
            for key in ('attempted','publish','stateChanged','status'):
                handle.write(f'{key}={str(report[key]).lower()}\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
