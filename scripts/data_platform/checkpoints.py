"""Verified private checkpoints; immutable objects first, conditional pointer last."""
from __future__ import annotations

import argparse
import gzip
import io
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


class ConditionalConflict(RuntimeError):
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
        try:
            return self.client.put_object(Bucket=BUCKET, Key=key, Body=body,
                CacheControl='private, no-store', **condition)
        except self.client.exceptions.ClientError as error:
            if error.response['Error']['Code'] in ('PreconditionFailed', '412', 'ConditionalRequestConflict', '409'):
                raise ConditionalConflict('Conditional write conflict') from error
            raise


    def inventory(self, prefix, limit=100000):
        entries = []
        for page in self.client.get_paginator('list_objects_v2').paginate(Bucket=BUCKET, Prefix=prefix):
            for row in page.get('Contents', []):
                entries.append({'key': row['Key'], 'etag': row['ETag'], 'bytes': row['Size'],
                                'modifiedAt': row['LastModified'].isoformat()})
                if len(entries) > limit:
                    raise ValueError('Remote inventory limit exceeded; no deletion is allowed')
        return entries

    def delete(self, key, expected):
        # Maintenance additionally serializes writers and validates a reviewed inventory.
        try:
            return self.client.delete_object(Bucket=BUCKET, Key=key, IfMatch=expected)
        except self.client.exceptions.ClientError as error:
            if error.response['Error']['Code'] in ('PreconditionFailed', '412', 'ConditionalRequestConflict', '409'):
                raise ConditionalConflict('Conditional delete conflict') from error
            raise


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
        remote.put(key, body)
    except ConditionalConflict:
        # An earlier attempt may already have saved these content-addressed bytes.
        pass
    existing, _ = remote.get(key)
    if existing != body:
        raise ValueError('Remote immutable object verification failed')


def check_database(path):
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite checkpoint failed integrity check')
        db.execute('SELECT id, identity_key, revision, value_hash, payload FROM observations LIMIT 0')
        db.execute('SELECT observation_id, source_id, url, sha, observed_at FROM evidence LIMIT 0')
        return {r[0] for r in db.execute('SELECT DISTINCT sha FROM documents')}


def check_collection(path, references=None):
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Collection checkpoint failed integrity check')
        # Both tables are required even for an empty/initial state database.
        db.execute('SELECT source_id, payload FROM state LIMIT 0')
        db.execute('SELECT url, sha, etag, modified FROM cache LIMIT 0')
        cached = {row[0] for row in db.execute('SELECT sha FROM cache')}
        if references is not None and not cached <= references:
            raise ValueError('Collection cache references absent archived documents')


def backup(store, remote, expected_etag, run_id, previous=None):
    if not re.fullmatch('[A-Za-z0-9._-]+', run_id):
        raise ValueError('Invalid run ID')
    from scripts.data_platform.remote_lock import remote_writer
    with remote_writer(remote, 'checkpoint'):
        _, actual = current(remote)
        if actual != expected_etag:
            raise ConditionalConflict('Checkpoint pointer conflict before backup')
        return _backup(store, remote, expected_etag, run_id, previous)


def _backup(store, remote, expected_etag, run_id, previous=None):
    if not re.fullmatch('[A-Za-z0-9._-]+', run_id):
        raise ValueError('Invalid run ID')
    # Only reuse descriptors from the manifest verified during this run's restore.
    known = {entry['path']: entry for entry in previous['files']} if previous else {}
    files = []
    with tempfile.TemporaryDirectory(dir=store.root) as temporary:
        database = Path(temporary) / 'observations.sqlite'
        with sqlite3.connect(database) as target:
            store.db.backup(target)
        hashes = check_database(database)
        state_database = Path(temporary) / 'collection.sqlite'
        with sqlite3.connect(state_database) as target:
            store.db.backup(target, name='collection')
        check_collection(state_database, hashes)
        if any(not re.fullmatch('[a-f0-9]{64}', sha) for sha in hashes):
            raise ValueError('Unsafe raw document address')
        paths = [('observations.sqlite', database), ('collection.sqlite', state_database)]
        paths += [('raw/' + sha, store.root / 'raw' / sha) for sha in sorted(hashes)]
        sizes = [known[name]['bytes'] if name.startswith('raw/') and name in known
                 else path.stat().st_size for name, path in paths]
        if len(paths) > MAX_FILES or any(not 0 < size <= MAX_FILE_BYTES for size in sizes) or sum(sizes) > MAX_TOTAL_BYTES:
            raise ValueError('Checkpoint exceeds supported restore budget; previous pointer is preserved')
        pending = []
        for name, path in paths:
            old = known.get(name)
            if name.startswith('raw/') and old:
                # Immutable archived bytes need neither restoring nor reading again.
                files.append(dict(old))
                continue
            body = path.read_bytes()
            sha = digest(body)
            if name.startswith('raw/') and name != 'raw/' + sha:
                raise ValueError('Local raw hash mismatch')
            entry = {'path': name, 'sha256': sha, 'bytes': len(body)}
            if name in ('observations.sqlite', 'collection.sqlite'):
                if old and old.get('uncompressedSha256', old['sha256']) == sha:
                    files.append(dict(old))
                    continue
                entry.update({'compression': 'gzip', 'uncompressedSha256': sha, 'uncompressedBytes': len(body)})
                body = gzip.compress(body, compresslevel=6, mtime=0)
                sha = digest(body)
                entry.update({'sha256': sha, 'bytes': len(body)})
                path = Path(temporary) / (name + '.gz')
                path.write_bytes(body)
            files.append(entry)
            if old != entry:
                pending.append((sha, path))
        if any(entry['bytes'] > MAX_FILE_BYTES for entry in files):
            raise ValueError('Checkpoint exceeds supported restore budget; previous pointer is preserved')
        for sha, path in pending:
            body = path.read_bytes()
            if digest(body) != sha:
                raise ValueError('Local object changed during checkpoint')
            immutable(remote, f'{PREFIX}/objects/{sha}', body)
    manifest = {'schemaVersion': 2, 'runId': run_id, 'files': files,
                'createdAt': datetime.now(timezone.utc).isoformat()}
    body = (encode(manifest) + '\n').encode()
    sha = digest(body)
    immutable(remote, f'{PREFIX}/manifests/{sha}.json', body)
    pointer = (encode({'schemaVersion': 1, 'manifestSha256': sha, 'runId': run_id}) + '\n').encode()
    # The ETag must be the one captured BEFORE collection, not a fresh read here.
    remote.put(f'{PREFIX}/current.json', pointer, expected=expected_etag)
    return manifest


def restore(remote, output, pointer=None, lazy_raw=False):
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
    databases, names = validate_manifest(manifest)
    version = manifest['schemaVersion']
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / 'restore'
        stage.mkdir(mode=0o700)
        for entry in files:
            if lazy_raw and entry['path'].startswith('raw/'):
                continue
            content = read_object(remote, entry)
            path = stage / entry['path']
            path.parent.mkdir(exist_ok=True, mode=0o700)
            path.write_bytes(content)
        references = check_database(stage / 'observations.sqlite')
        if version == 2:
            check_collection(stage / 'collection.sqlite', references)
            with sqlite3.connect(stage / 'observations.sqlite') as db:
                if db.execute('PRAGMA user_version').fetchone()[0] != 2:
                    raise ValueError('Unsupported split checkpoint database version')
                if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('state','cache')").fetchone():
                    raise ValueError('Split checkpoint embeds legacy collection state')
        if {'raw/' + value for value in references} != names - databases:
            raise ValueError('Checkpoint raw coverage mismatch')
        stage.rename(output)
    return manifest


def validate_manifest(manifest):
    files = manifest.get('files', [])
    version = manifest.get('schemaVersion')
    databases = {'observations.sqlite', 'collection.sqlite'} if version == 2 else {'observations.sqlite'}
    if version not in (1, 2) or not files or len(files) > MAX_FILES:
        raise ValueError('Invalid checkpoint manifest')
    names = set()
    for entry in files:
        name, checksum = entry['path'], entry['sha256']
        if (name not in databases and not re.fullmatch(r'raw/[a-f0-9]{64}', name)
                or not re.fullmatch('[a-f0-9]{64}', checksum) or name in names
                or not isinstance(entry['bytes'], int) or not 0 < entry['bytes'] <= MAX_FILE_BYTES):
            raise ValueError('Unsafe checkpoint file')
        if 'compression' in entry:
            if (name not in databases or entry['compression'] != 'gzip'
                    or not re.fullmatch('[a-f0-9]{64}', entry.get('uncompressedSha256', ''))
                    or not isinstance(entry.get('uncompressedBytes'), int)
                    or not 0 < entry['uncompressedBytes'] <= MAX_FILE_BYTES):
                raise ValueError('Invalid compressed checkpoint descriptor')
        elif 'uncompressedBytes' in entry or 'uncompressedSha256' in entry:
            raise ValueError('Compression metadata requires an encoding')
        if name.startswith('raw/') and name != 'raw/' + checksum:
            raise ValueError('Checkpoint raw address mismatch')
        names.add(name)
    if not databases <= names:
        raise ValueError('Checkpoint has no required database')
    if sum(entry.get('uncompressedBytes', entry['bytes']) for entry in files) > MAX_TOTAL_BYTES:
        raise ValueError('Checkpoint exceeds supported restore budget')
    return databases, names


def read_object(remote, entry):
    content, _ = remote.get(f"{PREFIX}/objects/{entry['sha256']}")
    if len(content) != entry['bytes'] or digest(content) != entry['sha256']:
        raise ValueError('Checkpoint object hash/size mismatch')
    if entry.get('compression') == 'gzip':
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as stream:
            content = stream.read(entry['uncompressedBytes'] + 1)
        if len(content) != entry['uncompressedBytes'] or digest(content) != entry['uncompressedSha256']:
            raise ValueError('Checkpoint decompressed hash/size mismatch')
    return content


def raw_loader(remote, manifest):
    entries = {entry['sha256']: entry for entry in manifest['files'] if entry['path'].startswith('raw/')}

    def load(sha):
        if sha not in entries:
            raise ValueError('Raw document absent from verified checkpoint')
        return read_object(remote, entries[sha])
    return load


class ObservedObjects:
    """Logical API attempts and payload bytes, independent of source HTTP counters."""
    def __init__(self, remote):
        self.remote = remote
        self.metrics = {'getRequests': 0, 'putRequests': 0, 'downloadedBytes': 0, 'uploadedBytes': 0}

    def get(self, key):
        self.metrics['getRequests'] += 1
        body, etag = self.remote.get(key)
        self.metrics['downloadedBytes'] += len(body)
        return body, etag

    def put(self, key, body, expected=None):
        self.metrics['putRequests'] += 1
        result = self.remote.put(key, body, expected=expected)
        self.metrics['uploadedBytes'] += len(body)
        return result


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
