"""Private R2 diagnostics, complete restore drill and explicit stopped-writer recovery."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.checkpoints import R2Objects, PREFIX, MissingObject, ConditionalConflict, current, restore
from scripts.data_platform.pipeline import encode, private_path
from scripts.data_platform.remote_lock import LOCK_KEY, remote_writer


def verify_conditions(remote):
    # Only disposable UUID probe bytes are touched before conditional support is proven.
    key = f'{PREFIX}/probes/{uuid.uuid4().hex}'
    body = b'private checkpoint conditional operations probe\n'
    remote.put(key, body)
    saved, etag = remote.get(key)
    if saved != body or not etag:
        raise ValueError('Probe read verification failed')
    for operation in ('put', 'delete'):
        try:
            if operation == 'put':
                remote.put(key, b'wrong precondition', expected='"00000000000000000000000000000000"')
            else:
                remote.delete(key, expected='"00000000000000000000000000000000"')
        except ConditionalConflict:
            pass
        else:
            raise RuntimeError(f'Remote ignored conditional {operation}; maintenance is disabled')
    if remote.get(key) != (body, etag):
        raise ValueError('Conditional probe changed unexpectedly')
    remote.delete(key, expected=etag)
    try:
        remote.get(key)
    except MissingObject:
        return {'conditionalPut': True, 'conditionalDelete': True, 'probeRemoved': True}
    raise ValueError('Probe deletion was not verified')


def drill(remote, root):
    root = private_path(root)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with remote_writer(remote, 'restore-drill'):
        capabilities = verify_conditions(remote)
        pointer, _ = current(remote)
        if pointer is None:
            return {**capabilities, 'checkpoint': 'absent', 'restore': 'not_run'}
        with tempfile.TemporaryDirectory(dir=root) as temporary:
            manifest = restore(remote, Path(temporary) / 'verified', pointer)
        return {**capabilities, 'checkpoint': 'present', 'restore': 'verified',
                'verifiedFiles': len(manifest['files'])}


def recover_writer(remote, expected_etag, expected_owner, writer_stopped=False):
    if not writer_stopped or not expected_etag or not expected_owner:
        raise ValueError('Recovery requires stopped writers and exact inspected owner/ETag')
    body, actual = remote.get(LOCK_KEY)
    value = json.loads(body)
    if (actual != expected_etag or value.get('schemaVersion') != 1
            or value.get('state') != 'held' or value.get('owner') != expected_owner):
        raise ValueError('Inspected writer changed; recovery aborted')
    released = (encode({'schemaVersion': 1, 'state': 'free', 'owner': expected_owner,
                        'recovered': True}) + '\n').encode()
    remote.put(LOCK_KEY, released, expected=actual)
    return {'lease': 'released'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['drill', 'inspect-writer', 'recover-writer'])
    parser.add_argument('--root', type=Path, default=Path('var/data-platform-drill'))
    parser.add_argument('--writer-stopped', action='store_true')
    parser.add_argument('--expected-etag')
    parser.add_argument('--expected-owner')
    args = parser.parse_args()
    remote = R2Objects()
    if args.command == 'drill':
        result = drill(remote, args.root)
    elif args.command == 'recover-writer':
        result = recover_writer(remote, args.expected_etag, args.expected_owner, args.writer_stopped)
    else:
        body, etag = remote.get(LOCK_KEY)
        value = json.loads(body)
        result = {k: value.get(k) for k in ('schemaVersion', 'state', 'owner', 'purpose', 'startedAt')}
        result['etag'] = etag
    print(encode(result))


if __name__ == '__main__':
    main()
