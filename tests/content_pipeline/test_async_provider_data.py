import unittest
from pathlib import Path

from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.providers.jpmorgan import JPMorganAdapter
from scripts.content_pipeline.providers.rex import RexAdapter
from scripts.content_pipeline.providers.statestreet import StateStreetAdapter


FIXTURES = Path(__file__).parent / "fixtures"


def document(adapter, fixture):
    candidate = next(iter(adapter.discover()))
    return SourceDocument(adapter.slug, candidate.url, candidate.source_type,
                          (FIXTURES / fixture).read_bytes(), metadata=candidate.metadata)


class AsyncProviderDataTests(unittest.TestCase):
    def test_jpmorgan_reads_official_history_response_and_keeps_review_status(self):
        adapter = JPMorganAdapter()
        events = adapter.parse(document(adapter, "jpmorgan_history.json"))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].ticker, "JEPI")
        self.assertEqual(events[0].distribution_per_share, "0.34134")
        self.assertEqual(events[0].ex_date, "2026-10-01")
        self.assertEqual(events[0].payable_date, "2026-10-05")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_state_street_reads_official_grouped_response(self):
        adapter = StateStreetAdapter()
        events = adapter.parse(document(adapter, "statestreet_distributions.json"))
        self.assertEqual([event.ticker for event in events], ["HYBL", "SRLN"])
        self.assertEqual(events[0].distribution_per_share, "0.164532")
        self.assertEqual(events[0].frequency, "monthly")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_rex_uses_announced_dates_and_skips_future_schedule_without_amount(self):
        adapter = RexAdapter()
        events = adapter.parse(document(adapter, "rex_schedule.html"))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].ticker, "FEPI")
        self.assertEqual(events[0].distribution_per_share, "0.2094")
        self.assertEqual(events[0].declared_date, "2026-10-13")
        self.assertEqual(events[0].ex_date, "2026-10-14")
        self.assertEqual(events[0].verification_status, "official")

    def test_empty_or_changed_official_payload_remains_a_failure(self):
        for adapter in (JPMorganAdapter(), StateStreetAdapter()):
            with self.subTest(provider=adapter.slug), self.assertRaises((KeyError, ValueError)):
                adapter.parse(SourceDocument(adapter.slug, "https://example.com/fund", "json", b"{}"))


if __name__ == "__main__":
    unittest.main()
