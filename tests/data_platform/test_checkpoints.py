from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.data_platform.checkpoints import backup, current, restore, MissingObject, R2Objects, PREFIX
from scripts.data_platform.pipeline import Store, collect, digest
from test_pipeline import registry, response, xml, NOW


class MemoryObjects:
    def __init__(self):
        self.objects = {}
        self.fail = None

    def get(self, key):
        if key not in self.objects:
            raise MissingObject(key)
        body = self.objects[key]
        return body, digest(body)

    def put(self, key, body, expected=None):
        if self.fail and self.fail in key:
            raise RuntimeError('Injected upload failure')
        old = self.objects.get(key)
        if (expected and (old is None or digest(old) != expected)) or (not expected and old is not None):
            raise RuntimeError('Conditional write conflict')
        self.objects[key] = body


class CheckpointTests(unittest.TestCase):
    def test_oversized_checkpoint_never_replaces_a_restorable_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            remote = MemoryObjects()
            backup(store, remote, None, 'one')
            before, etag = current(remote)
            with patch('scripts.data_platform.checkpoints.MAX_FILE_BYTES', 1):
                with self.assertRaisesRegex(ValueError, 'restore budget'):
                    backup(store, remote, etag, 'oversized')
            self.assertEqual(current(remote)[0], before)

    def test_roundtrip_preserves_observations_state_and_conditional_http_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'original')
            self.addCleanup(store.close)
            collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            remote = MemoryObjects()
            backup(store, remote, None, 'one')
            restore(remote, root / 'restored')
            copy = Store(root / 'restored')
            self.addCleanup(copy.close)
            self.assertEqual(copy.state('ecb'), store.state('ecb'))
            result = collect(copy, registry(), transport=lambda *_: self.fail('Duplicate HTTP'), now=NOW)
            self.assertEqual(result['httpRequests'], 0)
            self.assertEqual(copy.db.execute('SELECT etag FROM cache').fetchone()[0], 'version1')
            with self.assertRaisesRegex(ValueError, 'must not exist'):
                restore(remote, root / 'restored')

    def test_upload_failure_and_stale_writer_preserve_previous_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            remote = MemoryObjects()
            backup(store, remote, None, 'one')
            before, etag = current(remote)
            remote.fail = '/manifests/'
            with self.assertRaises(RuntimeError):
                backup(store, remote, etag, 'two')
            self.assertEqual(current(remote)[0], before)
            remote.fail = None
            backup(store, remote, etag, 'three')
            with self.assertRaisesRegex(RuntimeError, 'conflict'):
                backup(store, remote, etag, 'stale')
            self.assertEqual(current(remote)[0]['runId'], 'three')

    def test_corrupted_object_never_creates_restore_target(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / 'original')
            self.addCleanup(store.close)
            collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            remote = MemoryObjects()
            backup(store, remote, None, 'one')
            key = next(key for key in remote.objects if '/objects/' in key)
            remote.objects[key] = b'corrupt'
            target = Path(directory) / 'restored'
            with self.assertRaisesRegex(ValueError, 'hash/size'):
                restore(remote, target)
            self.assertFalse(target.exists())

    def test_private_configuration_never_falls_back_to_public_credentials(self):
        with patch.dict('os.environ', {'R2_BUCKET_NAME': 'public'}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'Private R2 configuration'):
                R2Objects()
