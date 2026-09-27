import json
import tempfile
import unittest
from pathlib import Path

from scripts.content_pipeline.content_calendar import export_calendar
from scripts.content_pipeline.sync_notion import build_properties


class ContentCalendarTest(unittest.TestCase):
    def test_calendar_export_and_notion_mapping(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle = root / "generated" / "2026-09-16-tsly-42"
            bundle.mkdir(parents=True)
            (bundle / "manifest.json").write_text(
                json.dumps(
                    {
                        "generatedAt": "2026-09-19T00:00:00+00:00",
                        "eventId": 42,
                        "provider": "yieldmax",
                        "ticker": "TSLY",
                        "title": "TSLY 배당 발표",
                        "declaredDate": "2026-09-16",
                        "exDate": "2026-09-17",
                        "verificationStatus": "official",
                        "officialUrl": "https://yieldmaxetfs.com/our-etfs/tsly/",
                    }
                ),
                encoding="utf-8",
            )
            records = export_calendar(
                root / "generated", root / "calendar.json", root / "calendar.csv"
            )
            self.assertEqual(records[0]["eventKey"], "yieldmax:TSLY:42")
            properties = build_properties(records[0])
            self.assertEqual(properties["Ticker"]["rich_text"][0]["text"]["content"], "TSLY")
            self.assertTrue((root / "calendar.csv").exists())


if __name__ == "__main__":
    unittest.main()
