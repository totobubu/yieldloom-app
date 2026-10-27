import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.stock_collection import (
    collect_stock, discover_bac, parse_bac, parse_market, is_us_stock, StockCollectionError,
)

URL = 'https://newsroom.bankofamerica.com/content/newsroom/press-releases/2026/10/stock-dividends.html'
ISSUER = {'adapter': 'bank-of-america-newsroom', 'currency': 'USD',
          'indexUrl': 'https://investor.bankofamerica.com/press-releases',
          'articleOrigin': 'https://newsroom.bankofamerica.com',
          'allowedHosts': ['investor.bankofamerica.com', 'newsroom.bankofamerica.com']}
HTML = b'''<p>October 21, 2026 at 4:15 PM Eastern</p>
<p>Bank of America Corporation today announced a regular quarterly cash dividend on Bank of America common stock of $0.32 per share, payable on December 24, 2026 to shareholders of record as of December 4, 2026.</p>
<p>The Board also declared a dividend of $1.75 per share on Preferred Stock, Series B, payable on January 25, 2027.</p>'''


def market(symbol='BAC', amount='0.30'):
    return json.dumps({'chart': {'result': [{
        'meta': {'symbol': symbol, 'currency': 'USD', 'exchangeTimezoneName': 'America/New_York'},
        'timestamp': [1792675800],
        'indicators': {'quote': [{'open': [50], 'high': [52], 'low': [49], 'close': [51], 'volume': [100]}]},
        'events': {'dividends': {'1': {'date': 1787319000, 'amount': amount}}} if amount else {},
    }]}}).encode()


class StockCollectionTests(unittest.TestCase):
    def test_official_common_stock_excludes_preferred_and_never_guesses_ex_date(self):
        facts = parse_bac(HTML + HTML, URL, ISSUER)
        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0]['amountRaw'], '0.32')
        self.assertEqual(facts[0]['declaredDate'], '2026-10-21')
        self.assertEqual(facts[0]['payableDate'], '2026-12-24')
        self.assertIsNone(facts[0]['exDate'])
        self.assertEqual(facts[0]['missingFields'], ['exDate'])
        self.assertEqual(facts[0]['verificationStatus'], 'partial_evidence')

    def test_wrong_issuer_dates_or_unapproved_hosts_fail_closed(self):
        for document in [HTML.replace(b'Bank of America', b'Another Company'),
                         HTML.replace(b'December 4, 2026', b'December 25, 2026')]:
            with self.assertRaises(StockCollectionError):
                parse_bac(document, URL, ISSUER)
        with self.assertRaises(StockCollectionError):
            parse_bac(HTML, 'https://attacker.example/stock-dividends.html', ISSUER)
        with self.assertRaises(StockCollectionError):
            discover_bac(b'<p>no article list</p>', ISSUER)

    def test_market_identity_currency_and_empty_response_are_errors(self):
        for body in [market('AAPL'), market().replace(b'USD', b'KRW'), b'{"chart":{"result":[]}}']:
            with self.assertRaises(StockCollectionError):
                parse_market(body, 'BAC', 'USD', date(2026, 10, 26))
        value = parse_market(market(), 'BAC', 'USD', date(2026, 10, 26))
        self.assertIsNone(value['history'][0]['payable_date'])
        self.assertEqual(value['history'][0]['verification_status'], 'needs_review')

    def fixture_fetch(self, url):
        if url == ISSUER['indexUrl']:
            return f'<a href="{URL}">Stock dividends</a>'.encode()
        if url == URL:
            return HTML
        return market()

    def test_repeat_and_failure_preserve_evidence_without_touching_etf_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = ContentDatabase(root/'state.sqlite'); db.initialize()
            kwargs = dict(fetcher=self.fixture_fetch, today=date(2026, 10, 26), registry={'BAC': ISSUER})
            first = collect_stock('BAC', db, root/'raw', root/'public', 'request-1', **kwargs)
            self.assertEqual(first['status'], 'partial')
            self.assertEqual(first['officialAnnouncements'], 1)
            collect_stock('BAC', db, root/'raw', root/'public', 'request-2', **kwargs)
            path = root/'public/stock-evidence-bac.json'
            saved = json.loads(path.read_text())
            self.assertEqual(len(saved['announcements']), 1)
            self.assertEqual(len(saved['history']), 1)
            self.assertEqual(saved['requestId'], 'request-2')
            def broken(url): raise StockCollectionError('rate_limited', True)
            failed = collect_stock('BAC', db, root/'raw', root/'public', 'request-3',
                                   fetcher=broken, today=date(2026, 10, 26), registry={'BAC': ISSUER})
            self.assertEqual(failed['status'], 'failed')
            current = json.loads(path.read_text())
            for key in ('announcements', 'candles', 'history', 'marketObservedAt'):
                self.assertEqual(current[key], saved[key])
            with db.connect() as connection:
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM distribution_events').fetchone()[0], 0)
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM provider_funds').fetchone()[0], 0)
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM stock_issuer_announcements').fetchone()[0], 1)
            retry = collect_stock('BAC', db, root/'raw', root/'public', 'request-4', **kwargs)
            self.assertTrue(retry['marketUpdated'])
            self.assertEqual(retry['status'], 'partial')

    def test_revision_keeps_prior_amount_and_other_symbols_are_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=ContentDatabase(root/'state.sqlite');db.initialize()
            sentinel = root/'public/stock-evidence-aapl.json';sentinel.parent.mkdir();sentinel.write_text('sentinel')
            collect_stock('BAC', db, root/'raw', root/'public', fetcher=self.fixture_fetch, today=date(2026,10,26), registry={'BAC': ISSUER})
            def changed(url): return market(amount='0.60') if 'finance.yahoo' in url else self.fixture_fetch(url)
            result=collect_stock('BAC', db, root/'raw', root/'public', fetcher=changed, today=date(2026,10,26), registry={'BAC': ISSUER})
            self.assertIn('dividend_revision_needs_review', [item['code'] for item in result['errors']])
            saved=json.loads((root/'public/stock-evidence-bac.json').read_text())
            self.assertEqual(saved['history'][0]['distribution_per_share'], '0.30')
            self.assertTrue(saved['history'][0]['conflicting'])
            self.assertEqual(sentinel.read_text(), 'sentinel')

    def test_unregistered_issuer_and_no_dividends_are_partial_not_official_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=ContentDatabase(root/'state.sqlite');db.initialize()
            result=collect_stock('AAPL', db, root/'raw', root/'public', fetcher=lambda url: market('AAPL', None),
                                 today=date(2026,10,26), registry={})
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(result['steps'][0]['state'], 'unsupported')
            value=json.loads((root/'public/stock-evidence-aapl.json').read_text())
            self.assertEqual(value['history'], [])
            self.assertNotIn('noDividends', value)

    def test_html_changes_are_deduplicated_and_official_corrections_are_evidence_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=ContentDatabase(root/'state.sqlite');db.initialize()
            def run(fetcher):
                return collect_stock('BAC',db,root/'raw',root/'public',fetcher=fetcher,today=date(2026,10,26),registry={'BAC':ISSUER})
            run(self.fixture_fetch)
            def cosmetic(url): return self.fixture_fetch(url)+b'<!-- layout changed -->' if url==URL else self.fixture_fetch(url)
            run(cosmetic)
            path=root/'public/stock-evidence-bac.json'
            self.assertEqual(len(json.loads(path.read_text())['announcements']),1)
            def correction(url): return HTML.replace(b'$0.32',b'$0.33') if url==URL else self.fixture_fetch(url)
            result=run(correction)
            self.assertIn('official_revision_needs_review',[item['code'] for item in result['errors']])
            announcements=json.loads(path.read_text())['announcements']
            self.assertEqual({a['amountRaw'] for a in announcements},{'0.32','0.33'})
            self.assertTrue(all(a['verificationStatus']=='conflicting' for a in announcements))
            with db.connect() as connection:
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM stock_issuer_announcements').fetchone()[0],2)
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM distribution_events').fetchone()[0],0)

    def test_snapshot_validation_rejects_reference_promotion(self):
        from scripts.content_pipeline.stock_collection import validate_stock_export
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=ContentDatabase(root/'state.sqlite');db.initialize()
            collect_stock('BAC',db,root/'raw',root/'public',fetcher=self.fixture_fetch,today=date(2026,10,26),registry={'BAC':ISSUER})
            self.assertEqual(validate_stock_export(root/'public'),1)
            path=root/'public/stock-evidence-bac.json'
            payload=json.loads(path.read_text());payload['history'][0]['verification_status']='official';path.write_text(json.dumps(payload))
            with self.assertRaises(StockCollectionError): validate_stock_export(root/'public')

    def test_refresh_entrypoint_routes_bac_and_exports_partial_report(self):
        from scripts.content_pipeline import refresh
        from unittest.mock import patch
        import io
        from contextlib import redirect_stdout
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            def collect(symbol, database, raw_dir, output, request_id):
                return collect_stock(symbol,database,raw_dir,output,request_id,fetcher=self.fixture_fetch,today=date(2026,10,26),registry={'BAC':ISSUER})
            args=['refresh.py','--scope','ticker','--ticker','BAC','--db',str(root/'ledger.sqlite'),'--raw-dir',str(root/'raw'),'--public-dir',str(root/'public'),'--request-id','BAC-test']
            with patch('sys.argv',args),patch('scripts.content_pipeline.stock_collection.collect_stock',collect),patch.object(refresh,'run_collect') as etf,redirect_stdout(io.StringIO()) as result:
                status=refresh.main()
            self.assertEqual(status,0)
            self.assertEqual(json.loads(result.getvalue())['status'],'partial')
            etf.assert_not_called()
            self.assertTrue((root/'public/system-logs.json').exists())
            self.assertIsNone(json.loads((root/'public/stock-evidence-bac.json').read_text())['announcements'][0]['exDate'])

    def test_etfs_and_delisted_instruments_are_not_routed_as_common_stocks(self):
        self.assertFalse(is_us_stock({'symbol':'CONY','officialProvider':'YieldMax','currency':'USD','market':'NYSE'}))
        self.assertFalse(is_us_stock({'symbol':'COII','currency':'USD','market':'NASDAQ'}))
        self.assertTrue(is_us_stock({'symbol':'BAC','currency':'USD','market':'NYSE'}))


if __name__ == '__main__': unittest.main()
