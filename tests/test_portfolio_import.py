import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


API_DIR = Path(__file__).resolve().parents[1] / "api"
sys.path.insert(0, str(API_DIR))
SPEC = importlib.util.spec_from_file_location("portfolio_import", API_DIR / "portfolio-import.py")
portfolio_import = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(portfolio_import)


class UploadedPdf:
    def save(self, handle):
        handle.write(b"%PDF-1.4")


class PortfolioImportTest(unittest.TestCase):
    def test_legacy_upload_endpoint_is_retired_without_touching_data(self):
        response = portfolio_import.app.test_client().post('/api/portfolio-import')
        self.assertEqual(response.status_code, 410)

    def test_parse_statement_reads_transactions_from_extractor_result(self):
        extraction = {"transactions": [{"ticker": "US88636J6423", "date": "2026.10.13", "type": "매수", "quantity": "2", "transaction_amount_krw": "1000"}]}
        with patch.object(portfolio_import, "extract_transactions_from_pdf", return_value=extraction):
            rows = portfolio_import.parse_statement(UploadedPdf(), "password")
        self.assertEqual(rows, [{"code": "US88636J6423", "date": "20261013", "rawType": "매수", "type": "buy", "quantity": 2.0, "amount": 1000.0, "settlementAmount": None, "nativeSettlementAmount": None, "exchangeRate": None, "nativeCommission": None, "nativeTax": None, "price": None, "commission": None, "tax": None, "currency": "KRW", "nativeAmount": None, "nativePrice": None, "name": None, "balanceQuantity": None}])

class RetiredReviewLifecycleTest(unittest.TestCase):
    def test_retired_commit_cannot_modify_legacy_data(self):
        with patch.object(portfolio_import, 'firebase_db') as db, patch.object(portfolio_import, 'persist_items') as persist:
            response = portfolio_import.app.test_client().post('/api/portfolio-import?action=commit', json={'sessionId': 'old', 'acceptedIds': ['row']})
        self.assertEqual(response.status_code, 410)
        db.assert_not_called()
        persist.assert_not_called()

    def test_retired_refresh_directs_clients_to_account_scoped_import(self):
        with patch.object(portfolio_import, 'firebase_db') as db:
            response = portfolio_import.app.test_client().post('/api/portfolio-import?action=refresh', json={'sessionId': 'old'})
        self.assertEqual(response.status_code, 410)
        db.assert_not_called()
