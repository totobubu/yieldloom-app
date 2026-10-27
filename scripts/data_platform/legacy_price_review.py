"""Read-only price migration comparison; never writes storage or promotes price basis."""
import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
from datetime import date


def inspect(body, symbol, currency):
    payload = json.loads(body, parse_float=Decimal)
    info = payload.get('tickerInfo', {})
    equivalent = lambda value: str(value).upper().replace('.', '-')
    if equivalent(info.get('symbol', info.get('Symbol'))) != equivalent(symbol) or info.get('currency') != currency:
        raise ValueError('Source identity/currency mismatch')
    rows = {}
    forecast_count = 0
    for row in payload['backtestData']:
        if row.get('forecasted'):
            forecast_count += 1
            continue
        if row.get('close') is None:
            continue  # Dividend-only rows carry no price.
        day = date.fromisoformat(row['date']).isoformat()
        try:
            close = Decimal(str(row['close']))
        except InvalidOperation as error:
            raise ValueError('Invalid source price') from error
        if not close.is_finite() or close <= 0:
            raise ValueError('Invalid source price')
        if day in rows:
            raise ValueError('Duplicate source price date')
        rows[day] = close
    if not rows:
        raise ValueError('No actual source prices')
    return rows, {'sha256': hashlib.sha256(body).hexdigest(), 'priceCount': len(rows),
                  'firstDate': min(rows), 'lastDate': max(rows), 'excludedForecasts': forecast_count}


def review(source, destination, symbol, currency):
    old, left = inspect(source, symbol, currency)
    new, right = inspect(destination, symbol, currency)
    missing = sorted(old.keys() - new.keys())
    changed = sorted(day for day in old.keys() & new.keys() if old[day] != new[day])
    changes = [{'date': day, 'sourceClose': str(old[day]),
                'destinationClose': str(new[day]),
                'difference': str(new[day] - old[day]),
                'relativeDifference': str((new[day] - old[day]) / old[day])}
               for day in changed]
    return {'schemaVersion': 1, 'symbol': symbol, 'currency': currency,
            'source': left, 'destination': right, 'missingDates': missing,
            'changedDates': changed, 'priceChanges': changes,
            'comparedPriceCount': len(old.keys() & new.keys()),
            'sameByteHash': left['sha256'] == right['sha256'],
            'addedDates': sorted(new.keys()-old.keys()),
            'preservesSourcePrices': not missing and not changed,
            'priceBasis': 'upstream_unverified', 'historicalCompleteness': 'unverified',
            'cutoverReady': False, 'writesPerformed': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--symbol', required=True)
    parser.add_argument('--currency', required=True)
    args = parser.parse_args()
    result = review(args.source.read_bytes(), args.destination.read_bytes(), args.symbol, args.currency)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['preservesSourcePrices'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
