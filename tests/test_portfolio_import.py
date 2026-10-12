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
    def test_parse_statement_reads_transactions_from_extractor_result(self):
        extraction = {"transactions": [{"ticker": "US88636J6423", "date": "2026.10.13", "type": "매수", "quantity": "2", "transaction_amount_krw": "1000"}]}
        with patch.object(portfolio_import, "extract_transactions_from_pdf", return_value=extraction):
            rows = portfolio_import.parse_statement(UploadedPdf(), "password")
        self.assertEqual(rows, [{"code": "US88636J6423", "date": "20261013", "rawType": "매수", "type": "buy", "quantity": 2.0, "amount": 1000.0, "price": None, "commission": None, "tax": None, "currency": "KRW", "nativeAmount": None, "nativePrice": None, "name": None, "balanceQuantity": None}])
