import unittest

from scripts.data_platform.market_contract import validate_price, validate_split


class MarketContractTests(unittest.TestCase):
    def price(self, **changes):
        return {'entityId': 'instrument:isin:US4642872000', 'sourceId': 'fixture',
            'sourceDocumentId': 'a' * 64, 'asOfDate': '2026-10-21', 'currency': 'USD',
            'priceBasis': 'unadjusted', 'coverage': 'close_only', 'close': '100.0000',
            'open': None, 'high': None, 'low': None, 'volume': None, **changes}

    def test_close_only_preserves_precision_and_unknown_volume(self):
        row = validate_price(self.price())
        self.assertEqual(row['close'], '100.0000')
        self.assertIsNone(row['volume'])
        with self.assertRaises(ValueError):
            validate_price(self.price(open='100.0000'))

    def test_adjustments_ohlc_and_units_are_explicit(self):
        validate_price(self.price(coverage='ohlc', open='99', low='98', high='101', volume='0', volumeUnit='shares'))
        for changes in [{'priceBasis': 'adjusted'}, {'priceBasis': 'split_adjusted'},
                        {'coverage': 'ohlc', 'open': '99', 'low': '101', 'high': '102'},
                        {'volume': '1', 'volumeUnit': 'lots'}, {'volume': '-1', 'volumeUnit': 'shares'},
                        {'close': 'NaN'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_price(self.price(**changes))
        validate_price(self.price(priceBasis='split_adjusted', adjustmentAsOfDate='2026-10-22'))

    def test_split_uses_new_shares_per_old_share_and_rejects_wrong_direction(self):
        row = {**self.price(), 'effectiveDate': '2026-10-21', 'actionType': 'reverse_split',
               'newShares': '1', 'oldShares': '10'}
        validate_split(row)
        for changes in [{'oldShares': '0'}, {'actionType': 'split'}, {'sourceDocumentId': ''}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_split({**row, **changes})
