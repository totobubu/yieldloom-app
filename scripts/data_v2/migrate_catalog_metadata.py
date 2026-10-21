"""One-time, explicit migration of app metadata and price source routing.

Normal builds and refreshes never read the legacy input. Re-running requires
reviewing the diff; existing catalog identities and administrator edits win.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

FIELDS = ('ipoDate', 'frequency', 'noDividends')


def migrate(catalog: dict, legacy: dict) -> tuple[dict, dict, dict]:
    rows = legacy['nav']
    metadata = {row['symbol']: row for row in rows}
    if len(metadata) != len(rows):
        raise ValueError('Duplicate legacy catalog symbol')
    instruments = []
    sources = []
    for row in catalog['instruments']:
        previous = metadata.get(row['symbol'], {})
        instruments.append({**{key: previous[key] for key in FIELDS if key in previous}, **row})
        paths = previous.get('dataPaths') or []
        if paths:
            sources.append({'symbol': row['symbol'], 'yfSymbol': previous.get('yfSymbol', row['symbol']), 'dataPath': paths[0]})
    symbols = {row['symbol'] for row in catalog['instruments']}
    if len(symbols) != len(instruments):
        raise ValueError('Duplicate catalog symbol')
    if set(metadata) - symbols:
        raise ValueError('Legacy symbols absent from independent catalog; review identities first')
    return (
        {**catalog, 'source': 'yieldloom-owned-catalog', 'instruments': instruments},
        {'schemaVersion': 1, 'instruments': sorted(sources, key=lambda row: row['symbol'])},
        {'catalogCount': len(instruments), 'priceSourceCount': len(sources),
         'metadataCounts': {key: sum(key in row for row in instruments) for key in FIELDS},
         'catalogOnlySymbols': sorted(symbols - set(metadata))},
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, default=Path('data-v2/catalog-seed.json'))
    parser.add_argument('--sources', type=Path, default=Path('data-v2/market-sources.json'))
    parser.add_argument('--report', type=Path, default=Path('docs/data-management/catalog-migration.json'))
    args = parser.parse_args()
    raw = args.input.read_bytes()
    catalog, sources, report = migrate(json.loads(args.catalog.read_text()), json.loads(raw))
    report['legacySha256'] = hashlib.sha256(raw).hexdigest()
    for path, payload in ((args.catalog, catalog), (args.sources, sources), (args.report, report)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
