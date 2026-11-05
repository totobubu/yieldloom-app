"""Explicit, reviewed access grants for automated dividend reference collection.

A working public URL is not a data license. Missing/expired grants fail closed;
this module never purchases access or changes credentials/transport.
"""
from datetime import date
import json
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_ACCESS_PATH = Path(__file__).resolve().parents[2] / 'data-v2/dividend-reference-access.json'


def load_access(path=DEFAULT_ACCESS_PATH):
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding='utf-8'))
    if payload.get('schemaVersion') != 1 or not isinstance(payload.get('providers'), dict):
        raise ValueError('Invalid dividend reference access registry')
    return payload['providers']


def permits(access, provider, ticker, url, *, today=None):
    grant = access.get(provider, {})
    if not isinstance(grant, dict):
        return False
    if any(not isinstance(grant.get(field), list) for field in ('datasets', 'tickers', 'allowedHosts')):
        return False
    evidence = grant.get('evidenceUrl')
    if not isinstance(evidence, str):
        return False
    try:
        valid_until = date.fromisoformat(grant.get('validUntil', ''))
        reviewed = date.fromisoformat(grant.get('reviewedAt', ''))
    except (TypeError, ValueError):
        return False
    today = today or date.today()
    target = urlparse(url)
    return bool(
        grant.get('enabled') is True
        and grant.get('automatedCollection') is True
        and grant.get('storage') is True
        and grant.get('publicRedistribution') is True
        and grant.get('feeRequired') is False
        and evidence.startswith('https://')
        and reviewed <= today <= valid_until
        and 'dividends' in grant.get('datasets', [])
        and ticker in grant.get('tickers', [])
        and target.scheme == 'https' and not target.username and not target.password
        and target.hostname in grant.get('allowedHosts', [])
    )
