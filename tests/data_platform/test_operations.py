import json
from pathlib import Path
import tempfile
import unittest
from scripts.data_platform.operations import drill, verify_conditions, recover_writer
from scripts.data_platform.remote_lock import LOCK_KEY
from scripts.data_platform.pipeline import encode, digest
from test_retention import RetentionObjects, snapshots


class OperationsTests(unittest.TestCase):
    def test_empty_bucket_conditions_verified_without_bootstrapping(self):
        with tempfile.TemporaryDirectory() as root:
            remote = RetentionObjects()
            result = drill(remote, Path(root))
            self.assertTrue(result['probeRemoved'])
            self.assertEqual(result['restore'], 'not_run')
            self.assertEqual(list(remote.objects), [LOCK_KEY])

    def test_full_drill_removes_local_private_data(self):
        with tempfile.TemporaryDirectory() as root:
            remote, _, _ = snapshots(Path(root) / 'original')
            output = Path(root) / 'drill'
            result = drill(remote, output)
            self.assertEqual(result['restore'], 'verified')
            self.assertGreater(result['verifiedFiles'], 2)
            self.assertEqual(list(output.iterdir()), [])

    def test_ignored_delete_precondition_disables_maintenance(self):
        remote = RetentionObjects()
        def unsafe_delete(key, expected):
            del remote.objects[key]
        remote.delete = unsafe_delete
        with self.assertRaisesRegex(RuntimeError, 'ignored conditional delete'):
            verify_conditions(remote)

    def test_recovery_requires_exact_stopped_writer_and_cas(self):
        remote = RetentionObjects()
        body = encode({'schemaVersion': 1, 'state': 'held', 'owner': 'stopped'}).encode()
        remote.put(LOCK_KEY, body)
        for stopped, etag, owner in [(False, digest(body), 'stopped'), (True, 'stale', 'stopped'), (True, digest(body), 'other')]:
            with self.assertRaises(ValueError):
                recover_writer(remote, etag, owner, stopped)
            self.assertEqual(remote.objects[LOCK_KEY], body)
        recover_writer(remote, digest(body), 'stopped', True)
        self.assertEqual(json.loads(remote.objects[LOCK_KEY])['state'], 'free')
