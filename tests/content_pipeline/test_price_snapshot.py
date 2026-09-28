import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.content_pipeline.export_price_snapshot import export_price_snapshot


class PriceSnapshotTest(unittest.TestCase):
    def test_exports_latest_actual_close_and_marks_old_prices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data/nyse").mkdir(parents=True)
            (root / "nav.json").write_text(json.dumps({"nav": [{"symbol": "TSLY", "currency": "USD", "dataPaths": ["data/nyse/tsly.json"]}]}), encoding="utf-8")
            (root / "index.json").write_text(json.dumps({"tickers": [{"ticker": "TSLY"}, {"ticker": "MISS"}]}), encoding="utf-8")
            (root / "data/nyse/tsly.json").write_text(json.dumps({"tickerInfo": {"currency": "USD"}, "backtestData": [
                {"date": "2026-09-01", "close": 20}, {"date": "2026-09-20", "close": 21}, {"date": "2026-10-01", "forecasted": True}
            ]}), encoding="utf-8")
            coverage = export_price_snapshot(root / "nav.json", root / "index.json", root, root / "prices.json", as_of=date(2026, 9, 30))
            payload = json.loads((root / "prices.json").read_text(encoding="utf-8"))
            quality = json.loads((root / "price-quality.json").read_text(encoding="utf-8"))
            self.assertEqual(coverage["priced"], 1)
            self.assertEqual(payload["prices"]["TSLY"]["close"], 21.0)
            self.assertFalse(payload["prices"]["TSLY"]["stale"])
            self.assertEqual(coverage["missingTickers"], ["MISS"])
            self.assertEqual(quality["findings"][0]["status"], "missing_nav")
