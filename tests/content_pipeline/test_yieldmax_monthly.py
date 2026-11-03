"""Monthly issuer rows, calendar boundaries and partial-date recovery."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline import collect, schedule_yieldmax as runner
from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome, SourceCandidate
from scripts.content_pipeline.providers.yieldmax import YieldMaxAdapter
from scripts.content_pipeline.yieldmax_schedule import cycle_anchors, previous_anchor

FIXTURES = Path(__file__).parent / 'fixtures'
URL = 'https://www.globenewswire.com/news-release/2026/{month}/release'


def document(month):
    return SourceDocument('yieldmax', URL.format(month=month), 'official_press_release',
                          (FIXTURES / f'yieldmax_monthly_2026_{month}.html').read_bytes())


class MonthlyTest(unittest.TestCase):
    def test_official_october_and_november_rows(self):
        for month, declared, ex, pay, amounts in (
            ('10', '2026-10-06', '2026-10-07', '2026-10-08', ['0.5323', '0.4614', '0.9992']),
            ('11', '2026-11-03', '2026-11-04', '2026-11-05', ['0.4977', '0.4785', '0.7730']),
        ):
            events = YieldMaxAdapter().parse(document(month))
            self.assertEqual([e.ticker for e in events], ['BIGY', 'RNTY', 'SOXY'])
            self.assertEqual([e.distribution_per_share for e in events], amounts)
            self.assertTrue(all((e.declared_date, e.ex_date, e.record_date, e.payable_date, e.frequency)
                                == (declared, ex, ex, pay, 'monthly') for e in events))

    def test_invalid_or_conflicting_row_dates_fail(self):
        from dataclasses import replace
        original = document('11')
        for content in (original.content.replace(b'11/5/26', b'11/2/26'),
                        original.content + b'<p>Payment Date: November 6, 2026</p>',
                        original.content.replace(b'11/4/26', b'unknown')):
            with self.assertRaises(ValueError):
                YieldMaxAdapter().parse(replace(original, content=content))

    def test_month_boundaries_and_weekly_dates(self):
        self.assertEqual(cycle_anchors('monthly', date(2026, 11, 2)), (date(2026, 10, 6), date(2026, 11, 3)))
        self.assertEqual(cycle_anchors('monthly', date(2026, 11, 20)), (date(2026, 11, 3), date(2026, 12, 1)))
        self.assertEqual(previous_anchor('monthly', date(2026, 1, 6)), date(2025, 12, 2))
        self.assertEqual(cycle_anchors('group-1', date(2026, 11, 20)), (date(2026, 11, 17), date(2026, 11, 24)))
        with self.assertRaises(ValueError):
            runner.request_for(group='monthly', declared=date(2026, 11, 10), cycle=date(2026, 11, 10),
                               now=datetime(2026, 11, 20, tzinfo=timezone.utc))

    def test_monthly_discovery_uses_issuer_linked_releases(self):
        listing = b'<a href="https://www.globenewswire.com/news-release/monthly">Distributions on BIGY, RNTY and SOXY</a>'
        with patch.object(YieldMaxAdapter, 'request_bytes', return_value=listing):
            rows = list(YieldMaxAdapter().discover_announcements_for_tickers(['BIGY']))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].metadata['group'], 'monthly')

    def test_one_collected_date_does_not_hide_another_missing_date(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # First source supplies October for every target; November must still be discovered.
            calls = []
            def fetch(candidates):
                candidates = list(candidates)
                calls.extend(candidates)
                doc = document('10') if len(calls) == 3 else document('11')
                return [FetchOutcome(candidates[0], doc)]
            candidate = SourceCandidate(URL.format(month='11'), 'official_press_release')
            args = ['collect.py', '--provider', 'yieldmax', '--tickers', 'BIGY,RNTY,SOXY',
                    '--declaration-dates', '2026-10-06,2026-11-03', '--db', str(root/'ledger.sqlite'),
                    '--raw-dir', str(root/'raw')]
            with patch('sys.argv', args), patch.object(YieldMaxAdapter, 'fetch_many', side_effect=fetch), \
                 patch.object(YieldMaxAdapter, 'discover_announcements_for_tickers', return_value=[candidate]) as discovery, \
                 redirect_stdout(io.StringIO()) as output:
                self.assertEqual(collect.main(), 0)
            discovery.assert_called_once_with(['BIGY', 'RNTY', 'SOXY'])
            self.assertEqual(json.loads(output.getvalue())['events'], 6)


if __name__ == '__main__':
    unittest.main()
