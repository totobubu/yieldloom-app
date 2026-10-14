import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts.utils import export_us_dividend_catalog as exporter


def report():
    return {'schemaVersion': 1, 'lookbackDays': 365, 'verificationAsOfDate': '2026-10-14',
            'stocks': [{'symbol': 'AAON', 'name': 'AAON', 'market': 'NASDAQ',
                'etfHoldings': [{'etf': 'DGRO', 'weightPercent': 0.1, 'asOfDate': '2026-10-12',
                                'sourceUrl': 'https://www.ishares.com/holdings.csv'}],
                'dividendVerification': {'status': 'verified', 'source': 'Yahoo Finance',
                    'asOfDate': '2026-10-14', 'instrumentType': 'EQUITY', 'currency': 'USD',
                    'longName': 'AAON, Inc.', 'events': [{'exDate': '2026-09-01', 'amount': 0.1}]}},
                {'symbol': 'BAD', 'dividendVerification': {'status': 'unavailable'}}]}


class CatalogTests(unittest.TestCase):
    def test_export_verified_metadata_and_provenance(self):
        catalog = exporter.build_catalog(report(), date(2026, 10, 14))
        self.assertEqual(len(catalog['instruments']), 1)
        stock = catalog['instruments'][0]
        self.assertEqual(stock['securityType'], 'stock')
        self.assertEqual(stock['longName'], 'AAON, Inc.')
        self.assertEqual(stock['dividendEvidence']['latestAmount'], 0.1)
        self.assertEqual(stock['dividendEtfs'][0]['ticker'], 'DGRO')
        self.assertNotIn('officialProvider', stock)

    def test_stale_and_false_verified_evidence_are_rejected(self):
        with self.assertRaises(ValueError):
            exporter.build_catalog(report(), date(2026, 10, 15))
        for event in ({'exDate': '2026-10-15', 'amount': 1},
                      {'exDate': '2026-09-01', 'amount': float('nan')},
                      {'exDate': '2026-09-01', 'amount': 0}):
            changed = report()
            changed['stocks'][0]['dividendVerification']['events'] = [event]
            with self.assertRaises(ValueError):
                exporter.build_catalog(changed, date(2026, 10, 14))

    def test_empty_export_retains_existing_catalog(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'report.json'
            output = Path(temp) / 'catalog.json'
            source.write_text(json.dumps({'schemaVersion': 1, 'lookbackDays': 365,
                                         'collectedAt': '2026-10-14', 'stocks': []}))
            output.write_text('existing catalog')
            with patch.object(exporter, 'datetime') as clock:
                clock.now.return_value.date.return_value = date(2026, 10, 14)
                with self.assertRaises(ValueError):
                    exporter.main(['--input', str(source), '--output', str(output)])
            self.assertEqual(output.read_text(), 'existing catalog')


if __name__ == '__main__':
    unittest.main()
