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

    def test_change_details_keep_decimal_prices_and_signed_differences(self):
        source = body([{'date': '2020-01-02', 'close': '0.100000000000000001'},
                       {'date': '2020-01-03', 'close': '20'}])
        destination = body([{'date': '2020-01-02', 'close': '0.100000000000000002'},
                            {'date': '2020-01-03', 'close': '19.75'}])
        result = review(source, destination, 'AAPL', 'USD')
        self.assertEqual(result['comparedPriceCount'], 2)
        self.assertEqual(result['priceChanges'][0]['difference'], '1E-18')
        self.assertEqual(result['priceChanges'][1]['difference'], '-0.25')
        self.assertEqual(result['priceChanges'][1]['relativeDifference'], '-0.0125')
        self.assertFalse(result['sameByteHash'])
        self.assertEqual(result['writesPerformed'], 0)
        self.assertFalse(result['cutoverReady'])

    def test_same_prices_with_different_serialization_do_not_require_identical_bytes(self):
        source = body([{'date': '2020-01-02', 'close': 10}])
        destination = json.dumps(json.loads(source), indent=2).encode()
        result = review(source, destination, 'AAPL', 'USD')
        self.assertTrue(result['preservesSourcePrices'])
        self.assertFalse(result['sameByteHash'])
        self.assertEqual(result['priceChanges'], [])
        self.assertEqual(result['comparedPriceCount'], 1)

    def test_no_overlap_does_not_invent_zero_prices_or_differences(self):
        result = review(body([{'date': '2020-01-02', 'close': 10}]),
                        body([{'date': '2021-01-04', 'close': 20}]), 'AAPL', 'USD')
        self.assertEqual(result['comparedPriceCount'], 0)
        self.assertEqual(result['priceChanges'], [])
        self.assertFalse(result['preservesSourcePrices'])
        self.assertEqual(result['missingDates'], ['2020-01-02'])
