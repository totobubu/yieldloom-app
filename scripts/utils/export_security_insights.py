"""Publish small, allowlisted security summaries without internal paths or raw files."""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ('symbol', 'status', 'currency', 'financialCurrency', 'collectedAt', 'source',
          'sourceUrl', 'performance', 'quote', 'fund', 'dividendCapacity',
          'navHistory', 'dividendEtfs', 'officialDistributionCalendar')
PRIVATE = {'error', 'errors', 'observationPath', 'observationIds', 'rawPath', 'rows'}


def public_value(value):
    if isinstance(value, dict):
        return {k: public_value(v) for k, v in value.items() if k not in PRIVATE and not k.endswith('Path')}
    if isinstance(value, list):
        return [public_value(v) for v in value]
    return value


def bucket(symbol):
    return sum(map(ord, symbol)) % 64


def export(report, output):
    if report.get('runState') != 'complete' or not report.get('securities'):
        raise ValueError('A completed, nonempty collection is required')
    roc = defaultdict(list)
    for row in report.get('rocObservations', []):
        roc[row['ticker']].append(public_value(row))
    shards = defaultdict(dict)
    for symbol, row in sorted(report['securities'].items()):
        result = {key: public_value(row[key]) for key in FIELDS if key in row}
        result['rocObservations'] = roc[symbol]
        shards[bucket(symbol)][symbol] = result
    output.mkdir(parents=True, exist_ok=True)
    for index, securities in shards.items():
        payload = {'schemaVersion': 1, 'asOfDate': report['asOfDate'],
                   'updatedAt': report['updatedAt'], 'securities': securities}
        temporary = output / f'{index}.json.tmp'
        temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
        temporary.replace(output / f'{index}.json')
    return sum(len(rows) for rows in shards.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'var/data-management/security-insights/latest.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/security-insights')
    args = parser.parse_args()
    print(f'Published {export(json.loads(args.input.read_text()), args.output)} security summaries')


if __name__ == '__main__':
    main()
