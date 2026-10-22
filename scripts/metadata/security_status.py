"""Reviewed listing status shared by catalog and scheduled collection jobs."""
from __future__ import annotations

import argparse
from datetime import date
import json
import re
from pathlib import Path
from urllib.parse import urlparse

REGISTRY = Path(__file__).resolve().parents[2] / 'data-v2/security-status.json'


def validate_registry(payload):
    if not isinstance(payload, dict) or payload.get('schemaVersion') != 1 or not isinstance(payload.get('securities'), list):
        raise ValueError('Expected schemaVersion 1 and securities array')
    seen = set()
    for row in payload['securities']:
        if not isinstance(row, dict):
            raise ValueError('Status record must be an object')
        symbol = row.get('symbol')
        if not isinstance(symbol, str) or not re.fullmatch(r'[A-Z0-9^][A-Z0-9.^=-]{0,29}', symbol):
            raise ValueError('Invalid symbol')
        normalized = symbol.replace('.', '-')
        if normalized in seen:
            raise ValueError(f'Duplicate symbol: {symbol}')
        seen.add(normalized)
        if row.get('status') != 'delisted':
            raise ValueError(f'Invalid status: {symbol}')
        for field in ('market', 'currency', 'reason'):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError(f'Missing {field}: {symbol}')
        for field in ('delistedOn', 'lastTradingOn', 'checkedOn'):
            if field not in row or (field == 'checkedOn' and row[field] is None):
                raise ValueError(f'Missing {field}: {symbol}')
        for field in ('delistedOn', 'lastTradingOn', 'tradingHaltedOn', 'liquidatedOn', 'checkedOn'):
            value = row.get(field)
            if value is not None and (not isinstance(value, str) or date.fromisoformat(value).isoformat() != value):
                raise ValueError(f'Invalid {field}: {symbol}')
        if row['lastTradingOn'] and row['delistedOn'] and row['lastTradingOn'] > row['delistedOn']:
            raise ValueError(f'Last trade after delisting: {symbol}')
        if row.get('liquidatedOn') and row['lastTradingOn'] and row['liquidatedOn'] < row['lastTradingOn']:
            raise ValueError(f'Liquidation before last trade: {symbol}')
        source = row.get('source') or {}
        if not isinstance(source, dict) or source.get('type') not in ('user_report', 'official') or not isinstance(source.get('reference'), str) or not source['reference'].strip():
            raise ValueError(f'Missing evidence: {symbol}')
        url = source.get('url')
        if url is not None and (not isinstance(url, str) or urlparse(url).scheme != 'https' or not urlparse(url).netloc):
            raise ValueError(f'Invalid source URL: {symbol}')
        if not isinstance(row.get('officialVerified'), bool):
            raise ValueError(f'Missing verification state: {symbol}')
        if row['officialVerified'] != (source['type'] == 'official') or (row['officialVerified'] and not url):
            raise ValueError(f'Official evidence requires URL: {symbol}')
    return payload


def load_statuses(path=REGISTRY):
    payload = validate_registry(json.loads(Path(path).read_text(encoding='utf-8')))
    return {row['symbol'].replace('.', '-'): row for row in payload['securities']}


def is_delisted(symbol):
    return str(symbol or '').strip().upper().replace('.', '-') in load_statuses()


def apply_status(row, statuses=None):
    status = (load_statuses() if statuses is None else statuses).get(row['symbol'].replace('.', '-'))
    return {**row, 'active': False, 'listingStatus': status} if status else row


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Validate reviewed listing status without changing files')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--input', type=Path, default=REGISTRY)
    args = parser.parse_args()
    print(f'Validated {len(load_statuses(args.input))} listing status records')
