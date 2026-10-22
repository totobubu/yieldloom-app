"""Verified private checkpoints; immutable objects first, conditional pointer last."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.pipeline import Store, digest, encode, private_path
from scripts.data_platform.locking import writer_lock

PREFIX = 'platform/v1'
BUCKET = 'yieldloom-data-private'
MAX_FILE_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_FILES = 50000


class MissingObject(Exception):
    pass


class R2Objects:
    def __init__(self):
        # Deliberately no fallback to the public bucket or .env.r2.
        names = ['DATA_PRIVATE_R2_ACCOUNT_ID', 'DATA_PRIVATE_R2_ACCESS_KEY_ID',
                 'DATA_PRIVATE_R2_SECRET_ACCESS_KEY', 'DATA_PRIVATE_R2_BUCKET']
        if not all(os.environ.get(name) for name in names):
            raise RuntimeError('Private R2 configuration required: ' + ', '.join(names))
        if os.environ[names[3]] != BUCKET:
            raise ValueError('Private checkpoints require the dedicated private bucket')
        import boto3
        from botocore.config import Config
        self.client = boto3.client('s3', endpoint_url=f'https://{os.environ[names[0]]}.r2.cloudflarestorage.com',
            aws_access_key_id=os.environ[names[1]], aws_secret_access_key=os.environ[names[2]],
            region_name='auto', config=Config(signature_version='s3v4',
                request_checksum_calculation='when_required', response_checksum_validation='when_required'))

    def get(self, key):
        try:
            result = self.client.get_object(Bucket=BUCKET, Key=key)
            return result['Body'].read(), result['ETag']
        except self.client.exceptions.ClientError as error:
            if error.response['Error']['Code'] in ('NoSuchKey', '404', 'NotFound'):
                raise MissingObject(key) from error
            raise

    def put(self, key, body, expected=None):
        condition = {'IfMatch': expected} if expected else {'IfNoneMatch': '*'}
        return self.client.put_object(Bucket=BUCKET, Key=key, Body=body,
            CacheControl='private, no-store', **condition)


def current(remote):
    try:
        body, etag = remote.get(f'{PREFIX}/current.json')
        value = json.loads(body)
        if value.get('schemaVersion') != 1 or not re.fullmatch('[a-f0-9]{64}', value.get('manifestSha256', '')):
            raise ValueError('Invalid checkpoint pointer')
        return value, etag
    except MissingObject:
        return None, None


def immutable(remote, key, body):
    try:
        existing, _ = remote.get(key)
    except MissingObject:
        remote.put(key, body)
        existing, _ = remote.get(key)
    if existing != body:
        raise ValueError('Remote immutable object verification failed')


def check_database(path):
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite checkpoint failed integrity check')
        return {r[0] for r in db.execute('SELECT DISTINCT sha FROM documents')}


def backup(store, remote, expected_etag, run_id):
    if not re.fullmatch('[A-Za-z0-9._-]+', run_id):
        raise ValueError('Invalid run ID')
    files = []
    with tempfile.TemporaryDirectory(dir=store.root) as temporary:
        database = Path(temporary) / 'observations.sqlite'
        with sqlite3.connect(database) as target:
            store.db.backup(target)
        hashes = check_database(database)
        if any(not re.fullmatch('[a-f0-9]{64}', sha) for sha in hashes):
            raise ValueError('Unsafe raw document address')
        paths = [('observations.sqlite', database)] + [('raw/' + sha, store.root / 'raw' / sha) for sha in sorted(hashes)]
        sizes = [path.stat().st_size for _, path in paths]
        if len(paths) > MAX_FILES or any(not 0 < size <= MAX_FILE_BYTES for size in sizes) or sum(sizes) > MAX_TOTAL_BYTES:
            raise ValueError('Checkpoint exceeds supported restore budget; previous pointer is preserved')
        for name, path in paths:
            body = path.read_bytes()
            sha = digest(body)
            if name.startswith('raw/') and name != 'raw/' + sha:
                raise ValueError('Local raw hash mismatch')
            key = f'{PREFIX}/objects/{sha}'
            immutable(remote, key, body)
            files.append({'path': name, 'sha256': sha, 'bytes': len(body)})
    manifest = {'schemaVersion': 1, 'runId': run_id, 'files': files,
                'createdAt': datetime.now(timezone.utc).isoformat()}
    body = (encode(manifest) + '\n').encode()
    sha = digest(body)
    immutable(remote, f'{PREFIX}/manifests/{sha}.json', body)
    pointer = (encode({'schemaVersion': 1, 'manifestSha256': sha, 'runId': run_id}) + '\n').encode()
    # The ETag must be the one captured BEFORE collection, not a fresh read here.
    remote.put(f'{PREFIX}/current.json', pointer, expected=expected_etag)
    return manifest


def restore(remote, output, pointer=None):
    output = private_path(output)
    if output.exists():
        raise ValueError('Restore target must not exist')
    if pointer is None:
        pointer, _ = current(remote)
    if pointer is None:
        raise MissingObject('No checkpoint; initial collection requires explicit bootstrap')
    sha = pointer['manifestSha256']
    if not re.fullmatch('[a-f0-9]{64}', sha):
        raise ValueError('Invalid manifest hash')
    body, _ = remote.get(f'{PREFIX}/manifests/{sha}.json')
    if digest(body) != sha:
        raise ValueError('Checkpoint manifest hash mismatch')
    manifest = json.loads(body)
    files = manifest.get('files', [])
    if manifest.get('schemaVersion') != 1 or not files or len(files) > MAX_FILES:
        raise ValueError('Invalid checkpoint manifest')
    names = set()
    for entry in files:
        name, checksum = entry['path'], entry['sha256']
        if (name != 'observations.sqlite' and not re.fullmatch(r'raw/[a-f0-9]{64}', name)
                or not re.fullmatch('[a-f0-9]{64}', checksum) or name in names
                or not isinstance(entry['bytes'], int) or not 0 < entry['bytes'] <= MAX_FILE_BYTES):
            raise ValueError('Unsafe checkpoint file')
        names.add(name)
    if 'observations.sqlite' not in names:
        raise ValueError('Checkpoint has no database')
    if sum(entry['bytes'] for entry in files) > MAX_TOTAL_BYTES:
        raise ValueError('Checkpoint exceeds supported restore budget')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / 'restore'
        stage.mkdir(mode=0o700)
        for entry in files:
            content, _ = remote.get(f"{PREFIX}/objects/{entry['sha256']}")
            if len(content) != entry['bytes'] or digest(content) != entry['sha256']:
                raise ValueError('Checkpoint object hash/size mismatch')
            if entry['path'].startswith('raw/') and entry['path'] != 'raw/' + digest(content):
                raise ValueError('Checkpoint raw address mismatch')
            path = stage / entry['path']
            path.parent.mkdir(exist_ok=True, mode=0o700)
            path.write_bytes(content)
        references = check_database(stage / 'observations.sqlite')
        if {'raw/' + value for value in references} != names - {'observations.sqlite'}:
            raise ValueError('Checkpoint raw coverage mismatch')
        stage.rename(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['backup', 'restore'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--run-id')
    parser.add_argument('--expected-etag', help='Pointer ETag captured before local collection')
    parser.add_argument('--bootstrap', action='store_true', help='Create the first pointer only')
    args = parser.parse_args()
    remote = R2Objects()
    with writer_lock(private_path(args.root)):
        if args.command == 'restore':
            result = restore(remote, args.root)
        else:
            if not args.run_id:
                parser.error('backup requires --run-id')
            if not args.bootstrap and not args.expected_etag:
                parser.error('backup requires --expected-etag or explicit --bootstrap')
            if not (args.root / 'observations.sqlite').is_file():
                parser.error('backup requires an existing observation database')
            store = Store(args.root)
            try:
                result = backup(store, remote, args.expected_etag, args.run_id)
            finally:
                store.close()
    print(encode({'runId': result['runId'], 'files': len(result['files'])}))


if __name__ == '__main__':
    main()
