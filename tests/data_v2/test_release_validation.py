import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.data_v2.validate_snapshot import valid_amount

ROOT = Path(__file__).resolve().parents[2]


class ReleaseValidationTest(unittest.TestCase):
    def test_rejects_nonfinite_negative_and_wrong_currency_amounts(self):
        for value in ['Infinity', 'NaN', '-1', '0']:
            with self.subTest(value=value):
                self.assertTrue(valid_amount({'raw': value, 'decimal': value, 'currency': 'USD'}, 'amount'))
        self.assertTrue(valid_amount({'raw': '0.25660', 'decimal': '0.25660', 'currency': ''}, 'amount'))
        self.assertFalse(valid_amount({'raw': '0.25660', 'decimal': '0.25660', 'currency': 'USD'}, 'amount'))

    def test_empty_bootstrap_cannot_pass_release_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'schemaVersion':1,'releaseId':'bootstrap','files':[]}))
            result = subprocess.run([sys.executable, 'scripts/data_v2/validate_snapshot.py', '--data-dir', str(root)], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('non-empty', result.stderr)

    def test_corrupt_ticker_amount_is_rejected_even_when_hash_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / 'candidate.json'
            candidate.write_text(json.dumps([{'provider':'neos','ticker':'SPYI','amount':'0.25660','currency':'USD','declaredDate':'2026-09-15','exDate':'2026-09-16','officialUrl':'https://neosfunds.com/spyi/','sourceSha256':'a'*64,'verificationStatus':'official','collectionMethod':'official_fetch'}]))
            release = root / 'release'
            subprocess.run([sys.executable,'scripts/data_v2/build_release.py','--input',str(candidate),'--release-id','test','--output',str(release)],cwd=ROOT,check=True,capture_output=True)
            path = release / 'tickers/SPYI.json'
            payload = json.loads(path.read_text())
            payload['events'][0]['amount']['raw'] = payload['events'][0]['amount']['decimal'] = 'Infinity'
            path.write_text(json.dumps(payload))
            manifest_path = release / 'manifest.json'
            manifest = json.loads(manifest_path.read_text())
            for entry in manifest['files']:
                if entry['path'] == 'tickers/SPYI.json': entry['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            manifest_path.write_text(json.dumps(manifest))
            result = subprocess.run([sys.executable,'scripts/data_v2/validate_snapshot.py','--data-dir',str(release)],cwd=ROOT,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('finite and positive',result.stderr)
