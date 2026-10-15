import json
from pathlib import Path
import tempfile
import unittest

from scripts.utils.export_security_insights import bucket, export


class InsightsExportTests(unittest.TestCase):
    def test_publishes_roc_precision_and_missing_values_without_internal_paths(self):
        report = {'runState': 'complete', 'asOfDate': '2026-10-14', 'updatedAt': '2026-10-14',
                  'securities': {'SPYI': {'symbol': 'SPYI', 'status': 'partial',
                    'observationPath': '/private/source', 'performance': {'ttmDividendYield': {'value': None, 'status': 'needs_corporate_action_review'}},
                    'fund': {'error': '/private/error', 'expenseRatio': {'value': 0}}}},
                  'rocObservations': [{'ticker': 'SPYI', 'rocPercent': '95.274833', 'rocAmount': '0.48085208',
                    'classificationStatus': 'final', 'scope': 'payment', 'observationPath': '/private/roc'}]}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            self.assertEqual(export(report, output), 1)
            text = (output / f'{bucket("SPYI")}.json').read_text()
            self.assertNotIn('/private', text)
            row = json.loads(text)['securities']['SPYI']
            self.assertEqual(row['rocObservations'][0]['rocAmount'], '0.48085208')
            self.assertIsNone(row['performance']['ttmDividendYield']['value'])
            self.assertEqual(row['fund']['expenseRatio']['value'], 0)

    def test_incomplete_collection_cannot_replace_published_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '0.json'
            path.write_text('previous')
            with self.assertRaises(ValueError):
                export({'runState': 'in_progress', 'securities': {'AAA': {}}}, path.parent)
            self.assertEqual(path.read_text(), 'previous')


if __name__ == '__main__':
    unittest.main()
