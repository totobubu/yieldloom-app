import json
import unittest

from scripts.data_platform.parsers import companyfacts, policy_rates, fact
from scripts.data_platform.analytics import project


class FinancialMacroTests(unittest.TestCase):
    def test_financial_periods_units_and_amendments_remain_distinct(self):
        reported = {'end': '2026-06-30', 'start': '2026-01-01', 'filed': '2026-08-01',
                    'form': '10-Q', 'accn': 'first', 'fy': 2026, 'fp': 'Q3', 'val': -120}
        facts = {tag: {'units': {'USD': [reported]}} for tag in
                 ['Revenues', 'NetIncomeLoss', 'Assets', 'NetCashProvidedByUsedInOperatingActivities']}
        facts['NetIncomeLoss']['units']['USD'].append({**reported, 'val': -125, 'form': '10-Q/A', 'filed': '2026-08-10', 'accn': 'amended'})
        data = {'cik': 1, 'facts': {'us-gaap': facts}}
        rows = companyfacts(json.dumps(data).encode(), {'cik': '0000000001'})
        income = [r for r in rows if r['field'] == 'netIncome']
        self.assertEqual({r['value'] for r in income}, {'-120', '-125'})
        self.assertEqual({r['qualifiers']['accessionNumber'] for r in income}, {'first', 'amended'})
        self.assertEqual(income[0]['qualifiers']['periodStart'], '2026-01-01')
        self.assertEqual(income[0]['currency'], 'USD')
        self.assertEqual(income[0]['asOfDate'], '2026-06-30')
        with self.assertRaisesRegex(ValueError, 'identity'):
            companyfacts(json.dumps(data).encode(), {'cik': '0000000002'})

    def test_policy_rates_use_effective_dates_and_do_not_turn_missing_into_zero(self):
        html = b'''<table><tr><td rowspan="2">2026</td><td>21 Oct.</td><td>2.00</td><td>2.15</td><td>-</td><td>2.40</td></tr>
        <tr><td>10 Sep.<sup>5</sup></td><td>-0.50</td><td>0.00</td><td>-</td><td>0.25</td></tr></table>'''
        html = html.replace(b'-0.50', '−0.50'.encode())
        rows = policy_rates(html, {})
        self.assertEqual(len(rows), 6)
        self.assertEqual({r['asOfDate'] for r in rows}, {'2026-10-21', '2026-09-10'})
        self.assertIn('-0.50', {r['value'] for r in rows})
        self.assertTrue(all(r['qualifiers']['dateBasis'] == 'effective_date' for r in rows))
        with self.assertRaises(ValueError):
            policy_rates(b'<h1>maintenance</h1>', {})

    def test_exposures_preserve_negative_zero_missing_and_input_versions(self):
        rows = []
        for weight, sector in [('20.00', 'Tech'), ('-1.50', 'Cash'), ('0.00', 'Cash'), (None, None)]:
            rows.append({**fact('holdings', 'fund:test', 'position', {'Weight (%)': weight,
                'Sector': sector, 'Location': 'US', 'Market Currency': 'USD'}, '2026-10-20'), 'sourceId': 'issuer'})
        versions = {'issuer': {'sourceDocumentId': 'a' * 64, 'parserVersion': '5', 'fingerprint': 'version-one'}}
        value = project(rows, versions)[0]
        self.assertEqual(value['coverage']['reportedWeightTotal'], '18.50')
        self.assertEqual(value['coverage']['unweightedPositions'], 1)
        self.assertEqual(value['inputVersions'], versions)
        self.assertEqual(value['verificationStatus'], 'derived_estimate')
        changed = project(rows, {'issuer': {**versions['issuer'], 'sourceDocumentId': 'b' * 64}})[0]
        self.assertNotEqual(value['inputVersions'], changed['inputVersions'])
