"""Catalog reconciliation and publication quality; never edits instrument identity."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import re

CATALOG = Path(__file__).resolve().parents[2] / 'data-v2/catalog-seed.json'
UNITS = {'nav': 'currency_per_share', 'aum': 'currency', 'closingPrice': 'currency_per_share',
         'sharesOutstanding': 'shares', 'medianSpread30D': 'percent', 'secYield30D': 'percent',
         'trailingYield12M': 'percent', 'prospectusExpenseRatio': 'percent',
         'referenceRate': 'quote_currency_per_base_currency', 'position': 'position'}


def valid_isin(value):
    if not isinstance(value, str) or not re.fullmatch('[A-Z]{2}[A-Z0-9]{9}[0-9]', value):
        return False
    digits = ''.join(str(int(c, 36)) if c.isalpha() else c for c in value)
    total = 0
    for index, char in enumerate(reversed(digits)):
        n = int(char) * (2 if index % 2 else 1)
        total += n // 10 + n % 10
    return total % 10 == 0


def observations(store, source_id):
    for identifier in store.state(source_id).get('currentObservationIds', []):
        yield json.loads(store.db.execute('SELECT payload FROM observations WHERE id=?', (identifier,)).fetchone()[0])


def evaluate(store, config, catalog=None, now=None):
    clock = now or datetime.now(timezone.utc)
    catalog = catalog if catalog is not None else json.loads(CATALOG.read_text())['instruments']
    symbols = {}
    for row in catalog:
        symbols.setdefault(row['symbol'], []).append(row)
    report = []
    for source in config['sources']:
        if not source.get('enabled'):
            continue
        errors, warnings, counts, fields = set(), set(), Counter(), Counter()
        identity = source.get('entityId', '')
        if identity.startswith('instrument:isin:'):
            isin = identity.removeprefix('instrument:isin:')
            candidates = symbols.get(source.get('symbol'), [])
            if not valid_isin(isin):
                errors.add('invalid_source_isin')
            if len(candidates) != 1 or candidates[0].get('isin') != isin:
                errors.add('catalog_identity_conflict')
        for row in observations(store, source['id']):
            counts[row['dataset']] += 1
            fields[row['field']] += 1
            if row['field'] in UNITS and row['unit'] != UNITS[row['field']]:
                errors.add('unit_contract_mismatch')
            if row['unit'].startswith('currency') and not re.fullmatch('[A-Z]{3}', row.get('currency') or ''):
                errors.add('currency_missing')
            if row['field'] in ('nav', 'aum', 'closingPrice', 'referenceRate') and Decimal(row['value']) <= 0:
                errors.add('nonpositive_value')
            if not row.get('asOfDate'):
                warnings.add('as_of_unknown')
            elif row['field'] not in ('filing', 'listing'):
                age = clock.date() - datetime.fromisoformat(row['asOfDate']).date()
                days = 60 if row['field'] in ('secYield30D', 'trailingYield12M') else 5
                if row['dataset'] in ('fund-observations', 'holdings', 'fx') and age > timedelta(days=days):
                    warnings.add('stale_observation')
            if row['dataset'] == 'identity':
                value = row['value']
                symbol = value.get('Symbol') or value.get('ACT Symbol')
                match = symbols.get(symbol, [])
                expected = 'NASDAQ' if source['id'] == 'nasdaq-listed' else {'N': 'NYSE'}.get(value.get('Exchange'))
                if len(match) == 1 and expected and match[0].get('market') == expected:
                    counts['suggestedCatalogMatches'] += 1
                else:
                    counts['identityReviewRequired'] += 1
        state = store.state(source['id'])
        if state.get('failureCount'):
            errors.add('source_collection_failed')
        success = state.get('lastSuccessAt')
        if not success or clock - datetime.fromisoformat(success) > timedelta(hours=48):
            warnings.add('collection_stale')
        report.append({'sourceId': source['id'], 'errors': sorted(errors),
                       'warnings': sorted(warnings), 'counts': dict(counts), 'fields': dict(fields)})
    return {'schemaVersion': 1, 'checkedAt': clock.isoformat(), 'sources': report,
            'catalogInvalidIsinCount': sum(not valid_isin(r.get('isin')) for r in catalog),
            'catalogIdentityReview': [{'symbol': r['symbol'], 'reason': 'missing_isin' if not r.get('isin') else 'invalid_isin'}
                                      for r in catalog if not valid_isin(r.get('isin'))],
            'identityPolicy': 'suggestions_only_no_catalog_mutation'}


def publication_errors(source_report, datasets):
    errors = list(source_report['errors'])
    for warning in source_report['warnings']:
        if warning in ('stale_observation', 'collection_stale') or (warning == 'as_of_unknown' and 'fund-profile' in datasets):
            errors.append(warning)
    if 'identity' in datasets:
        errors.append('discovery_candidates_not_canonical_catalog')
    return errors
