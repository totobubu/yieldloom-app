import unittest

from datetime import datetime, timezone

from scripts.data_v2.collection_schedule import due_reason, schedule_for
from scripts.data_v2.collection_state import upgrade_state
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

    def test_official_time_history_schedules_only_the_announcement_window(self):
        now = datetime(2026, 10, 3, 9, tzinfo=timezone.utc)
        history = [
            {"officialPublishedAt": "2026-07-03T10:00:00+00:00"},
            {"officialPublishedAt": "2026-08-03T10:30:00+00:00"},
            {"officialPublishedAt": "2026-09-03T10:15:00+00:00"},
        ]
        schedule = schedule_for(history, now)
        source = {"schedule": schedule, "lastCheckedAt": "2026-10-02T10:00:00+00:00"}
        self.assertEqual(due_reason(source, datetime(2026, 10, 3, 10, tzinfo=timezone.utc)), "announcement_window")
        self.assertIsNone(due_reason(source, datetime(2026, 10, 3, 7, tzinfo=timezone.utc)))

    def test_unconfirmed_source_gets_one_daily_safety_check(self):
        source = {"schedule": {"mode": "observation", "confidence": "unconfirmed"}, "lastCheckedAt": "2026-10-02T10:00:00+00:00"}
        self.assertEqual(due_reason(source, datetime(2026, 10, 3, 7, tzinfo=timezone.utc)), "daily_safety")

    def test_v1_state_upgrades_without_discarding_approved_events(self):
        state = upgrade_state({"schemaVersion": 1, "generatedAt": None, "sources": {"neos|https://neosfunds.com/spyi/": {"provider": "neos", "url": "https://neosfunds.com/spyi/", "events": [event("0.25660")]}}})
        self.assertEqual(state["schemaVersion"], 2)
        self.assertEqual(state["sources"]["neos|https://neosfunds.com/spyi/"]["events"][0]["amount"], "0.25660")
