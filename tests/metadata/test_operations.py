import unittest
from scripts.metadata.apply_reviews import apply_reviews
from scripts.metadata.health import update_health
import json
import tempfile
from unittest.mock import patch
from scripts.data_v2 import build_catalog
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]


class OperationsTests(unittest.TestCase):
    def test_review_apply_does_not_register_incomplete_instruments_or_mutate_inputs(self):
        row = json.loads((ROOT / 'data-v2/security-underlyings.json').read_text())['instruments']['AAPY']
        payload = {'schemaVersion': 1, 'decisions': [{'symbol': 'AAPY', 'revision': 1, 'approved': row}]}
        catalog = {'instruments': []}
        registry = {'schemaVersion': 1, 'instruments': {}}
        with self.assertRaises(ValueError): apply_reviews(payload, registry, catalog)
        payload['decisions'][0]['instrument'] = {'symbol':'AAPY','market':'NYSE','currency':'USD','longName':'Kurv Apple ETF','active':True}
        links, result = apply_reviews(payload, registry, catalog)
        self.assertEqual(links['instruments']['AAPY']['underlying'], 'AAPL')
        self.assertEqual(result['instruments'][0]['officialProvider'], 'Kurv')
        self.assertEqual(catalog, {'instruments': []})
        self.assertEqual(registry['instruments'], {})
        payload['decisions'].append(payload['decisions'][0])
        with self.assertRaises(ValueError): apply_reviews(payload, registry, catalog)

    def test_collection_failure_keeps_last_success_and_coverage_loss_is_visible(self):
        first = update_health({}, {'kurv': {'verifiedLinks':10,'products':12,'errors':[]}}, '2026-10-15T00:00:00+00:00')
        failed = update_health(first, {'kurv': {'verifiedLinks':0,'catalogFailed':True,'errors':['403']}}, '2026-10-16T00:00:00+00:00')
        self.assertEqual(failed['providers']['kurv']['lastSuccessAt'], first['providers']['kurv']['lastSuccessAt'])
        self.assertEqual(failed['providers']['kurv']['status'], 'failed')
        partial = update_health(first, {'kurv': {'verifiedLinks':6,'products':12,'errors':[]}}, '2026-10-17T00:00:00+00:00')
        self.assertTrue(partial['providers']['kurv']['coverageDrop'])
        self.assertEqual(partial['providers']['kurv']['lastCompleteAt'], first['providers']['kurv']['lastCompleteAt'])
        self.assertEqual(partial['providers']['kurv']['status'], 'degraded')
        self.assertEqual(first['providers']['kurv']['verifiedLinks'],10)

    def test_seed_regeneration_keeps_reviewed_registration_without_legacy_row(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'nav.json'
            output = Path(directory) / 'seed.json'
            source.write_text(json.dumps({'nav': [{'symbol': 'AAA', 'market': 'NYSE', 'currency': 'USD'}]}))
            output.write_text(json.dumps({'instruments': [{'symbol': 'AAPY', 'market': 'NYSE', 'currency': 'USD', 'longName': 'Confirmed name', 'active': False}]}))
            with patch('sys.argv', ['build_catalog', '--input', str(source), '--output', str(output)]):
                self.assertEqual(build_catalog.main(), 0)
            rows = {row['symbol']: row for row in json.loads(output.read_text())['instruments']}
            self.assertEqual(rows['AAPY']['underlying'], 'AAPL')
            self.assertEqual(rows['AAPY']['longName'], 'Confirmed name')
            self.assertFalse(rows['AAPY']['active'])
            self.assertIn('AAA', rows)
