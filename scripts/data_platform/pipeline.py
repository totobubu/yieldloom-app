"""Private observation collection, revisions and domain candidate exports."""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.parsers import PARSERS
from scripts.data_platform.locking import writer_lock

REGISTRY = ROOT / 'data-v2/dataset-registry.json'
DEFAULT_ROOT = ROOT / 'var/data-platform'


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def private_path(path):
    path = Path(path).resolve()
    for parent in (ROOT / 'public', ROOT / 'dist'):
        if path == parent or parent in path.parents:
            raise ValueError('Observation roots and candidates must stay outside public/dist')
    return path


def load_registry(path=REGISTRY):
    config = json.loads(Path(path).read_text())
    if config.get('schemaVersion') != 1:
        raise ValueError('Unsupported dataset registry')
    if any(not re.fullmatch(r'[a-z][a-z0-9-]*', name) for name in config['datasets']):
        raise ValueError('Invalid dataset identifier')
    identifiers = set()
    for source in config['sources']:
        if not re.fullmatch(r'[a-z][a-z0-9-]*', source['id']):
            raise ValueError('Invalid source identifier')
        if source['id'] in identifiers:
            raise ValueError('Duplicate source ID')
        identifiers.add(source['id'])
        if not set(source['datasets']) <= config['datasets'].keys():
            raise ValueError('Source references unknown datasets')
        if source.get('enabled'):
            url = urlsplit(source['url'])
            credential_keys = {'apikey', 'api_key', 'key', 'token', 'access_token', 'secret', 'signature'}
            if (url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment
                    or any(key.lower() in credential_keys for key, _ in parse_qsl(url.query))):
                raise ValueError('Source must be a credential-free HTTPS URL')
            if source.get('parser') not in PARSERS or not source.get('parserVersion'):
                raise ValueError('Enabled source has no supported versioned parser')
            if source.get('minIntervalSeconds', 0) < 1:
                raise ValueError('Source needs a positive request interval')
    return config


def fetch(url, headers):
    result = subprocess.run(
        ['node', '--use-env-proxy', str(Path(__file__).with_name('fetch.mjs'))],
        input=encode({'url': url, 'headers': headers}) + '\n', text=True,
        capture_output=True, check=True, timeout=40,
    )
    response = json.loads(result.stdout)
    if response.get('error'):
        raise RuntimeError(response['error'])
    response['body'] = base64.b64decode(response.pop('content'))
    return response


class Store:
    def __init__(self, root):
        self.root = private_path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.root / 'observations.sqlite')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS state (source_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cache (url TEXT PRIMARY KEY, sha TEXT NOT NULL,
                etag TEXT, modified TEXT);
            CREATE TABLE IF NOT EXISTS documents (url TEXT, sha TEXT, fetched_at TEXT,
                PRIMARY KEY(url, sha));
            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY, identity_key TEXT NOT NULL, revision INTEGER NOT NULL,
                value_hash TEXT NOT NULL, payload TEXT NOT NULL,
                UNIQUE(identity_key, revision));
            CREATE TABLE IF NOT EXISTS evidence (
                observation_id INTEGER, source_id TEXT, url TEXT, sha TEXT, observed_at TEXT,
                UNIQUE(observation_id, source_id, url, sha));
        ''')

    def close(self):
        self.db.close()

    def state(self, source_id):
        row = self.db.execute('SELECT payload FROM state WHERE source_id=?', (source_id,)).fetchone()
        return json.loads(row[0]) if row else {}

    def set_state(self, source_id, value):
        self.db.execute('INSERT OR REPLACE INTO state VALUES (?,?)', (source_id, encode(value)))

    def raw(self, sha):
        content = (self.root / 'raw' / sha).read_bytes()
        if digest(content) != sha:
            raise ValueError('Cached source hash mismatch')
        return content

    def document(self, url, response, now):
        cached = self.db.execute('SELECT * FROM cache WHERE url=?', (url,)).fetchone()
        if response['status'] == 304:
            if not cached:
                raise ValueError('304 without archived source')
            return self.raw(cached['sha']), cached['sha']
        if response['status'] != 200:
            raise RuntimeError(f"Source HTTP {response['status']}")
        body = response['body']
        sha = digest(body)
        raw = self.root / 'raw' / sha
        raw.parent.mkdir(exist_ok=True, mode=0o700)
        if raw.exists():
            if raw.read_bytes() != body:
                raise ValueError('Immutable source hash mismatch')
        else:
            with raw.open('xb') as target:
                target.write(body)
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO documents VALUES (?,?,?)', (url, sha, now))
            self.db.execute('INSERT OR REPLACE INTO cache VALUES (?,?,?,?)',
                            (url, sha, response.get('etag'), response.get('lastModified')))
        return body, sha

    def accept(self, source, rows, sha, now, fingerprint):
        previous = self.state(source['id'])
        ids, new, revised = [], 0, 0
        with self.db:
            for row in rows:
                identity = digest(encode({key: row[key] for key in
                    ('dataset', 'entityId', 'field', 'asOfDate', 'qualifiers')} ).encode() + source['id'].encode())
                value_hash = digest(encode(row).encode())
                old = self.db.execute('SELECT * FROM observations WHERE identity_key=? ORDER BY revision DESC LIMIT 1',
                                      (identity,)).fetchone()
                if old and old['value_hash'] == value_hash:
                    record_id = old['id']
                else:
                    revision = old['revision'] + 1 if old else 1
                    payload = {**row, 'sourceId': source['id'], 'sourceUrl': source['url'],
                               'sourceDocumentId': sha, 'observedAt': now,
                               'publishedAt': row['qualifiers'].get('publishedAt'),
                               'parserVersion': source['parserVersion'], 'revision': revision,
                               'supersedes': old['id'] if old else None}
                    record_id = self.db.execute('INSERT INTO observations(identity_key, revision, value_hash, payload) VALUES (?,?,?,?)',
                                                (identity, revision, value_hash, encode(payload))).lastrowid
                    new += old is None
                    revised += old is not None
                self.db.execute('INSERT OR IGNORE INTO evidence VALUES (?,?,?,?,?)',
                                (record_id, source['id'], source['url'], sha, now))
                ids.append(record_id)
            self.set_state(source['id'], {
                'lastSuccessAt': now, 'lastCheckedAt': now, 'failureCount': 0,
                'fingerprint': fingerprint, 'sourceDocumentId': sha,
                'lastAttemptFingerprint': fingerprint, 'parserVersion': source['parserVersion'],
                'currentObservationIds': ids, 'rowCount': len(rows),
                'previousSuccessAt': previous.get('lastSuccessAt'),
                'asOfDates': sorted({row['asOfDate'] for row in rows if row['asOfDate']}),
            })
        return {'observations': len(rows), 'new': new, 'revised': revised,
                'undated': sum(row['asOfDate'] is None for row in rows)}


def collect(store, registry, selected=None, transport=fetch, now=None, force=False):
    clock = now or datetime.now(timezone.utc)
    timestamp = clock.isoformat()
    known = {s['id'] for s in registry['sources']}
    if selected and not set(selected) <= known:
        raise ValueError('Unknown selected source')
    report, fetched, fetch_errors = [], {}, {}
    http_requests = 0
    for source in registry['sources']:
        if selected and source['id'] not in selected:
            continue
        if not source.get('enabled'):
            if selected:
                report.append({'sourceId': source['id'], 'status': 'blocked', 'reason': source['blockedReason']})
            continue
        previous = store.state(source['id'])
        fingerprint = digest(encode(source).encode())
        due = previous.get('lastSuccessAt')
        retry = previous.get('nextRetryAt')
        attempted = previous.get('lastAttemptFingerprint', previous.get('fingerprint'))
        if not force and ((attempted == fingerprint and retry and datetime.fromisoformat(retry) > clock) or
                          (not previous.get('failureCount') and previous.get('fingerprint') == fingerprint and due and
                           clock - datetime.fromisoformat(due) < timedelta(seconds=source['minIntervalSeconds']))):
            report.append({'sourceId': source['id'], 'status': 'not_due'})
            continue
        try:
            cached = store.db.execute('SELECT * FROM cache WHERE url=?', (source['url'],)).fetchone()
            # A parser/configuration update can reprocess immutable bytes without a request.
            if cached and attempted is not None and attempted != fingerprint:
                body, sha = store.raw(cached['sha']), cached['sha']
            else:
                if source['url'] in fetch_errors:
                    raise RuntimeError(fetch_errors[source['url']])
                if source['url'] not in fetched:
                    headers = {}
                    if cached:
                        if cached['etag']:
                            headers['If-None-Match'] = cached['etag']
                        if cached['modified']:
                            headers['If-Modified-Since'] = cached['modified']
                    http_requests += 1
                    try:
                        response = transport(source['url'], headers)
                        fetched[source['url']] = store.document(source['url'], response, timestamp)
                    except Exception as error:
                        fetch_errors[source['url']] = str(error)
                        raise
                body, sha = fetched[source['url']]
            rows = PARSERS[source['parser']](body, source)
            identities = set()
            for row in rows:
                definition = registry['datasets'].get(row['dataset'], {})
                if row['dataset'] not in source['datasets'] or row['field'] not in definition.get('fields', []):
                    raise ValueError('Parser escaped registered dataset/field contract')
                if row['asOfDate'] and datetime.fromisoformat(row['asOfDate']).date() > (clock + timedelta(days=1)).date():
                    raise ValueError('Unexpected future observation')
                identity = encode([row[k] for k in ('dataset', 'entityId', 'field', 'asOfDate', 'qualifiers')])
                if identity in identities:
                    raise ValueError('Duplicate source observation identity')
                identities.add(identity)
            if not rows or (previous.get('rowCount', 0) > 20 and len(rows) < previous['rowCount'] / 2):
                raise ValueError('Empty or unexpectedly truncated source')
            result = store.accept(source, rows, sha, timestamp, fingerprint)
            report.append({'sourceId': source['id'], 'status': 'collected', **result})
        except Exception as error:
            failed = {**previous, 'lastCheckedAt': timestamp,
                      'lastAttemptFingerprint': fingerprint,
                      'failureCount': previous.get('failureCount', 0) + 1, 'lastError': str(error)}
            failed['nextRetryAt'] = (clock + timedelta(seconds=min(3600, 60 * 2 ** min(failed['failureCount'], 6)))).isoformat()
            with store.db:
                store.set_state(source['id'], failed)
            report.append({'sourceId': source['id'], 'status': 'failed', 'error': str(error)})
    result = {'schemaVersion': 1, 'observedAt': timestamp, 'httpRequests': http_requests,
              'sources': report, 'failed': sum(r['status'] == 'failed' for r in report),
              'blocked': sum(r['status'] == 'blocked' for r in report)}
    target = store.root / 'review'
    target.mkdir(exist_ok=True, mode=0o700)
    (target / 'latest.json').write_text(encode(result) + '\n')
    return result


def export_candidate(store, registry, datasets, output, public=False):
    if not datasets or not set(datasets) <= registry['datasets'].keys():
        raise ValueError('Select known datasets')
    output = private_path(output)
    if output.exists():
        raise ValueError('Candidate already exists; choose a new path')
    sources = {s['id']: s for s in registry['sources']}
    records = {dataset: [] for dataset in datasets}
    source_versions = {}
    for state in store.db.execute('SELECT source_id,payload FROM state'):
        current = json.loads(state['payload'])
        for identifier in current.get('currentObservationIds', []):
            row = json.loads(store.db.execute('SELECT payload FROM observations WHERE id=?', (identifier,)).fetchone()[0])
            if row['dataset'] not in records:
                continue
            if public and sources.get(state['source_id'], {}).get('publicDisplay') != 'approved':
                raise ValueError(f"Public use not approved: {state['source_id']}")
            source_versions[state['source_id']] = {
                key: current.get(key) for key in ('fingerprint', 'parserVersion', 'sourceDocumentId',
                    'lastSuccessAt', 'lastCheckedAt', 'failureCount', 'lastError', 'asOfDates')}
            if (not current.get('parserVersion') and state['source_id'] in sources
                    and current.get('fingerprint') == digest(encode(sources[state['source_id']]).encode())):
                source_versions[state['source_id']]['parserVersion'] = sources[state['source_id']]['parserVersion']
            if public and (current.get('failureCount') or not sources.get(state['source_id'], {}).get('enabled')
                    or current.get('fingerprint') != digest(encode(sources[state['source_id']]).encode())):
                raise ValueError(f"Source must be successfully revalidated: {state['source_id']}")
            records[row['dataset']].append(row)
    if any(not rows for rows in records.values()):
        raise ValueError('A selected dataset has no accepted observations')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as staging:
        stage = Path(staging) / 'candidate'
        stage.mkdir()
        files = []
        for dataset, rows in records.items():
            body = (encode({'schemaVersion': 1, 'dataset': dataset, 'observations': rows}) + '\n').encode()
            filename = dataset + '.json'
            (stage / filename).write_bytes(body)
            files.append({'dataset': dataset, 'path': filename, 'sha256': digest(body), 'observations': len(rows)})
        manifest = {'schemaVersion': 1, 'kind': 'public_candidate' if public else 'private_review_candidate',
                    'files': files, 'sourceVersions': source_versions,
                    'createdAt': datetime.now(timezone.utc).isoformat()}
        (stage / 'manifest.json').write_text(encode(manifest) + '\n')
        stage.rename(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['collect', 'export', 'registry'])
    parser.add_argument('--registry', type=Path, default=REGISTRY)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--source', action='append')
    parser.add_argument('--dataset', action='append')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--public', action='store_true')
    args = parser.parse_args()
    registry = load_registry(args.registry)
    if args.command == 'registry':
        print(encode(registry))
        return 0
    with writer_lock(private_path(args.root)):
        store = Store(args.root)
        try:
            if args.command == 'collect':
                result = collect(store, registry, args.source, force=args.force)
                print(encode(result))
                return 1 if result['failed'] or result['blocked'] else 0
            if args.output is None:
                parser.error('export requires --output')
            print(encode(export_candidate(store, registry, args.dataset, args.output, args.public)))
            return 0
        finally:
            store.close()


if __name__ == '__main__':
    raise SystemExit(main())
