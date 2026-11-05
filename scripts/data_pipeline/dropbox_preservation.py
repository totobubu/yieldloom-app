"""Dropbox preservation primitives. No default transport, env reads, CLI, or live calls."""
from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlencode

from scripts.data_pipeline.extract_amount_fixed import verify

TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
CONTENT_URL = 'https://content.dropboxapi.com/2/files/'
HASH = re.compile(r'[a-f0-9]{64}')
MAX_FILE_BYTES = 100_000_000  # Larger files need a separately implemented upload session.


class PreservationError(Exception):
    """Only fixed safe codes; never include server bodies, tokens or request headers."""


@dataclass
class Response:
    status: int
    body: bytes = field(repr=False)
    headers: dict = field(default_factory=dict, repr=False)


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def content_hash(body):
    blocks = (hashlib.sha256(body[i:i + 4194304]).digest() for i in range(0, len(body), 4194304))
    return hashlib.sha256(b''.join(blocks)).hexdigest()


def parsed(body):
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        raise PreservationError('invalid_response') from None


def tags(value):
    if not isinstance(value, dict):
        return set()
    return ({value['.tag']} if isinstance(value.get('.tag'), str) else set()) | set().union(*(tags(v) for v in value.values()))


def retry_delay(response, attempt):
    value = next((v for k, v in response.headers.items() if k.lower() == 'retry-after'), None)
    if value is not None:
        try:
            delay = float(value)
            if not math.isfinite(delay) or not 0 <= delay <= 5:
                raise ValueError()
            return delay
        except (ValueError, TypeError):
            raise PreservationError('retry_later') from None
    return 0.25 * 2 ** attempt


class TokenProvider:
    def __init__(self, app_key, app_secret, refresh_token, transport, *, enabled=False,
                 now=time.monotonic, sleep=time.sleep, attempts=3):
        if not all(isinstance(value, str) and value for value in (app_key, app_secret, refresh_token)):
            raise PreservationError('missing_token_configuration')
        if not 1 <= attempts <= 3:
            raise ValueError('Bound token retries to 1..3')
        self._credentials = (app_key, app_secret, refresh_token)
        self._transport, self._enabled = transport, enabled
        self._now, self._sleep, self._attempts = now, sleep, attempts
        self._token, self._expires, self._blocked = None, 0, False
        self._lock = threading.Lock()

    def token(self, rejected=None):
        with self._lock:
            if not self._enabled or self._blocked:
                raise PreservationError('reauthorization_required')
            if self._token and self._expires > self._now() and self._token != rejected:
                return self._token
            for attempt in range(self._attempts):
                try:
                    key, secret, refresh = self._credentials
                    response = self._transport(TOKEN_URL, {'Content-Type': 'application/x-www-form-urlencoded'},
                                               urlencode({'grant_type': 'refresh_token', 'refresh_token': refresh,
                                                          'client_id': key, 'client_secret': secret}).encode())
                except (OSError, TimeoutError):
                    response = Response(503, b'{}')
                except Exception:
                    raise PreservationError('transport_adapter_failed') from None
                if response.status == 429 or response.status >= 500:
                    if attempt + 1 < self._attempts:
                        self._sleep(retry_delay(response, attempt))
                        continue
                    raise PreservationError('token_temporarily_unavailable')
                if response.status != 200:
                    # Includes invalid_grant/invalid_client. No automatic retry of rejected credentials.
                    self._blocked = True
                    self._token, self._expires = None, 0
                    raise PreservationError('reauthorization_required')
                payload = parsed(response.body)
                try:
                    token, ttl = payload['access_token'], float(payload['expires_in'])
                    if not isinstance(token, str) or not token or not math.isfinite(ttl) or ttl <= 0 or payload.get('token_type', '').lower() != 'bearer':
                        raise ValueError()
                except (KeyError, TypeError, ValueError, AttributeError):
                    raise PreservationError('invalid_token_response') from None
                self._token, self._expires = token, self._now() + ttl - min(60, ttl / 10)
                return token


    def block(self):
        with self._lock:
            self._blocked, self._token, self._expires = True, None, 0


class DropboxSession:
    """Transport(url, headers, bytes) must return Response. Caller supplies the adapter."""
    def __init__(self, tokens, transport, *, sleep=time.sleep):
        self._tokens, self._transport, self._sleep = tokens, transport, sleep

    def call(self, endpoint, arguments, body=b''):
        if endpoint not in {'download', 'upload'}:
            raise PreservationError('unsupported_operation')
        token = self._tokens.token()
        auth_retry = False
        transient = 0
        while True:
            headers = {'Authorization': 'Bearer ' + token,
                       'Dropbox-API-Arg': json.dumps(arguments, ensure_ascii=True),
                       'Content-Type': 'application/octet-stream'}
            try:
                response = self._transport(CONTENT_URL + endpoint, headers, body)
            except (OSError, TimeoutError):
                if endpoint == 'upload':
                    raise PreservationError('uncertain_write') from None
                response = Response(503, b'{}')
            except Exception:
                raise PreservationError('transport_adapter_failed') from None
            if response.status == 200:
                return response
            if response.status == 429 or response.status >= 500:
                if endpoint == 'upload':
                    raise PreservationError('uncertain_write')
                if transient < 2:
                    self._sleep(retry_delay(response, transient))
                    transient += 1
                    continue
                raise PreservationError('read_temporarily_unavailable')
            payload = parsed(response.body) if response.body else {}
            error_tags = tags(payload.get('error', {})) if isinstance(payload, dict) else set()
            if response.status == 401:
                if not auth_retry and 'expired_access_token' in error_tags:
                    token = self._tokens.token(rejected=token)
                    auth_retry = True
                    continue
                self._tokens.block()
                raise PreservationError('reauthorization_required')
            if response.status == 409:
                if 'not_found' in error_tags:
                    raise PreservationError('not_found')
                if 'conflict' in error_tags:
                    raise PreservationError('conflict')
                raise PreservationError('path_rejected')
            raise PreservationError('request_rejected')

    def download(self, path):
        response = self.call('download', {'path': path})
        raw_meta = next((v for k, v in response.headers.items() if k.lower() == 'dropbox-api-result'), None)
        metadata = parsed(raw_meta)
        self.check(response.body, metadata)
        return response.body, metadata

    @staticmethod
    def check(body, metadata):
        if not isinstance(metadata, dict) or metadata.get('size') != len(body) or metadata.get('content_hash') != content_hash(body) or not metadata.get('rev'):
            raise PreservationError('integrity_mismatch')

    def upload(self, path, body, revision=None):
        if len(body) > MAX_FILE_BYTES:
            raise PreservationError('upload_session_required')
        arguments = {'path': path, 'mode': {'.tag': 'update', 'update': revision} if revision else 'add',
                     'autorename': False, 'strict_conflict': True, 'mute': True, 'content_hash': content_hash(body)}
        metadata = parsed(self.call('upload', arguments, body).body)
        self.check(body, metadata)
        return metadata


@dataclass(frozen=True)
class ArchivePlan:
    files: dict
    blobs: dict = field(repr=False)


def build_plan(source_dir: Path, preservation_dir: Path):
    verified = verify(source_dir, preservation_dir)  # Reconcile source values before any remote operation.
    manifest = parsed((preservation_dir / 'manifest.json').read_bytes())
    names = {'manifest.json', 'dividends.json', 'verification.json'}
    names.update(entry['preservedSource'] for entry in manifest['files'] if entry['amountFixedRows'])
    files, blobs = {}, {}
    for name in sorted(names):
        if name not in {'manifest.json', 'dividends.json', 'verification.json'} and not re.fullmatch(r'originals/[a-f0-9]{64}\.json', name):
            raise PreservationError('unsafe_archive_path')
        path = preservation_dir / name
        if path.is_symlink() or preservation_dir.resolve() not in path.resolve().parents:
            raise PreservationError('unsafe_archive_path')
        body = path.read_bytes()
        if len(body) > MAX_FILE_BYTES:
            raise PreservationError('upload_session_required')
        digest = sha(body)
        files[name] = {'sha256': digest, 'size': len(body), 'contentHash': content_hash(body)}
        blobs[digest] = body
    if parsed(blobs[files['verification.json']['sha256']]) != verified:
        raise PreservationError('local_archive_changed')
    if sha(blobs[files['dividends.json']['sha256']]) != manifest.get('recordsSha256'):
        raise PreservationError('local_archive_changed')
    for name, entry in files.items():
        if name.startswith('originals/') and entry['sha256'] != name.removeprefix('originals/').removesuffix('.json'):
            raise PreservationError('local_archive_changed')
    # Catch a local change between verification and reading.
    verify(source_dir, preservation_dir)
    if parsed(blobs[files['manifest.json']['sha256']]) != manifest:
        raise PreservationError('local_archive_changed')
    return ArchivePlan(files, blobs)


class DropboxArchive:
    def __init__(self, session, root='/Yieldloom/dividends/v1', *, allow_writes=False):
        if not re.fullmatch(r'/[A-Za-z0-9_/-]+', root) or '//' in root or root.endswith('/'):
            raise ValueError('Invalid archive namespace')
        self._session, self._root, self._allow_writes = session, root, allow_writes

    def _read(self, suffix, optional=False):
        try:
            return self._session.download(self._root + '/' + suffix)
        except PreservationError as error:
            if optional and str(error) == 'not_found':
                return None
            raise

    def _immutable(self, suffix, body):
        existing = self._read(suffix, optional=True)
        if existing:
            if existing[0] != body:
                raise PreservationError('immutable_collision')
            return
        try:
            self._session.upload(self._root + '/' + suffix, body)
        except PreservationError as error:
            if str(error) not in {'conflict', 'uncertain_write'}:
                raise
            # Unknown write outcomes are checked, never blindly uploaded again.
            recovered = self._read(suffix, optional=True)
            if recovered and recovered[0] == body:
                return
            raise PreservationError('immutable_write_unconfirmed') from None
        if self._read(suffix)[0] != body:
            raise PreservationError('integrity_mismatch')

    def current(self):
        result = self._read('current.json', optional=True)
        if not result:
            return None
        pointer = parsed(result[0])
        if not isinstance(pointer, dict) or pointer.get('schemaVersion') != 1 or not isinstance(pointer.get('snapshotId'), str) or not HASH.fullmatch(pointer['snapshotId']):
            raise PreservationError('invalid_archive_pointer')
        return pointer['snapshotId'], result[1]['rev']

    def snapshot(self, snapshot_id):
        if not isinstance(snapshot_id, str) or not HASH.fullmatch(snapshot_id):
            raise PreservationError('invalid_snapshot_id')
        body, _ = self._read('snapshots/' + snapshot_id + '.json')
        if sha(body) != snapshot_id:
            raise PreservationError('snapshot_hash_mismatch')
        manifest = parsed(body)
        if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('files'), dict):
            raise PreservationError('invalid_snapshot')
        return manifest

    def publish(self, plan):
        if not self._allow_writes:
            raise PreservationError('writes_disabled')
        # Validate even externally constructed plans before remote mutations.
        if any(len(body) > MAX_FILE_BYTES for body in plan.blobs.values()):
            raise PreservationError('upload_session_required')
        if not {'manifest.json', 'dividends.json', 'verification.json'} <= plan.files.keys() or set(plan.blobs) != {entry.get('sha256') for entry in plan.files.values()}:
            raise PreservationError('invalid_plan')
        for name, entry in plan.files.items():
            if name not in {'manifest.json', 'dividends.json', 'verification.json'} and not re.fullmatch(r'originals/[a-f0-9]{64}\.json', name):
                raise PreservationError('unsafe_archive_path')
            digest = entry.get('sha256', '')
            if not isinstance(digest, str) or not HASH.fullmatch(digest) or digest not in plan.blobs or sha(plan.blobs[digest]) != digest or entry.get('size') != len(plan.blobs[digest]) or entry.get('contentHash') != content_hash(plan.blobs[digest]):
                raise PreservationError('invalid_plan')
        current = self.current()
        if current and self.snapshot(current[0])['files'] == plan.files:
            for name in plan.files:
                self.read_file(current[0], name)
            return {'status': 'unchanged', 'snapshotId': current[0]}
        for digest, body in plan.blobs.items():
            self._immutable('objects/' + digest + '.json', body)
        manifest = {'schemaVersion': 1, 'previousSnapshotId': current[0] if current else None, 'files': plan.files}
        body = encode(manifest)
        snapshot_id = sha(body)
        self._immutable('snapshots/' + snapshot_id + '.json', body)
        pointer = encode({'schemaVersion': 1, 'snapshotId': snapshot_id})
        try:
            self._session.upload(self._root + '/current.json', pointer, current[1] if current else None)
        except PreservationError as error:
            if str(error) == 'uncertain_write' and self._read('current.json')[0] == pointer:
                return {'status': 'published', 'snapshotId': snapshot_id}
            raise
        if self._read('current.json')[0] != pointer:
            raise PreservationError('pointer_readback_conflict')
        return {'status': 'published', 'snapshotId': snapshot_id}

    def read_file(self, snapshot_id, name):
        manifest = self.snapshot(snapshot_id)
        entry = manifest['files'].get(name)
        if not isinstance(entry, dict) or not isinstance(entry.get('sha256'), str) or not HASH.fullmatch(entry['sha256']):
            raise PreservationError('missing_archive_file')
        body, _ = self._read('objects/' + entry['sha256'] + '.json')
        if sha(body) != entry['sha256'] or len(body) != entry.get('size') or content_hash(body) != entry.get('contentHash'):
            raise PreservationError('integrity_mismatch')
        return body

    def load_records(self, *, max_snapshots=1000):
        current = self.current()
        if not current:
            return []
        snapshot_id = current[0]
        seen, records = set(), {}
        while snapshot_id:
            if snapshot_id in seen or len(seen) >= max_snapshots:
                raise PreservationError('incomplete_history_chain')
            seen.add(snapshot_id)
            manifest = self.snapshot(snapshot_id)
            payload = parsed(self.read_file(snapshot_id, 'dividends.json'))
            if not isinstance(payload, dict) or not isinstance(payload.get('records'), list):
                raise PreservationError('invalid_dividend_archive')
            for row in payload['records']:
                record_id = row.get('recordId')
                if not isinstance(record_id, str) or not HASH.fullmatch(record_id):
                    raise PreservationError('invalid_dividend_archive')
                if record_id in records and records[record_id] != row:
                    raise PreservationError('observation_conflict')
                records[record_id] = row
            snapshot_id = manifest.get('previousSnapshotId')
            if snapshot_id is not None and (not isinstance(snapshot_id, str) or not HASH.fullmatch(snapshot_id)):
                raise PreservationError('invalid_snapshot_id')
        return list(records.values())  # No merge by ISIN/date, and no partial result on a read failure.
