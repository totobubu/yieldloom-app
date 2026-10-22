from datetime import timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.data_platform.checkpoints import backup, current, restore, ConditionalConflict, PREFIX, R2Objects
from scripts.data_platform.pipeline import Store, collect, digest, encode
from scripts.data_platform.remote_lock import remote_writer, LOCK_KEY
from scripts.data_platform.retention import plan, apply
from test_checkpoints import MemoryObjects
from test_pipeline import NOW, registry, response, xml


class RetentionObjects(MemoryObjects):
    def __init__(self):
        super().__init__()
        self.clock = NOW
        self.modified = {}
        self.deleted = []
        self.on_delete = None

    def put(self, key, body, expected=None):
        result = super().put(key, body, expected)
        self.modified[key] = self.clock
        return result

    def inventory(self, prefix, limit=100000):
        rows = [{'key': key, 'etag': digest(body), 'bytes': len(body),
                 'modifiedAt': self.modified[key].isoformat()}
                for key, body in self.objects.items() if key.startswith(prefix)]
        if len(rows) > limit:
            raise ValueError('Inventory limit exceeded')
        return rows

    def delete(self, key, expected):
        if self.on_delete and '/probes/' not in key:
            self.on_delete(key)
        if digest(self.objects[key]) != expected:
            raise ConditionalConflict('Delete ETag conflict')
        self.deleted.append(key)
        del self.objects[key]
        del self.modified[key]

    def delete_serialized(self, key, lease):
        lease.assert_owned()
        if self.on_delete and '/probes/' not in key:
            self.on_delete(key)
        self.deleted.append(key)
        del self.objects[key]
        del self.modified[key]


def snapshots(root):
    store = Store(root)
    collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
    remote = RetentionObjects()
    pointers = []
    manifests = []
    for number in range(10):
        remote.clock = NOW + timedelta(days=number)
        with store.db:
            store.set_state('counter', {'number': number})
        with patch('scripts.data_platform.checkpoints.datetime') as clock:
            clock.now.return_value = remote.clock
            manifests.append(backup(store, remote, current(remote)[1], f'snapshot-{number}'))
        pointers.append(current(remote)[0])
    store.close()
    return remote, pointers, manifests


class RetentionTests(unittest.TestCase):
    def test_serialized_mode_restores_survivors_on_remote_ignoring_delete_conditions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, pointers, _ = snapshots(root / 'original')
            remote.delete = lambda key, expected: self.fail('Conditional delete must not be used')
            clock = NOW + timedelta(days=50)
            reviewed = plan(remote, clock, 7, 2, 1, [pointers[0]['manifestSha256']], 'exclusive-writer')
            def concurrent_writer(_):
                with self.assertRaisesRegex(RuntimeError, 'held'):
                    with remote_writer(remote, 'checkpoint'):
                        self.fail('Concurrent writer entered serialized deletion')
            remote.on_delete = concurrent_writer
            result = apply(remote, reviewed, digest(encode(reviewed).encode()), clock)
            self.assertGreater(result['deletedObjects'], 0)
            self.assertEqual(result['deleteMode'], 'exclusive-writer')
            for number in (0, 8, 9):
                restore(remote, root / f'restored-{number}', pointers[number])
            self.assertEqual(current(remote)[0], pointers[-1])

    def test_serialized_mode_is_bound_to_reviewed_hash_and_stops_on_lost_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            remote, _, _ = snapshots(Path(directory))
            clock = NOW + timedelta(days=50)
            reviewed = plan(remote, clock, 7, 2, 1)
            checksum = digest(encode(reviewed).encode())
            reviewed['deleteMode'] = 'exclusive-writer'
            with self.assertRaisesRegex(ValueError, 'digest'):
                apply(remote, reviewed, checksum, clock)
            from scripts.data_platform.remote_lock import WriterLease
            original = WriterLease.assert_owned
            def lose_after_probe(lease):
                if any('/probes/' in key for key in remote.deleted):
                    raise RuntimeError('Remote writer lease changed; deletion aborted')
                original(lease)
            with patch.object(WriterLease, 'assert_owned', lose_after_probe):
                with self.assertRaisesRegex(RuntimeError, 'lease changed'):
                    apply(remote, reviewed, digest(encode(reviewed).encode()), clock)
            self.assertTrue(all('/probes/' in key for key in remote.deleted))

    def test_real_serialized_adapter_checks_ownership_and_restricts_mutable_keys(self):
        from unittest.mock import Mock
        remote = R2Objects.__new__(R2Objects)
        remote.serialized_delete_client = Mock()
        from scripts.data_platform.remote_lock import WriterLease
        lease = Mock(spec=WriterLease, remote=remote)
        key = f"{PREFIX}/objects/{'a' * 64}"
        remote.delete_serialized(key, lease)
        lease.assert_owned.assert_called_once()
        self.assertEqual(remote.serialized_delete_client.delete_object.call_args.kwargs, {'Bucket': 'yieldloom-data-private', 'Key': key})
        for key in (LOCK_KEY, f'{PREFIX}/current.json', 'other/data', f'{PREFIX}/objects/../current.json'):
            with self.assertRaises(ValueError):
                remote.delete_serialized(key, lease)
        lease.assert_owned.side_effect = RuntimeError('lease changed')
        with self.assertRaisesRegex(RuntimeError, 'lease changed'):
            remote.delete_serialized(f"{PREFIX}/objects/{'a' * 64}", lease)
        self.assertEqual(remote.serialized_delete_client.delete_object.call_count, 1)

    def test_uncertain_serialized_delete_keeps_remote_lease_held(self):
        from unittest.mock import Mock
        remote = RetentionObjects()
        remote.serialized_delete_client = Mock()
        remote.serialized_delete_client.delete_object.side_effect = TimeoutError('Delete outcome unknown')
        with self.assertRaises(TimeoutError):
            with remote_writer(remote, 'retention') as lease:
                R2Objects.delete_serialized(remote, f"{PREFIX}/objects/{'a' * 64}", lease)
        self.assertEqual(json.loads(remote.objects[LOCK_KEY])['state'], 'held')
        with self.assertRaisesRegex(RuntimeError, 'held'):
            with remote_writer(remote, 'checkpoint'):
                self.fail('A writer started while a DELETE might still be in flight')

    def test_plan_is_read_only_and_apply_preserves_current_and_minimum_restorable_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, pointers, manifests = snapshots(root / 'original')
            before = dict(remote.objects)
            clock = NOW + timedelta(days=50)
            reviewed = plan(remote, clock, retain_days=7, minimum=2, grace_days=1)
            self.assertEqual(remote.objects, before)
            self.assertEqual(len(reviewed['retainedManifests']), 2)
            self.assertGreater(reviewed['deleteBytes'], 0)
            # Unchanged observation/raw objects are shared by all snapshots and must remain.
            for entry in manifests[0]['files']:
                if entry['path'] != 'collection.sqlite':
                    self.assertNotIn(f"{PREFIX}/objects/{entry['sha256']}", {r['key'] for r in reviewed['candidates']})
            result = apply(remote, reviewed, digest(encode(reviewed).encode()), clock)
            self.assertEqual(result['deletedObjects'], len(reviewed['candidates']))
            self.assertEqual(current(remote)[0], pointers[-1])
            restore(remote, root / 'current')
            restore(remote, root / 'previous', pointers[-2])
            self.assertEqual(json.loads(remote.objects[LOCK_KEY])['state'], 'free')

    def test_pin_grace_and_unknown_names_are_never_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            remote, pointers, _ = snapshots(Path(directory))
            remote.clock = NOW + timedelta(days=50)
            fresh = f"{PREFIX}/objects/{'a' * 64}"
            remote.put(fresh, b'recent in-flight bytes')
            remote.put(f'{PREFIX}/probes/keep', b'not owned by retention')
            reviewed = plan(remote, remote.clock, 7, 2, 7, [pointers[0]['manifestSha256']])
            keys = {row['key'] for row in reviewed['candidates']}
            self.assertNotIn(fresh, keys)
            self.assertIn(pointers[0]['manifestSha256'], reviewed['retainedManifests'])
            self.assertIn(f'{PREFIX}/probes/keep', reviewed['ignoredKeys'])

    def test_stale_or_modified_plan_and_changed_pointer_cannot_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            remote, _, _ = snapshots(Path(directory))
            clock = NOW + timedelta(days=50)
            reviewed = plan(remote, clock, 7, 2, 1)
            checksum = digest(encode(reviewed).encode())
            with self.assertRaisesRegex(ValueError, 'digest'):
                apply(remote, reviewed, 'a' * 64, clock)
            with self.assertRaisesRegex(ValueError, 'expired'):
                apply(remote, reviewed, checksum, clock + timedelta(days=2))
            pointer, etag = current(remote)
            remote.put(f'{PREFIX}/current.json', encode({**pointer, 'runId': 'changed'}).encode(), expected=etag)
            with self.assertRaisesRegex(ValueError, 'changed'):
                apply(remote, reviewed, checksum, clock)
            self.assertEqual(remote.deleted, [])

    def test_missing_referenced_object_or_corrupt_manifest_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            remote, pointers, manifests = snapshots(Path(directory))
            key = f"{PREFIX}/objects/{manifests[-1]['files'][0]['sha256']}"
            del remote.objects[key]
            with self.assertRaisesRegex(ValueError, 'missing'):
                plan(remote, NOW + timedelta(days=50), 7, 2, 1)
            key = f"{PREFIX}/manifests/{pointers[-1]['manifestSha256']}.json"
            remote.objects[key] = b'corrupt'
            with self.assertRaisesRegex(ValueError, 'integrity'):
                plan(remote, NOW + timedelta(days=50), 7, 2, 1)
            self.assertEqual(remote.deleted, [])

    def test_lease_excludes_collectors_and_never_expires_automatically(self):
        remote = RetentionObjects()
        with remote_writer(remote, 'retention'):
            with self.assertRaisesRegex(RuntimeError, 'held'):
                with remote_writer(remote, 'checkpoint'):
                    self.fail('Concurrent writer acquired lease')
        held = {'schemaVersion': 1, 'state': 'held', 'owner': 'stopped', 'startedAt': '2000-01-01T00:00:00+00:00'}
        remote.put(LOCK_KEY, encode(held).encode(), expected=digest(remote.objects[LOCK_KEY]))
        with self.assertRaisesRegex(RuntimeError, 'held'):
            with remote_writer(remote, 'checkpoint'):
                self.fail('Expired lease was silently stolen')

    def test_concurrent_checkpoint_cannot_start_between_plan_and_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, pointers, _ = snapshots(root / 'original')
            clock = NOW + timedelta(days=50)
            reviewed = plan(remote, clock, 7, 2, 1)
            def attempt(_):
                with self.assertRaisesRegex(RuntimeError, 'held'):
                    with remote_writer(remote, 'checkpoint'):
                        self.fail('Writer raced deletion')
            remote.on_delete = attempt
            apply(remote, reviewed, digest(encode(reviewed).encode()), clock)
            self.assertEqual(current(remote)[0], pointers[-1])
            restore(remote, root / 'recovery')

    def test_deletion_conflict_aborts_and_retained_checkpoint_is_still_restorable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, _, _ = snapshots(root / 'original')
            clock = NOW + timedelta(days=50)
            reviewed = plan(remote, clock, 7, 2, 1)
            def change(key):
                remote.objects[key] = b'changed'
            remote.on_delete = change
            with self.assertRaises(ConditionalConflict):
                apply(remote, reviewed, digest(encode(reviewed).encode()), clock)
            restore(remote, root / 'current')
            self.assertEqual(json.loads(remote.objects[LOCK_KEY])['state'], 'free')
