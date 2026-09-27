import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.content_pipeline.performance import import_csv, recommend


class PerformanceRecommendationTest(unittest.TestCase):
    def test_import_is_idempotent_and_ranks_stronger_topic_first(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            csv_path = root / "metrics.csv"
            fieldnames = [
                "platform", "content_key", "ticker", "topic", "published_at", "views",
                "likes", "comments", "clicks", "subscribers", "watch_minutes", "production_minutes",
            ]
            with csv_path.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(
                    [
                        {"platform": "youtube", "content_key": "a", "ticker": "TSLY", "topic": "weekly-income", "published_at": "2026-09-18", "views": 10000, "likes": 800, "comments": 100, "clicks": 200, "subscribers": 120, "watch_minutes": 50000, "production_minutes": 90},
                        {"platform": "naver", "content_key": "b", "ticker": "SCHD", "topic": "dividend-growth", "published_at": "2026-09-18", "views": 500, "likes": 5, "comments": 0, "clicks": 2, "subscribers": 0, "watch_minutes": 0, "production_minutes": 30},
                    ]
                )
            database_path = root / "content.sqlite"
            self.assertEqual(import_csv(database_path, csv_path), 2)
            self.assertEqual(import_csv(database_path, csv_path), 2)
            results = recommend(database_path, date(2026, 9, 19))
            self.assertEqual(results[0]["topic"], "weekly-income")
            self.assertEqual(results[0]["sampleSize"], 1)


if __name__ == "__main__":
    unittest.main()
