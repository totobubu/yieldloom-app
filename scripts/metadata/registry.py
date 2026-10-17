"""Read the validated relationship registry without network/parser dependencies."""
from __future__ import annotations
import json
from pathlib import Path
import re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / 'data-v2/security-underlyings.json'
OFFICIAL_HOSTS = {
    'direxion': 'direxion.com', 'kurv': 'kurvinvest.com',
    'graniteshares': 'graniteshares.com', 'roundhill': 'roundhillinvestments.com',
    'yieldmax': 'yieldmaxetfs.com', 'defiance': 'defianceetfs.com',
    'rex': 'rexshares.com', 'proshares': 'proshares.com',
}


def load_verified_links(path: Path = REGISTRY) -> dict:
    payload = json.loads(path.read_text(encoding='utf-8'))
    if payload.get('schemaVersion') != 1 or not isinstance(payload.get('instruments'), dict):
        raise ValueError('Unsupported underlying registry')
    result = {}
    for ticker, row in payload['instruments'].items():
        evidence = row.get('evidence', {})
        source = urlparse(evidence.get('url', ''))
        if (ticker != row.get('symbol') or row.get('verificationStatus') != 'official'
            or not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,11}', str(row.get('underlying', '')))
            or ticker == row['underlying'] or source.scheme != 'https'
            or (source.hostname or '').removeprefix('www.') != OFFICIAL_HOSTS.get(row.get('provider'))
            or not re.fullmatch(r'[a-f0-9]{64}', evidence.get('contentSha256', ''))):
            raise ValueError(f'Invalid underlying registry record: {ticker}')
        result[ticker] = row
    return result
