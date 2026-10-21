import copy
import importlib.util
from types import SimpleNamespace
from unittest.mock import patch
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from scripts.metadata.security_status import load_statuses, validate_registry, apply_status
from scripts.data_v2.build_release import load_catalog

ROOT = Path(__file__).resolve().parents[2]


class ListingStatusTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / 'data-v2/security-status.json').read_text())

    def test_dates_status_duplicates_and_evidence_are_validated(self):
        for field, value in [('delistedOn', '2026-02-30'), ('status', 'inactive'), ('source', {}), ('checkedOn', None), ('officialVerified', True)]:
            with self.subTest(field=field):
                payload = copy.deepcopy(self.payload)
                payload['securities'][0][field] = value
                with self.assertRaises(ValueError):
                    validate_registry(payload)
        self.payload['securities'].append(copy.deepcopy(self.payload['securities'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            validate_registry(self.payload)

    def test_catalog_regeneration_applies_reviewed_status_to_old_active_input(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'nav.json', Path(temp) / 'catalog.json'
            source.write_text(json.dumps({'nav': [{'symbol': 'COII', 'market': 'NASDAQ', 'currency': 'USD', 'active': True}, {'symbol': 'IPO', 'market': 'NYSE', 'currency': 'USD', 'active': False}]}))
            subprocess.run([sys.executable, str(ROOT / 'scripts/data_v2/build_catalog.py'), '--input', str(source), '--output', str(output)], check=True, capture_output=True)
            rows = {r['symbol']: r for r in json.loads(output.read_text())['instruments']}
            self.assertFalse(rows['COII']['active'])
            self.assertEqual(rows['COII']['listingStatus']['status'], 'delisted')
            self.assertFalse(rows['IPO']['active'])
            self.assertNotIn('listingStatus', rows['IPO'])
            # Release normalization must not discard the status when regenerating search indexes.
            released = {r['symbol']: r for r in load_catalog(output, [])}
            self.assertEqual(released['COII']['listingStatus'], rows['COII']['listingStatus'])
            candidates = Path(temp) / 'events.json'
            candidates.write_text('[]')
            release = Path(temp) / 'release'
            subprocess.run([sys.executable, str(ROOT / 'scripts/data_v2/build_release.py'), '--input', str(candidates), '--catalog-input', str(output), '--release-id', 'status-test', '--output', str(release)], check=True, capture_output=True)
            search_rows = json.loads((release / 'catalog/search-index.json').read_text())['instruments']
            self.assertEqual(next(row for row in search_rows if row['symbol'] == 'COII')['listingStatus'], rows['COII']['listingStatus'])

    def test_lookup_failures_require_review_without_confirming_delisting(self):
        def fail(*args):
            raise RuntimeError('provider unavailable')
        spec = importlib.util.spec_from_file_location('failed_symbols', ROOT / 'scripts/data_pipeline/classify_failed_symbols.py')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'yfinance': SimpleNamespace(Ticker=fail), 'tqdm': SimpleNamespace(tqdm=lambda rows, **kwargs: rows)}):
            spec.loader.exec_module(module)
        self.assertEqual(module.check_symbol_status('TEST', ['', '.KS']), ('needs_review', None, {}))

    def test_no_automatic_dates_or_official_confirmation(self):
        status = load_statuses()['COII']
        self.assertIsNone(status['delistedOn'])
        self.assertIsNone(status['lastTradingOn'])
        self.assertFalse(status['officialVerified'])
        self.assertFalse(apply_status({'symbol': 'COII', 'active': True})['active'])


if __name__ == '__main__':
    unittest.main()
