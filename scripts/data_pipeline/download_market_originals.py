"""Download authorized legacy R2 market objects without any remote mutations."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREFIXES = tuple(f'data/{market}/' for market in ('bats', 'kosdaq', 'kospi', 'nasdaq', 'nyse'))
KEY = re.compile(r'data/(?:bats|kosdaq|kospi|nasdaq|nyse)/[A-Za-z0-9._-]+\.json')


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def listing(client, bucket):
    objects = {}
    for prefix in PREFIXES:
        for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix):
            for row in page.get('Contents', []):
                key = row['Key']
                if not KEY.fullmatch(key) or '..' in key.split('/') or key in objects:
                    raise ValueError('Unexpected or duplicate source key; no flattening allowed')
                if not row.get('ETag'):
                    raise ValueError('Source object ETag is required')
                objects[key] = {'size': row['Size'], 'etag': row['ETag'], 'lastModified': str(row.get('LastModified', ''))}
    if not objects:
        raise ValueError('No market objects found')
    return objects


def download(client, bucket, output):
    if bucket != 'divgrow-data':
        raise ValueError('Only the authorized divgrow-data bucket is supported')
    target = output.resolve()
    for forbidden in (ROOT / 'public', ROOT / 'dist'):
        if target == forbidden or forbidden in target.parents:
            raise ValueError('Raw originals must remain outside public/dist')
    if output.exists():
        raise ValueError('Use a new isolated output directory')
    before = listing(client, bucket)
    output.mkdir(parents=True, mode=0o700)
    sources = output / 'sources'
    sources.mkdir(mode=0o700)
    save(output / 'inventory-before.json', before)
    origins = {}
    try:
        for key, metadata in sorted(before.items()):
            relative = key.removeprefix('data/')
            path = sources / relative
            path.parent.mkdir(exist_ok=True, mode=0o700)
            response = client.get_object(Bucket=bucket, Key=key, IfMatch=metadata['etag'])
            body = response['Body']
            try:
                if response.get('ETag') != metadata['etag'] or response.get('ContentLength') != metadata['size']:
                    raise ValueError('Source metadata changed during retrieval')
                hasher, length = hashlib.sha256(), 0
                with path.open('xb') as handle:
                    while chunk := body.read(1024 * 1024):
                        handle.write(chunk)
                        hasher.update(chunk)
                        length += len(chunk)
                if length != metadata['size']:
                    raise ValueError('Truncated raw object retrieval')
                origins[relative] = {'bucket': bucket, 'key': key, 'sha256': hasher.hexdigest(), 'etag': metadata['etag']}
            finally:
                body.close()
        after = listing(client, bucket)
        save(output / 'inventory-after.json', after)
        if before != after:
            raise ValueError('Remote source inventory changed; this is not a stable snapshot')
        save(output / 'source-objects.json', origins)
        report = {'verifiedRawTransfer': True, 'sourceObjects': len(origins),
                  'sourceBytes': sum(row['size'] for row in before.values()),
                  'remoteMutations': 0, 'deletionAuthorized': False}
        save(output / 'download-status.json', report)
        return report
    except Exception:
        save(output / 'download-status.json', {'verifiedRawTransfer': False,
             'completeObjects': len(origins), 'expectedObjects': len(before),
             'remoteMutations': 0, 'deletionAuthorized': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    required = ('R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')
    if not all(os.environ.get(name) for name in required):
        raise ValueError('Raw S3 read credentials are not bound to this execution environment')
    try:
        import boto3
    except ImportError as error:
        raise ValueError('Install the repository workflow requirements for boto3') from error
    client = boto3.client('s3', endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                          aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
                          aws_session_token=os.environ.get('R2_SESSION_TOKEN') or os.environ.get('AWS_SESSION_TOKEN'), region_name='auto')
    print(json.dumps(download(client, 'divgrow-data', args.output_dir)))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
