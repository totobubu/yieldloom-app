import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class ReleaseTests(unittest.TestCase):
    def test_build_preserves_trailing_zeroes_and_writes_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            candidate = temp_path / "candidate.json"
            candidate.write_text(json.dumps([{
                "provider": "neos", "ticker": "SPYI", "amount": "0.25660", "currency": "USD",
                "declaredDate": "2026-09-15", "exDate": "2026-09-16", "officialUrl": "https://neosfunds.com/spyi/",
                "sourceSha256": "a" * 64, "verificationStatus": "official", "collectionMethod": "official_fetch",
            }]), encoding="utf-8")
            output = temp_path / "release"
            subprocess.run([sys.executable, "scripts/data_v2/build_release.py", "--input", str(candidate), "--release-id", "test", "--output", str(output)], cwd=ROOT, check=True)
            subprocess.run([sys.executable, "scripts/data_v2/validate_snapshot.py", "--data-dir", str(output)], cwd=ROOT, check=True)
            event = json.loads((output / "tickers" / "SPYI.json").read_text(encoding="utf-8"))["events"][0]
            self.assertEqual(event["amount"], {"raw": "0.25660", "decimal": "0.25660", "currency": "USD"})

    def test_legacy_baseline_cannot_be_released(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            candidate = temp_path / "candidate.json"
            candidate.write_text(json.dumps([{
                "provider": "neos", "ticker": "SPYI", "amount": "0.25660", "currency": "USD",
                "declaredDate": "2026-09-15", "exDate": "2026-09-16", "officialUrl": "https://neosfunds.com/spyi/",
                "sourceSha256": "a" * 64, "verificationStatus": "official", "collectionMethod": "legacy_baseline",
            }]), encoding="utf-8")
            result = subprocess.run([sys.executable, "scripts/data_v2/build_release.py", "--input", str(candidate), "--release-id", "test", "--output", str(temp_path / "release")], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("not freshly collected", result.stderr)


if __name__ == "__main__":
    unittest.main()
