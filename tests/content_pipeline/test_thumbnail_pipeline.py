import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class ThumbnailPipelineTest(unittest.TestCase):
    def test_data_only_run_exports_schedule_without_editorial_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = subprocess.run(
                [sys.executable, 'scripts/content_pipeline/pipeline.py',
                 '--skip-collect', '--db', str(root / 'ledger.sqlite'),
                 '--bundles', str(root / 'bundles'),
                 '--public-dir', str(root / 'public'),
                 '--legacy-data-dir', str(root / 'data')],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)['status'], 'success')
            self.assertTrue((root / 'public/distribution-index.json').is_file())
            self.assertTrue((root / 'public/reconciliation.json').is_file())
            self.assertFalse((root / 'bundles').exists())


if __name__ == '__main__':
    unittest.main()
