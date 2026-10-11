import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.enrich_dividends import compare_event, enrich, parse_yahoo
from scripts.content_pipeline.investing_evidence import parse_investing
from scripts.content_pipeline.seekingalpha_evidence import parse_seekingalpha


class DividendEvidenceTests(unittest.TestCase):
    def test_seekingalpha_public_table_and_identity(self):
        url = 'https://seekingalpha.com/symbol/JEPI/dividends/history'
        html = b'''<h1>JEPI Dividend History</h1><table><tr>
        <th>Ex-Div Date</th><th>Amount</th><th>Record Date</th><th>Pay Date</th></tr>
        <tr><td>Oct 1, 2026</td><td>$0.34134</td><td>Oct 1, 2026</td><td>Oct 5, 2026</td></tr></table>'''
        rows = parse_seekingalpha(html, 'JEPI', url, 'USD')
        self.assertEqual(rows[0]['ex_date'], '2026-10-01')
        self.assertEqual(rows[0]['payable_date'], '2026-10-05')
        self.assertEqual(rows[0]['amount_raw'], '0.34134')
        self.assertEqual(compare_event(self.event(payable_date='2026-10-06'), rows)['status'], 'mismatch')
        for ticker, currency in [('JEPQ', 'USD'), ('JEPI', 'KRW')]:
            with self.assertRaises(ValueError): parse_seekingalpha(html, ticker, url, currency)
        with self.assertRaises(ValueError):
            parse_seekingalpha(b'<h1>JEPI Dividend History</h1>Please enable Javascript and cookies', 'JEPI', url, 'USD')

    def event(self, **changes):
        return {"ex_date": "2026-10-01", "currency": "USD", "distribution_per_share": "0.34134", **changes}

    @patch('scripts.content_pipeline.enrich_dividends.time.sleep')
    def test_seekingalpha_accumulates_public_evidence(self, _):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nav = root / 'nav.json'
            nav.write_text(json.dumps({'nav': [{'symbol': 'JEPI', 'currency': 'USD', 'market': 'NYSE'}]}))
            db = ContentDatabase(root / 'ledger.sqlite')
            html = b'<h1>JEPI Dividend History</h1><table><tr><th>Ex-Div Date</th><th>Amount</th><th>Pay Date</th></tr><tr><td>Oct 1, 2026</td><td>$0.34134</td><td>Oct 5, 2026</td></tr></table>'
            def fetch(url, headers=None):
                return html if 'seekingalpha.com' in url else json.dumps(self.payload()).encode()
            result = enrich(db, nav, root / 'raw', fetch=fetch, search_limit=0, sources_path=root / 'absent.json')
            self.assertEqual(result['tickers'][0]['seekingAlphaObservationCount'], 1)
            self.assertFalse(result['tickers'][0]['errors'])
            with db.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM distribution_observations WHERE source_provider='seekingalpha'").fetchone()[0], 1)
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM distribution_events').fetchone()[0], 0)

    def test_exact_date_currency_precision_and_split(self):
        observation = {"ex_date": "2026-10-01", "currency": "USD", "amount_raw": "0.3413400001"}
        self.assertEqual(compare_event(self.event(), [observation])["status"], "matched")
        self.assertEqual(compare_event(self.event(currency="KRW"), [observation])["status"], "mismatch")
        self.assertEqual(compare_event(self.event(ex_date="2026-10-02"), [observation])["status"], "missing_external")
        self.assertEqual(compare_event(self.event(distribution_per_share="1"), [observation], [{"date": 1800000000}])["status"], "split_basis_unresolved")
        self.assertEqual(compare_event(self.event(), [observation, observation])["status"], "ambiguous")

    def payload(self):
        return {"chart": {"result": [{"meta": {"symbol": "JEPI", "currency": "USD", "exchangeTimezoneName": "America/New_York"},
                                     "events": {"dividends": {"1": {"date": 1790856000, "amount": 0.34134}}}}]}}

    def test_yahoo_security_identity(self):
        rows, _ = parse_yahoo(self.payload(), "JEPI", "JEPI", "USD")
        self.assertEqual(rows[0]["ex_date"], "2026-10-01")
        with self.assertRaises(ValueError): parse_yahoo(self.payload(), "JEPI", "JEPQ", "USD")
        with self.assertRaises(ValueError): parse_yahoo(self.payload(), "JEPI", "JEPI", "KRW")

    def test_investing_table_identity_and_payable_date(self):
        html = '<h1>JPMorgan Equity Premium Income ETF (JEPI)</h1><p>뉴욕 통화 USD</p><table><tr><th>배당락일</th><th>배당</th><th>유형</th><th>지불일</th><th>수익률</th></tr><tr><td>10월 01, 2026</td><td>0.34134</td><td>1M</td><td>10월 05, 2026</td><td>8.12%</td></tr></table>'.encode()
        config = {"url": "https://kr.investing.com/etfs/jepi-dividends", "currency": "USD", "market_label": "뉴욕"}
        rows = parse_investing(html, "JEPI", config)
        self.assertEqual(rows[0]["payable_date"], "2026-10-05")
        with self.assertRaises(ValueError): parse_investing(html, "JEPQ", config)
        with self.assertRaises(ValueError): parse_investing(b'<html>Access denied</html>', "JEPI", config)

    @patch('scripts.content_pipeline.enrich_dividends.time.sleep')
    def test_accumulation_idempotence_rotation_and_partial_failure(self, _):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); nav = root / "nav.json"
            nav.write_text(json.dumps({"nav": [{"symbol": "JEPI", "currency": "USD"}, {"symbol": "ZZZ", "currency": "USD"}]}))
            db = ContentDatabase(root / "ledger.sqlite")
            def fetch(url, headers=None): return json.dumps(self.payload()).encode()
            args = dict(limit=1, search_limit=0, fetch=fetch, sources_path=root / 'absent.json')
            first = enrich(db, nav, root / "raw", **args)
            self.assertEqual(first["tickers"][0]["ticker"], "JEPI")
            second = enrich(db, nav, root / "raw", **args)
            self.assertEqual(second["tickers"][0]["ticker"], "ZZZ")
            self.assertTrue(second["tickers"][0]["errors"])
            enrich(db, nav, root / "raw", tickers=["JEPI"], **args)
            with db.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM distribution_observations").fetchone()[0], 1)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM dividend_verification_results").fetchone()[0], 1)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM distribution_events").fetchone()[0], 0)


if __name__ == '__main__': unittest.main()
