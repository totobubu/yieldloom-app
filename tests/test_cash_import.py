import importlib.util
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from api.toss_extractor import parse_cash_transaction_lines

spec = importlib.util.spec_from_file_location('api.family_portfolio', Path(__file__).resolve().parents[1] / 'api/family-portfolio.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CashImportTest(unittest.TestCase):
    def test_local_and_foreign_cash_are_not_counted_twice(self):
        won = parse_cash_transaction_lines(['2026.10.15 원화입금 0.00 0 100,000 100,000 0 0 0 0 0 100,000'],0)
        self.assertEqual((won['currency'],won['amount'],won['suggestedKind']),('KRW',100000,'external_deposit'))
        fx = parse_cash_transaction_lines(['2026.10.15 환전원화출금 1,400.00 0 42,000 42,000 0 0 0 0 0 58,000'],0)
        self.assertEqual(fx['suggestedKind'],'exchange')
        usd = parse_cash_transaction_lines(['2026.10.15 외화입금 1,400.00 0 140,000 140,000 0 0 0 0 0 182,000','($ 100.00) ($ 100.00) ($ 0.00) ($ 0.00) ($ 0.00) ($ 0.00) ($ 130.00)'],0)
        self.assertEqual((usd['currency'],usd['amount'],usd['balance']),('USD',100,130))

    def test_uncertain_layout_and_security_dividends_do_not_become_external_deposits(self):
        self.assertEqual(parse_cash_transaction_lines(['2026.10.15 외화입금 숫자 열이 부족함'],0),{'unparsed':True})
        self.assertEqual(parse_cash_transaction_lines(['2026.10.15 외화입금 1,400.00 0 140,000 140,000 0 0 0 0 0 182,000'],0),{'unparsed':True})
        self.assertIsNone(parse_cash_transaction_lines(['2026.10.15 외화증권배당금입금 ETF 1,400.00 0 140,000 140,000 0 0 0 0 0 182,000','(US88636X8801)'],0))

    def test_family_pdf_cash_keeps_currency_and_does_not_need_security_mapping(self):
        cash={'date':'2026.10.15','rawType':'환전원화출금','currency':'KRW','amount':42000,'exchangeRate':1400,'balance':58000,'suggestedKind':'exchange'}
        with patch('api.toss_extractor.extract_transactions_from_pdf', return_value={'transactions':[], 'cash_transactions':[cash,{**cash,'balance':16000}]}):
            rows=module.pdf_rows(b'%PDF-1.4','')
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['cashKind'],'exchange')
        self.assertEqual(rows[0]['currency'],'KRW')
        self.assertNotEqual(rows[0]['externalId'],rows[1]['externalId'])
        from api.family_portfolio_service import validate_rows
        normalized, errors=validate_rows(rows,'transactions','2026-10-15')
        self.assertFalse(errors)
        self.assertEqual(normalized[0]['exchangeRate'],1400)
        self.assertEqual(normalized[0]['rawType'],'환전원화출금')

    def test_family_pdf_preserves_exact_native_settlement_for_funding(self):
        raw={'ticker':'US88636J6423','date':'2026.10.15','type':'구매','quantity':1,'transaction_amount_krw':140000,'settlement_amount_krw':140140,'transaction_amount_usd':100,'settlement_amount_usd':100.1,'exchange_rate':1400}
        with patch('api.toss_extractor.extract_transactions_from_pdf',return_value={'transactions':[raw]}):
            rows=module.pdf_rows(b'%PDF-1.4','')
        from api.family_portfolio_service import validate_rows
        normalized,errors=validate_rows(rows,'transactions','2026-10-15')
        self.assertFalse(errors)
        self.assertEqual(normalized[0]['nativeSettlementAmount'],100.1)
        self.assertEqual(normalized[0]['settlementAmount'],140140)
