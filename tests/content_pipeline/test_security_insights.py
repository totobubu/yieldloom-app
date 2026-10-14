import json
from datetime import date, datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

from scripts.content_pipeline import security_insights as insights
from scripts.content_pipeline import tax_character as tax
from scripts.content_pipeline.refresh import insights_targets
from scripts.utils import collect_security_insights as collector
from scripts.utils import run_us_collection


ESTIMATE = '''Example Fund (SPYI) Rule 19a-1
payment payable on September 18, 2026 to shareholders of record on September 16, 2026
Estimated Return of Capital $0.5014 94% $4.5614 96%
Total (per common share) $0.5338 100% $4.7603 100%
'''
FINAL = '''Form 8937 SPYI
FYE 12/31/2025
Record Date Ex Date Payable Date Total Dividend Return of Capital Return of Capital %
6/25/2025 6/25/2025 6/27/2025 0.50470000 0 .48085208 95.274833%
7/23/2025 7/23/2025 7/25/2025 0.51120000 0.48704495 95.274834%
'''
URL = 'https://neosfunds.com/wp-content/uploads/example.pdf'


class TaxTests(unittest.TestCase):
    def test_current_and_fiscal_ytd_are_separate_and_not_final(self):
        rows = tax.parse_roc_text(ESTIMATE, 'SPYI', URL, 'abc')
        self.assertEqual([r['scope'] for r in rows], ['payment', 'fiscal_year_to_date'])
        self.assertEqual([r['rocPercent'] for r in rows], ['94', '96'])
        self.assertEqual(rows[0]['payableDate'], '2026-09-18')
        self.assertIsNone(rows[1]['payableDate'])
        self.assertIsNone(rows[0]['exDate'])
        self.assertTrue(all(r['classificationStatus'] == 'estimated' for r in rows))

    def test_final_precision_and_pdf_spacing_are_preserved(self):
        rows = tax.parse_roc_text(FINAL, 'SPYI', URL, 'final')
        self.assertEqual(rows[0]['rocAmount'], '0.48085208')
        self.assertEqual(rows[0]['distributionAmount'], '0.50470000')
        self.assertEqual(rows[0]['rocPercent'], '95.274833')
        self.assertEqual(rows[0]['classificationStatus'], 'final')
        self.assertEqual(rows[0]['fiscalYearEnd'], '2025-12-31')
        self.assertIsNone(rows[0]['taxYear'])

    def test_explicit_zero_and_unrecognized_documents(self):
        zero = ESTIMATE.replace('$0.5014 94%', '$0.0000 0%')
        self.assertEqual(tax.parse_roc_text(zero, 'SPYI', URL, 'zero')[0]['rocPercent'], '0')
        for text, ticker in [(ESTIMATE, 'QQQI'), ('SPYI Form 8937 Annual ROC 90%', 'SPYI')]:
            with self.assertRaises(ValueError):
                tax.parse_roc_text(text, ticker, URL, 'unsupported')
        for url in ['http://neosfunds.com/x.pdf', 'https://neosfunds.com.evil.test/x.pdf', 'https://user:pass@neosfunds.com/x.pdf']:
            with self.assertRaises(ValueError):
                tax.validate_source_url(url)

    def test_immutable_tax_revisions_do_not_replace_estimates(self):
        estimate = tax.parse_roc_text(ESTIMATE, 'SPYI', URL, 'estimate')
        final = tax.parse_roc_text(FINAL, 'SPYI', URL, 'final')
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            first = tax.persist_observations(estimate + final, directory)
            again = tax.persist_observations(estimate + final, directory)
            self.assertEqual([r['observationId'] for r in first], [r['observationId'] for r in again])
            self.assertEqual(len(list(directory.glob('*.json'))), 4)
            corrected = dict(final[0], rocAmount='0.49000000', documentSha256='correction')
            tax.persist_observations([corrected], directory)
            self.assertEqual(len(list(directory.glob('*.json'))), 5)
            self.assertEqual(first[0]['firstObservedAt'], again[0]['firstObservedAt'])
            Path(first[0]['observationPath']).write_text('{}')
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                tax.persist_observations(estimate, directory)

    def test_cached_percentage_is_not_promoted_to_estimate_or_final(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / 'distribution-ticker-spyi.json').write_text(json.dumps({'history': [
                {'ticker': 'SPYI', 'distribution_per_share': '0.5', 'roc_percent': '0', 'official_url': URL},
                {'ticker': 'SPYI', 'distribution_per_share': '0.5', 'roc_percent': None, 'official_url': URL},
            ]}))
            rows = tax.legacy_roc(directory, {'SPYI'})
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['classificationStatus'], 'unclassified')
            self.assertIsNone(rows[0]['rocAmount'])


class MetricTests(unittest.TestCase):
    def history(self):
        return {'prices': [
            {'date': '2024-10-13', 'close': 80, 'adjustedClose': 70},
            {'date': '2025-10-14', 'close': 100, 'adjustedClose': 90},
            {'date': '2026-10-14', 'close': 110, 'adjustedClose': 108}],
            'dividends': [{'exDate': '2025-05-01', 'amount': 1}, {'exDate': '2026-05-01', 'amount': 2}],
            'splits': []}

    def test_returns_ttm_growth_and_yield_have_explicit_basis(self):
        result = insights.calculate_history(self.history(), date(2026, 10, 14))
        self.assertAlmostEqual(result['totalReturn1Y']['value'], 20)
        self.assertEqual(result['totalReturn1Y']['status'], 'provider_adjusted_estimate')
        self.assertEqual(result['ttmDividendPerShare']['value'], 2)
        self.assertEqual(result['ttmDividendGrowth']['value'], 100)
        self.assertAlmostEqual(result['ttmDividendYield']['value'], 2 / 110 * 100)

    def test_splits_and_missing_adjusted_prices_are_not_fabricated(self):
        history = self.history()
        history['splits'] = [{'date': '2026-01-01', 'splitRatio': '2:1'}]
        result = insights.calculate_history(history, date(2026, 10, 14))
        self.assertIsNone(result['ttmDividendGrowth']['value'])
        self.assertEqual(result['ttmDividendGrowth']['status'], 'needs_corporate_action_review')
        history['prices'][-1]['adjustedClose'] = None
        self.assertIsNone(insights.calculate_history(history, date(2026, 10, 14))['totalReturn1Y']['value'])

    def test_short_history_does_not_become_ttm(self):
        history = self.history()
        history['prices'] = history['prices'][-1:]
        result = insights.calculate_history(history, date(2026, 10, 14))
        self.assertIsNone(result['ttmDividendPerShare']['value'])
        self.assertEqual(result['ttmDividendGrowth']['status'], 'insufficient_history')

    def test_quote_missing_values_and_invalid_spreads(self):
        result = insights.quote_metrics({'bid': 10, 'ask': 0}, date(2026, 10, 14))
        self.assertIsNone(result['bidAskSpread']['value'])
        self.assertIsNone(result['reportedPayoutRatio']['value'])
        self.assertIsNone(result['calendar']['payableDate']['value'])
        result = insights.quote_metrics({'bid': 99, 'ask': 101}, date(2026, 10, 14))
        self.assertEqual(result['bidAskSpread']['value'], 2)

    def test_cash_flow_four_quarters_and_nonpositive_denominator(self):
        columns = pd.to_datetime(['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'])
        frame = pd.DataFrame([[100, 100, 100, 100], [-25, -25, -25, -25]],
                             index=['Free Cash Flow', 'Cash Dividends Paid'], columns=columns)
        result = insights.cash_flow_metrics(frame, date(2026, 10, 14))
        self.assertEqual(result['fcfPayoutRatio']['value'], 25)
        self.assertEqual(len(result['quarterlyObservations']), 4)
        self.assertIsNone(insights.cash_flow_metrics(frame.iloc[:, :3], date(2026, 10, 14))['fcfPayoutRatio']['value'])
        frame.loc['Free Cash Flow'] = -100
        self.assertEqual(insights.cash_flow_metrics(frame, date(2026, 10, 14))['fcfPayoutRatio']['status'], 'nonpositive_free_cash_flow')

    def test_official_nav_skips_csv_disclaimer_and_never_uses_market_price(self):
        text = 'Date,Fund NAV\n10/12/2026,31.000000\n10/13/2026,32.000000\nThe index levels are total return.\n'
        rows = insights.parse_nav(text, 'SCHD', date(2026, 10, 14))
        self.assertEqual(rows[-1]['nav'], '32.000000')
        payload = {'fundId': 'VYM', 'market': [{'item': [{'price': 50}]}]}
        with self.assertRaises(ValueError):
            insights.parse_nav(json.dumps(payload), 'VYM', date(2026, 10, 14))

    def test_holdings_overlap_flags_different_source_dates(self):
        result = insights.holdings_overlap({'stocks': [{'symbol': 'KO', 'etfHoldings': [
            {'etf': 'SCHD', 'weightPercent': 4, 'asOfDate': '2026-10-13'},
            {'etf': 'VYM', 'weightPercent': 2, 'asOfDate': '2026-08-31'}]}]})
        self.assertEqual(result[0]['overlapPercent'], 2)
        self.assertEqual(result[0]['status'], 'mixed_or_unknown_as_of_dates')


class PipelineTests(unittest.TestCase):
    def test_refresh_keeps_selected_provider_and_date_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'distribution-ticker-spyi.json').write_text(json.dumps({'history': [
                {'ticker': 'SPYI', 'provider_slug': 'neos', 'currency': 'USD', 'ex_date': '2026-09-16'}]}))
            (root / 'distribution-ticker-ymax.json').write_text(json.dumps({'history': [
                {'ticker': 'YMAX', 'provider_slug': 'yieldmax', 'currency': 'USD', 'ex_date': '2026-09-17'}]}))
            self.assertEqual(insights_targets(root, provider='neos'), ['SPYI'])
            self.assertEqual(insights_targets(root, ex_date=date(2026, 9, 17)), ['YMAX'])
            self.assertEqual(insights_targets(root, provider='missing'), [])
            self.assertIsNone(insights_targets(root))

    def test_compact_report_preserves_full_observation_reference_and_flags_partial_sources(self):
        row = {'symbol': 'AAA', 'status': 'collected', 'collectedAt': '2026-10-14T10:00:00+00:00',
               'observationPath': 'observations/AAA/source.json',
               'history': {'prices': [1, 2], 'dividends': [3], 'splits': []},
               'navHistory': {'status': 'available', 'rows': [1, 2]},
               'quote': {'averageDailyVolume': {'value': 100, 'status': 'available'}},
               'fund': {'status': 'not_available', 'error': 'source failed'}}
        compact = collector.compact_row(row)
        self.assertEqual(compact['status'], 'partial')
        self.assertEqual(compact['observationPath'], row['observationPath'])
        self.assertNotIn('history', compact)
        self.assertEqual(compact['historyRowCounts']['prices'], 2)
        self.assertEqual(compact['navHistory']['rowCount'], 2)
        self.assertIsNone(compact['quote']['averageDailyVolume']['asOfDate'])
        self.assertEqual(len(row['history']['prices']), 2)

    def test_single_ticker_rerun_preserves_others_and_resume_skips_completed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / 'latest.json'
            def collected(ticker, today, raw):
                return {'symbol': ticker, 'status': 'collected', 'collectorVersion': insights.COLLECTOR_VERSION,
                        'collectedAt': datetime.now(timezone.utc).isoformat()}
            with patch.object(collector, 'add_tax_observations'), patch.object(collector, 'collect_security', side_effect=collected) as collect:
                base = ['--output', str(output), '--discovery', str(root / 'missing.json'),
                        '--content-dir', str(root / 'content'), '--delay', '0']
                collector.main(base + ['--symbol', 'AAA'])
                collector.main(base + ['--symbol', 'BBB'])
                collector.main(base + ['--symbol', 'AAA', '--resume'])
                self.assertEqual(collect.call_count, 2)
            report = json.loads(output.read_text())
            self.assertEqual(set(report['securities']), {'AAA', 'BBB'})
            self.assertTrue(list((root / 'snapshots').rglob('*.json')))

    def test_integrated_collection_continues_partial_data_and_stops_fatal_errors(self):
        with patch.object(run_us_collection.subprocess, 'run') as run:
            run.return_value.returncode = 2
            self.assertEqual(run_us_collection.main(['--resume']), 2)
            self.assertEqual(run.call_count, 3)
        with patch.object(run_us_collection.subprocess, 'run') as run:
            run.return_value.returncode = 1
            self.assertEqual(run_us_collection.main([]), 1)
            self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
