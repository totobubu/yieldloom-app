"""Recheck unresolved identities against two saved official directories, without changing mappings."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.parsers import nasdaq
from scripts.data_platform.pipeline import digest, encode, private_path

DIRECTORIES = {
    'nasdaqlisted': ('Symbol', 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt'),
    'otherlisted': ('ACT Symbol', 'https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt'),
}


def review_directories(review, contents, now=None):
    if review.get('schemaVersion') != 1 or set(contents) != set(DIRECTORIES):
        raise ValueError('Review and both official directory inputs are required')
    evidence, listings = [], {}
    for name, (symbol_key, url) in DIRECTORIES.items():
        body = contents[name]
        lines = body.decode('utf-8-sig').splitlines()
        if not lines or lines[0].split('|')[0] != symbol_key:
            raise ValueError('Wrong directory input')
        rows = nasdaq(body, {'id': name})
        seen = set()
        for row in rows:
            record = row['value']
            symbol = record[symbol_key]
            if symbol in seen:
                raise ValueError('Duplicate directory symbol')
            seen.add(symbol)
            listings.setdefault(symbol, []).append({
                'directory': name, 'symbol': symbol, 'name': record['Security Name'],
                'exchangeCode': record.get('Exchange'), 'marketCategory': record.get('Market Category'),
                'etf': record['ETF'],
            })
        evidence.append({'directory': name, 'url': url, 'sha256': digest(body), 'bytes': len(body),
                         'fileCreationTime': next(line.split('|')[0] for line in lines if line.startswith('File Creation Time:'))})
    entries = []
    for entry in review['entries']:
        if entry['status'] == 'confirmed_isin':
            continue
        if entry['active']:
            raise ValueError('Unresolved active identity requires immediate individual review')
        exact = listings.get(entry['symbol'], [])
        candidate = listings.get(entry.get('candidateSymbol'), [])
        entries.append({'symbol': entry['symbol'], 'previousReviewStatus': entry['status'],
                        'exactDirectoryMatches': exact, 'candidateDirectoryMatches': candidate,
                        'requiredEvidence': entry['requiredEvidence'],
                        'outcome': 'manual_identity_review_required' if exact else 'absent_from_supplied_directories',
                        'automaticAlias': False, 'listingActivation': False})
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        raise ValueError('Review time requires timezone')
    return {'schemaVersion': 1, 'generatedAt': clock.isoformat(), 'reviewSha256': digest(encode(review).encode()),
            'scope': 'Unresolved inactive identities only; directory absence does not establish delisting or alias identity',
            'directoryEvidence': evidence, 'entries': entries,
            'summary': {'reviewed': len(entries), 'exactMatchCount': sum(bool(r['exactDirectoryMatches']) for r in entries),
                        'candidateOnlyCount': sum(bool(r['candidateDirectoryMatches']) and not r['exactDirectoryMatches'] for r in entries),
                        'automaticChanges': 0}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, default=ROOT / 'data-v2/identity-review.json')
    parser.add_argument('--nasdaq-listed', type=Path, required=True)
    parser.add_argument('--other-listed', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = private_path(args.output)
    inputs = [args.review, args.nasdaq_listed, args.other_listed, ROOT / 'data-v2/catalog-seed.json',
              ROOT / 'data-v2/identity-corrections.json']
    if output in {p.resolve() for p in inputs}:
        parser.error('Review output must not overwrite inputs or canonical identity data')
    result = review_directories(json.loads(args.review.read_text()), {
        'nasdaqlisted': args.nasdaq_listed.read_bytes(), 'otherlisted': args.other_listed.read_bytes()})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(encode(result['summary']))


if __name__ == '__main__':
    main()
