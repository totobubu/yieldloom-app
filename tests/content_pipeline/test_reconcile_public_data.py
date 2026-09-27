import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.reconcile_public_data import apply_review, scan


class PublicDataReconciliationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db_path = self.root / "studio.sqlite"
        self.data_dir = self.root / "data"
        (self.data_dir / "nyse").mkdir(parents=True)
        database = ContentDatabase(self.db_path)
        database.initialize()
        database.upsert_provider("yieldmax", "YieldMax", "https://yieldmaxetfs.com")
        source = SourceDocument("yieldmax", "https://yieldmaxetfs.com/official", "html", b"official")
        self.source_id = database.add_source_document(source)
        self.database = database

    def tearDown(self):
        self.temp.cleanup()

    def add_event(self, ticker, ex_date, amount):
        return self.database.upsert_distribution_event(DistributionEvent(
            provider_slug="yieldmax", ticker=ticker, distribution_per_share=amount,
            declared_date="2026-09-01", ex_date=ex_date,
            official_url="https://yieldmaxetfs.com/official",
        ), self.source_id)

    def write_ticker(self, ticker, rows):
        (self.data_dir / "nyse" / f"{ticker.lower()}.json").write_text(
            json.dumps({"tickerInfo": {"Symbol": ticker}, "backtestData": rows}), encoding="utf-8")

    def test_matches_amountfixed_and_flags_missing_mismatch_and_expected(self):
        self.add_event("MATCH", "2026-09-10", "0.1234")
        self.add_event("MISS", "2026-09-10", "0.2")
        self.add_event("DIFF", "2026-09-10", "0.3")
        self.add_event("EXPECT", "2026-09-10", "0.4")
        self.write_ticker("MATCH", [{"date": "2026-09-10", "amount": 1.234, "amountFixed": 0.1234}])
        self.write_ticker("MISS", [])
        self.write_ticker("DIFF", [{"date": "2026-09-10", "amount": 0.1, "amountFixed": 0.1}])
        self.write_ticker("EXPECT", [{"date": "2026-09-10", "expected": True}])

        result = scan(self.db_path, self.data_dir)
        statuses = {row["ticker"]: row["status"] for row in result["reviews"]}
        self.assertEqual(statuses, {"MATCH": "matched", "MISS": "missing_date", "DIFF": "amount_mismatch", "EXPECT": "expected_only"})

    def test_apply_requires_explicit_review_and_writes_only_selected_missing_row(self):
        self.add_event("MISS", "2026-09-10", "0.2")
        path = self.data_dir / "nyse" / "miss.json"
        self.write_ticker("MISS", [])
        review = next(row for row in scan(self.db_path, self.data_dir)["reviews"] if row["ticker"] == "MISS")
        self.assertEqual(review["status"], "missing_date")
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["backtestData"], [])

        result = apply_review(self.db_path, review["id"], "tester", "append")
        self.assertEqual(result["status"], "applied")
        row = json.loads(path.read_text(encoding="utf-8"))["backtestData"][0]
        self.assertEqual(row, {"date": "2026-09-10", "amount": 0.2, "amountFixed": 0.2, "expected": False})

    @patch("scripts.content_pipeline.reconcile_public_data.run_new_ticker_workflow")
    def test_runs_existing_onboarding_workflow_when_an_official_ticker_file_is_absent(self, workflow):
        self.add_event("NEW", "2026-09-10", "0.2")
        workflow.return_value = {"tickers": ["NEW"], "status": "failed", "retryable": True, "exitCode": 1, "stdout": "", "stderr": "failed"}

        result = scan(self.db_path, self.data_dir)

        workflow.assert_called_once_with(["NEW"])
        self.assertEqual(result["newTickerWorkflow"]["status"], "failed")
        self.assertEqual(result["reviews"][0]["status"], "missing_data_file")


if __name__ == "__main__":
    unittest.main()
