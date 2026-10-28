import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class YskhRegistrationTest(unittest.TestCase):
    def test_official_catalog_metadata_is_registered_without_unverified_isin(self):
        catalog = json.loads((ROOT / "data-v2/catalog-seed.json").read_text(encoding="utf-8"))
        rows = [row for row in catalog["instruments"] if row["symbol"] == "YSKH"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0], {
            "ipoDate": "2026-10-27",
            "frequency": "매주",
            "symbol": "YSKH",
            "isin": None,
            "market": "NASDAQ",
            "currency": "USD",
            "koName": "일드맥스 SK하이닉스 옵션 인컴 전략 ETF",
            "longName": "YieldMax SKHY Option Income Strategy ETF",
            "active": True,
            "officialProvider": "YieldMax",
        })


if __name__ == "__main__":
    unittest.main()
