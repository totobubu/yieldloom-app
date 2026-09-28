import unittest

from scripts.data_v2.prepare_incremental_candidate import update_source


def event(amount: str) -> dict[str, object]:
    return {
        "provider": "neos", "ticker": "SPYI", "amount": amount, "currency": "USD",
        "declaredDate": "2026-09-15", "exDate": "2026-09-16", "recordDate": None,
        "payableDate": None, "frequency": None, "officialUrl": "https://neosfunds.com/spyi/",
        "sourceSha256": "a" * 64, "verificationStatus": "official", "collectionMethod": "official_fetch",
    }


class IncrementalStateTests(unittest.TestCase):
    def test_correction_replaces_same_identity_and_preserves_precision(self):
        previous = {"provider": "neos", "url": "https://neosfunds.com/spyi/", "events": [event("0.24568")]}
        updated, diff = update_source(previous, [event("0.25660")], "b" * 64, "2026-09-28T00:00:00+00:00")
        self.assertEqual(len(diff["changed"]), 1)
        self.assertEqual(updated["events"][0]["amount"], "0.25660")

    def test_missing_row_is_retained_pending_review(self):
        previous = {"provider": "neos", "url": "https://neosfunds.com/spyi/", "events": [event("0.25660")]}
        updated, diff = update_source(previous, [], "b" * 64, "2026-09-28T00:00:00+00:00")
        self.assertEqual(len(diff["suspectedRemoved"]), 1)
        self.assertEqual(updated["events"][0]["amount"], "0.25660")
