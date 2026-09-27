import json
from pathlib import Path
import tempfile
import unittest
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.models import DistributionEvent, SourceDocument


class ComparisonBoundariesTest(unittest.TestCase):
    def test_frequency_change_resets_comparison_window(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = ContentDatabase(root / 'ledger.sqlite')
            db.initialize()
            db.upsert_provider('yieldmax', 'YieldMax', 'https://yieldmaxetfs.com')
            source = db.add_source_document(SourceDocument('yieldmax', 'https://yieldmaxetfs.com/a', 'html', b'official'))
            for ex_date, frequency, amount in [('2024-01-01', 'monthly', '1.00'), ('2024-02-01', 'weekly', '0.25')]:
                db.upsert_distribution_event(DistributionEvent(provider_slug='yieldmax', ticker='TSLY',
                    distribution_per_share=amount, declared_date=ex_date, ex_date=ex_date,
                    official_url='https://yieldmaxetfs.com/a', frequency=frequency), source)
            export_all(root / 'ledger.sqlite', root / 'bundles', root / 'public')
            history = json.loads((root / 'public/distribution-ticker-tsly.json').read_text())['history']
            self.assertIsNone(history[0]['previous_amount'])
            self.assertEqual(history[0]['average4'], 0.25)
            self.assertEqual(history[0]['comparisonBasis'], 'corporate_action_or_frequency_change')
