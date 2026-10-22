"""Build approved per-entity projections and publish an independent dataset pointer."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.pipeline import Store, digest, encode, export_candidate, load_registry, private_path
from scripts.data_platform.policies import public_policy
from scripts.data_platform.checkpoints import MissingObject, immutable
from scripts.data_platform.locking import writer_lock


def write_json(root, path, value):
    body = (encode(value) + '\n').encode()
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    return {'path': path, 'sha256': digest(body), 'bytes': len(body)}


def build(store, registry, dataset, release_id, output, now=None):
    if dataset not in registry['datasets'] or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]*', release_id):
        raise ValueError('Invalid dataset/release ID')
    output = private_path(output)
    if output.exists():
        raise ValueError('Release output already exists')
    config = copy.deepcopy(registry)
    allowed = []
    for source in config['sources']:
        if not source.get('enabled') or dataset not in source['datasets']:
            continue
        try:
            public_policy(source, config, [dataset])
        except ValueError:
            continue
        if store.state(source['id']).get('currentObservationIds'):
            allowed.append(source)
    if not allowed:
        raise ValueError('No approved observations for dataset; keep its consumer disabled')
    config['sources'] = allowed
    # Export only the configured approved sources, not states from excluded sources.
    source_ids = {s['id'] for s in allowed}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        candidate = Path(temporary) / 'review'
        manifest = export_candidate(store, config, [dataset], candidate, True, now)
        observations = json.loads((candidate / (dataset + '.json')).read_text())['observations']
        observations = [r for r in observations if r['sourceId'] in source_ids]
        groups = {}
        for row in observations:
            groups.setdefault(row['entityId'], []).append(row)
        stage = Path(temporary) / 'release'
        stage.mkdir()
        files, entities = [], {}
        for entity, rows in sorted(groups.items()):
            filename = 'entities/' + digest(entity.encode()) + '.json'
            payload = {'schemaVersion': 1, 'releaseId': release_id, 'dataset': dataset,
                       'entityId': entity, 'observations': rows}
            if dataset == 'holdings':
                positions = {'schemaVersion': 1, 'releaseId': release_id, 'dataset': dataset,
                             'entityId': entity, 'observations': rows}
                full = write_json(stage, filename.replace('.json', '-positions.json'), positions)
                files.append(full)
                payload['positionCount'] = len(rows)
                payload['positionsFile'] = full
                payload['observations'] = sorted(rows, key=lambda r: Decimal(r['value'].get('Weight (%)') or '0'), reverse=True)[:10]
            entry = write_json(stage, filename, payload)
            files.append(entry)
            entities[entity] = entry
        catalog = json.loads((ROOT / 'data-v2/catalog-seed.json').read_text())['instruments']
        symbols = {r['symbol']: 'instrument:isin:' + r['isin'] for r in catalog
                   if r.get('isin') and 'instrument:isin:' + r['isin'] in entities}
        result = {'schemaVersion': 1, 'releaseId': release_id, 'dataset': dataset,
                  'createdAt': (now or datetime.now(timezone.utc)).isoformat(), 'files': files,
                  'entities': entities, 'symbols': symbols, 'policies': manifest['policies'],
                  'inputVersions': manifest['sourceVersions']}
        write_json(stage, 'manifest.json', result)
        stage.rename(output)
    return result


def publish(output, remote):
    output = private_path(output)
    body = (output / 'manifest.json').read_bytes()
    manifest = json.loads(body)
    dataset, release_id = manifest['dataset'], manifest['releaseId']
    if (manifest.get('schemaVersion') != 1 or not re.fullmatch('[a-z][a-z0-9-]*', dataset)
            or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]*', release_id)):
        raise ValueError('Invalid release manifest')
    # Recheck policy versions, source state and hashes in the build CLI before publication.
    prefix = f'datasets/{dataset}/releases/{release_id}'
    pointer_key = f'datasets/{dataset}/current.json'
    try:
        old_body, etag = remote.get(pointer_key)
        previous = json.loads(old_body)
        if previous.get('schemaVersion') != 1 or previous.get('dataset') != dataset:
            raise ValueError('Invalid previous dataset pointer')
    except MissingObject:
        etag, previous = None, None
    try:
        remote.get(prefix + '/manifest.json')
    except MissingObject:
        pass
    else:
        raise ValueError('Immutable release already exists')
    for entry in manifest['files']:
        if not re.fullmatch(r'entities/[a-f0-9]{64}(?:-positions)?\.json', entry['path']):
            raise ValueError('Unsafe release path')
        content = (output / entry['path']).read_bytes()
        if digest(content) != entry['sha256'] or len(content) != entry['bytes']:
            raise ValueError('Release file hash/size mismatch')
    for entry in manifest['files']:
        immutable(remote, prefix + '/' + entry['path'], (output / entry['path']).read_bytes())
    immutable(remote, prefix + '/manifest.json', body)
    pointer = {'schemaVersion': 1, 'dataset': dataset, 'releaseId': release_id,
               'manifestKey': prefix + '/manifest.json', 'manifestSha256': digest(body)}
    if previous:
        pointer['previous'] = {key: previous[key] for key in ('schemaVersion', 'dataset', 'releaseId', 'manifestKey', 'manifestSha256')}
    remote.put(pointer_key, (encode(pointer) + '\n').encode(), expected=etag)
    return pointer


def rollback(remote, dataset, target_release, expected_current, registry, now=None):
    if not re.fullmatch('[a-z][a-z0-9-]*', dataset):
        raise ValueError('Invalid dataset')
    if any(not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]*', value) for value in (target_release, expected_current)):
        raise ValueError('Invalid rollback release ID')
    key = f'datasets/{dataset}/current.json'
    body, etag = remote.get(key)
    pointer = json.loads(body)
    previous = pointer.get('previous', {})
    if pointer.get('releaseId') != expected_current or previous.get('releaseId') != target_release:
        raise ValueError('Rollback target/current release mismatch')
    expected_key = f'datasets/{dataset}/releases/{target_release}/manifest.json'
    if previous.get('dataset') != dataset or previous.get('manifestKey') != expected_key:
        raise ValueError('Invalid rollback pointer')
    body, _ = remote.get(expected_key)
    if digest(body) != previous.get('manifestSha256'):
        raise ValueError('Rollback manifest hash mismatch')
    manifest = json.loads(body)
    clock = now or datetime.now(timezone.utc)
    if clock - datetime.fromisoformat(manifest['createdAt']) > timedelta(hours=48):
        raise ValueError('Rollback release is too old; disable the consumer instead')
    for policy_id, policy in manifest['policies'].items():
        if policy != registry.get('policies', {}).get(policy_id) or policy.get('status') != 'approved' or policy.get('free') is not True:
            raise ValueError('Rollback policy requires review')
    for entry in manifest['files']:
        if not re.fullmatch(r'entities/[a-f0-9]{64}(?:-positions)?\.json', entry['path']):
            raise ValueError('Unsafe rollback file')
        content, _ = remote.get(expected_key.removesuffix('manifest.json') + entry['path'])
        if len(content) != entry['bytes'] or digest(content) != entry['sha256']:
            raise ValueError('Rollback file verification failed')
    remote.put(key, (encode(previous) + '\n').encode(), expected=etag)
    return previous


class PublicObjects:
    def __init__(self):
        import boto3
        from botocore.config import Config
        names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
        if not all(os.environ.get(name) for name in names) or os.environ[names[3]] == 'yieldloom-data-private':
            raise RuntimeError('Explicit public R2 configuration required')
        self.bucket = os.environ[names[3]]
        self.client = boto3.client('s3', endpoint_url=f'https://{os.environ[names[0]]}.r2.cloudflarestorage.com',
            aws_access_key_id=os.environ[names[1]], aws_secret_access_key=os.environ[names[2]],
            region_name='auto', config=Config(request_checksum_calculation='when_required', response_checksum_validation='when_required'))

    def get(self, key):
        try:
            row = self.client.get_object(Bucket=self.bucket, Key=key)
            return row['Body'].read(), row['ETag']
        except self.client.exceptions.ClientError as error:
            if error.response['Error']['Code'] in ('NoSuchKey', 'NotFound', '404'):
                raise MissingObject(key) from error
            raise

    def put(self, key, body, expected=None):
        condition = {'IfMatch': expected} if expected else {'IfNoneMatch': '*'}
        cache = 'public, max-age=60' if key.endswith('/current.json') else 'public, max-age=31536000, immutable'
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType='application/json', CacheControl=cache, **condition)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs='?', choices=['build', 'rollback'], default='build')
    parser.add_argument('--root', type=Path, default=ROOT / 'var/data-platform')
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--expected-current')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    if args.command == 'rollback':
        if not args.expected_current:
            parser.error('rollback requires --expected-current')
        print(encode(rollback(PublicObjects(), args.dataset, args.release_id, args.expected_current, load_registry())))
        return
    if args.output is None:
        parser.error('build requires --output')
    with writer_lock(private_path(args.root)):
        store = Store(args.root)
        try:
            result = build(store, load_registry(), args.dataset, args.release_id, args.output)
            if args.publish:
                publish(args.output, PublicObjects())
        finally:
            store.close()
    print(encode({'dataset': result['dataset'], 'releaseId': result['releaseId'], 'files': len(result['files']), 'published': args.publish}))


if __name__ == '__main__':
    main()
