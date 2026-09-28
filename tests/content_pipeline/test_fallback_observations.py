import json
import tempfile
import unittest
from pathlib import Path

from scripts.content_pipeline.collect_fallback import massive_observations
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.export_admin_data import export_all


class FallbackObservationTest(unittest.TestCase):
    def test_vendor_amount_preserves_lexical_precision_and_stays_noncanonical(self):
        payload = b'{"results":[{"ticker":"SCHD","cash_amount":0.252500000,"ex_dividend_date":"2026-06-24","declaration_date":"2026-06-20","record_date":"2026-06-24","pay_date":"2026-06-29","currency":"USD"}]}'
        observations = massive_observations(
            payload, "https://api.massive.com/v3/reference/dividends?ticker=SCHD"
        )
        self.assertEqual(observations[0]["amount_raw"], "0.252500000")
        self.assertEqual(observations[0]["verification_status"], "third_party_only")

        with tempfile.TemporaryDirectory() as directory:
            database = ContentDatabase(Path(directory) / "ledger.sqlite")
            database.initialize()
            database.add_distribution_observation(observations[0])
            with database.connect() as connection:
                canonical = connection.execute(
                    "SELECT COUNT(*) FROM distribution_events"
                ).fetchone()[0]
                stored = connection.execute(
                    "SELECT amount_raw, precision_digits, source_class, canonical_event_id "
                    "FROM distribution_observations"
                ).fetchone()
            self.assertEqual(canonical, 0)
            self.assertEqual(stored["amount_raw"], "0.252500000")
            self.assertEqual(stored["precision_digits"], 9)
            self.assertEqual(stored["source_class"], "licensed_vendor")
            self.assertIsNone(stored["canonical_event_id"])
            bundles = Path(directory) / "bundles"
            output = Path(directory) / "public"
            bundles.mkdir()
            export_all(database.path, bundles, output)
            index = json.loads((output / "distribution-index.json").read_text())
            self.assertEqual(index["fallbackObservations"][0]["amount_raw"], "0.252500000")
            self.assertEqual(index["fallbackObservations"][0]["verification_status"], "third_party_only")


if __name__ == "__main__":
    unittest.main()
