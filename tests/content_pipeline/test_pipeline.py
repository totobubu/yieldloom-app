import json
import tempfile
import unittest
from pathlib import Path

from scripts.content_pipeline.content_calendar import export_calendar
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.generate_content import generate_all_bundles, load_event, refresh_existing_bundles
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.weekly_digest import build_shorts_script


class PipelineTest(unittest.TestCase):
    def test_verified_event_generates_once_and_exports_admin_views(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); db = ContentDatabase(root / "ledger.sqlite"); db.initialize()
            db.upsert_provider("yieldmax", "YieldMax", "https://yieldmaxetfs.com")
            source = db.add_source_document(SourceDocument(provider_slug="yieldmax", source_url="https://yieldmaxetfs.com/a", source_type="official", content=b"official"))
            event = DistributionEvent(provider_slug="yieldmax", ticker="TSLY", distribution_per_share="0.20", declared_date="2026-09-16", ex_date="2026-09-17", official_url="https://yieldmaxetfs.com/a")
            db.upsert_distribution_event(event, source)
            bundles = generate_all_bundles(root / "ledger.sqlite", root / "bundles")
            self.assertEqual(len(bundles), 1)
            self.assertEqual(generate_all_bundles(root / "ledger.sqlite", root / "bundles"), bundles)
            export_calendar(root / "bundles", root / "calendar.json", root / "calendar.csv")
            export_all(root / "ledger.sqlite", root / "bundles", root / "public")
            self.assertFalse((root / "public/distributions.json").exists())
            index = json.loads((root / "public/distribution-index.json").read_text())
            self.assertEqual(index["providers"][0]["slug"], "yieldmax")
            self.assertFalse((root / "public/distribution-yieldmax-1.json").exists())
            renders = json.loads((root / "public/renders.json").read_text())
            self.assertEqual(renders["renders"][0]["verificationStatus"], "official")
            self.assertEqual(renders["renders"][0]["officialUrl"], "https://yieldmaxetfs.com/a")
            export_all(root / "ledger.sqlite", root / "bundles", root / "public", legacy_exports=True)
            self.assertTrue((root / "public/distributions.json").exists())
            export_all(root / "ledger.sqlite", root / "bundles", root / "public")
            self.assertFalse((root / "public/distributions.json").exists())
            history = json.loads((root / "public/distribution-ticker-tsly.json").read_text())
            self.assertEqual(len(history['history']), 1)
            self.assertNotIn('event_key', history['history'][0])

    def test_legacy_public_data_is_used_when_sqlite_has_no_previous_event(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); db = ContentDatabase(root / "ledger.sqlite"); db.initialize()
            db.upsert_provider("yieldmax", "YieldMax", "https://yieldmaxetfs.com")
            source = db.add_source_document(SourceDocument("yieldmax", "https://yieldmaxetfs.com/official", "html", b"official"))
            event_id = db.upsert_distribution_event(DistributionEvent(
                provider_slug="yieldmax", ticker="TSLY", distribution_per_share="0.25",
                declared_date="2026-09-20", ex_date="2026-09-21", official_url="https://yieldmaxetfs.com/official"), source)
            data_dir = root / "data" / "nyse"; data_dir.mkdir(parents=True)
            (data_dir / "tsly.json").write_text(json.dumps({"backtestData": [
                {"date": "2026-09-14", "amount": 0.99, "amountFixed": 0.2},
                {"date": "2026-09-21", "expected": True},
            ]}), encoding="utf-8")
            loaded = load_event(root / "ledger.sqlite", event_id, False, root / "data")
            self.assertEqual(loaded.previous_distribution, "0.2")
            self.assertEqual(loaded.previous_distribution_source, "public-data")

    def test_public_renders_keep_three_distinct_ex_dates_per_ticker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); db = ContentDatabase(root / "ledger.sqlite"); db.initialize()
            db.upsert_provider("yieldmax", "YieldMax", "https://yieldmaxetfs.com")
            source = db.add_source_document(SourceDocument("yieldmax", "https://yieldmaxetfs.com/official", "html", b"official"))
            for index, ex_date in enumerate(("2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"), start=1):
                db.upsert_distribution_event(DistributionEvent(
                    provider_slug="yieldmax", ticker="TSLY", distribution_per_share="0.2",
                    declared_date=ex_date, ex_date=ex_date, official_url="https://yieldmaxetfs.com/official"), source)
            generate_all_bundles(root / "ledger.sqlite", root / "bundles")
            export_all(root / "ledger.sqlite", root / "bundles", root / "public")
            payload = json.loads((root / "public/content.json").read_text(encoding="utf-8"))
            self.assertEqual(len(payload["bundles"]), 3)
            self.assertEqual({item["manifest"]["exDate"] for item in payload["bundles"]}, {"2026-02-10", "2026-03-10", "2026-04-10"})

    def test_refresh_existing_bundle_uses_stable_ticker_and_declared_date_not_stale_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); db = ContentDatabase(root / "ledger.sqlite"); db.initialize()
            db.upsert_provider("yieldmax", "YieldMax", "https://yieldmaxetfs.com")
            source = db.add_source_document(SourceDocument("yieldmax", "https://yieldmaxetfs.com/official", "html", b"official"))
            event_id = db.upsert_distribution_event(DistributionEvent(
                provider_slug="yieldmax", ticker="TSLY", distribution_per_share="0.2",
                declared_date="2026-09-16", ex_date="2026-09-17", official_url="https://yieldmaxetfs.com/official"), source)
            bundle = root / "bundles" / "2026-09-16-tsly-42"; bundle.mkdir(parents=True)
            (bundle / "manifest.json").write_text(json.dumps({"eventId": 42, "ticker": "WRONG"}), encoding="utf-8")
            refresh_existing_bundles(root / "ledger.sqlite", root / "bundles", root / "data")
            manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["eventId"], event_id)
            self.assertEqual(manifest["ticker"], "TSLY")

    def test_shorts_keeps_facts_and_commentary_separate(self):
        result = build_shorts_script([], __import__('datetime').date(2026, 9, 1), __import__('datetime').date(2026, 9, 7))
        self.assertIn("사실 데이터", result)
        self.assertIn("내레이션", result)


if __name__ == "__main__":
    unittest.main()
