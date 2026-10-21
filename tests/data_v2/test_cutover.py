import copy
import unittest
from scripts.data_v2.check_cutover import compare
from scripts.data_v2.migrate_catalog_metadata import migrate


def event(**changes):
    return {'provider': 'neos', 'ticker': 'SPYI', 'amount': '0.25660', 'currency': 'USD',
            'declaredDate': '2026-10-01', 'exDate': '2026-10-02', 'recordDate': '2026-10-02',
            'payableDate': '2026-10-03', 'verificationStatus': 'official', **changes}


class CutoverTests(unittest.TestCase):
    def test_cutover_preserves_history_and_accepts_new_verified_events(self):
        result = compare([event()], [event(), event(exDate='2026-11-02')])
        self.assertTrue(result['ready'])
        self.assertEqual(result['summary']['new'], 1)

    def test_missing_history_and_changed_dates_or_precision_block_cutover(self):
        for changes in ({'exDate': '2026-10-04'}, {'payableDate': '2026-10-04'},
                        {'declaredDate': '2026-09-30'}, {'recordDate': None},
                        {'amount': '0.2566'}, {'currency': 'KRW'}):
            with self.subTest(changes=changes):
                self.assertFalse(compare([event()], [event(**changes)])['ready'])
        self.assertFalse(compare([event()], [])['ready'])

    def test_review_only_history_is_never_promoted_and_duplicates_block(self):
        self.assertTrue(compare([event(), event(exDate='2026-11-02', verificationStatus='needs_review')], [event()])['ready'])
        self.assertFalse(compare([event()], [event(verificationStatus='needs_review')])['ready'])
        self.assertFalse(compare([event()], [event(), event()])['ready'])
        self.assertFalse(compare([], [])['ready'])

    def test_migration_keeps_owned_identity_and_separates_price_routing(self):
        original = {'schemaVersion': 1, 'instruments': [{'symbol': 'SPYI', 'koName': '검토한 이름', 'active': False}]}
        before = copy.deepcopy(original)
        legacy = {'nav': [{'symbol': 'SPYI', 'koName': '이전 이름', 'ipoDate': '2022-08-30',
                           'frequency': '월', 'dataPaths': ['data/bats/spyi.json'], 'periods': ['10Y']}]}
        catalog, sources, _ = migrate(original, legacy)
        self.assertEqual(original, before)
        row = catalog['instruments'][0]
        self.assertEqual(row['koName'], '검토한 이름')
        self.assertFalse(row['active'])
        self.assertEqual(row['ipoDate'], '2022-08-30')
        self.assertNotIn('dataPaths', row)
        self.assertNotIn('periods', row)
        self.assertEqual(sources['instruments'][0]['dataPath'], 'data/bats/spyi.json')
