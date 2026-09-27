from datetime import date
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from scripts.data_pipeline.history_policy import dividend_refresh_start, merge_yahoo_dividend


class HistoryPolicyTest(unittest.TestCase):
    def test_refresh_has_no_ten_year_retention_and_ignores_future_forecasts(self):
        self.assertEqual(dividend_refresh_start(None), '1900-01-01')
        self.assertEqual(dividend_refresh_start('2026-01-01', '1962-01-02', full=True), '1962-01-02')
        self.assertEqual(dividend_refresh_start('2027-01-01', today=date(2026, 9, 20)), '2026-05-23')

    def test_revision_is_quarantined_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'observations.sqlite'
            row = {'date': '1962-01-02', 'amount': 0.1, 'amountFixed': 0.15}
            for _ in range(2):
                self.assertFalse(merge_yahoo_dividend(row, 0.2, 'TEST', observation_db=db))
            self.assertEqual(row['amount'], 0.1)
            self.assertEqual(row['amountFixed'], 0.15)
            with closing(sqlite3.connect(db)) as connection:
                self.assertEqual(connection.execute('select count(*) from dividend_conflicts').fetchone()[0], 1)

    def test_new_event_preserves_official_override(self):
        row = {'date': '2026-09-17', 'forecasted': True, 'amountFixed': 0.2}
        self.assertTrue(merge_yahoo_dividend(row, 0.21, 'TEST'))
        self.assertEqual(row['amountFixed'], 0.2)
        self.assertNotIn('forecasted', row)
        self.assertEqual(row['amountBasis'], 'provider_adjusted_unknown')
