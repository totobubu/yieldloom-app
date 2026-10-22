"""Durability and migration of split observation/collection checkpoints."""
from datetime import timedelta
import gzip
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from scripts.data_platform.checkpoints import (
    PREFIX, ConditionalConflict, R2Objects, backup, current, immutable, restore,
)
from scripts.data_platform.pipeline import Store, collect, digest, encode
from scripts.data_platform.run import run
from test_checkpoints import MemoryObjects
from test_pipeline import NOW, registry, response, xml


def legacy_checkpoint(root, compressed=False):
    """Build the real v1 format, with state/cache embedded in the main DB."""
    store = Store(root / 'seed')
    try:
        collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
        legacy = root / 'legacy.sqlite'
        with sqlite3.connect(legacy) as target:
            store.db.backup(target)
            target.execute('ATTACH DATABASE ? AS collection', (str(store.root / 'collection.sqlite'),))
            target.execute('CREATE TABLE state AS SELECT * FROM collection.state')
            target.execute('CREATE TABLE cache AS SELECT * FROM collection.cache')
            target.execute('PRAGMA user_version=0')
        remote = MemoryObjects()
        body = legacy.read_bytes()
        database = {'path': 'observations.sqlite', 'sha256': digest(body), 'bytes': len(body)}
        if compressed:
            database.update({'compression': 'gzip', 'uncompressedSha256': digest(body), 'uncompressedBytes': len(body)})
            body = gzip.compress(body, mtime=0)
            database.update({'sha256': digest(body), 'bytes': len(body)})
        remote.objects[f'{PREFIX}/objects/{digest(body)}'] = body
        files = [database]
        for raw in (store.root / 'raw').iterdir():
            body = raw.read_bytes()
            remote.objects[f'{PREFIX}/objects/{digest(body)}'] = body
            files.append({'path': 'raw/' + digest(body), 'sha256': digest(body), 'bytes': len(body)})
        manifest = {'schemaVersion': 1, 'runId': 'legacy', 'files': files}
        body = (encode(manifest) + '\n').encode()
        remote.objects[f'{PREFIX}/manifests/{digest(body)}.json'] = body
        remote.objects[f'{PREFIX}/current.json'] = encode({'schemaVersion': 1, 'manifestSha256': digest(body), 'runId': 'legacy'}).encode()
        return remote, legacy, store.state('ecb')
    finally:
        store.close()


class StateStorageTests(unittest.TestCase):
    def test_real_v1_checkpoints_migrate_once_without_source_http_or_lost_state(self):
        for compressed in (False, True):
            with self.subTest(compressed=compressed), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                remote, _, expected = legacy_checkpoint(root, compressed)
                old_pointer, _ = current(remote)
                result = run(remote, root / 'migrated', registry(), 'migrated',
                             transport=lambda *_: self.fail('Migration requested source HTTP'), now=NOW)
                self.assertEqual(result['checkpoint'], 'saved')
                self.assertEqual(result['httpRequests'], 0)
                manifest = restore(remote, root / 'verify')
                self.assertEqual(manifest['schemaVersion'], 2)
                store = Store(root / 'verify')
                try:
                    self.assertEqual(store.state('ecb'), expected)
                    self.assertEqual(store.db.execute('SELECT etag FROM collection.cache').fetchone()[0], 'version1')
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0], 1)
                    self.assertFalse(store.db.execute("SELECT 1 FROM main.sqlite_master WHERE name IN ('state','cache')").fetchone())
                finally:
                    store.close()
                # The original recovery point remains available after migration.
                restore(remote, root / 'old-recovery', old_pointer)
                result = run(remote, root / 'unchanged', registry(), 'unchanged',
                             transport=lambda *_: self.fail('Not due'), now=NOW)
                self.assertEqual(result['checkpoint'], 'unchanged')
                self.assertEqual(result['r2']['putRequests'], 0)

    def test_local_migration_failure_rolls_back_both_databases_and_can_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, _, expected = legacy_checkpoint(root)
            restore(remote, root / 'interrupted')
            sidecar = root / 'interrupted' / 'collection.sqlite'
            with sqlite3.connect(sidecar) as db:
                db.executescript('''
                    CREATE TABLE state (source_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                    CREATE TABLE cache (url TEXT PRIMARY KEY, sha TEXT NOT NULL, etag TEXT, modified TEXT);
                    CREATE TRIGGER reject_cache BEFORE INSERT ON cache BEGIN SELECT RAISE(ABORT, 'injected'); END;
                ''')
            with self.assertRaisesRegex(sqlite3.IntegrityError, 'injected'):
                Store(root / 'interrupted')
            with sqlite3.connect(root / 'interrupted' / 'observations.sqlite') as db:
                self.assertEqual(json.loads(db.execute('SELECT payload FROM state').fetchone()[0]), expected)
                self.assertEqual(db.execute('SELECT etag FROM cache').fetchone()[0], 'version1')
                self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 0)
            with sqlite3.connect(sidecar) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM state').fetchone()[0], 0)
                db.execute('DROP TRIGGER reject_cache')
            store = Store(root / 'interrupted')
            self.addCleanup(store.close)
            self.assertEqual(store.state('ecb'), expected)

    def test_acceptance_failure_rolls_back_observations_and_collection_state(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            with store.db:
                store.set_state('ecb', {'sentinel': True})
            store.db.execute('''CREATE TRIGGER collection.reject_state BEFORE INSERT ON state
                                BEGIN SELECT RAISE(ABORT, 'injected'); END''')
            with self.assertRaisesRegex(sqlite3.IntegrityError, 'injected'):
                collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0], 0)
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM evidence').fetchone()[0], 0)
            self.assertEqual(store.state('ecb'), {'sentinel': True})

    def test_missing_local_collection_database_is_not_silently_initialized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root)
            collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            store.close()
            (root / 'collection.sqlite').unlink()
            with self.assertRaisesRegex(ValueError, 'requires its collection database'):
                Store(root)
            self.assertFalse((root / 'collection.sqlite').exists())

    def test_empty_sidecar_and_missing_observation_database_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root)
            store.close()
            (root / 'collection.sqlite').write_bytes(b'')
            with self.assertRaises(sqlite3.OperationalError):
                Store(root)
            (root / 'observations.sqlite').unlink()
            with self.assertRaisesRegex(ValueError, 'requires its observation database'):
                Store(root)
            self.assertFalse((root / 'observations.sqlite').exists())

    def test_missing_or_corrupt_remote_state_does_not_expose_partial_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'initial')
            collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            remote = MemoryObjects()
            manifest = backup(store, remote, None, 'initial')
            store.close()
            state = next(e for e in manifest['files'] if e['path'] == 'collection.sqlite')
            remote.objects[f"{PREFIX}/objects/{state['sha256']}"] = b'corrupt'
            with self.assertRaisesRegex(ValueError, 'hash/size'):
                restore(remote, root / 'corrupt', lazy_raw=True)
            self.assertFalse((root / 'corrupt').exists())
            manifest['files'].remove(state)
            body = encode(manifest).encode()
            remote.objects[f'{PREFIX}/manifests/{digest(body)}.json'] = body
            with self.assertRaisesRegex(ValueError, 'required database'):
                restore(remote, root / 'missing', {'manifestSha256': digest(body)})
            self.assertFalse((root / 'missing').exists())

    def test_state_only_failure_keeps_previous_remote_checkpoint_recoverable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = MemoryObjects()
            run(remote, root / 'initial', registry(), 'initial', True, lambda *_: response(xml()), NOW)
            pointer, _ = current(remote)
            remote.fail = '/objects/'
            with self.assertRaisesRegex(RuntimeError, 'upload failure'):
                run(remote, root / 'failed', registry(), 'failed', transport=lambda *_: {'status': 503}, now=NOW + timedelta(days=1))
            self.assertEqual(current(remote)[0], pointer)
            restore(remote, root / 'recovery')
            store = Store(root / 'recovery')
            self.addCleanup(store.close)
            self.assertEqual(store.state('ecb')['failureCount'], 0)

    def test_etag_and_success_changes_reuse_the_existing_observation_object(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = MemoryObjects()
            run(remote, root / 'initial', registry(), 'initial', True, lambda *_: response(xml()), NOW)
            first = restore(remote, root / 'before')
            database = next(e for e in first['files'] if e['path'] == 'observations.sqlite')
            result = run(remote, root / 'daily', registry(), 'daily',
                         transport=lambda *_: {**response(xml()), 'etag': 'version2'}, now=NOW + timedelta(days=1))
            second = restore(remote, root / 'after')
            self.assertEqual(next(e for e in second['files'] if e['path'] == 'observations.sqlite'), database)
            self.assertEqual(result['checkpointFiles'], {'observations.sqlite': 'reused', 'collection.sqlite': 'updated'})
            self.assertEqual(result['r2']['getRequests'], 6)
            self.assertEqual(result['r2']['putRequests'], 3)
            store = Store(root / 'after')
            self.addCleanup(store.close)
            self.assertEqual(store.db.execute('SELECT etag FROM collection.cache').fetchone()[0], 'version2')
            self.assertEqual(store.state('ecb')['lastSuccessAt'], (NOW + timedelta(days=1)).isoformat())
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0], 1)

    def test_correction_commits_new_data_and_state_in_the_same_recovery_point(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = MemoryObjects()
            run(remote, root / 'initial', registry(), 'initial', True, lambda *_: response(xml()), NOW)
            pointer, _ = current(remote)
            result = run(remote, root / 'corrected', registry(), 'corrected',
                         transport=lambda *_: response(xml('1.1200')), now=NOW + timedelta(days=1))
            self.assertEqual(result['checkpointFiles'], {'observations.sqlite': 'updated', 'collection.sqlite': 'updated'})
            self.assertEqual(result['r2']['getRequests'], 8)
            self.assertEqual(result['r2']['putRequests'], 5)
            restore(remote, root / 'after')
            store = Store(root / 'after')
            self.addCleanup(store.close)
            rows = [json.loads(row[0]) for row in store.db.execute('SELECT payload FROM observations ORDER BY revision')]
            self.assertEqual([row['value'] for row in rows], ['1.1234', '1.1200'])
            self.assertEqual(rows[1]['supersedes'], 1)
            self.assertEqual(store.state('ecb')['currentObservationIds'], [2])
            restore(remote, root / 'before', pointer)
            old = Store(root / 'before')
            self.addCleanup(old.close)
            self.assertEqual(old.state('ecb')['currentObservationIds'], [1])
            self.assertEqual(old.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0], 1)

    def test_r2_precondition_conflicts_are_distinguished_from_permission_failures(self):
        class ClientError(Exception):
            def __init__(self, code):
                self.response = {'Error': {'Code': code}}
        remote = R2Objects.__new__(R2Objects)
        remote.client = SimpleNamespace(exceptions=SimpleNamespace(ClientError=ClientError), put_object=Mock())
        for code in ('PreconditionFailed', '412', 'ConditionalRequestConflict', '409'):
            remote.client.put_object.side_effect = ClientError(code)
            with self.assertRaises(ConditionalConflict):
                remote.put('test', b'test')
        remote.client.put_object.side_effect = ClientError('AccessDenied')
        with self.assertRaises(ClientError):
            remote.put('test', b'test')
        remote.client.put_object.side_effect = None
        remote.put('test', b'test')
        self.assertEqual(remote.client.put_object.call_args.kwargs['IfNoneMatch'], '*')
        remote.put('test', b'test', expected='old-etag')
        self.assertEqual(remote.client.put_object.call_args.kwargs['IfMatch'], 'old-etag')
        self.assertNotIn('IfNoneMatch', remote.client.put_object.call_args.kwargs)

    def test_immutable_retry_verifies_existing_bytes_without_overwriting_them(self):
        remote = MemoryObjects()
        immutable(remote, 'key', b'original')
        immutable(remote, 'key', b'original')
        with self.assertRaisesRegex(ValueError, 'verification failed'):
            immutable(remote, 'key', b'changed')
        self.assertEqual(remote.objects['key'], b'original')
