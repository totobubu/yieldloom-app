from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest

from scripts.data_platform.parsers import fx, fund_page, holdings, nasdaq, filings
from scripts.data_platform.pipeline import Store, collect, export_candidate, load_registry, private_path

NOW = datetime(2026, 10, 22, 12, tzinfo=timezone.utc)


def xml(rate='1.1234'):
    return f'<Envelope><Cube><Cube time="2026-10-21"><Cube currency="USD" rate="{rate}"/></Cube></Cube></Envelope>'.encode()


def registry():
    return {'policies': {'test': {'version': '1', 'status': 'approved', 'free': True,
        'publicDisplay': True, 'redistribution': True, 'datasets': ['fx'],
        'citation': 'ECB', 'evidenceUrl': 'https://example.com/terms'}},
        'datasets': {'fx': {'fields': ['referenceRate']}}, 'sources': [{
        'id': 'ecb', 'url': 'https://example.com/fx', 'enabled': True, 'datasets': ['fx'],
        'parser': 'ecb-fx', 'parserVersion': '1', 'minIntervalSeconds': 3600,
        'publicDisplay': 'unreviewed', 'policyId': 'test',
    }]}


def response(body):
    return {'status': 200, 'body': body, 'etag': 'version1'}


class PipelineTests(unittest.TestCase):
    def test_incremental_cache_304_and_revision_history(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            first = collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            self.assertEqual(first['sources'][0]['new'], 1)
            skipped = collect(store, config, transport=lambda *_: self.fail('duplicate HTTP'), now=NOW)
            self.assertEqual(skipped['httpRequests'], 0)
            self.assertEqual(skipped['sources'][0]['status'], 'not_due')
            def unchanged(url, headers):
                self.assertEqual(headers, {'If-None-Match': 'version1'})
                return {'status': 304}
            result = collect(store, config, transport=unchanged, now=NOW + timedelta(days=1))
            self.assertEqual(result['sources'][0]['new'], 0)
            self.assertEqual(store.state('ecb')['asOfDates'], ['2026-10-21'])
            corrected = collect(store, config, transport=lambda *_: response(xml('1.1200')),
                                now=NOW + timedelta(days=2))
            self.assertEqual(corrected['sources'][0]['revised'], 1)
            records = [json.loads(r[0]) for r in store.db.execute('SELECT payload FROM observations ORDER BY revision')]
            self.assertEqual([r['value'] for r in records], ['1.1234', '1.1200'])
            self.assertEqual(records[1]['supersedes'], 1)

    def test_parser_change_reprocesses_archived_document_without_http(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            config['sources'][0]['parserVersion'] = '2'
            result = collect(store, config, transport=lambda *_: self.fail('Unnecessary HTTP'), now=NOW)
            self.assertEqual(result['failed'], 0)
            self.assertEqual(result['httpRequests'], 0)

    def test_parser_fix_can_reprocess_failed_raw_during_backoff(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            config['sources'][0]['parser'] = 'sec-submissions'
            result = collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            self.assertEqual(result['failed'], 1)
            config['sources'][0].update(parser='ecb-fx', parserVersion='2')
            result = collect(store, config, transport=lambda *_: self.fail('Unnecessary HTTP'), now=NOW)
            self.assertEqual(result['failed'], 0)
            self.assertEqual(result['httpRequests'], 0)

    def test_failed_shared_request_is_counted_once_and_retries_after_backoff(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            config['sources'].append(dict(config['sources'][0], id='other'))
            result = collect(store, config, transport=lambda *_: {'status': 503}, now=NOW)
            self.assertEqual(result['failed'], 2)
            self.assertEqual(result['httpRequests'], 1)
            result = collect(store, config, transport=lambda *_: self.fail('Backoff'), now=NOW)
            self.assertEqual(result['httpRequests'], 0)
            result = collect(store, config, transport=lambda *_: response(xml()), now=NOW + timedelta(minutes=3))
            self.assertEqual(result['failed'], 0)
            self.assertEqual(result['httpRequests'], 1)

    def test_failed_source_does_not_advance_success_or_erase_current_values(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            before = store.state('ecb')
            failed = collect(store, config, transport=lambda *_: response(b'<login>bad schema</login>'),
                             now=NOW + timedelta(days=1))
            self.assertEqual(failed['failed'], 1)
            after = store.state('ecb')
            self.assertEqual(after['lastSuccessAt'], before['lastSuccessAt'])
            self.assertEqual(after['currentObservationIds'], before['currentObservationIds'])
            self.assertTrue(after['nextRetryAt'])

    def test_same_document_is_fetched_once_and_one_source_failure_is_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            second = dict(config['sources'][0], id='other')
            config['sources'].append(second)
            calls = []
            result = collect(store, config, transport=lambda url, _: calls.append(url) or response(xml()), now=NOW)
            self.assertEqual(len(calls), 1)
            self.assertEqual(result['failed'], 0)
            second['url'] = 'https://example.com/bad'
            def transport(url, _):
                return response(b'not xml') if url.endswith('bad') else response(xml())
            result = collect(store, config, transport=transport, now=NOW + timedelta(days=1), force=True)
            self.assertEqual(result['failed'], 1)
            self.assertEqual(result['sources'][0]['status'], 'collected')

    def test_publication_rights_gate_and_immutable_domain_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'private')
            self.addCleanup(store.close)
            config = registry()
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            target = root / 'blocked'
            with self.assertRaisesRegex(ValueError, 'not approved'):
                export_candidate(store, config, ['fx'], target, public=True)
            self.assertFalse(target.exists())
            manifest = export_candidate(store, config, ['fx'], root / 'candidate')
            self.assertEqual(manifest['kind'], 'private_review_candidate')
            self.assertEqual(manifest['sourceVersions']['ecb']['sourceDocumentId'], store.state('ecb')['sourceDocumentId'])
            self.assertEqual([r['dataset'] for r in manifest['files']], ['fx'])
            with self.assertRaisesRegex(ValueError, 'already exists'):
                export_candidate(store, config, ['fx'], root / 'candidate')

    def test_app_public_directory_cannot_hold_raw_observations(self):
        from scripts.data_platform.pipeline import ROOT
        with self.assertRaisesRegex(ValueError, 'outside public'):
            private_path(ROOT / 'public/private/raw')

    def test_approval_requires_revalidation_and_failed_source_cannot_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'private')
            self.addCleanup(store.close)
            config = registry()
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            config['sources'][0]['publicDisplay'] = 'approved'
            with self.assertRaisesRegex(ValueError, 'revalidated'):
                export_candidate(store, config, ['fx'], root / 'stale-config', public=True)
            collect(store, config, transport=lambda *_: self.fail('Unnecessary HTTP'), now=NOW)
            result = export_candidate(store, config, ['fx'], root / 'approved', public=True, now=NOW)
            self.assertEqual(result['kind'], 'public_candidate')
            collect(store, config, transport=lambda *_: {'status': 503}, now=NOW + timedelta(days=1))
            with self.assertRaisesRegex(ValueError, 'revalidated|quality'):
                export_candidate(store, config, ['fx'], root / 'failed-source', public=True)


class ParserTests(unittest.TestCase):
    def test_fund_fields_keep_individual_dates_and_unknown_fee_date(self):
        body = b'''<h1>iShares Core S&amp;P 500 ETF IVV</h1>
        NAV as of Oct 21, 2026 $ $ 776.5600
        Net Assets of Fund $890,398,202,408 as of Oct 21, 2026
        Closing Price $772.35 as of Oct 20, 2026
        30 Day SEC Yield as of Sep 30, 2026 0.95%
        Expense Ratio: Fees as stated in the prospectus 0.03%
        <script>Closing Price $999 as of Oct 22, 2026</script>'''
        config = {'symbol': 'IVV', 'fundName': 'iShares Core S&P 500 ETF', 'entityId': 'fund:ivv', 'currency': 'USD'}
        result = {r['field']: r for r in fund_page(body, config)}
        self.assertEqual(result['nav']['value'], '776.5600')
        self.assertEqual(result['nav']['asOfDate'], '2026-10-21')
        self.assertEqual(result['closingPrice']['asOfDate'], '2026-10-20')
        self.assertEqual(result['secYield30D']['asOfDate'], '2026-09-30')
        self.assertIsNone(result['prospectusExpenseRatio']['asOfDate'])
        with self.assertRaisesRegex(ValueError, 'identity'):
            fund_page(body, dict(config, symbol='OTHER'))

    def test_holdings_have_stable_keys_decimal_precision_and_no_forced_100_percent(self):
        heading = '''Fund
Fund Holdings as of,"Oct 20, 2026"
Shares Outstanding,"1,000.00"
Ticker,Name,Asset Class,Weight (%),Quantity,Market Value,Notional Value,Market Currency
'''
        a = 'AAA,AAA INC,Equity,20.00,0.00,0.00,0.00,USD\n'
        b = 'USD,CASH,Cash,-1.50,-10.00,-10.00,-10.00,USD\n'
        config = {'fundName': 'Fund', 'entityId': 'fund:test'}
        left = holdings((heading + a + b).encode(), config)
        right = holdings((heading + b + a).encode(), config)
        self.assertEqual({r['qualifiers'].get('rowKey') for r in left},
                         {r['qualifiers'].get('rowKey') for r in right})
        self.assertEqual(left[0]['value']['Quantity'], '0.00')
        self.assertEqual(left[1]['value']['Weight (%)'], '-1.50')
        self.assertEqual(left[-1]['value'], '1000.00')

    def test_nasdaq_filters_test_issues_and_requires_completion_marker(self):
        raw = b'Symbol|Security Name|Test Issue|ETF\nAAPL|APPLE|N|N\nTEST|TEST|Y|N\nFile Creation Time: raw|||\n'
        rows = nasdaq(raw, {'id': 'nasdaq'})
        self.assertEqual(len(rows), 1)
        self.assertIn('candidate', rows[0]['entityId'])
        self.assertIsNone(rows[0]['asOfDate'])
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            nasdaq(raw.split(b'File Creation')[0], {'id': 'nasdaq'})

    def test_currency_and_issuer_validation(self):
        row = fx(xml(), {})[0]
        self.assertEqual(row['qualifiers']['baseCurrency'], 'EUR')
        self.assertEqual(row['unit'], 'quote_currency_per_base_currency')
        for bad in ('NaN', '-1'):
            with self.assertRaises(ValueError):
                fx(xml(bad), {})
        payload = {'cik': '2', 'filings': {'recent': {}}}
        with self.assertRaisesRegex(ValueError, 'identity'):
            filings(json.dumps(payload).encode(), {'cik': '0000000001'})

    def test_checked_in_registry_defers_unconfigured_sources(self):
        config = load_registry()
        self.assertTrue(any(s.get('blockedReason') for s in config['sources'] if not s.get('enabled')))
        self.assertEqual(config['datasets']['distributions']['state'], 'existing_authoritative_pipeline')

    def test_bond_positions_keep_distinct_maturities_and_par_values(self):
        text = '''Bond Fund
Fund Holdings as of,"Oct 20, 2026"
Ticker,Name,Asset Class,Weight (%),Par Value,Market Value,Notional Value,Market Currency,Maturity,Coupon (%)
TREASURY,US TREASURY,Bond,2.00,100.00,99.00,99.00,USD,2030-01-01,3.00
TREASURY,US TREASURY,Bond,1.00,100.00,98.00,98.00,USD,2031-01-01,3.00
'''
        rows = holdings(text.encode(), {'fundName': 'Bond Fund', 'entityId': 'fund:test'})
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]['qualifiers']['rowKey'], rows[1]['qualifiers']['rowKey'])
        self.assertEqual(rows[0]['value']['Par Value'], '100.00')
        bonds = text.replace('Ticker,Name,', 'ISIN,Name,').replace('TREASURY,US TREASURY,', 'US1234567890,US TREASURY,')
        rows = holdings(bonds.encode(), {'fundName': 'Bond Fund', 'entityId': 'fund:test'})
        self.assertEqual(len(rows), 2)
        without_ticker = '''Bond Fund
Fund Holdings as of,"Oct 20, 2026"
Name,Asset Class,Weight (%),Par Value,Market Value,Notional Value,Market Currency,CUSIP,Duration,YTM (%)
TREASURY NOTE,Fixed Income,0.00,100.00,99.00,99.00,USD,123456789,6.75,-0.50
'''
        row = holdings(without_ticker.encode(), {'fundName': 'Bond Fund', 'entityId': 'fund:test'})[0]
        self.assertEqual(row['value']['Duration'], '6.75')
        self.assertEqual(row['value']['YTM (%)'], '-0.50')

    def test_cusip_and_sec_ticker_conflicts_are_not_accepted(self):
        body = b'Fund IVV CUSIP 464287200 NAV as of Oct 21, 2026 $100 Net Assets of Fund $1000 as of Oct 21, 2026'
        config = {'fundName': 'Fund', 'symbol': 'IVV', 'cusip': 'WRONG'}
        with self.assertRaisesRegex(ValueError, 'CUSIP'):
            fund_page(body, config)
        with self.assertRaisesRegex(ValueError, 'ticker'):
            filings(json.dumps({'cik': 1, 'tickers': ['OTHER']}).encode(), {'cik': '0000000001', 'symbol': 'AAPL'})
