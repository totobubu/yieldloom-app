import importlib.util
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from api.toss_extractor import parse_cash_transaction_lines, parse_transaction_lines

spec = importlib.util.spec_from_file_location('api.family_portfolio', Path(__file__).resolve().parents[1] / 'api/family-portfolio.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CashImportTest(unittest.TestCase):
    def test_real_won_columns_and_bank_transfers(self):
        row = parse_cash_transaction_lines(['2024.11.16 환전원화출금 1,404.49 0 997 997 0 0 0 0 0 0 6,396'], 0)
        self.assertEqual((row['amount'], row['balance'], row['exchangeRate'], row['suggestedKind']), (997, 6396, 1404.49, 'exchange'))
        row = parse_cash_transaction_lines(['2024.11.16 이체입금 예금주 0 43,084 43,084 0 0 0 0 0 0 50,477'], 0)
        self.assertEqual((row['amount'], row['suggestedKind']), (43084, 'external_deposit'))
        tax = parse_cash_transaction_lines(['2026.09.30 외화이자세금출금 0 20 20 0 0 0 20 0 0 112'], 0)
        self.assertEqual((tax['currency'], tax['suggestedKind']), ('KRW', 'tax'))
        reward = parse_cash_transaction_lines(['2026.10.08 이벤트 입금 0 50 50 0 0 0 0 0 0 162'], 0)
        self.assertEqual((reward['amount'], reward['suggestedKind']), (50, 'reward'))

    def test_domestic_trade_preserves_original_identifier_and_tax(self):
        row, _ = parse_transaction_lines(['2025.01.06 판매 폴라리스AI(A039980) 1 3,025 3,021 3,025 0 4 0 0 0 126,524'], 0)
        self.assertEqual((row['ticker'], row['quantity'], row['settlement_amount_krw'], row['tax_krw']), ('A039980', 1, 3021, 4))
        self.assertNotIn('exchange_rate', row)

    def test_security_transfers_and_tax_refunds_are_preserved_without_becoming_purchases(self):
        raw = {'ticker':'US0000000001', 'date':'2026.10.15', 'quantity':1, 'transaction_amount_krw':100, 'stock_name':'ETF'}
        types = {'주식병합입고':'transfer_in', '주식병합출고':'transfer_out', '출석체크이벤트입고':'transfer_in', '외화세금환급':'cash_in', '외국납부세액출금':'cash_out'}
        for original, normalized in types.items():
            with patch('api.toss_extractor.extract_transactions_from_pdf', return_value={'transactions':[{**raw, 'type':original}]}):
                row = module.pdf_rows(b'%PDF-1.4', '')[0]
            self.assertEqual(row['type'], normalized)
            self.assertEqual(row['originalCode'], raw['ticker'])

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
        self.assertEqual(normalized[0]['convertedAmount'],140000)
        self.assertEqual((normalized[0]['amount'],normalized[0]['currency']),(100,'USD'))
