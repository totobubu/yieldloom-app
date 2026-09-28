import tempfile
import unittest
from pathlib import Path

from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.record_collection_report import record_collection_report
from scripts.content_pipeline.refresh import _ticker_target


class CollectionHealthTest(unittest.TestCase):
    def test_dashboard_exposes_latest_browser_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "ledger.sqlite"
            database = ContentDatabase(db_path)
            database.initialize()
            database.upsert_provider(
                "schwab", "Schwab", "https://www.schwabassetmanagement.com"
            )
            database.upsert_provider_fund(
                "schwab", "SCHD",
                "https://www.schwabassetmanagement.com/products/schd",
                "official_fund_history",
            )
            record_collection_report(db_path, "schwab", {
                "errors": [{
                    "url": "https://www.schwabassetmanagement.com/products/schd",
                    "fetchMode": "browser",
                    "code": "challenge_detected",
                    "retryable": False,
                    "error": "anti-automation challenge detected; collection stopped",
                }],
            })
            provider = database.dashboard_snapshot()["providers"][0]
            self.assertEqual(provider["last_fetch_mode"], "browser")
            self.assertEqual(provider["last_attempt_status"], "challenge_detected")
            self.assertIn("challenge", provider["last_attempt_message"])
            self.assertEqual(provider["catalog_ticker_count"], 1)
            self.assertEqual(provider["collected_ticker_count"], 0)
            fund = database.dashboard_snapshot()["providerFunds"][0]
            self.assertEqual(fund["coverage_status"], "catalog_only")
            self.assertEqual(
                _ticker_target(database, "SCHD"),
                ("schwab", "https://www.schwabassetmanagement.com/products/schd"),
            )


if __name__ == "__main__":
    unittest.main()
