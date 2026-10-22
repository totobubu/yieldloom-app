from datetime import timedelta
from pathlib import Path
import tempfile
import unittest

from scripts.data_platform.pipeline import Store, collect, export_candidate
from scripts.data_platform.quality import evaluate, publication_errors, valid_isin
from test_pipeline import registry, response, xml, NOW


class QualityTests(unittest.TestCase):
    def test_isin_checksum_and_conflicting_catalog_never_changes_catalog(self):
        self.assertTrue(valid_isin('US4642876555'))
        self.assertFalse(valid_isin('US4642876556'))
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            config['sources'][0].update(entityId='instrument:isin:US4642876555', symbol='IWM')
            catalog = [{'symbol': 'IWM', 'isin': 'JP5841360000', 'market': 'NYSE'}]
            report = evaluate(store, config, catalog, NOW)
            self.assertIn('catalog_identity_conflict', report['sources'][0]['errors'])
            self.assertEqual(catalog[0]['isin'], 'JP5841360000')

    def test_stale_values_remain_private_but_block_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            config['sources'][0]['publicDisplay'] = 'approved'
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            later = NOW + timedelta(days=7)
            report = evaluate(store, config, [], later)
            issues = publication_errors(report['sources'][0], ['fx'])
            self.assertIn('stale_observation', issues)
            with self.assertRaisesRegex(ValueError, 'quality'):
                export_candidate(store, config, ['fx'], Path(directory) / 'blocked', public=True, now=later)
            self.assertFalse((Path(directory) / 'blocked').exists())
            self.assertTrue(store.state('ecb')['currentObservationIds'])

    def test_identity_candidates_and_unknown_fee_dates_cannot_publish(self):
        report = {'errors': [], 'warnings': ['as_of_unknown']}
        self.assertIn('discovery_candidates_not_canonical_catalog', publication_errors(report, ['identity']))
        self.assertIn('as_of_unknown', publication_errors(report, ['fund-profile']))
