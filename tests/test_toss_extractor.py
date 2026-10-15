import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'api'))
from toss_extractor import parse_transaction_lines

class TossStatementColumns(unittest.TestCase):
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
