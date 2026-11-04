"""Read-only preservation of legacy amountFixed rows; never merges or deletes data."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class NumberLexeme(str):
    """Keep original numeric tokens, including trailing zeroes and exponents."""


def loads(body):
    return json.loads(body, parse_float=NumberLexeme, parse_int=NumberLexeme,
                      parse_constant=lambda token: (_ for _ in ()).throw(ValueError('Invalid JSON number')))


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def valid_isin(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{9}[0-9]', value):
        return False
    digits = ''.join(str(ord(c) - 55) if c.isalpha() else c for c in value)
    total = 0
    for index, digit in enumerate(reversed(digits)):
        number = int(digit) * (2 if index % 2 else 1)
        total += number // 10 + number % 10
    return total % 10 == 0


def observed_identity(payload, row=None):
    info = payload.get('tickerInfo', {}) if isinstance(payload, dict) else {}
    if not isinstance(info, dict):
        raise ValueError('Invalid market tickerInfo')
    fields = {'ticker': ('symbol', 'Symbol', 'ticker'), 'isin': ('isin', 'ISIN'),
              'market': ('market', 'exchange'), 'currency': ('currency', 'Currency'),
              'validFrom': ('validFrom',), 'validTo': ('validTo',)}
    # Preserve all supplied variants. Conflicting values are never resolved by precedence.
    claims = {field: [{'scope': scope, 'field': key, 'value': source[key]}
                      for scope, source in [('row', row or {}), ('tickerInfo', info), ('root', payload if isinstance(payload, dict) else {})]
                      for key in keys if key in source]
              for field, keys in fields.items()}
    return claims


def extract_file(body, relative, source_object=None):
    payload = loads(body)
    groups = []
    if isinstance(payload, list):
        groups.append(('', payload))
    elif isinstance(payload, dict):
        for name in ('backtestData', 'dividend_history', 'dividends'):
            if name in payload:
                if not isinstance(payload[name], list):
                    raise ValueError('Invalid market history array')
                groups.append(('/' + name, payload[name]))
    if not groups:
        raise ValueError(f'Unsupported market history shape: {relative}')
    source_object = source_object or {'kind': 'local-market-copy', 'bucket': None, 'key': None, 'sha256': sha(body)}
    identity = observed_identity(payload)
    records = []
    for pointer, rows in groups:
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError(f'Invalid market history row: {relative}')
            if 'amountFixed' not in row:
                continue
            value = row['amountFixed']
            issues = []
            kind = 'number' if isinstance(value, NumberLexeme) else 'string' if isinstance(value, str) else 'other'
            try:
                if kind == 'other' or not Decimal(str(value)).is_finite():
                    raise InvalidOperation()
            except (InvalidOperation, ValueError):
                issues.append('invalid_amount_preserved')
            records.append({'recordId': sha(encoded([relative, sha(body), pointer, index])),
                            'sourceFile': relative, 'sourceFileSha256': sha(body), 'sourceObject': source_object,
                            'jsonPointer': f'{pointer}/{index}',
                            'amountFixed': {'raw': value, 'valueType': kind},
                            'observedIdentityClaims': observed_identity(payload, row),
                            'originalFileMetadata': {key: value for key, value in payload.items() if key not in ('backtestData', 'dividend_history', 'dividends')} if isinstance(payload, dict) else {},
                            'originalRow': row, 'issues': issues,
                            'confirmation': 'user-confirmed-legacy-amountFixed',
                            'sourceVerification': 'not-reverified',
                            'sourceReferenceStatus': 'present-unverified' if any(container.get(key) for container in [row, payload if isinstance(payload, dict) else {}, payload.get('tickerInfo', {}) if isinstance(payload, dict) else {}] for key in ('official_url', 'officialUrl', 'sourceUrl', 'source', 'sources')) else 'missing'})
    return records, identity


def identity_review(claims, catalog):
    issues = ['identity_not_reverified']
    values = {key: sorted({str(item['value']) for item in rows if item['value']}) for key, rows in claims.items()}
    for key in ('isin', 'ticker', 'market', 'currency'):
        if not values[key]:
            issues.append('missing_' + key)
        if len(values[key]) > 1:
            issues.append('conflicting_' + key)
    if any(not valid_isin(isin) for isin in values['isin']):
        issues.append('invalid_isin_checksum_or_format')
    candidates = [row for row in catalog if row.get('symbol') in values['ticker'] or row.get('isin') in values['isin']]
    by_isin = defaultdict(set)
    for row in catalog:
        if row.get('isin'):
            by_isin[row['isin']].add((row.get('symbol'), row.get('market'), row.get('currency')))
    if any(len(by_isin[isin]) > 1 for isin in {row.get('isin') for row in candidates}):
        issues.append('catalog_isin_multiple_listings_needs_review')
    if any(row.get(key) and values[key] and str(row[key]) not in values[key]
           for row in candidates for key in ('isin', 'market', 'currency')):
        issues.append('catalog_disagreement')
    return {'issues': sorted(set(issues)), 'catalogCandidates': candidates,
            'mappingStatus': 'unresolved', 'mergeAllowed': False}


def inventory(input_dir):
    if not input_dir.is_dir():
        raise ValueError('Market source directory is missing; no empty inventory was created')
    paths = sorted(input_dir.rglob('*.json'))
    if not paths:
        raise ValueError('No market JSON files available')
    result = []
    for path in paths:
        if path.is_symlink() or input_dir.resolve() not in path.resolve().parents:
            raise ValueError('Source symlinks or paths outside input are rejected')
        result.append((path.relative_to(input_dir).as_posix(), path.read_bytes()))
    return result


def preserve(input_dir, output_dir, catalog_path=None, source_manifest_path=None):
    source = input_dir.resolve()
    target = output_dir.resolve()
    if source == target or source in target.parents or target in source.parents:
        raise ValueError('Output must be separate from source')
    for forbidden in (ROOT / 'public', ROOT / 'dist'):
        if target == forbidden or forbidden in target.parents:
            raise ValueError('Preservation output must remain outside public/dist')
    if output_dir.exists():
        raise ValueError('Use a new output directory; existing preservation is immutable')
    sources = inventory(source)
    origin_bytes = source_manifest_path.read_bytes() if source_manifest_path else None
    origins = json.loads(origin_bytes) if origin_bytes else {}
    if origin_bytes and set(origins) != {name for name, _ in sources}:
        raise ValueError('Source object manifest must cover the exact input file set')
    catalog_bytes = catalog_path.read_bytes() if catalog_path else None
    catalog = json.loads(catalog_bytes).get('instruments', []) if catalog_bytes else []
    records, files, backups = [], [], {}
    for relative, body in sources:
        origin = {'kind': 'local-market-copy', 'bucket': None, 'key': None, 'sha256': sha(body)}
        if origin_bytes:
            claim = origins[relative]
            if not isinstance(claim, dict) or set(claim) - {'bucket', 'key', 'sha256', 'etag', 'copiedAt'}:
                raise ValueError('Unexpected source object manifest fields')
            if not isinstance(claim.get('bucket'), str) or not claim['bucket'] or not isinstance(claim.get('key'), str) or not claim['key'] or claim.get('sha256') != sha(body):
                raise ValueError('Source bucket/key/hash evidence is missing or differs')
            origin = {'kind': 'r2-object-copy', **claim}
        rows, claims = extract_file(body, relative, origin)
        review = identity_review(claims, catalog)
        entry = {'path': relative, 'sha256': sha(body), 'bytes': len(body),
                 'amountFixedRows': len(rows), 'identityReview': review, 'sourceObject': origin}
        if rows:
            entry['preservedSource'] = f'originals/{sha(body)}.json'
            backups[entry['preservedSource']] = body
        if rows:
            aggregate = {key: [claim for row in rows for claim in row['observedIdentityClaims'][key]] for key in claims}
            entry['identityReview'] = identity_review(aggregate, catalog)
        records.extend(rows)
        files.append(entry)
    if not records:
        raise ValueError('No amountFixed rows found; no extraction or deletion readiness claimed')
    # Nothing is written until the complete input set has parsed successfully.
    output_dir.mkdir(parents=True, mode=0o700)
    (output_dir / 'originals').mkdir(mode=0o700)
    for name, body in backups.items():
        (output_dir / name).write_bytes(body)
    events = encoded({'schemaVersion': 1, 'records': records})
    (output_dir / 'dividends.json').write_bytes(events)
    manifest = {'schemaVersion': 1, 'extractorVersion': 1, 'files': files,
                'catalogSha256': sha(catalog_bytes) if catalog_bytes else None,
                'sourceManifestSha256': sha(origin_bytes) if origin_bytes else None,
                'catalogVerification': 'unverified-candidates-only',
                'records': len(records), 'recordsSha256': sha(events), 'deletionAuthorized': False}
    (output_dir / 'manifest.json').write_bytes(encoded(manifest))
    report = verify(source, output_dir)
    (output_dir / 'verification.json').write_bytes(encoded(report))
    return report


def verify(input_dir, output_dir):
    manifest = json.loads((output_dir / 'manifest.json').read_bytes())
    current = dict(inventory(input_dir.resolve()))
    if set(current) != {entry['path'] for entry in manifest['files']}:
        raise ValueError('Source inventory changed')
    reconstructed = []
    for entry in manifest['files']:
        body = current[entry['path']]
        if sha(body) != entry['sha256'] or len(body) != entry['bytes']:
            raise ValueError('Original source changed')
        if entry['sourceObject'].get('sha256') != sha(body):
            raise ValueError('Original object hash evidence differs')
        rows, _ = extract_file(body, entry['path'], entry['sourceObject'])
        if len(rows) != entry['amountFixedRows']:
            raise ValueError('Extraction row count mismatch')
        if rows:
            expected = f"originals/{sha(body)}.json"
            if entry.get('preservedSource') != expected or (output_dir / expected).read_bytes() != body:
                raise ValueError('Preserved original bytes differ')
        reconstructed.extend(rows)
    exported = (output_dir / 'dividends.json').read_bytes()
    if sha(exported) != manifest['recordsSha256'] or loads(exported)['records'] != reconstructed:
        raise ValueError('Extracted values, source, identity or row evidence differ')
    if len(reconstructed) != manifest['records']:
        raise ValueError('Total count mismatch')
    return {'verified': True, 'sourceFiles': len(current), 'fixedDividendRows': len(reconstructed),
            'preservedFiles': sum(bool(entry['amountFixedRows']) for entry in manifest['files']),
            'reviewRequiredFiles': sum(bool(entry['identityReview']['issues']) for entry in manifest['files']),
            'identityVerified': False, 'deletionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['extract', 'verify'])
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--source-manifest', type=Path, help='Local JSON mapping file path to original R2 bucket/key/sha256; no network calls')
    args = parser.parse_args()
    result = preserve(args.input_dir, args.output_dir, args.catalog, args.source_manifest) if args.command == 'extract' else verify(args.input_dir, args.output_dir)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
