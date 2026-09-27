"""Read-only history probes. Provider exhaustion does not prove lifetime coverage.

Usage: python scripts/data_pipeline/history_sources.py toss GE --start 1962-01-02
       python scripts/data_pipeline/history_sources.py tiingo GE --start 1962-01-02
Tokens are read only from TOSS_ACCESS_TOKEN / TIINGO_API_TOKEN environment vars.
Responses go to the observation directory; this never overwrites accepted history.
"""
import argparse
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def get_json(url, token, *, scheme='Bearer'):
    request = Request(url, headers={'Authorization': f'{scheme} {token}', 'Accept': 'application/json'})
    for attempt in range(4):
        try:
            with urlopen(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                # Don't echo request headers, credentials or provider error bodies.
                raise RuntimeError(f'History provider HTTP {error.code}') from None
            time.sleep(min(30, 2 ** attempt))


def toss_history(symbol, start, fetch, *, max_pages=100):
    if max_pages < 1:
        raise ValueError('max_pages must be positive')
    cursor = None
    seen_cursors = set()
    candles = {}
    reason = 'page_limit'
    for page in range(max_pages):
        query = dict(symbol=symbol, interval='1d', count=200, adjusted='false')
        if cursor:
            query['before'] = cursor
        result = fetch(query)['result']
        rows = result.get('candles', [])
        for row in rows:
            candles[row['timestamp']] = row
        oldest = min((row['timestamp'][:10] for row in rows), default=None)
        if oldest and oldest <= start:
            reason = 'requested_start_reached'
            break
        next_cursor = result.get('nextBefore')
        if not next_cursor or not rows:
            reason = 'provider_exhausted'
            break
        if next_cursor == cursor or next_cursor in seen_cursors:
            reason = 'cursor_stalled'
            break
        seen_cursors.add(next_cursor)
        cursor = next_cursor
    ordered = sorted(candles.values(), key=lambda row: row['timestamp'])
    return {'source': 'toss', 'symbol': symbol, 'priceBasis': 'unadjusted',
            'requestedStart': start, 'oldestReturned': ordered[0]['timestamp'][:10] if ordered else None,
            'stopReason': reason, 'startReached': reason == 'requested_start_reached',
            'pages': page + 1, 'candles': ordered}


def tiingo_history(symbol, start, token):
    base = 'https://api.tiingo.com/tiingo/daily/' + quote(symbol, safe='')
    metadata = get_json(base, token, scheme='Token')
    rows = get_json(base + '/prices?' + urlencode({'startDate': start, 'endDate': date.today().isoformat()}), token, scheme='Token')
    return {'source': 'tiingo', 'symbol': symbol, 'requestedStart': start,
            'availableStart': metadata.get('startDate'), 'availableEnd': metadata.get('endDate'),
            'priceBasis': 'raw_and_provider_adjusted_separate', 'candles': rows,
            'status': 'observation_only'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('provider', choices=['toss', 'tiingo'])
    parser.add_argument('symbol')
    parser.add_argument('--start', required=True, type=date.fromisoformat)
    parser.add_argument('--max-pages', type=int, default=100)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9.-]+', args.symbol):
        parser.error('Invalid symbol')
    token = os.getenv('TOSS_ACCESS_TOKEN' if args.provider == 'toss' else 'TIINGO_API_TOKEN')
    if not token:
        parser.error('Provider token is not configured in the environment')
    if args.provider == 'toss':
        result = toss_history(args.symbol, args.start.isoformat(),
            lambda query: get_json('https://openapi.tossinvest.com/api/v1/candles?' + urlencode(query), token),
            max_pages=args.max_pages)
    else:
        result = tiingo_history(args.symbol, args.start.isoformat(), token)
    raw = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    path = Path('var/data-management/observations') / args.provider / (hashlib.sha256(raw).hexdigest() + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    print(json.dumps({k: v for k, v in result.items() if k != 'candles'}, ensure_ascii=False))
    print(f'Observation saved: {path}; rows={len(result["candles"])}')


if __name__ == '__main__':
    main()
