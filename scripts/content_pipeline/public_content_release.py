"""Opt-in, content-addressed public projections. Never uploads raw/private state."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.cloud.r2_helper import get_r2_client
from scripts.content_pipeline.validate_refresh_outputs import validate

ALLOWED = re.compile(r'(?:distribution-index|distribution-ticker-[a-z0-9.-]+|stock-evidence-index|stock-evidence-[a-z0-9.-]+|price-index|price-quality)\.json', re.I)


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read(client, bucket, key):
    try:
        response = client.get_object(Bucket=bucket, Key=key)
        return json.loads(response['Body'].read()), response['ETag']
    except Exception as error:
        if getattr(error, 'response', {}).get('Error', {}).get('Code') in {'404', 'NoSuchKey', 'NotFound'}:
            return None, None
        raise


def publish(client, bucket, root, channel, provenance):
    if not re.fullmatch(r'production|preview-[a-f0-9]{16}', channel):
        raise ValueError('Invalid isolated channel')
    validate(root)
    prefix = f'public-content/{channel}'
    pointer_key = f'{prefix}/current.json'
    pointer, etag = read(client, bucket, pointer_key)
    previous = None
    if pointer:
        rid = pointer.get('releaseId', '')
        if not re.fullmatch('[a-f0-9]{64}', rid):
            raise ValueError('Invalid current release')
        previous, _ = read(client, bucket, f'{prefix}/releases/{rid}/manifest.json')
        if not previous or previous.get('releaseId') != rid:
            raise ValueError('Current manifest unavailable')
    old_files = (previous or {}).get('files', {})
    files, bodies = {}, {}
    payloads = {}
    for path in sorted(root.iterdir()):
        if not ALLOWED.fullmatch(path.name):
            continue
        if path.is_symlink() or not path.is_file():
            raise ValueError('Public projections must be regular files')
        body = path.read_bytes()
        payload = json.loads(body)
        payloads[path.name] = payload
        # Export time alone does not change market facts. Preserve original bytes
        # (including source dates and hashes) whenever a projection does change.
        semantic = dict(payload)
        semantic.pop('generatedAt', None)
        fingerprint = digest(encode(semantic))
        old = old_files.get(path.name)
        if old and old.get('semanticSha256') == fingerprint:
            files[path.name] = old
        else:
            sha = digest(body)
            files[path.name] = {'sha256': sha, 'semanticSha256': fingerprint}
            bodies[sha] = body
    # Every index reference must resolve inside this same snapshot.
    for name in ('distribution-index.json', 'stock-evidence-index.json'):
        if name not in files:
            if name == 'stock-evidence-index.json':
                continue
            raise ValueError('Missing distribution index')
        for row in json.loads((root / name).read_text())['tickers']:
            path = row.get('historyUrl', '')
            if not path.startswith('/content-studio/') or path.removeprefix('/content-studio/') not in files:
                raise ValueError('Missing or unsafe referenced history')
    # A partial export must never erase an already published projection/history.
    if set(old_files) - set(files):
        raise ValueError('Projection removal blocked; restore complete export')
    for name, old in old_files.items():
        if files[name] == old or not (name.startswith('distribution-ticker-') or name.startswith('stock-evidence-') and name != 'stock-evidence-index.json'):
            continue
        body = client.get_object(Bucket=bucket, Key=f"{prefix}/objects/{old['sha256']}.json")['Body'].read()
        if digest(body) != old['sha256']:
            raise ValueError('Previous projection hash mismatch')
        previous_rows = json.loads(body).get('history', [])
        current_rows = {encode(row) for row in payloads[name].get('history', [])}
        if any(encode(row) not in current_rows for row in previous_rows):
            raise ValueError('History loss or unreviewed correction blocked')
    rid = digest(encode(files))
    if pointer and pointer['releaseId'] == rid:
        return {'status': 'unchanged', 'releaseId': rid, 'uploadedObjects': 0}
    # Immutable objects are create-only; retry verifies pre-existing bytes.
    def immutable(key, body):
        try:
            client.put_object(Bucket=bucket, Key=key, Body=body, ContentType='application/json', CacheControl='public, max-age=31536000, immutable', IfNoneMatch='*')
        except Exception as error:
            if getattr(error, 'response', {}).get('Error', {}).get('Code') not in {'PreconditionFailed', '412'}:
                raise
            existing = client.get_object(Bucket=bucket, Key=key)['Body'].read()
            if existing != body:
                raise ValueError('Immutable object collision')
    for sha, body in bodies.items():
        immutable(f'{prefix}/objects/{sha}.json', body)
    manifest_key = f'{prefix}/releases/{rid}/manifest.json'
    manifest, _ = read(client, bucket, manifest_key)
    if manifest:
        if manifest.get('files') != files or manifest.get('releaseId') != rid:
            raise ValueError('Immutable manifest collision')
    else:
        immutable(manifest_key, encode({'schemaVersion': 1, 'releaseId': rid, 'files': files, 'publishedAt': datetime.now(timezone.utc).isoformat(), 'provenance': provenance}))
    # Lost races fail instead of overwriting another publisher's current pointer.
    client.put_object(Bucket=bucket, Key=pointer_key, Body=encode({'schemaVersion': 1, 'releaseId': rid}), ContentType='application/json', CacheControl='public, max-age=60, must-revalidate', **({'IfMatch': etag} if etag else {'IfNoneMatch': '*'}))
    return {'status': 'published', 'releaseId': rid, 'uploadedObjects': len(bodies)}


def restore(client, bucket, root, channel):
    prefix = f'public-content/{channel}'
    pointer, _ = read(client, bucket, f'{prefix}/current.json')
    if not pointer or not re.fullmatch('[a-f0-9]{64}', pointer.get('releaseId', '')):
        raise ValueError('Bootstrap and verify shadow publication before R2-only restore')
    manifest, _ = read(client, bucket, f"{prefix}/releases/{pointer['releaseId']}/manifest.json")
    if not manifest or manifest.get('releaseId') != pointer['releaseId']:
        raise ValueError('Invalid restoration manifest')
    bodies = {}
    for name, entry in manifest['files'].items():
        if not ALLOWED.fullmatch(name) or not re.fullmatch('[a-f0-9]{64}', entry.get('sha256', '')):
            raise ValueError('Unsafe restoration path')
        body = client.get_object(Bucket=bucket, Key=f"{prefix}/objects/{entry['sha256']}.json")['Body'].read()
        if digest(body) != entry['sha256']:
            raise ValueError('Restoration hash mismatch')
        json.loads(body)
        bodies[name] = body
    # Verify all objects before changing any local projection.
    root.mkdir(parents=True, exist_ok=True)
    for name, body in bodies.items():
        target = root / name
        if target.is_symlink():
            raise ValueError('Projection symlink rejected')
        target.write_bytes(body)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--branch', required=True)
    parser.add_argument('--restore', action='store_true')
    args = parser.parse_args()
    branch = args.branch
    if os.environ.get('GITHUB_REF_NAME') != branch:
        raise ValueError('Branch must match workflow ref')
    channel = 'production' if branch == 'main' else 'preview-' + digest(branch.encode())[:16]
    client, bucket = get_r2_client()
    if not client or not bucket:
        raise RuntimeError('R2 publication credentials required')
    if args.restore:
        restore(client, bucket, ROOT / 'public/content-studio', channel)
        return
    print(json.dumps(publish(client, bucket, ROOT / 'public/content-studio', channel, {'commit': os.environ.get('GITHUB_SHA'), 'runId': os.environ.get('GITHUB_RUN_ID')})))


if __name__ == '__main__':
    main()
