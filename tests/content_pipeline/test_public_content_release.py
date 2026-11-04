import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline.public_content_release import publish, restore


class S3Error(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code}}


class Store:
    def __init__(self):
        self.data = {}
        self.writes = []
        self.fail = None
        self.race = False

    def get_object(self, Bucket, Key):
        if Key not in self.data:
            raise S3Error('NoSuchKey')
        return {'Body': io.BytesIO(self.data[Key]), 'ETag': str(hash(self.data[Key]))}

    def put_object(self, **kw):
        key = kw['Key']
        if self.fail and self.fail in key:
            raise RuntimeError('upload failed')
        if kw.get('IfNoneMatch') == '*' and key in self.data:
            raise S3Error('PreconditionFailed')
        if 'IfMatch' in kw and (self.race or kw['IfMatch'] != str(hash(self.data.get(key)))):
            raise S3Error('PreconditionFailed')
        self.data[key] = kw['Body']
        self.writes.append(key)


class PublicContentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store()
        self.gate = patch('scripts.content_pipeline.public_content_release.validate')
        self.gate.start()
        self.addCleanup(self.gate.stop)
        self.write('distribution-index.json', {'tickers': [{'ticker': 'TEST', 'historyUrl': '/content-studio/distribution-ticker-test.json'}]})
        self.write('distribution-ticker-test.json', {'history': [{'amount': '0.10', 'source': {'hash': 'original'}}]})
        self.write('account.json', {'private': True})

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def publish(self, channel='production'):
        return publish(self.store, 'bucket', self.root, channel, {'runId': 'fixture'})

    def test_noop_and_export_clock_only_do_not_write(self):
        first = self.publish()
        self.store.writes.clear()
        self.write('distribution-index.json', {'generatedAt': 'later', 'tickers': [{'ticker': 'TEST', 'historyUrl': '/content-studio/distribution-ticker-test.json'}]})
        self.assertEqual(self.publish()['releaseId'], first['releaseId'])
        self.assertEqual(self.store.writes, [])
        self.assertFalse(any('account' in key for key in self.store.data))

    def test_append_reuses_other_objects_and_retains_previous_release(self):
        first = self.publish()
        self.store.writes.clear()
        self.write('distribution-ticker-test.json', {'history': [{'amount': '0.10', 'source': {'hash': 'original'}}, {'amount': '0.11'}]})
        self.assertEqual(self.publish()['uploadedObjects'], 1)
        self.assertIn(f"public-content/production/releases/{first['releaseId']}/manifest.json", self.store.data)
        self.assertEqual(len(self.store.writes), 3)

    def test_loss_and_correction_fail_before_writes(self):
        self.publish()
        self.store.writes.clear()
        self.write('distribution-ticker-test.json', {'history': []})
        with self.assertRaisesRegex(ValueError, 'History loss'):
            self.publish()
        self.assertEqual(self.store.writes, [])

    def test_failure_and_race_leave_current_untouched_and_retry_recovers(self):
        self.publish()
        pointer = self.store.data['public-content/production/current.json']
        self.write('price-index.json', {'prices': {}})
        self.store.fail = '/objects/'
        with self.assertRaisesRegex(RuntimeError, 'upload failed'):
            self.publish()
        self.assertEqual(self.store.data['public-content/production/current.json'], pointer)
        self.store.fail = None
        self.store.race = True
        with self.assertRaises(S3Error):
            self.publish()
        self.assertEqual(self.store.data['public-content/production/current.json'], pointer)
        self.store.race = False
        self.assertEqual(self.publish()['status'], 'published')

    def test_channel_isolation_and_restore(self):
        self.publish()
        pointer = self.store.data['public-content/production/current.json']
        channel = 'preview-' + 'a' * 16
        self.publish(channel)
        self.assertEqual(self.store.data['public-content/production/current.json'], pointer)
        (self.root / 'distribution-ticker-test.json').unlink()
        restore(self.store, 'bucket', self.root, channel)
        self.assertEqual(json.loads((self.root / 'distribution-ticker-test.json').read_text())['history'][0]['amount'], '0.10')

    def test_fixed_dividend_and_source_survive_and_cannot_be_removed(self):
        fixed = {'amountFixed': '0.123400', 'date': '2026-01-01',
                 'source': {'url': 'https://issuer.example/notice', 'sha256': 'issuer-evidence'}}
        self.write('distribution-ticker-test.json', {'history': [fixed]})
        self.publish()
        manifest = next(json.loads(body) for key, body in self.store.data.items() if key.endswith('/manifest.json'))
        sha = manifest['files']['distribution-ticker-test.json']['sha256']
        body = self.store.data[f'public-content/production/objects/{sha}.json']
        self.assertEqual(json.loads(body)['history'], [fixed])
        self.write('distribution-ticker-test.json', {'history': [{'date': '2026-01-01'}]})
        self.store.writes.clear()
        with self.assertRaisesRegex(ValueError, 'History loss'):
            self.publish()
        self.assertEqual(self.store.writes, [])

    def test_legacy_mixed_price_and_fixed_dividend_file_is_untouched(self):
        mixed = self.root / 'data' / 'us' / 'example.json'
        mixed.parent.mkdir(parents=True)
        original = b'{"backtestData":[{"date":"2026-01-01","close":10,"amountFixed":0.1234,"sourceUrl":"https://issuer.example"}]}'
        mixed.write_bytes(original)
        self.publish()
        self.assertEqual(mixed.read_bytes(), original)
        self.assertFalse(any('/data/' in key for key in self.store.data))

    def test_missing_reference_and_validation_failure_write_nothing(self):
        (self.root / 'distribution-ticker-test.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing or unsafe'):
            self.publish()
        self.assertEqual(self.store.writes, [])
