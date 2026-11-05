import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.enrich_dividends import compare_event, enrich, parse_yahoo
from scripts.content_pipeline.investing_evidence import parse_investing
from scripts.content_pipeline.seekingalpha_evidence import parse_seekingalpha
from scripts.content_pipeline.reference_access import permits


class DividendEvidenceTests(unittest.TestCase):
    def access(self, root):
        # Synthetic authorization for injected fixtures, never a production grant.
        path = root / 'access.json'
        path.write_text(json.dumps({'schemaVersion': 1, 'providers': {
            name: {'enabled': True, 'automatedCollection': True, 'storage': True,
                   'publicRedistribution': True, 'feeRequired': False,
                   'evidenceUrl': 'https://license.example/fixture-only',
                   'reviewedAt': '2020-01-01', 'validUntil': '2099-01-01',
                   'tickers': ['JEPI', 'ZZZ', 'SCHD'], 'datasets': ['dividends'],
                   'allowedHosts': [host]}
            for name, host in [('yahoo', 'query1.finance.yahoo.com'), ('seekingalpha', 'seekingalpha.com')]
        }}))
        return path

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
            result = enrich(db, nav, root / 'raw', fetch=fetch, search_limit=0, sources_path=root / 'absent.json', access_path=self.access(root))
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
            args = dict(limit=1, search_limit=0, fetch=fetch, sources_path=root / 'absent.json', access_path=self.access(root))
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

    @patch('scripts.content_pipeline.enrich_dividends.time.sleep')
    def test_etf_without_official_events_uses_scoped_reference_and_preserves_history_on_403(self, _):
        from urllib.error import HTTPError
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nav = root / 'nav.json'
            nav.write_text(json.dumps({'nav': [
                {'symbol': 'SCHD', 'currency': 'USD', 'company': 'Schwab'},
                {'symbol': 'JEPI', 'currency': 'USD', 'company': 'JPMorgan'}]}))
            database = ContentDatabase(root / 'ledger.sqlite')
            payload = self.payload()
            payload['chart']['result'][0]['meta']['symbol'] = 'SCHD'
            args = dict(provider='schwab', access_path=self.access(root), search_limit=0)
            report = enrich(database, nav, root / 'raw', fetch=lambda url: json.dumps(payload).encode(), **args)
            self.assertEqual([row['ticker'] for row in report['tickers']], ['SCHD'])
            self.assertEqual(report['tickers'][0]['missingOfficialCount'], 1)
            with database.connect() as connection:
                before = [tuple(row) for row in connection.execute('SELECT * FROM distribution_observations')]
            requested = []
            def denied(url):
                requested.append(url)
                raise HTTPError(url, 403, 'Forbidden', {}, None)
            report = enrich(database, nav, root / 'raw', fetch=denied, **args)
            self.assertEqual(len(requested), 1)  # no URL/transport retry or bypass
            self.assertEqual(report['tickers'][0]['errors'], [{'source': 'yahoo', 'type': 'HTTPError', 'httpStatus': 403}])
            with database.connect() as connection:
                self.assertEqual(before, [tuple(row) for row in connection.execute('SELECT * FROM distribution_observations')])
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM distribution_events').fetchone()[0], 0)

    @patch('scripts.content_pipeline.enrich_dividends.time.sleep')
    def test_missing_license_never_fetches_and_reports_supplier_connection(self, _):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nav = root / 'nav.json'
            nav.write_text(json.dumps({'nav': [{'symbol': 'SCHD', 'currency': 'USD', 'market': 'NYSE'}]}))
            with patch('scripts.content_pipeline.enrich_dividends.read_url') as fetch:
                result = enrich(ContentDatabase(root / 'db'), nav, root / 'raw',
                                tickers=['SCHD'], fetch=fetch, search_limit=0, access_path=root / 'missing.json')
                fetch.assert_not_called()
            self.assertEqual(result['tickers'][0]['referenceStatus'], 'supplier_connection_required')
            self.assertFalse(result['tickers'][0]['errors'])

    def test_grants_reject_wrong_host_ticker_expiry_and_paid_access(self):
        from datetime import date
        from scripts.content_pipeline.reference_access import load_access
        with tempfile.TemporaryDirectory() as directory:
            grant = load_access(self.access(Path(directory)))
            url = 'https://query1.finance.yahoo.com/v8/finance/chart/SCHD'
            self.assertTrue(permits(grant, 'yahoo', 'SCHD', url))
            self.assertFalse(permits(grant, 'yahoo', 'OTHER', url))
            self.assertFalse(permits(grant, 'yahoo', 'SCHD', 'https://unapproved.example/data'))
            self.assertFalse(permits(grant, 'yahoo', 'SCHD', url, today=date(2100, 1, 1)))
            for field, value in [('feeRequired', True), ('publicRedistribution', False), ('storage', False),
                                 ('automatedCollection', False), ('enabled', False), ('evidenceUrl', '')]:
                from copy import deepcopy
                changed = deepcopy(grant)
                changed['yahoo'][field] = value
                self.assertFalse(permits(changed, 'yahoo', 'SCHD', url), field)
            for value in [None, 'invalid', {'datasets': None}, {'datasets': [], 'tickers': [], 'allowedHosts': [], 'evidenceUrl': None}]:
                self.assertFalse(permits({'yahoo': value}, 'yahoo', 'SCHD', url))

    @patch('scripts.content_pipeline.enrich_dividends.time.sleep')
    def test_empty_registry_preserves_official_and_reference_rows_and_public_history(self, _):
        from scripts.content_pipeline.models import DistributionEvent, SourceDocument
        from scripts.content_pipeline.export_admin_data import export_all
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nav = root / 'nav.json'
            nav.write_text(json.dumps({'nav': [{'symbol': 'SCHD', 'currency': 'USD', 'company': 'Schwab'}]}))
            database = ContentDatabase(root / 'ledger.sqlite')
            database.initialize()
            database.upsert_provider('schwab', 'Schwab', 'https://www.schwabassetmanagement.com')
            source_id = database.add_source_document(SourceDocument('schwab', 'https://www.schwabassetmanagement.com/products/schd', 'html', b'fixture'))
            database.upsert_distribution_event(DistributionEvent('schwab', 'SCHD', '0.26000', '2026-09-01', '2026-09-23', 'https://www.schwabassetmanagement.com/products/schd'), source_id)
            database.add_distribution_observation({'ticker': 'SCHD', 'ex_date': '2026-06-24', 'amount_raw': '0.25', 'currency': 'USD', 'source_provider': 'fixture-reference', 'source_class': 'public_aggregator', 'source_url': 'https://fixture.example/SCHD'})
            output = root / 'public'
            export_all(database.path, root / 'bundles', output)
            before_export = {path.name: path.read_bytes() for path in output.glob('distribution*.json')}
            with database.connect() as connection:
                before = {table: [tuple(row) for row in connection.execute(f'SELECT * FROM {table}')]
                          for table in ['distribution_events', 'distribution_observations', 'source_documents']}
            with patch('scripts.content_pipeline.enrich_dividends.read_url') as fetch:
                report = enrich(database, nav, root / 'raw', tickers=['SCHD'], access_path=root/'missing.json',
                                search_limit=0, fetch=fetch, official_refresh_outcome='failure')
                fetch.assert_not_called()
            self.assertEqual(report['officialRefreshStepOutcome'], 'failure')
            row = report['tickers'][0]
            self.assertEqual((row['referenceStatus'], row['canonicalEventCount'], row['previouslyStoredReferenceCount']),
                             ('supplier_connection_required', 1, 1))
            with database.connect() as connection:
                after = {table: [tuple(row) for row in connection.execute(f'SELECT * FROM {table}')]
                         for table in before}
            self.assertEqual(before, after)
            export_all(database.path, root / 'bundles', output)
            self.assertEqual(before_export, {path.name: path.read_bytes() for path in output.glob('distribution*.json')})


if __name__ == '__main__': unittest.main()
