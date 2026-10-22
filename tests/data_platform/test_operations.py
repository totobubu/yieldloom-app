import json
from pathlib import Path
import tempfile
import unittest
from scripts.data_platform.operations import drill, verify_conditions, recover_writer
from scripts.data_platform.remote_lock import LOCK_KEY
from scripts.data_platform.pipeline import encode, digest
from scripts.data_platform.retention import plan, apply
from test_retention import RetentionObjects, snapshots, NOW
from datetime import timedelta


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

    def test_unsupported_delete_still_verifies_restore_and_blocks_all_checkpoint_deletion(self):
        with tempfile.TemporaryDirectory() as root:
            remote, _, _ = snapshots(Path(root) / 'original')
            before = {key: value for key, value in remote.objects.items() if key != LOCK_KEY}
            def unsafe_delete(key, expected):
                del remote.objects[key]
                del remote.modified[key]
            remote.delete = unsafe_delete
            result = drill(remote, Path(root) / 'drill')
            self.assertEqual(result['restore'], 'verified')
            self.assertFalse(result['conditionalDelete'])
            self.assertTrue(result['probeRemoved'])
            self.assertEqual(result['retentionApply'], 'blocked_conditional_delete_unsupported')
            self.assertTrue(result['serializedDelete'])
            self.assertTrue(result['serializedProbeRemoved'])
            self.assertEqual(result['serializedRetentionApply'], 'supported_with_reviewed_plan_and_exclusive_writer')
            clock = NOW + timedelta(days=50)
            reviewed = plan(remote, clock, retain_days=7, minimum=2, grace_days=1)
            self.assertTrue(reviewed['candidates'])
            with self.assertRaisesRegex(RuntimeError, 'ignored conditional delete'):
                apply(remote, reviewed, digest(encode(reviewed).encode()), clock)
            self.assertEqual({key: value for key, value in remote.objects.items() if key != LOCK_KEY}, before)

    def test_other_delete_errors_are_not_classified_as_unsupported(self):
        with tempfile.TemporaryDirectory() as root:
            remote = RetentionObjects()
            def denied(key, expected):
                raise PermissionError('Delete access denied')
            remote.delete = denied
            with self.assertRaises(PermissionError):
                drill(remote, Path(root))

    def test_unsupported_delete_does_not_hide_corrupt_restore_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            remote, _, manifests = snapshots(Path(root) / 'original')
            key = 'platform/v1/objects/' + manifests[-1]['files'][0]['sha256']
            remote.objects[key] = b'corrupt'
            remote.delete = lambda key, expected: remote.objects.pop(key)
            with self.assertRaisesRegex(ValueError, 'hash/size'):
                drill(remote, Path(root) / 'drill')

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
