import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.data_v2.publish_release import main


class MissingRelease(Exception):
    response = {'Error': {'Code': '404'}}


class RecordingClient:
    def __init__(self, fail=False):
        self.written = []
        self.lock = threading.Lock()
        self.barrier = threading.Barrier(2)
        self.fail = fail

    def head_object(self, **kwargs):
        raise MissingRelease()

    def put_object(self, **kwargs):
        key = kwargs['Key']
        if key.endswith(('/a.json', '/b.json')):
            self.barrier.wait(timeout=5)
            if self.fail and key.endswith('/a.json'):
                raise RuntimeError('Upload failed')
        with self.lock:
            self.written.append(key)


class PublishTests(unittest.TestCase):
    def publish(self, directory, client, gate_failure=False):
        root = Path(directory)
        for filename in ('a.json', 'b.json'):
            (root / filename).write_text('{}')
        (root / 'manifest.json').write_text(json.dumps({
            'releaseId': 'test', 'files': [{'path': 'a.json'}, {'path': 'b.json'}],
        }))
        with patch('sys.argv', ['publish', '--release-id', 'test', '--data-dir', str(root)]), \
             patch('scripts.data_v2.publish_release.get_r2_client', return_value=(client, 'bucket')), \
             patch('scripts.data_v2.publish_release.subprocess.run',
                   side_effect=[None, RuntimeError('Gate failed')] if gate_failure else None):
            return main()

    def test_parallel_uploads_finish_before_manifest_and_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            client = RecordingClient()
            self.assertEqual(self.publish(directory, client), 0)
            self.assertEqual(set(client.written[:2]),
                             {'core/releases/test/a.json', 'core/releases/test/b.json'})
            self.assertEqual(client.written[2:],
                             ['core/releases/test/manifest.json', 'core/current.json'])

    def test_one_failed_upload_never_exposes_manifest_or_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            client = RecordingClient(fail=True)
            with self.assertRaisesRegex(RuntimeError, 'Upload failed'):
                self.publish(directory, client)
            self.assertNotIn('core/current.json', client.written)
            self.assertNotIn('core/releases/test/manifest.json', client.written)

    def test_failed_cutover_gate_does_not_write_any_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            client = RecordingClient()
            with self.assertRaisesRegex(RuntimeError, 'Gate failed'):
                self.publish(directory, client, gate_failure=True)
            self.assertEqual(client.written, [])
