import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.content_pipeline import ContentDatabase, DistributionEvent, SourceDocument
from scripts.content_pipeline.weekly_digest import generate_weekly_digest


class WeeklyDigestTest(unittest.TestCase):
    def test_generates_fact_locked_newsletter_and_script(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            database = ContentDatabase(root / "content.sqlite")
            database.initialize()
            database.upsert_provider("neos", "NEOS", "https://neosfunds.com/")
            source = SourceDocument(
                provider_slug="neos",
                source_url="https://neosfunds.com/spyi/",
                source_type="fixture",
                content=b"official",
            )
            source_id = database.add_source_document(source)
            for declared, ex_date, amount in (
                ("2026-09-08", "2026-09-09", "0.5000"),
                ("2026-09-15", "2026-09-16", "0.5500"),
            ):
                database.upsert_distribution_event(
                    DistributionEvent(
                        provider_slug="neos",
                        ticker="SPYI",
                        distribution_per_share=amount,
                        declared_date=declared,
                        ex_date=ex_date,
                        payable_date="2026-09-18",
                        official_url=source.source_url,
                    ),
                    source_id,
                )
            output = generate_weekly_digest(
                database.path, date(2026, 9, 19), root / "weekly"
            )
            newsletter = (output / "newsletter.md").read_text("utf-8")
            script = (output / "youtube-script.md").read_text("utf-8")
            self.assertIn("10.0% 증가", newsletter)
            self.assertIn("0.5500달러", script)
            self.assertTrue((output / "facts.json").exists())


if __name__ == "__main__":
    unittest.main()
