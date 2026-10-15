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
        self.assertEqual(rows, [{"code": "US88636J6423", "date": "20261013", "rawType": "매수", "type": "buy", "quantity": 2.0, "amount": 1000.0, "settlementAmount": None, "nativeSettlementAmount": None, "exchangeRate": None, "nativeCommission": None, "nativeTax": None, "price": None, "commission": None, "tax": None, "currency": "KRW", "nativeAmount": None, "nativePrice": None, "name": None, "balanceQuantity": None}])

class ReviewLifecycleTest(unittest.TestCase):
    def setUp(self):
        from datetime import datetime, timedelta, timezone
        from unittest.mock import MagicMock
        self.db=MagicMock()
        self.session=self.db.collection.return_value.document.return_value.collection.return_value.document.return_value
        self.session.get.return_value.exists=True
        self.first={'code':'US35953D4016','date':'20260101','rawType':'구매','type':'buy','quantity':1.0,'amount':100.0}
        self.second={'code':'US26923N4135','date':'20260101','rawType':'구매','type':'buy','quantity':1.0,'amount':200.0}
        self.session.get.return_value.to_dict.return_value={'expiresAt':datetime.now(timezone.utc)+timedelta(hours=1),'items':[self.first,self.second]}
        self.client=portfolio_import.app.test_client()

    def test_partial_commit_retains_unmapped_rows_for_later_confirmation(self):
        ready=[{'id':portfolio_import.stable_id(self.first),'status':'ready'}]
        remaining=[{'id':portfolio_import.stable_id(self.second),'status':'unmapped'}]
        with patch.object(portfolio_import,'firebase_db',return_value=self.db),patch.object(portfolio_import,'get_user',return_value={'uid':'owner'}),patch.object(portfolio_import,'review_rows',side_effect=[ready,remaining]),patch.object(portfolio_import,'persist_items',return_value={'transactionCount':1}):
            response=self.client.post('/api/portfolio-import?action=commit',json={'sessionId':'session','acceptedIds':[portfolio_import.stable_id(self.first)]})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['remainingReview']['rows'],remaining)
        self.session.update.assert_called_once_with({'items':[self.second]})
        self.session.delete.assert_not_called()

    def test_refresh_rechecks_mapping_without_uploading_or_storing_trades(self):
        with patch.object(portfolio_import,'firebase_db',return_value=self.db),patch.object(portfolio_import,'get_user',return_value={'uid':'owner'}),patch.object(portfolio_import,'review_rows',return_value=[{'id':'ready','status':'ready'}]),patch.object(portfolio_import,'persist_items') as persist:
            response=self.client.post('/api/portfolio-import?action=refresh',json={'sessionId':'session'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['rows'][0]['status'],'ready')
        persist.assert_not_called()
