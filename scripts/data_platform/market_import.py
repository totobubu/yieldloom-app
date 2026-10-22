"""Import canonical provider batches into a private revision ledger; never fetch or publish."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.pipeline import Store, digest, encode, private_path
from scripts.data_platform.locking import writer_lock
from scripts.data_platform.market_contract import validate_price, validate_split, amount


def prepare(body):
    if len(body) > 32 * 1024 * 1024:
        raise ValueError('Market batch exceeds 32 MiB; split the incremental input')
    payload = json.loads(body, parse_float=Decimal)
    source = payload.get('sourceId', '')
    url = payload.get('sourceUrl', '')
    if (payload.get('schemaVersion') != 1 or not re.fullmatch('[a-z0-9][a-z0-9._-]{0,99}', source)
            or not url.startswith('https://') or not isinstance(payload.get('prices', []), list)
            or not isinstance(payload.get('actions', []), list)):
        raise ValueError('Canonical batch requires schema, source identity, HTTPS evidence URL and row arrays')
    sha = digest(body)
    output, seen = [], set()
    for dataset, field, validator in [('market-prices', 'prices', validate_price), ('corporate-actions', 'actions', validate_split)]:
        for item in payload.get(field, []):
            if any(key in item for key in ('sourceId', 'sourceDocumentId', 'sourceUrl', 'observedAt', 'revision', 'supersedesRevision')):
                raise ValueError('Batch provenance is assigned from the archived input, not row overrides')
            row = validator({**item, 'sourceId': source, 'sourceDocumentId': sha})
            if dataset == 'market-prices':
                key = [dataset, source, row['entityId'], row['asOfDate'], row['currency'], row['priceBasis']]
            else:
                if not isinstance(row.get('eventId'), str) or not row['eventId']:
                    raise ValueError('Actions require a stable provider eventId for corrections')
                key = [dataset, source, row['entityId'], row['eventId']]
            identity = digest(encode(key).encode())
            if identity in seen:
                raise ValueError('Duplicate market identity in batch')
            seen.add(identity)
            output.append((identity, dataset, row))
    if not output or len(output) > 100000:
        raise ValueError('Batch must contain 1 to 100000 rows')
    return source, url, sha, output


def ingest(store, body, now=None):
    source, url, sha, rows = prepare(body)
    timestamp = (now or datetime.now(timezone.utc)).isoformat()
    # All rows validate before the original bytes are archived. This path performs no HTTP.
    store.document(f'urn:yieldloom:market-input:{source}:{sha}', {'status': 200, 'body': body}, timestamp)
    store.db.executescript('''
        CREATE TABLE IF NOT EXISTS market_revisions (
            identity_key TEXT NOT NULL, revision INTEGER NOT NULL, dataset TEXT NOT NULL,
            source_id TEXT NOT NULL, value_hash TEXT NOT NULL, payload TEXT NOT NULL,
            PRIMARY KEY(identity_key, revision));
        CREATE TABLE IF NOT EXISTS market_evidence (
            identity_key TEXT NOT NULL, revision INTEGER NOT NULL, document_sha TEXT NOT NULL,
            observed_at TEXT NOT NULL, UNIQUE(identity_key, revision, document_sha));
    ''')
    new, revised, unchanged = 0, 0, 0
    with store.db:
        for identity, dataset, row in rows:
            value = {key: value for key, value in row.items() if key != 'sourceDocumentId'}
            checksum = digest(encode(value).encode())
            old = store.db.execute('SELECT * FROM market_revisions WHERE identity_key=? ORDER BY revision DESC LIMIT 1', (identity,)).fetchone()
            revision = old['revision'] if old else 0
            if old and old['value_hash'] == checksum:
                unchanged += 1
            else:
                revision += 1
                record = {**row, 'revision': revision, 'observedAt': timestamp, 'sourceUrl': url,
                          'supersedesRevision': revision - 1 if old else None}
                store.db.execute('INSERT INTO market_revisions VALUES (?,?,?,?,?,?)',
                    (identity, revision, dataset, source, checksum, encode(record)))
                new += old is None
                revised += old is not None
            store.db.execute('INSERT OR IGNORE INTO market_evidence VALUES (?,?,?,?)',
                             (identity, revision, sha, timestamp))
    return {'new': new, 'revised': revised, 'unchanged': unchanged, 'public': False}


def prices(store, source):
    exists = store.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='market_revisions'").fetchone()
    if not exists:
        return []
    return [json.loads(row['payload']) for row in store.db.execute('''
        SELECT r.payload FROM market_revisions r WHERE source_id=? AND dataset='market-prices'
        AND revision=(SELECT MAX(s.revision) FROM market_revisions s WHERE s.identity_key=r.identity_key)
    ''', (source,))]


def reconcile(left, right, absolute_tolerance='0'):
    tolerance = amount(absolute_tolerance, positive=False)
    def index(rows):
        result = {}
        for row in rows:
            validate_price(row)
            key = (row['entityId'], row['asOfDate'], row['currency'], row['priceBasis'])
            if key in result:
                raise ValueError('Duplicate comparison identity')
            result[key] = row
        return result
    a, b = index(left), index(right)
    matches, differences, incomparable = [], [], []
    for key in sorted(a.keys() & b.keys()):
        old, new = a[key], b[key]
        identity = dict(zip(('entityId', 'asOfDate', 'currency', 'priceBasis'), key))
        if key[-1] != 'unadjusted' and old['adjustmentAsOfDate'] != new['adjustmentAsOfDate']:
            incomparable.append({**identity, 'reason': 'different_adjustment_vintage'})
            continue
        fields = ['close']
        reasons = []
        if old['coverage'] != new['coverage']:
            reasons.append('coverage_mismatch')
        elif old['coverage'] == 'ohlc':
            fields += ['open', 'high', 'low']
        changes = {field: {'left': old[field], 'right': new[field],
                          'absoluteDelta': str(abs(Decimal(old[field]) - Decimal(new[field])))}
                   for field in fields if abs(Decimal(old[field]) - Decimal(new[field])) > tolerance}
        # Volume has its own unit semantics and is compared exactly, without price tolerance.
        if old.get('volume') != new.get('volume') and not (old.get('volume') is not None and new.get('volume') is not None and Decimal(old['volume']) == Decimal(new['volume'])):
            reasons.append('volume_mismatch')
        if changes or reasons:
            differences.append({**identity, 'fields': changes, 'reasons': reasons})
        else:
            matches.append(identity)
    missing = lambda keys: [dict(zip(('entityId', 'asOfDate', 'currency', 'priceBasis'), key)) for key in sorted(keys)]
    return {'schemaVersion': 1, 'kind': 'private_price_comparison', 'absoluteTolerance': absolute_tolerance,
            'matchedCount': len(matches), 'differences': differences, 'incomparable': incomparable,
            'leftOnly': missing(a.keys() - b.keys()), 'rightOnly': missing(b.keys() - a.keys()),
            'cutoverReady': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['import', 'compare'])
    parser.add_argument('--root', type=Path, default=Path('var/data-market-candidate'))
    parser.add_argument('--input', type=Path)
    parser.add_argument('--left-source')
    parser.add_argument('--right-source')
    parser.add_argument('--absolute-tolerance', default='0')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = private_path(args.root)
    if args.command == 'import' and not args.input:
        parser.error('Import requires --input')
    if args.command == 'compare' and (not args.left_source or not args.right_source or not args.output):
        parser.error('Compare requires both source IDs and a private --output')
    with writer_lock(root):
        store = Store(root)
        try:
            if args.command == 'import':
                result = ingest(store, private_path(args.input).read_bytes())
            else:
                left, right = prices(store, args.left_source), prices(store, args.right_source)
                if not left or not right or args.left_source == args.right_source:
                    raise ValueError('Comparison requires two distinct populated sources')
                report = reconcile(left, right, args.absolute_tolerance)
                output = private_path(args.output)
                output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                output.write_text(encode(report) + '\n')
                result = {key: len(value) if isinstance(value, list) else value for key, value in report.items()}
            print(encode(result))
        finally:
            store.close()


if __name__ == '__main__':
    main()
