"""Fail-closed, non-expiring remote writer lease shared by checkpoints and maintenance."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import uuid

from scripts.data_platform.pipeline import encode

LOCK_KEY = 'platform/v1/writer.json'


@contextmanager
def remote_writer(remote, purpose):
    from scripts.data_platform.checkpoints import MissingObject
    try:
        body, etag = remote.get(LOCK_KEY)
        previous = json.loads(body)
        if previous.get('schemaVersion') != 1 or previous.get('state') != 'free':
            raise RuntimeError('Remote writer lease is held or invalid; inspect the stopped writer before recovery')
    except MissingObject:
        etag = None
    owner = uuid.uuid4().hex
    body = (encode({'schemaVersion': 1, 'state': 'held', 'owner': owner,
                    'purpose': purpose, 'startedAt': datetime.now(timezone.utc).isoformat()}) + '\n').encode()
    result = remote.put(LOCK_KEY, body, expected=etag)
    lease_etag = result.get('ETag') if isinstance(result, dict) else None
    if not lease_etag:
        raise RuntimeError('Lease write returned no ETag; do not automatically release it')
    try:
        yield
    finally:
        released = (encode({'schemaVersion': 1, 'state': 'free', 'owner': owner}) + '\n').encode()
        remote.put(LOCK_KEY, released, expected=lease_etag)
