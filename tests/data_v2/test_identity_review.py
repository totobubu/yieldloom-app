import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from scripts.data_v2.build_catalog import apply_identity_corrections
from scripts.data_platform.quality import valid_isin

ROOT = Path(__file__).resolve().parents[2]


class IdentityReviewTests(unittest.TestCase):
    def test_each_original_review_row_has_a_safe_current_outcome(self):
        review = json.loads((ROOT / 'data-v2/identity-review.json').read_text())
        catalog = {r['symbol']: r for r in json.loads((ROOT / 'data-v2/catalog-seed.json').read_text())['instruments']}
        self.assertEqual(len(review['entries']), 18)
        self.assertEqual(len({r['symbol'] for r in review['entries']}), 18)
        for entry in review['entries']:
            actual = catalog[entry['symbol']]
            for field in ('market', 'currency', 'active'):
                self.assertEqual(actual[field], entry[field])
            self.assertFalse(entry['automaticAlias'])
            self.assertFalse(entry['listingActivation'])
            if entry['status'] == 'confirmed_isin':
                self.assertTrue(valid_isin(entry['resolvedIsin']))
                self.assertEqual(actual['isin'], entry['resolvedIsin'])
            else:
                self.assertFalse(actual['active'])
                self.assertIsNone(actual['isin'])

    def test_missing_isin_fill_preserves_inactive_broker_class_and_active_fund(self):
        original = {'BRK.A': {'symbol': 'BRK.A', 'market': 'NYSE', 'currency': 'USD', 'isin': None, 'active': False},
                    'TSYW': {'symbol': 'TSYW', 'market': 'BATS', 'currency': 'USD', 'isin': None, 'active': True}}
        fixed = apply_identity_corrections(original)
        self.assertEqual(fixed['BRK.A']['isin'], 'US0846701086')
        self.assertFalse(fixed['BRK.A']['active'])
        self.assertEqual(fixed['TSYW']['isin'], 'US77926X3952')
        self.assertTrue(fixed['TSYW']['active'])
        self.assertIsNone(original['TSYW']['isin'])
        self.assertEqual(apply_identity_corrections(fixed), fixed)

    def test_legacy_regeneration_keeps_reviewed_fills_and_availability(self):
        rows = [{'symbol': 'TSYW', 'market': 'BATS', 'currency': 'USD', 'isin': None, 'active': True},
                {'symbol': 'BRK.A', 'market': 'NYSE', 'currency': 'USD', 'isin': None, 'active': False}]
        with tempfile.TemporaryDirectory() as root:
            source, output = Path(root) / 'nav.json', Path(root) / 'catalog.json'
            source.write_text(json.dumps({'nav': rows}))
            subprocess.run([sys.executable, 'scripts/data_v2/build_catalog.py', '--input', str(source), '--output', str(output)], check=True)
            result = {r['symbol']: r for r in json.loads(output.read_text())['instruments']}
            self.assertEqual(result['TSYW']['isin'], 'US77926X3952')
            self.assertFalse(result['BRK.A']['active'])
