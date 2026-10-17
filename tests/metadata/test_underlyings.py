import unittest
import json
import tempfile
from pathlib import Path
from lxml import html
from scripts.metadata.underlyings import (
    title_underlyings, parse_product, parse_direxion, discover, merge_records,
    audit, validate_record, record,
)

EVIDENCE = {'url': 'https://www.kurvinvest.com/etf/aapy', 'contentSha256': 'a' * 64,
            'fetchedAt': '2026-10-17T00:00:00+00:00'}
SYMBOLS = {'AAPL', 'AMD', 'NVDA', 'MU', 'K', 'FANG', 'SPY', 'MSFT', 'MSFY', 'AAPY', 'AAPU', 'AAPD'}


class UnderlyingTests(unittest.TestCase):
    def test_baskets_and_symbol_like_prose_do_not_become_single_stock_links(self):
        for title in ['GraniteShares Bloomberg Commodity Broad Strategy No K-1 ETF',
                      'Kurv Memory ETF', 'REX FANG Covered Call ETF',
                      'Kurv U.S. Large Cap TaxOptimized ETF',
                      'Kurv Semiconductor ETF with Micron',
                      'Kurv Magnificent 7 ETF with Apple']:
            self.assertEqual(title_underlyings(title, 'TEST', SYMBOLS), set(), title)
        self.assertEqual(title_underlyings('Kurv Yield Premium Strategy Microsoft ETF', 'MSFY', SYMBOLS), {'MSFT'})
        self.assertEqual(title_underlyings('Apple and Microsoft ETF', 'TEST', SYMBOLS), {'AAPL', 'MSFT'})

    def test_product_identity_and_scoped_title_are_required(self):
        doc = html.fromstring('<html><title>Kurv Apple ETF</title><h1>AAPY</h1><nav>NVDA TSLA AMD</nav></html>')
        result = parse_product(doc, 'AAPY', 'kurv', SYMBOLS, EVIDENCE, ['AAPY'])
        self.assertEqual(result['underlying'], 'AAPL')
        self.assertEqual(validate_record(result), result)
        with self.assertRaisesRegex(ValueError, 'identity'):
            parse_product(doc, 'MISSING', 'kurv', SYMBOLS, EVIDENCE)
        with self.assertRaisesRegex(ValueError, 'disagree'):
            parse_product(doc, 'AAPY', 'kurv', SYMBOLS, EVIDENCE, ['Kurv AMD ETF'])
        promo = html.fromstring('<html><title>Kurv Memory ETF</title><h1>Access Micron all in one ETF</h1><p>KMEM</p></html>')
        self.assertIsNone(parse_product(promo, 'KMEM', 'kurv', SYMBOLS, EVIDENCE))

    def test_yieldmax_fund_name_in_h2_and_fragmented_headings(self):
        doc = html.fromstring('<html><title>APLY - YieldMax</title><h1>APLY</h1><h2>YieldMax <span>AAPL</span> Option Income Strategy ETF</h2></html>')
        evidence = {**EVIDENCE, 'url': 'https://yieldmaxetfs.com/our-etfs/aply/'}
        self.assertEqual(parse_product(doc, 'APLY', 'yieldmax', SYMBOLS, evidence)['underlying'], 'AAPL')
        pipe_title = html.fromstring('<html><title>MSTX | Defiance Daily Target 2X Long MSTR ETF</title><h1>MSTX</h1></html>')
        source = {**EVIDENCE, 'url': 'https://www.defianceetfs.com/mstx/'}
        self.assertEqual(parse_product(pipe_title, 'MSTX', 'defiance', SYMBOLS | {'MSTR'}, source)['underlying'], 'MSTR')

    def test_direxion_rowspans_and_inverse_exposure(self):
        doc = html.fromstring('''<table><tbody>
        <tr><td></td><td>AAPU</td><td>Direxion Daily AAPL Bull 2X ETF</td><td rowspan="2">AAPL</td><td>200%</td></tr>
        <tr><td></td><td>AAPD</td><td>Direxion Daily AAPL Bear 1X ETF</td><td>-100%</td></tr>
        </tbody></table>''')
        evidence = {**EVIDENCE, 'url': 'https://www.direxion.com/single-stock-etfs'}
        result = parse_direxion(doc, SYMBOLS, evidence)
        self.assertEqual(result['AAPD']['underlying'], 'AAPL')
        self.assertEqual(result['AAPD']['leverage'], -1)
        self.assertEqual(result['AAPU']['leverage'], 2)

    def test_defiance_official_json_discovery_rejects_external_urls(self):
        data = [{'ticker': 'MSTX', 'name': 'Defiance Daily 2X Long MSTR ETF', 'url': 'https://www.defianceetfs.com/mstx/'}]
        self.assertIn('MSTX', discover(data, 'defiance', set()))
        with self.assertRaises(ValueError):
            discover([{**data[0], 'url': 'https://example.com/mstx/'}], 'defiance', set())

    def test_partial_refresh_preserves_links_and_quarantines_changes(self):
        old = record('AAPY', 'Kurv Apple ETF', 'AAPL', 'kurv', EVIDENCE, 'official-product-title')
        rows = [{'symbol': 'AAPY', 'company': 'Kurv'}]
        merged, conflicts = merge_records({'AAPY': old}, {}, rows)
        self.assertEqual(merged['AAPY'], old)
        changed = {**old, 'underlying': 'AMD'}
        merged, conflicts = merge_records({'AAPY': old}, {'AAPY': changed}, rows)
        self.assertEqual(merged['AAPY'], old)
        self.assertEqual(conflicts[0]['reason'], 'underlying-changed')
        merged, conflicts = merge_records({}, {'AAPY': old}, [{'symbol': 'AAPY', 'company': 'Direxion'}])
        self.assertEqual(merged, {})
        self.assertEqual(conflicts[0]['reason'], 'provider-mismatch')
        # No missing-market "UNKNOWN" instruments are created by relationship discovery.
        merged, _ = merge_records({}, {'AAPY': old}, [])
        self.assertEqual(merged, {})

    def test_audit_includes_every_etf_including_missing_issuer(self):
        rows = [{'symbol': 'AAPY', 'company': 'Kurv', 'koName': '커브 애플 ETF'},
                {'symbol': 'AAPU', 'koName': '애플 ETF'},
                {'symbol': 'AAPL', 'koName': '애플'},
                {'symbol': 'COMB', 'company': 'GraniteShares', 'koName': '원자재 ETF'}]
        report = audit(rows, {}, {}, {}, [], [])
        self.assertEqual(report['summary']['catalogInstruments'], 4)
        self.assertEqual(report['summary']['etfsAudited'], 3)
        self.assertEqual(report['instruments'][1]['nameCandidates'], ['AAPL'])
        self.assertEqual(report['summary']['no-single-underlying-detected'], 1)

    def test_invalid_evidence_cannot_be_registered(self):
        row = record('AAPY', 'Kurv Apple ETF', 'AAPL', 'kurv', EVIDENCE, 'official-product-title')
        for change in [{'underlying': 'AAPY'}, {'verificationStatus': 'candidate'},
                       {'evidence': {**EVIDENCE, 'url': 'https://evil.test/aapy'}},
                       {'evidence': {**EVIDENCE, 'contentSha256': 'bad'}}]:
            with self.assertRaises(ValueError):
                validate_record({**row, **change})

    def test_core_release_preserves_verified_underlying_without_trusting_seed_guesses(self):
        from scripts.data_v2.build_release import load_catalog
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps({'instruments': [
                {'symbol': 'AAPY', 'market': 'NYSE', 'currency': 'USD', 'underlying': 'WRONG'},
                {'symbol': 'FAKE', 'market': 'NYSE', 'currency': 'USD', 'underlying': 'AAPL'},
            ]}))
            catalog = {row['symbol']: row for row in load_catalog(path, [])}
            self.assertEqual(catalog['AAPY']['underlying'], 'AAPL')
            self.assertNotIn('underlying', catalog['FAKE'])

    def test_local_reaudit_retains_collection_failures_and_unregistered_evidence(self):
        from scripts.metadata.underlyings import main
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / 'registry.json'
            registry.write_text(json.dumps({'schemaVersion': 1, 'instruments': {}}))
            report = Path(directory) / 'audit.json'
            candidate = record('ZZZZZ', 'Kurv Apple ETF', 'AAPL', 'kurv', EVIDENCE, 'official-product-title')
            failure = {'provider': 'kurv', 'error': 'HTTP Error 404: Not Found'}
            report.write_text(json.dumps({'unregisteredOfficialProducts': [candidate], 'sourceFailures': [failure]}))
            self.assertEqual(main(['--registry', str(registry), '--report', str(report)]), 2)
            result = json.loads(report.read_text())
            self.assertEqual(result['unregisteredOfficialProducts'], [candidate])
            self.assertEqual(result['sourceFailures'], [failure])


if __name__ == '__main__':
    unittest.main()
