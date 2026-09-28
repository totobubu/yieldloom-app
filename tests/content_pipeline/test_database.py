import tempfile
from dataclasses import replace
import json
import unittest
from pathlib import Path

from scripts.content_pipeline import ContentDatabase, DistributionEvent, SourceDocument


class ContentDatabaseTest(unittest.TestCase):
    def test_source_and_event_are_idempotent_and_preserve_decimal_precision(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            database = ContentDatabase(Path(temp_dir) / "content.sqlite")
            database.initialize()
            database.upsert_provider(
                "yieldmax",
                "YieldMax",
                "https://yieldmaxetfs.com/",
            )
            document = SourceDocument(
                provider_slug="yieldmax",
                source_url="https://yieldmaxetfs.com/example",
                source_type="html",
                content=b"<table>official</table>",
            )
            source_id = database.add_source_document(document)
            self.assertEqual(source_id, database.add_source_document(document))

            event = DistributionEvent(
                provider_slug="yieldmax",
                ticker="TSLY",
                distribution_per_share="0.212700",
                declared_date="2026-09-16",
                ex_date="2026-09-17",
                record_date="2026-09-17",
                payable_date="2026-09-18",
                official_url=document.source_url,
                frequency="weekly",
                roc_percent="0.00",
            )
            event_id = database.upsert_distribution_event(event, source_id)
            self.assertEqual(event_id, database.upsert_distribution_event(event, source_id))
            self.assertEqual(
                database.summary(),
                {
                    "providers": 1,
                    "provider_funds": 1,
                    "source_documents": 1,
                    "collection_attempts": 0,
                    "distribution_events": 1,
                    "distribution_observations": 1,
                    "validation_findings": 0,
                    "pipeline_runs": 0,
                    "content_performance": 0,
                },
            )
            self.assertEqual(event.distribution_per_share, "0.212700")
            snapshot = database.dashboard_snapshot()
            self.assertEqual(snapshot["counts"]["distribution_events"], 1)
            self.assertEqual(snapshot["recentEvents"][0]["ticker"], "TSLY")
            self.assertEqual(snapshot["providers"][0]["event_count"], 1)
            self.assertEqual(snapshot["providers"][0]["catalog_ticker_count"], 1)
            self.assertEqual(snapshot["providers"][0]["collected_ticker_count"], 1)
            self.assertEqual(snapshot["providerFunds"][0]["coverage_status"], "collected")
            with database.connect() as connection:
                observation = connection.execute(
                    "SELECT * FROM distribution_observations"
                ).fetchone()
            self.assertEqual(observation["amount_raw"], "0.212700")
            self.assertEqual(observation["precision_digits"], 6)
            self.assertEqual(observation["source_class"], "issuer_official")
            # A correction keeps exact old decimals and its source link.
            corrected = replace(event, distribution_per_share="0.212701")
            database.upsert_distribution_event(corrected, source_id)
            database.upsert_distribution_event(corrected, source_id)
            with database.connect() as connection:
                revisions = connection.execute("SELECT snapshot_json FROM distribution_event_revisions").fetchall()
            self.assertEqual(len(revisions), 1)
            self.assertEqual(json.loads(revisions[0][0])["distribution_per_share"], "0.212700")

    def test_invalid_event_is_rejected(self):
        with self.assertRaises(ValueError):
            DistributionEvent(
                provider_slug="yieldmax",
                ticker="BAD TICKER",
                distribution_per_share="0",
                declared_date="2026-09-16",
                ex_date="2026-09-17",
                official_url="https://yieldmaxetfs.com/example",
            )


if __name__ == "__main__":
    unittest.main()
