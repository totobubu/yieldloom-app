import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from scripts.data_platform.checkpoints import ConditionalConflict

from scripts.data_platform.releases import build, publish, rollback, PublicObjects
from scripts.data_platform.pipeline import Store, collect, load_registry
from test_checkpoints import MemoryObjects
from test_pipeline import registry, response, xml, NOW


class ReleaseTests(unittest.TestCase):
    def test_previous_release_rollback_requires_current_match_and_unchanged_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'private')
            self.addCleanup(store.close)
            config = registry()
            config['sources'][0]['publicDisplay'] = 'approved'
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            remote = MemoryObjects()
            for release in ['one', 'two']:
                build(store, config, 'fx', release, root / release, NOW)
                publish(root / release, remote)
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                rollback(remote, 'fx', 'one', 'unexpected', config, NOW)
            config['policies']['test']['version'] = 'changed'
            with self.assertRaisesRegex(ValueError, 'policy'):
                rollback(remote, 'fx', 'one', 'two', config, NOW)
            config['policies']['test']['version'] = '1'
            self.assertEqual(rollback(remote, 'fx', 'one', 'two', config, NOW)['releaseId'], 'one')

    def test_projection_publish_and_corruption_cannot_advance_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'private')
            self.addCleanup(store.close)
            config = registry()
            config['sources'][0]['publicDisplay'] = 'approved'
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            manifest = build(store, config, 'fx', 'one', root / 'one', NOW)
            self.assertEqual(len(manifest['entities']), 1)
            remote = MemoryObjects()
            pointer = publish(root / 'one', remote)
            self.assertEqual(pointer['releaseId'], 'one')
            build(store, config, 'fx', 'two', root / 'two', NOW)
            entry = manifest['files'][0]
            (root / 'two' / entry['path']).write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'hash/size'):
                publish(root / 'two', remote)
            self.assertEqual(json.loads(remote.get('datasets/fx/current.json')[0])['releaseId'], 'one')
            with self.assertRaisesRegex(ValueError, 'already exists'):
                publish(root / 'one', remote)

    def test_excluded_source_states_do_not_leak_into_approved_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'private')
            self.addCleanup(store.close)
            config = registry()
            config['sources'].append(dict(config['sources'][0], id='unapproved'))
            config['sources'][0]['publicDisplay'] = 'approved'
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            manifest = build(store, config, 'fx', 'one', root / 'one', NOW)
            row = json.loads((root / 'one' / manifest['files'][0]['path']).read_text())
            self.assertEqual(len(row['observations']), 1)
            self.assertEqual(row['observations'][0]['sourceId'], 'ecb')

    def test_unapproved_fund_dataset_creates_no_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            target = Path(directory) / 'blocked'
            with self.assertRaisesRegex(ValueError, 'No approved'):
                build(store, load_registry(), 'holdings', 'one', target, NOW)
            self.assertFalse(target.exists())

    def test_public_object_cache_headers_and_immutable_retry_conflicts(self):
        class ClientError(Exception):
            def __init__(self, code):
                self.response = {'Error': {'Code': code}}
        remote = PublicObjects.__new__(PublicObjects)
        remote.bucket = 'fixture-public'
        remote.client = SimpleNamespace(exceptions=SimpleNamespace(ClientError=ClientError), put_object=Mock())
        remote.put('datasets/fx/current.json', b'{}', expected='old')
        self.assertEqual(remote.client.put_object.call_args.kwargs['CacheControl'], 'public, max-age=60')
        self.assertEqual(remote.client.put_object.call_args.kwargs['IfMatch'], 'old')
        remote.put('datasets/fx/releases/one/manifest.json', b'{}')
        self.assertEqual(remote.client.put_object.call_args.kwargs['CacheControl'], 'public, max-age=31536000, immutable')
        self.assertEqual(remote.client.put_object.call_args.kwargs['IfNoneMatch'], '*')
        remote.client.put_object.side_effect = ClientError('PreconditionFailed')
        with self.assertRaises(ConditionalConflict):
            remote.put('datasets/fx/releases/one/manifest.json', b'{}')
        remote.client.put_object.side_effect = ClientError('AccessDenied')
        with self.assertRaises(ClientError):
            remote.put('datasets/fx/releases/one/manifest.json', b'{}')
