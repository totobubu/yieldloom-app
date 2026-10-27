import copy
import unittest
from scripts.data_platform.history_review import review_rows


class HistoryReviewTest(unittest.TestCase):
    def test_same_display_time_preserves_distinct_qdte_order_ids(self):
        rows = [{'id': 'synthetic-1', 'symbol': 'QDTE', 'time': '2025-01-02 20:30', 'quantity': '1'},
                {'id': 'synthetic-2', 'symbol': 'QDTE', 'time': '2025-01-02 20:30', 'quantity': '2'}]
        original = copy.deepcopy(rows)
        result = review_rows(rows, identity_fields=['id'], value_fields=['quantity'], decimal_fields=['quantity'])
        self.assertEqual(result['distinctIdentities'], 2)
        self.assertEqual(result['sourceRows'], 2)
        self.assertEqual(rows, original)
        self.assertFalse(result['approved'])

    def test_duplicate_official_dates_keep_roc_variations_without_choosing_last(self):
        rows = [{'date': '2025-01-02', 'amount': '0.20', 'roc': '10%'},
                {'date': '2025-01-02', 'amount': '0.200', 'roc': '20%'},
                {'date': '2025-01-02', 'amount': '0.200', 'roc': '20%'}]
        result = review_rows(rows, identity_fields=['date'], value_fields=['amount', 'roc'], decimal_fields=['amount'])
        self.assertEqual(result['exactDuplicateRows'], 1)
        self.assertEqual(result['variations'][0]['fields'], {'roc': ['10%', '20%']})
        self.assertEqual(result['variations'][0]['sourceRowIndexes'], [0, 1, 2])
        self.assertTrue(result['reviewRequired'])

    def test_unknown_fee_is_distinct_from_observed_zero(self):
        result = review_rows([{'id': 'synthetic', 'fee': None}, {'id': 'synthetic', 'fee': '0'}],
                            identity_fields=['id'], value_fields=['fee'], decimal_fields=['fee'])
        self.assertEqual(result['variations'][0]['fields']['fee'], [None, '0'])
        self.assertEqual(result['historicalCompleteness'], 'unverified')
        self.assertEqual(result['writesPerformed'], 0)

    def test_amount_followed_by_date_is_not_a_decimal_candidate(self):
        # YMAX-style concatenation is synthetic: do not greedily turn it into money.
        for value in ['3.5211월 26일 출금', 'NaN', 'Infinity', True]:
            with self.assertRaises(ValueError):
                review_rows([{'id': 'synthetic', 'amount': value}], identity_fields=['id'],
                            value_fields=['amount'], decimal_fields=['amount'])

    def test_missing_identity_does_not_fall_back_to_time(self):
        with self.assertRaises(ValueError):
            review_rows([{'time': '2025-01-02 20:30', 'amount': '1'}],
                        identity_fields=['brokerId'], value_fields=['amount'])
