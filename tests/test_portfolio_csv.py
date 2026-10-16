"""Safe CSV export metadata never changes unmarked original identifiers."""
import unittest
from api.family_portfolio_service import parse_csv, PortfolioError


class PortfolioCsvTest(unittest.TestCase):
    def csv(self, external_id, marker):
        return ('date,symbol,quantity,amount,currency,type,externalId,csvEscaped\n'
                f'2026-10-15,AAPL,1,0,USD,buy,{external_id},{marker}\n').encode('utf-8')

    def test_only_marked_protective_apostrophe_is_removed(self):
        self.assertEqual(parse_csv(self.csv("'=1", 'v1:externalId'))[0]['externalId'], '=1')
        self.assertEqual(parse_csv(self.csv("'=1", ''))[0]['externalId'], "'=1")
        self.assertEqual(parse_csv(self.csv('trade-1', ''))[0]['externalId'], 'trade-1')

    def test_invalid_markers_are_rejected_without_guessing_original_ids(self):
        for marker in ['v2:externalId', 'v1:unknown', 'v1:csvEscaped', 'v1:externalId|externalId', 'v1:']:
            with self.subTest(marker=marker), self.assertRaises(PortfolioError):
                parse_csv(self.csv("'=1", marker))
        with self.assertRaises(PortfolioError):
            parse_csv(self.csv('trade-1', 'v1:externalId'))


if __name__ == '__main__':
    unittest.main()
