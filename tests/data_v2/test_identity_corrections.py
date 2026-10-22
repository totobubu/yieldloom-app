import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from scripts.data_v2.build_catalog import apply_identity_corrections
from scripts.data_platform.pipeline import Store
from scripts.data_platform.quality import evaluate


class IdentityCorrectionTests(unittest.TestCase):
    def row(self, **changes):
        return {'symbol': 'IWM', 'market': 'NYSE', 'currency': 'USD', 'isin': 'JP5841360000', **changes}

    def test_exact_correction_is_idempotent_without_mutating_input_or_adding_alias(self):
        original = {'IWM': self.row()}
        fixed = apply_identity_corrections(original)
        self.assertEqual(original['IWM']['isin'], 'JP5841360000')
        self.assertEqual(fixed['IWM'], self.row(isin='US4642876555'))
        self.assertEqual(apply_identity_corrections(fixed), fixed)
        self.assertEqual(apply_identity_corrections({}), {})

    def test_changed_identity_or_market_or_currency_requires_review(self):
        for changes in [{'isin': 'US4642872000'}, {'market': 'TOKYO'}, {'currency': 'JPY'}]:
            with self.assertRaisesRegex(ValueError, 'precondition'):
                apply_identity_corrections({'IWM': self.row(**changes)})

    def test_legacy_regeneration_cannot_reintroduce_wrong_identity(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source, output = root / 'nav.json', root / 'seed.json'
            source.write_text(json.dumps({'nav': [self.row()]}))
            for _ in range(2):
                subprocess.run([sys.executable, 'scripts/data_v2/build_catalog.py', '--input', str(source), '--output', str(output)], check=True)
                fixed = next(row for row in json.loads(output.read_text())['instruments'] if row['symbol'] == 'IWM')
                self.assertEqual(fixed['isin'], 'US4642876555')

    def test_iwm_sources_match_catalog_after_review(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            try:
                config = {'sources': [{'id': 'iwm', 'enabled': True, 'symbol': 'IWM', 'entityId': 'instrument:isin:US4642876555'}]}
                report = evaluate(store, config, list(apply_identity_corrections({'IWM': self.row()}).values()))
                self.assertNotIn('catalog_identity_conflict', report['sources'][0]['errors'])
            finally:
                store.close()
