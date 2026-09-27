import unittest
from scripts.data_pipeline.history_sources import toss_history


def page(dates, cursor):
    return {'result': {'candles': [{'timestamp': d + 'T00:00:00-05:00', 'closePrice': '10'} for d in dates], 'nextBefore': cursor}}


class HistorySourcesTest(unittest.TestCase):
    def test_pagination_deduplicates_inclusive_boundary_and_reaches_old_history(self):
        calls = []
        pages = iter([page(['2026-09-18', '2010-01-04'], '2010-01-04T00:00:00-05:00'),
                      page(['2010-01-04', '1962-01-02'], None)])
        def fetch(query):
            calls.append(query)
            return next(pages)
        result = toss_history('GE', '1962-01-02', fetch)
        self.assertTrue(result['startReached'])
        self.assertEqual(len(result['candles']), 3)
        self.assertEqual(calls[1]['before'], '2010-01-04T00:00:00-05:00')
        self.assertEqual(calls[0]['adjusted'], 'false')

    def test_provider_end_is_not_lifetime_coverage(self):
        result = toss_history('GE', '1962-01-02', lambda _: page(['2016-01-04'], None))
        self.assertFalse(result['startReached'])
        self.assertEqual(result['stopReason'], 'provider_exhausted')

    def test_stalled_cursor_is_not_infinite_loop(self):
        result = toss_history('GE', '1962-01-02', lambda _: page(['2016-01-04'], 'same'))
        self.assertEqual(result['pages'], 2)
        self.assertEqual(result['stopReason'], 'cursor_stalled')
