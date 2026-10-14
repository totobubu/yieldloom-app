import importlib.util
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.utils import discover_us_dividend_stocks as discovery


ISHARES = '''iShares Test
Fund Holdings as of,"Oct 12, 2026"

Ticker,Name,Asset Class,Weight (%),Exchange,Market Currency
MSFT,Microsoft,Equity,3.29,NASDAQ,USD
BRK.B,Berkshire,Equity,1.2,NYSE,USD
USD,Cash,Cash,0.1,-,USD
ESZ6,Future,Futures,0.1,Chicago Mercantile Exchange,USD
ABC,Foreign,Equity,0.5,London Stock Exchange,GBP
'''
SCHWAB = '''As-Of-Date,Symbol,Percent of Assets,Name,Country,Currency,Exchange,Market Currency
2026-10-13,TXN,4.7,Texas Instruments,US,USD,XNGS,USD
2026-10-13,CASH,0.1,Cash,US,USD,,USD
'''


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        archive = patch.object(discovery, 'archive_report')
        archive.start()
        self.addCleanup(archive.stop)

    def test_official_csv_metadata_and_non_equity_filter(self):
        holdings = discovery.parse_holdings(ISHARES)
        self.assertEqual([s['symbol'] for s in holdings], ['MSFT', 'BRK-B'])
        self.assertEqual(holdings[0]['asOfDate'], '2026-10-12')
        self.assertEqual(holdings[0]['weightPercent'], 3.29)
        self.assertEqual(discovery.parse_holdings(SCHWAB)[0]['market'], 'NASDAQ')

    def test_error_page_is_not_empty_success(self):
        with self.assertRaises(ValueError):
            discovery.parse_holdings('<html>Access denied</html>')

    def test_stock_directories_exclude_etfs_and_test_issues(self):
        nasdaq = 'Symbol|Security Name|Test Issue|ETF\nMSFT|Microsoft|N|N\nQQQ|ETF|N|Y\nTEST|Test|Y|N\nBADW|Warrants|N|N\nBADU|Units|N|N\n'
        other = 'ACT Symbol|Security Name|Exchange|Test Issue|ETF\nKO|Coca-Cola|N|N|N\nSPY|ETF|P|N|Y\n'
        with patch.object(discovery, 'fetch_text', side_effect=[nasdaq, other]):
            stocks = discovery.listed_stocks()
        self.assertEqual([(s['symbol'], s['market']) for s in stocks],
                         [('MSFT', 'NASDAQ'), ('KO', 'NYSE')])
        self.assertFalse(discovery.non_stock_security('Unit Corporation Common Stock'))
        self.assertFalse(discovery.non_stock_security('MPLX LP Common Units Representing Limited Partner Interests'))
        self.assertFalse(discovery.non_stock_security('Royalty Trust Units of Beneficial Interest'))
        self.assertTrue(discovery.non_stock_security('Acquisition Corp Units'))

    def test_vanguard_reads_every_page_and_resolves_us_listings(self):
        import json
        first = {'size': 3, 'asOfDate': '2026-08-31T00:00:00-04:00',
                 'next': {'href': 'http://api.vanguard.com/rs/ire/01/ind/fund/VYM/portfolio-holding/stock?start=3&count=500'},
                 'fund': {'entity': [
                    {'ticker': 'MSFT', 'longName': 'Microsoft', 'percentWeight': '4.2'},
                    {'ticker': 'CASH', 'longName': 'Cash', 'percentWeight': '0.2'}]}}
        second = {'size': 3, 'asOfDate': first['asOfDate'],
                  'fund': {'entity': [{'ticker': 'KO', 'longName': 'Coca-Cola', 'percentWeight': '2.0'}]}}
        with patch.object(discovery, 'fetch_text', side_effect=[json.dumps(first), json.dumps(second)]) as fetch, \
                patch.object(discovery, 'listed_stocks', return_value=[
                    {'symbol': 'MSFT', 'market': 'NASDAQ'}, {'symbol': 'KO', 'market': 'NYSE'}]):
            rows, source = discovery.collect_vanguard('VYM')
        self.assertEqual([r['symbol'] for r in rows], ['MSFT', 'KO'])
        self.assertEqual(rows[1]['asOfDate'], '2026-08-31')
        self.assertTrue(source.startswith('https://investor.vanguard.com/'))
        self.assertTrue(fetch.call_args_list[1].args[0].endswith('?start=3&count=500'))
        # A truncated first page cannot be mistaken for full coverage.
        del first['next']
        with patch.object(discovery, 'fetch_text', return_value=json.dumps(first)):
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                discovery.collect_vanguard('VYM')

    def test_refresh_replaces_membership_but_keeps_verified_evidence(self):
        verification = {'status': 'verified', 'source': 'Yahoo Finance'}
        report = {'sources': [{'source': 'DGRO', 'status': 'failed'}], 'stocks': [
            {'symbol': 'MSFT', 'name': 'Microsoft', 'etfHoldings': [{'etf': 'DGRO', 'weightPercent': 99}],
             'dividendVerification': verification},
            {'symbol': 'OLD', 'etfHoldings': [{'etf': 'DGRO'}], 'dividendVerification': {'status': 'not_checked'}},
        ]}
        with patch.object(discovery, 'collect_fund', return_value=(discovery.parse_holdings(ISHARES), 'official:dgro')):
            discovery.refresh_etfs(report, ['DGRO'], {}, set())
        stocks = {s['symbol']: s for s in report['stocks']}
        self.assertIs(stocks['MSFT']['dividendVerification'], verification)
        self.assertEqual(stocks['MSFT']['etfHoldings'][0]['weightPercent'], 3.29)
        self.assertEqual(stocks['OLD']['etfHoldings'], [])
        self.assertEqual(stocks['BRK-B']['dividendVerification']['status'], 'not_checked')
        self.assertEqual(report['sources'][0]['status'], 'collected')

    def test_verified_new_symbols_and_repeated_fund(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'report.json'
            with patch.object(discovery, 'collect_fund', return_value=(
                    discovery.parse_holdings(SCHWAB), 'official:schd')) as collect, \
                    patch.object(discovery, 'existing_symbols', return_value=set()), \
                    patch.object(discovery, 'verify_dividends', return_value={
                        'status': 'verified', 'events': [{'exDate': '2026-10-01', 'amount': 1}]}):
                status = discovery.main(['--etf', 'SCHD', '--etf', 'SCHD',
                    '--verify-limit', '-1', '--delay', '0', '--output', str(output)])
            import json
            report = json.loads(output.read_text())
            self.assertEqual(status, 0)
            self.assertEqual(report['newVerifiedSymbols'], ['TXN'])
            self.assertEqual(collect.call_count, 1)

    def test_partial_sources_deduplicate_and_preserve_verification_errors(self):
        holdings = discovery.parse_holdings(ISHARES)
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'report.json'
            with patch.object(discovery, 'collect_fund', side_effect=[
                (holdings, 'official:dgro'), (holdings, 'official:hdv'),
                ValueError('unavailable')
            ]), patch.object(discovery, 'existing_symbols', return_value={'MSFT'}), \
                    patch.object(discovery, 'verify_dividends', side_effect=ValueError('rate limited')):
                status = discovery.main(['--etf', 'DGRO', '--etf', 'HDV', '--etf', 'VYM',
                    '--verify-limit', '1', '--delay', '0', '--output', str(output)])
            import json
            report = json.loads(output.read_text())
            self.assertEqual(status, 2)
            self.assertEqual(report['summary']['candidates'], 2)
            self.assertEqual(report['summary']['newCandidates'], 1)
            self.assertEqual(report['newVerifiedSymbols'], [])
            self.assertEqual(report['stocks'][0]['dividendVerification']['status'], 'unavailable')
            self.assertEqual(len(report['stocks'][0]['etfHoldings']), 2)
            self.assertEqual(report['stocks'][1]['dividendVerification']['status'], 'not_checked')

    @unittest.skipUnless(importlib.util.find_spec('yfinance'), 'yfinance not installed')
    def test_dividend_window_filters_future_zero_and_old_events(self):
        events = {str(i): {'date': int(datetime.fromisoformat(day + 'T14:00:00+00:00').timestamp()), 'amount': amount}
                  for i, (day, amount) in enumerate([
                      ('2025-10-01', 1), ('2026-01-01', 0), ('2026-10-13', 1.5), ('2026-10-15', 2)])}
        response = {'chart': {'result': [{'timestamp': [1],
            'meta': {'symbol': 'MSFT', 'instrumentType': 'EQUITY', 'currency': 'USD',
                     'exchangeTimezoneName': 'America/New_York'}, 'events': {'dividends': events}}]}}
        with patch('yfinance.data.YfData') as data:
            data.return_value.get_raw_json.return_value = response
            result = discovery.verify_dividends('MSFT', date(2026, 10, 14))
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(result['events'], [{'exDate': '2026-10-13', 'amount': 1.5}])

    @unittest.skipUnless(importlib.util.find_spec('yfinance'), 'yfinance not installed')
    def test_bad_chart_and_non_equity_are_not_no_dividends(self):
        with patch('yfinance.data.YfData') as data:
            data.return_value.get_raw_json.return_value = {'chart': {'result': None, 'error': {'description': 'missing'}}}
            with self.assertRaises(ValueError):
                discovery.verify_dividends('MSFT', date(2026, 10, 14))
            data.return_value.get_raw_json.return_value = {'chart': {'result': [{
                'timestamp': [1], 'meta': {'symbol': 'MSFT', 'instrumentType': 'ETF', 'currency': 'USD'}}]}}
            result = discovery.verify_dividends('MSFT', date(2026, 10, 14))
            self.assertEqual(result['status'], 'ineligible')

    def test_resume_preserves_completed_and_retries_failed(self):
        import json
        today = datetime.now(timezone.utc).date().isoformat()
        report = {'schemaVersion': 1, 'lookbackDays': 365, 'collectedAt': today,
                  'sources': [], 'stocks': [
            {'symbol': 'AAA', 'dividendVerification': {'status': 'verified', 'asOfDate': today}},
            {'symbol': 'BBB', 'dividendVerification': {'status': 'unavailable', 'asOfDate': today}},
            {'symbol': 'CCC', 'dividendVerification': {'status': 'no_recent_dividends', 'asOfDate': today}},
        ]}
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'report.json'
            output.write_text(json.dumps(report))
            with patch.object(discovery, 'existing_symbols', return_value=set()), \
                    patch.object(discovery, 'verify_dividends', return_value={'status': 'verified'}) as verify:
                discovery.main(['--resume', '--output', str(output), '--verify-limit', '-1', '--delay', '0'])
            self.assertEqual([c.args[0] for c in verify.call_args_list], ['BBB'])
            self.assertEqual(json.loads(output.read_text())['newVerifiedSymbols'], ['AAA', 'BBB'])

    def test_resume_refreshes_previous_day_window(self):
        import json
        report = {'schemaVersion': 1, 'lookbackDays': 365, 'collectedAt': '2000-01-01',
                  'sources': [], 'stocks': [{'symbol': 'AAA', 'dividendVerification': {'status': 'verified'}}]}
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'report.json'
            output.write_text(json.dumps(report))
            with patch.object(discovery, 'existing_symbols', return_value=set()), \
                    patch.object(discovery, 'verify_dividends', return_value={'status': 'no_recent_dividends'}) as verify:
                discovery.main(['--resume', '--output', str(output), '--verify-limit', '-1', '--delay', '0'])
            self.assertEqual(verify.call_count, 1)
            self.assertEqual(json.loads(output.read_text())['newVerifiedSymbols'], [])


class ArchiveTests(unittest.TestCase):
    def test_snapshots_preserve_events_and_do_not_overwrite_previous_observations(self):
        import json
        report = {'verificationAsOfDate': '2026-10-14', 'stocks': [
            {'symbol': 'MSFT', 'dividendVerification': {'status': 'verified',
                'events': [{'exDate': '2026-09-01', 'amount': 1}]}}]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            original = discovery.archive_report(report, root)
            self.assertEqual(discovery.archive_report(report, root), original)
            report['stocks'][0]['dividendVerification']['events'][0]['amount'] = 2
            changed = discovery.archive_report(report, root)
            self.assertNotEqual(changed, original)
            self.assertEqual(json.loads(original.read_text())['stocks'][0]['dividendVerification']['events'][0]['amount'], 1)
            self.assertEqual(len(list((root / '2026-10-14').glob('*.json'))), 2)


if __name__ == '__main__':
    unittest.main()
