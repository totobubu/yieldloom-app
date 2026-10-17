"""Apply administrator-approved records exported by the metadata review API."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from urllib.parse import urlparse
from urllib.request import Request, urlopen
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.metadata.underlyings import validate_record, write_json


def apply_reviews(payload, registry, catalog):
    if payload.get('schemaVersion') != 1 or not isinstance(payload.get('decisions'), list):
        raise ValueError('Unsupported review export')
    links = dict(registry['instruments'])
    instruments = {row['symbol']: dict(row) for row in catalog['instruments']}
    seen = set()
    for decision in payload['decisions']:
        ticker = decision['symbol']
        if ticker in seen:
            raise ValueError('Duplicate approved review')
        seen.add(ticker)
        row = validate_record(decision['approved'])
        if row['symbol'] != ticker or not isinstance(decision.get('revision'), int) or decision['revision'] < 1:
            raise ValueError('Invalid approved review revision')
        if ticker not in instruments:
            entry = decision.get('instrument') or {}
            if (entry.get('symbol') != ticker or entry.get('market') not in {'NASDAQ','NYSE','NYSEARCA','AMEX','BATS'}
                or entry.get('currency') != 'USD' or not entry.get('longName') or entry.get('active') is not True):
                raise ValueError(f'New instrument metadata is unconfirmed: {ticker}')
            instruments[ticker] = {key: entry[key] for key in ['symbol','market','currency','longName','active']}
            instruments[ticker]['officialProvider'] = row['providerName']
        links[ticker] = row
    return ({'schemaVersion': 1, 'instruments': dict(sorted(links.items()))},
            {**catalog, 'instruments': [instruments[key] for key in sorted(instruments)]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--input', type=Path)
    source.add_argument('--url')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.input:
        payload = json.loads(args.input.read_text())
    else:
        expected = 'yieldloom-app.vercel.app'
        parsed = urlparse(args.url)
        if parsed.scheme != 'https' or parsed.hostname != expected or parsed.path != '/api/security-metadata':
            raise ValueError('Review export must use the official metadata API')
        with urlopen(Request(args.url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
            if urlparse(response.url).hostname != expected:
                raise ValueError('Unexpected export redirect')
            payload = json.loads(response.read(2_000_001))
    registry_path = ROOT / 'data-v2/security-underlyings.json'
    catalog_path = ROOT / 'data-v2/catalog-seed.json'
    registry, catalog = apply_reviews(payload, json.loads(registry_path.read_text()), json.loads(catalog_path.read_text()))
    if args.apply:
        write_json(registry_path, registry)
        write_json(catalog_path, catalog)
    print(f"Validated {len(payload['decisions'])} approved reviews")


if __name__ == '__main__':
    main()
