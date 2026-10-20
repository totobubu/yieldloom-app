import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'api'))
from toss_extractor import extract_transactions_from_pdf, parse_transaction_lines

class TossStatementColumns(unittest.TestCase):
    def test_statement_identity_accepts_header_spacing_colons_and_shared_lines(self):
        for header in [
            '성명 PDFTest\n계좌번호 100-01-001234',
            '성명: PDFTest 계좌 번호: 100 - 01 - 001234',
            '성명：PDFTest\n계좌번호：10001001234',
            '성명 PDFTest\n계좌번호 ****1234',
        ]:
            with self.subTest(header=header):
                page = MagicMock()
                page.extract_text.return_value = header
                pdf = MagicMock()
                pdf.__enter__.return_value.pages = [page]
                with patch('toss_extractor.pdfplumber.open', return_value=pdf):
                    result = extract_transactions_from_pdf('synthetic.pdf', verbose=False)
                self.assertEqual(result['metadata']['customer_name'], 'PDFTest')
                self.assertTrue(result['metadata']['account_number'].endswith('1234'))

    def test_statement_identity_accepts_spaced_glyphs_and_wrapped_values(self):
        for header, expected in [
            ('요청 고객\n성 명 홍 길 동\n계 좌 번 호 100 - 01 - 001234', '홍길동'),
            ('성명\n홍길동\n계좌번호\n100-01-001234', '홍길동'),
            ('성 명：\n홍 길 동\n계좌 번호：100-01-001234', '홍길동'),
            ('성명 Hong Gil Dong 계좌번호 100-01-001234', 'Hong Gil Dong'),
        ]:
            with self.subTest(header=header):
                page = MagicMock()
                page.extract_text.return_value = header
                pdf = MagicMock()
                pdf.__enter__.return_value.pages = [page]
                with patch('toss_extractor.pdfplumber.open', return_value=pdf):
                    result = extract_transactions_from_pdf('synthetic.pdf', verbose=False)
                self.assertEqual(result['metadata']['customer_name'], expected)
                self.assertTrue(result['metadata']['account_number'].endswith('1234'))

    def test_missing_name_does_not_consume_the_next_header_or_a_trade(self):
        for header in [
            '성명\n계좌번호 100-01-001234',
            '성명: 계좌번호: 100-01-001234',
            '성명:',
            '성명\n100-01-001234',
            '거래 종목명 홍길동\n계좌번호 100-01-001234',
            '성명\n종목명 거래내역',
        ]:
            with self.subTest(header=header):
                page = MagicMock()
                page.extract_text.return_value = header
                pdf = MagicMock()
                pdf.__enter__.return_value.pages = [page]
                with patch('toss_extractor.pdfplumber.open', return_value=pdf):
                    result = extract_transactions_from_pdf('synthetic.pdf', verbose=False)
                self.assertNotIn('customer_name', result['metadata'])

    def test_fractional_purchase_keeps_settlement_distinct_from_price_and_fees(self):
        row, _ = parse_transaction_lines([
            '2026.10.15 구매 테스트 ETF 1,338.60 0.144987 6,692 6,693 46,162 0 0 0 243.428075 281,106',
            '(US77926X5858) ($ 4.999993) ($ 5.00) ($ 34.485802) ($ 0.00) ($ 0.00) ($ 0.00) ($ 210.00)',
        ], 0)
        self.assertEqual(row['quantity'], 0.144987)
        self.assertEqual(row['transaction_amount_krw'], 6692)
        self.assertEqual(row['settlement_amount_krw'], 6693)
        self.assertEqual(row['unit_price_krw'], 46162)
        self.assertEqual(row['commission_krw'], 0)
        self.assertEqual(row['tax_krw'], 0)
        self.assertEqual(row['balance_quantity'], 243.428075)
        self.assertEqual(row['transaction_amount_usd'], 4.999993)
        self.assertEqual(row['unit_price_usd'], 34.485802)

    def test_dividend_tax_does_not_become_a_fee_or_a_share_balance(self):
        row, _ = parse_transaction_lines([
            '2026.09.18 외화증권배당금입금 테스트 ETF 1,380.30 240 59,891 59,891 0 0 10,573 0 0 345,530',
            '(US88636X8801) ($ 43.39) ($ 43.39) ($ 0.00) ($ 0.00) ($ 7.66) ($ 0.00) ($ 250.33)',
        ], 0)
        self.assertEqual(row['commission_krw'], 0)
        self.assertEqual(row['tax_krw'], 10573)
        self.assertEqual(row['tax_usd'], 7.66)
        self.assertEqual(row['balance_quantity'], 0)

if __name__ == '__main__':
    unittest.main()
