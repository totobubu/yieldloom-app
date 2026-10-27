import json
import unittest
from scripts.data_platform.legacy_price_review import review


def body(rows, currency='USD'):
    return json.dumps({'tickerInfo': {'symbol': 'AAPL', 'currency': currency}, 'backtestData': rows}).encode()


class LegacyPriceReviewTest(unittest.TestCase):
    def test_old_history_loss_and_corrections_block_preservation(self):
        source = body([{'date':'2000-01-03','close':10}, {'date':'2026-01-02','close':20}])
        result = review(source, body([{'date':'2026-01-02','close':21}]), 'AAPL','USD')
        self.assertFalse(result['preservesSourcePrices'])
        self.assertEqual(result['missingDates'],['2000-01-03'])
        self.assertEqual(result['changedDates'],['2026-01-02'])

    def test_exact_copy_does_not_claim_complete_or_adjusted_history(self):
        source = body([{'date':'2000-01-03','close':10}, {'date':'2027-01-01','close':20,'forecasted':True}])
        result = review(source,source,'AAPL','USD')
        self.assertTrue(result['preservesSourcePrices'])
        self.assertEqual(result['source']['priceCount'],1)
        self.assertFalse(result['cutoverReady'])
        self.assertEqual(result['writesPerformed'],0)

    def test_identity_mismatch_and_duplicates_are_rejected(self):
        source = body([{'date':'2000-01-03','close':10}])
        with self.assertRaises(ValueError): review(source,source,'MSFT','USD')
        duplicate = body([{'date':'2000-01-03','close':10}]*2)
        with self.assertRaises(ValueError): review(source,duplicate,'AAPL','USD')
