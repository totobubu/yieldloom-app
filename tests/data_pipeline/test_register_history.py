import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import closing
import sqlite3
from scripts.data_pipeline.register_history import register


class RegisterHistoryTest(unittest.TestCase):
    def test_long_history_and_regimes_are_indexed_without_copying_prices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / 'public/data'
            data.mkdir(parents=True)
            payload = {'tickerInfo': {'Symbol': 'GE', 'events': {
                'splits': [{'date': '2021-08-02', 'ratio': '1:8'}],
                'frequencyChanges': [{'date': '2020-01-01', 'from': 'monthly', 'to': 'quarterly'}]}},
                'backtestData': [{'date': '1962-01-02', 'close': 1},
                                 {'date': '2026-09-18', 'close': 2, 'amount': 0.1},
                                 {'date': '2027-01-01', 'forecasted': True}]}
            (data / 'ge.json').write_text(json.dumps(payload))
            db = root / 'ledger.sqlite'
            with patch('scripts.data_pipeline.register_history.ROOT', root):
                register(data, db)
                register(data, db)
            with closing(sqlite3.connect(db)) as connection:
                row = connection.execute('SELECT first_price_date,last_price_date,row_count FROM history_sources').fetchone()
                self.assertEqual(row, ('1962-01-02', '2026-09-18', 3))
                self.assertEqual(connection.execute('SELECT count(*) FROM corporate_action_observations').fetchone()[0], 1)
                self.assertEqual(connection.execute('SELECT new_shares,old_shares FROM corporate_action_observations').fetchone(), ('1', '8'))
                self.assertEqual(connection.execute('SELECT count(*) FROM frequency_regime_observations').fetchone()[0], 1)
