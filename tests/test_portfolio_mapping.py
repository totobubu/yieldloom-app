import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'api'))
from portfolio_mapping import security_mapping

class SecurityMappingTest(unittest.TestCase):
    def test_reviewed_alias_precedes_legacy_and_preserves_statement_isin(self):
        db = MagicMock()
        db.collection.return_value.document.return_value.get.return_value.to_dict.return_value = {'symbol':'FUBO','isin':'US35953D4016','canonicalIsin':'US35953D1046'}
        result = security_mapping(db, 'US35953D4016')
        self.assertEqual(result['symbol'], 'FUBO')
        self.assertEqual(result['isin'], 'US35953D4016')
        self.assertEqual(result['canonicalIsin'], 'US35953D1046')
        db.collection.assert_called_once_with('portfolioSecurityMappings')

    def test_unreviewed_isin_uses_existing_mapping(self):
        db = MagicMock()
        reviewed = MagicMock(exists=False)
        legacy = MagicMock()
        legacy.to_dict.return_value = {'symbol':'TOPW'}
        db.collection.return_value.document.return_value.get.side_effect = [reviewed,legacy]
        self.assertEqual(security_mapping(db,'US77926X5858'), {'symbol':'TOPW'})

if __name__ == '__main__': unittest.main()
