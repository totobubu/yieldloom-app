import io
import json
import re
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline import collect, refresh, schedule_yieldmax as runner, schedule_roundhill
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import CollectionError, FetchOutcome, SourceCandidate
from scripts.content_pipeline.providers.yieldmax import YieldMaxAdapter
from scripts.content_pipeline.yieldmax_schedule import GROUPS, POLICY, PRIMARY_CRONS, RECOVERY_CRON, TRACKED_SYMBOLS, eligible_tickers, select_primary


def instant(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class YieldMaxPolicyTest(unittest.TestCase):
    def test_approved_tickers_and_requested_weekdays(self):
        self.assertEqual((GROUPS['group-3']['weekday'], GROUPS['group-3']['tickers']), (0, ['MSST', 'NVIT', 'TEST']))
        self.assertEqual(GROUPS['group-1']['tickers'], 'CHPY GPTY LFGY MINY QDTY RDTY SDTY SLTY ULTY YMAG YMAX YRAM'.split())
        self.assertEqual(GROUPS['group-2']['tickers'], 'AIYY AMDY AMZY APLY BABO BRKC CONY CRCO CRSH CVNY DIPS DRAY FBY FIAT GDXY GMEY GOOY HIYY HOOY INYY JPO MARO MRNY MSFO MSTY MUY NFLY NVDY OARK PLTY PYPY RBLY RDYY SMCY SNOY TSLY TSMY WNTR XOMO XYZY YBIT YQQQ YSKH YSPC'.split())
        self.assertEqual([len(GROUPS[group]['tickers']) for group in ('group-3', 'group-1', 'group-2')], [3, 12, 44])
        self.assertEqual(len(set(TRACKED_SYMBOLS)), 59)
        self.assertEqual([GROUPS[group]['weekday'] for group in ('group-3', 'group-1', 'group-2')], [0, 1, 2])
        for day, expected in ((26, 'group-3'), (27, 'group-1'), (28, 'group-2')):
            request = runner.request_for(cron=PRIMARY_CRONS[1], created_at=instant(f'2026-10-{day}T11:05:00'), now=instant('2026-10-30T00:00:00'))
            self.assertEqual((request['group'], request['anchor']), (expected, f'2026-10-{day}'))

    def test_delayed_run_and_dst_are_resolved_from_original_schedule(self):
        request = runner.request_for(cron=PRIMARY_CRONS[1], created_at=instant('2026-10-27T01:00:00'), now=instant('2026-11-11T00:00:00'))
        self.assertEqual((request['group'], request['anchor']), ('group-3', '2026-10-26'))
        self.assertIsNone(select_primary(PRIMARY_CRONS[3], instant('2026-10-27T12:05:00')))
        self.assertEqual(select_primary(PRIMARY_CRONS[3], instant('2026-11-03T12:05:00')), ('group-1', date(2026, 11, 3)))
        self.assertEqual(select_primary(PRIMARY_CRONS[1], instant('2026-11-03T11:05:00')), ('group-1', date(2026, 11, 3)))

    def test_workflow_and_separate_state_keep_backup_and_common_writer_lock(self):
        workflow = Path('.github/workflows/observe-yieldmax.yml').read_text()
        self.assertEqual(set(re.findall(r"cron: '([^']+)'", workflow)), {*PRIMARY_CRONS, RECOVERY_CRON})
        self.assertIn('group: content-studio-state-write', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertIn("steps.save.outcome == 'success'", workflow)
        self.assertIn("steps.validate.outcome == 'success'", workflow)
        self.assertIn("steps.observation.outputs.publish == 'true'", workflow)
        self.assertEqual(runner.DEFAULT_STATE.parent, schedule_roundhill.DEFAULT_STATE.parent)
        self.assertNotEqual(runner.DEFAULT_STATE, schedule_roundhill.DEFAULT_STATE)
        backup = Path('.github/workflows/content-studio-provider-refresh.yml').read_text()
        self.assertIn("cron: '15 22 * * 0-4' # yieldmax", backup)

    def test_bad_tickers_and_invalid_manual_dates_are_rejected_before_http(self):
        for symbol in ('CRAY', 'PYPTY', '../TSLY', 'INVALID'):
            with patch('sys.argv', ['collect.py', '--provider', 'yieldmax', '--tickers', symbol, '--declaration-dates', '2026-10-28']), patch('sys.stderr', io.StringIO()), patch.object(YieldMaxAdapter, 'fetch_many') as fetch:
                with self.assertRaises(SystemExit):
                    collect.main()
                fetch.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'specific group'):
            runner.request_for(declared=date(2026, 10, 26), now=instant('2026-10-27T00:00:00'))
        with self.assertRaisesRegex(ValueError, 'future'):
            runner.request_for(group='group-3', declared=date(2030, 1, 1), now=instant('2026-10-27T00:00:00'))

    def test_release_discovery_uses_only_yieldmax_news_links(self):
        adapter = YieldMaxAdapter()
        listing = (
            '<a href="/news/group-3-release/">YieldMax announces distributions on MSST, NVIT, and TEST</a>'
            '<a href="https://www.globenewswire.com/news-release/example/">'
            'YieldMax announces distributions on MSST, NVIT, and TEST</a>'
        ).encode()
        with patch.object(adapter, 'request_bytes', return_value=listing) as request:
            candidates = list(adapter.discover_announcements_for_tickers(['MSST', 'NVIT', 'TEST']))
        request.assert_called_once_with('https://yieldmaxetfs.com/news/')
        self.assertEqual(
            [(candidate.url, candidate.source_type) for candidate in candidates],
            [('https://yieldmaxetfs.com/news/group-3-release/', 'official_press_release')],
        )

    def test_release_parser_never_uses_fetch_time_as_declaration_date(self):
        content = (
            '<p>Group 3 Distribution Announcement: Ex. &amp; Record Date: October 27, 2026 '
            'Payment Date: October 28, 2026</p>'
            '<table><tr><th>ETF Ticker</th><th>ETF Name</th><th>Distribution Frequency</th>'
            '<th>Distribution per Share</th></tr>'
            '<tr><td>MSST</td><td>Fund</td><td>Weekly</td><td>$0.1419</td></tr></table>'
        ).encode()
        document = SourceDocument(
            'yieldmax', 'https://yieldmaxetfs.com/news/group-3-release/',
            'official_press_release', content, fetched_at='2026-10-26T15:00:00+00:00',
        )
        with self.assertRaisesRegex(ValueError, 'publication date'):
            YieldMaxAdapter().parse(document)

    def test_targeted_fund_history_never_infers_declaration_from_fetch_time(self):
        content = Path('tests/content_pipeline/fixtures/yieldmax_release.html').read_bytes()
        document = SourceDocument('yieldmax', 'https://yieldmaxetfs.com/our-etfs/tsly/', 'official_fund_history', content, metadata={'ticker': 'TSLY'})
        with self.assertRaises(ValueError):
            YieldMaxAdapter().parse(document)

    def test_legacy_roundhill_state_is_compatible_and_provider_state_is_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'observations.json'
            path.write_text(json.dumps({'schemaVersion': 1, 'cycles': {}}))
            state = schedule_roundhill.read_state(path)
            schedule_roundhill.write_state(path, state)
            self.assertEqual(json.loads(path.read_text())['provider'], 'roundhill')
            with self.assertRaisesRegex(ValueError, 'another provider'):
                runner.read_state(path)


class YieldMaxObservationFlowTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = ContentDatabase(self.root/'ledger.sqlite')
        self.database.initialize()
        self.public = self.root/'public'
        self.state = self.root/'generated/yieldmax-observations.json'
        self.events = {}
        self.release_events = {}
        self.release_fallback = False
        self.requests = []
        self.commands = []

    def bridge(self, command, **kwargs):
        self.commands.append(command)
        entry = refresh.main if command[1].endswith('refresh.py') else collect.main
        with patch('sys.argv', command[1:]), redirect_stdout(io.StringIO()) as output:
            code = entry()
        return subprocess.CompletedProcess(command, code, output.getvalue(), '')

    def fetch(self, candidates):
        results = []
        for candidate in candidates:
            self.requests.append(candidate)
            if candidate.source_type == 'official_press_release':
                rows = ''.join(
                    '<tr><td>' + ticker + '</td><td>YieldMax fund</td><td>Weekly</td><td>
    def run_request(self, request, now):
        release_candidates = [SourceCandidate(
            'https://yieldmaxetfs.com/news/group-3-distribution-release/',
            'official_press_release',
            metadata={'tickers': sorted(self.release_events), 'group': 'group-3'},
        )] if self.release_fallback else []
        with patch.object(runner, 'run_refresh', side_effect=self.bridge), patch.object(refresh.subprocess, 'run', side_effect=self.bridge), patch.object(YieldMaxAdapter, 'fetch_many', side_effect=self.fetch), patch.object(YieldMaxAdapter, 'discover') as discover, patch.object(YieldMaxAdapter, 'discover_announcements_for_tickers', return_value=release_candidates), patch('scripts.content_pipeline.reconcile_public_data.run_new_ticker_workflow') as onboard:
            result = runner.run_observations(request, ContentDatabase(self.database.path), now=now, state_path=self.state, raw_dir=self.root/'raw', public_dir=self.public, legacy_data_dir=self.root/'legacy')
        discover.assert_not_called()
        onboard.assert_not_called()
        return result

    def primary(self, group):
        anchor = { 'group-3': '2026-10-26', 'group-1': '2026-10-27', 'group-2': '2026-10-28'}[group]
        now = instant(f'{anchor}T11:05:00')
        request = runner.request_for(cron=PRIMARY_CRONS[1], created_at=now, now=now)
        return self.run_request(request, now)

    def add_group(self, group, declared):
        d = date.fromisoformat(declared)
        for symbol in GROUPS[group]['tickers']:
            self.events[symbol] = [(declared, str(d+timedelta(days=1)), str(d+timedelta(days=2)))]

    def seed(self, ticker, declared):
        d = date.fromisoformat(declared)
        self.database.upsert_provider('yieldmax', 'YieldMax', 'https://yieldmaxetfs.com/')
        document = SourceDocument('yieldmax', f'https://yieldmaxetfs.com/our-etfs/{ticker.lower()}/', 'official_fund_history', b'fixture')
        source_id = self.database.add_source_document(document)
        self.database.upsert_distribution_event(DistributionEvent('yieldmax', ticker, '0.123456', declared, str(d+timedelta(days=1)), document.source_url, record_date=str(d+timedelta(days=1)), payable_date=str(d+timedelta(days=2)), verification_status='official'), source_id)
        export_all(self.database.path, self.root/'generated', self.public)

    def test_official_news_release_fills_stale_group_three_fund_history(self):
        self.release_fallback = True
        self.release_events = {'MSST': '0.1419', 'NVIT': '0.2302', 'TEST': '0.1807'}
        report, code = self.primary('group-3')
        self.assertEqual((report['status'], report['publish'], code), ('collected', True, 0), report)
        self.assertTrue(any(candidate.source_type == 'official_press_release' for candidate in self.requests))
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT ticker, distribution_per_share, declared_date, ex_date, payable_date "
                "FROM distribution_events WHERE provider_slug='yieldmax' ORDER BY ticker"
            ).fetchall()
        self.assertEqual(
            [(row['ticker'], row['distribution_per_share'], row['declared_date'], row['ex_date'], row['payable_date']) for row in rows],
            [('MSST', '0.1419', '2026-10-26', '2026-10-27', '2026-10-28'),
             ('NVIT', '0.2302', '2026-10-26', '2026-10-27', '2026-10-28'),
             ('TEST', '0.1807', '2026-10-26', '2026-10-27', '2026-10-28')],
        )

    def test_each_group_fetches_only_its_fund_pages_once_then_skips(self):
        for group, declared in (('group-3', '2026-10-26'), ('group-1', '2026-10-27'), ('group-2', '2026-10-28')):
            with self.subTest(group=group):
                self.add_group(group, declared)
                self.requests.clear()
                report, code = self.primary(group)
                self.assertEqual((report['status'], report['publish'], code), ('collected', True, 0), report)
                self.assertEqual(len(self.requests), len(GROUPS[group]['tickers']))
                self.assertEqual({r.metadata['ticker'] for r in self.requests}, set(GROUPS[group]['tickers']))
                self.assertTrue(all(len(row['tickers']) <= 6 for row in report['cycles']))
                self.requests.clear()
                again, code = self.primary(group)
                self.assertEqual((again['status'], again['attempted'], code), ('already_collected', False, 0))
                self.assertEqual(self.requests, [])

    def test_partial_failure_publishes_received_facts_and_retries_only_missing(self):
        self.add_group('group-1', '2026-10-27')
        self.failed_ticker = 'CHPY'
        first, code = self.primary('group-1')
        self.assertTrue(first['publish'])
        self.assertEqual(runner.read_state(self.state)['cycles']['group-1:2026-10-27']['missingTickers'], ['CHPY'])
        self.failed_ticker = None
        self.requests.clear()
        second, code = self.primary('group-1')
        self.assertEqual(code, 0, second)
        self.assertEqual([c.metadata['ticker'] for c in self.requests], ['CHPY'])
        with self.database.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM distribution_events WHERE provider_slug='yieldmax'").fetchone()[0], 12)

    def test_multiple_declaration_dates_use_one_history_per_missing_ticker(self):
        self.add_group('group-3', '2026-10-27')
        self.primary('group-3')  # Monday's poll must not accept a later declaration.
        self.requests.clear()
        now = instant('2026-10-27T00:37:00')
        request = runner.request_for(group='group-3', now=now)
        report, code = self.run_request(request, now)
        self.assertEqual((report['publish'], code), (True, 0), report)
        self.assertEqual(len(self.requests), 3)
        self.assertGreater(len(report['cycles'][0]['queriedDates']), 1)
        cycle = runner.read_state(self.state)['cycles']['group-3:2026-10-26']
        self.assertEqual(set(cycle['matchedDeclarationDates'].values()), {'2026-10-27'})

    def test_prior_week_history_and_out_of_window_dates_never_complete_current_cycle(self):
        self.add_group('group-3', '2026-10-19')
        report, code = self.primary('group-3')
        self.assertEqual((report['status'], report['publish'], code), ('pending', False, 0), report)
        with self.database.connect() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM distribution_events').fetchone()[0], 0)

    def test_another_providers_fact_cannot_complete_yieldmax(self):
        self.database.upsert_provider('roundhill', 'Roundhill', 'https://www.roundhillinvestments.com/')
        document = SourceDocument('roundhill', 'https://www.roundhillinvestments.com/', 'fixture', b'fixture')
        source = self.database.add_source_document(document)
        self.database.upsert_distribution_event(DistributionEvent('roundhill', 'MSST', '0.1', '2026-10-26', '2026-10-27', document.source_url, record_date='2026-10-27', payable_date='2026-10-28', verification_status='official'), source)
        export_all(self.database.path, self.root/'generated', self.public)
        report, code = self.primary('group-3')
        self.assertEqual(code, 0, report)
        self.assertEqual(runner.read_state(self.state)['cycles']['group-3:2026-10-26']['missingTickers'], ['MSST', 'NVIT', 'TEST'])

    def test_holiday_early_publication_keeps_actual_dates(self):
        for symbol in GROUPS['group-3']['tickers']:
            self.seed(symbol, '2026-05-18')
            self.events[symbol] = [('2026-05-22', '2026-05-26', '2026-05-27')]
        now = instant('2026-05-22T14:37:00')
        report, code = self.run_request(runner.request_for(group='group-3', now=now), now)
        self.assertEqual(code, 0, report)
        self.assertEqual(set(runner.read_state(self.state)['cycles']['group-3:2026-05-25']['matchedDeclarationDates'].values()), {'2026-05-22'})
        payload = json.loads((self.public/'distribution-ticker-msst.json').read_text())
        latest = payload['history'][0]
        self.assertEqual((latest['declared_date'], latest['ex_date'], latest['payable_date']), ('2026-05-22', '2026-05-26', '2026-05-27'))

    def test_missing_cycles_are_retained_and_newer_week_cannot_fill_older_week(self):
        self.primary('group-3')
        self.add_group('group-3', '2026-11-02')
        now = instant('2026-11-03T00:37:00')
        report, code = self.run_request(runner.request_for(group='group-3', now=now), now)
        state = runner.read_state(self.state)
        self.assertEqual(state['provider'], 'yieldmax')
        self.assertEqual(state['cycles']['group-3:2026-10-26']['status'], 'overdue')
        self.assertEqual(state['cycles']['group-3:2026-10-26']['matchedDeclarationDates'], {})
        self.assertEqual(state['cycles']['group-3:2026-11-02']['status'], 'collected')
        self.assertEqual(code, 1)
        with self.assertRaisesRegex(ValueError, 'another provider'):
            schedule_roundhill.read_state(self.state)

    def test_batch_budget_leaves_unattempted_tickers_for_next_run(self):
        self.add_group('group-2', '2026-10-28')
        with patch.dict(POLICY, {'maxBatchesPerRun': 1}):
            self.primary('group-2')
            first = {r.metadata['ticker'] for r in self.requests}
            self.requests.clear()
            self.primary('group-2')
        second = {r.metadata['ticker'] for r in self.requests}
        self.assertEqual((len(first), len(second)), (6, 6))
        self.assertFalse(first & second)
        self.assertEqual(len(runner.read_state(self.state)['cycles']['group-2:2026-10-28']['missingTickers']), 32)

    def test_process_failure_keeps_cycle_and_does_not_mark_missing_as_complete(self):
        now = instant('2026-10-28T11:05:00')
        request = runner.request_for(cron=PRIMARY_CRONS[1], created_at=now, now=now)
        with patch.object(runner, 'run_refresh', side_effect=subprocess.TimeoutExpired('refresh', 180)):
            report, code = runner.run_observations(request, self.database, now=now, state_path=self.state, raw_dir=self.root/'raw', public_dir=self.public, legacy_data_dir=self.root/'legacy')
        self.assertEqual((report['status'], report['stateChanged'], code), ('failed', True, 1))
        self.assertEqual(len(report['cycles']), 1)
        self.assertEqual(len(runner.read_state(self.state)['cycles']['group-2:2026-10-28']['missingTickers']), 44)

    def test_yskh_is_not_overdue_before_its_first_official_announcement_date(self):
        self.assertNotIn('YSKH', eligible_tickers('group-2', date(2026, 10, 29)))
        self.assertIn('YSKH', eligible_tickers('group-2', date(2026, 11, 11)))
        self.add_group('group-2', '2026-10-28')
        now = instant('2026-10-29T00:37:00')
        request = runner.request_for(group='group-2', now=now)
        report, code = self.run_request(request, now)
        cycle = runner.read_state(self.state)['cycles']['group-2:2026-10-28']
        self.assertEqual((cycle['status'], cycle['missingTickers'], code), ('collected', [], 0), report)
        self.assertNotIn('YSKH', cycle['matchedDeclarationDates'])

    def test_read_only_smoke_reads_existing_facts_without_collecting_or_saving(self):
        for symbol in GROUPS['group-3']['tickers']:
            self.seed(symbol, '2026-10-19')
        before = self.database.path.read_bytes()
        args = ['schedule_yieldmax.py', '--dry-run', '--group', 'group-3', '--declaration-date', '2026-10-19',
                '--db', str(self.database.path), '--state', str(self.state), '--public-dir', str(self.public),
                '--report', str(self.root/'smoke.json')]
        with patch('sys.argv', args), patch.object(runner, 'run_refresh') as run, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(runner.main(), 0)
        run.assert_not_called()
        report = json.loads(output.getvalue())
        self.assertTrue(report['stateAccessible'])
        self.assertEqual(report['checks'][0]['verifiedTickerCount'], 3)
        self.assertEqual((report['attempted'], report['publish'], report['stateChanged']), (False, False, False))
        self.assertFalse(self.state.exists())
        self.assertEqual(self.database.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
 + amount +
                    '</td><td>25.00%</td><td>0.00%</td></tr>'
                    for ticker, amount in self.release_events.items()
                )
                content = (
                    '<meta property="article:published_time" content="2026-10-26T10:55:00-04:00">'
                    '<p>Group 3 Distribution Announcement: Ex. &amp; Record Date: October 27, 2026 '
                    'Payment Date: October 28, 2026</p>'
                    '<table><tr><th>ETF Ticker</th><th>ETF Name</th><th>Distribution Frequency</th>'
                    '<th>Distribution per Share</th><th>Distribution Rate</th><th>30-Day SEC Yield</th></tr>'
                    + rows + '</table>'
                ).encode()
                results.append(FetchOutcome(candidate, SourceDocument(
                    'yieldmax', candidate.url, candidate.source_type, content, metadata=candidate.metadata)))
                continue
            ticker = candidate.metadata['ticker']
            if ticker == getattr(self, 'failed_ticker', None):
                results.append(FetchOutcome(candidate, error=CollectionError('fixture unavailable')))
                continue
            rows = ''
            for declared, ex_date, payable in self.events.get(ticker, []):
                rows += f'<tr><td>$0.123456</td><td>{declared}</td><td>{ex_date}</td><td>{ex_date}</td><td>{payable}</td><td>0.00%</td></tr>'
            content = f'<h1>{ticker}</h1><table><tr><th>Distribution per Share</th><th>Declared Date</th><th>Ex Date</th><th>Record Date</th><th>Payable Date</th><th>ROC</th></tr>{rows}</table>'.encode()
            results.append(FetchOutcome(candidate, SourceDocument('yieldmax', candidate.url, candidate.source_type, content, metadata=candidate.metadata)))
        return results

    def run_request(self, request, now):
        with patch.object(runner, 'run_refresh', side_effect=self.bridge), patch.object(refresh.subprocess, 'run', side_effect=self.bridge), patch.object(YieldMaxAdapter, 'fetch_many', side_effect=self.fetch), patch.object(YieldMaxAdapter, 'discover') as discover, patch('scripts.content_pipeline.reconcile_public_data.run_new_ticker_workflow') as onboard:
            result = runner.run_observations(request, ContentDatabase(self.database.path), now=now, state_path=self.state, raw_dir=self.root/'raw', public_dir=self.public, legacy_data_dir=self.root/'legacy')
        discover.assert_not_called()
        onboard.assert_not_called()
        return result

    def primary(self, group):
        anchor = { 'group-3': '2026-10-26', 'group-1': '2026-10-27', 'group-2': '2026-10-28'}[group]
        now = instant(f'{anchor}T11:05:00')
        request = runner.request_for(cron=PRIMARY_CRONS[1], created_at=now, now=now)
        return self.run_request(request, now)

    def add_group(self, group, declared):
        d = date.fromisoformat(declared)
        for symbol in GROUPS[group]['tickers']:
            self.events[symbol] = [(declared, str(d+timedelta(days=1)), str(d+timedelta(days=2)))]

    def seed(self, ticker, declared):
        d = date.fromisoformat(declared)
        self.database.upsert_provider('yieldmax', 'YieldMax', 'https://yieldmaxetfs.com/')
        document = SourceDocument('yieldmax', f'https://yieldmaxetfs.com/our-etfs/{ticker.lower()}/', 'official_fund_history', b'fixture')
        source_id = self.database.add_source_document(document)
        self.database.upsert_distribution_event(DistributionEvent('yieldmax', ticker, '0.123456', declared, str(d+timedelta(days=1)), document.source_url, record_date=str(d+timedelta(days=1)), payable_date=str(d+timedelta(days=2)), verification_status='official'), source_id)
        export_all(self.database.path, self.root/'generated', self.public)

    def test_each_group_fetches_only_its_fund_pages_once_then_skips(self):
        for group, declared in (('group-3', '2026-10-26'), ('group-1', '2026-10-27'), ('group-2', '2026-10-28')):
            with self.subTest(group=group):
                self.add_group(group, declared)
                self.requests.clear()
                report, code = self.primary(group)
                self.assertEqual((report['status'], report['publish'], code), ('collected', True, 0), report)
                self.assertEqual(len(self.requests), len(GROUPS[group]['tickers']))
                self.assertEqual({r.metadata['ticker'] for r in self.requests}, set(GROUPS[group]['tickers']))
                self.assertTrue(all(len(row['tickers']) <= 6 for row in report['cycles']))
                self.requests.clear()
                again, code = self.primary(group)
                self.assertEqual((again['status'], again['attempted'], code), ('already_collected', False, 0))
                self.assertEqual(self.requests, [])

    def test_partial_failure_publishes_received_facts_and_retries_only_missing(self):
        self.add_group('group-1', '2026-10-27')
        self.failed_ticker = 'CHPY'
        first, code = self.primary('group-1')
        self.assertTrue(first['publish'])
        self.assertEqual(runner.read_state(self.state)['cycles']['group-1:2026-10-27']['missingTickers'], ['CHPY'])
        self.failed_ticker = None
        self.requests.clear()
        second, code = self.primary('group-1')
        self.assertEqual(code, 0, second)
        self.assertEqual([c.metadata['ticker'] for c in self.requests], ['CHPY'])
        with self.database.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM distribution_events WHERE provider_slug='yieldmax'").fetchone()[0], 12)

    def test_multiple_declaration_dates_use_one_history_per_missing_ticker(self):
        self.add_group('group-3', '2026-10-27')
        self.primary('group-3')  # Monday's poll must not accept a later declaration.
        self.requests.clear()
        now = instant('2026-10-27T00:37:00')
        request = runner.request_for(group='group-3', now=now)
        report, code = self.run_request(request, now)
        self.assertEqual((report['publish'], code), (True, 0), report)
        self.assertEqual(len(self.requests), 3)
        self.assertGreater(len(report['cycles'][0]['queriedDates']), 1)
        cycle = runner.read_state(self.state)['cycles']['group-3:2026-10-26']
        self.assertEqual(set(cycle['matchedDeclarationDates'].values()), {'2026-10-27'})

    def test_prior_week_history_and_out_of_window_dates_never_complete_current_cycle(self):
        self.add_group('group-3', '2026-10-19')
        report, code = self.primary('group-3')
        self.assertEqual((report['status'], report['publish'], code), ('pending', False, 0), report)
        with self.database.connect() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM distribution_events').fetchone()[0], 0)

    def test_another_providers_fact_cannot_complete_yieldmax(self):
        self.database.upsert_provider('roundhill', 'Roundhill', 'https://www.roundhillinvestments.com/')
        document = SourceDocument('roundhill', 'https://www.roundhillinvestments.com/', 'fixture', b'fixture')
        source = self.database.add_source_document(document)
        self.database.upsert_distribution_event(DistributionEvent('roundhill', 'MSST', '0.1', '2026-10-26', '2026-10-27', document.source_url, record_date='2026-10-27', payable_date='2026-10-28', verification_status='official'), source)
        export_all(self.database.path, self.root/'generated', self.public)
        report, code = self.primary('group-3')
        self.assertEqual(code, 0, report)
        self.assertEqual(runner.read_state(self.state)['cycles']['group-3:2026-10-26']['missingTickers'], ['MSST', 'NVIT', 'TEST'])

    def test_holiday_early_publication_keeps_actual_dates(self):
        for symbol in GROUPS['group-3']['tickers']:
            self.seed(symbol, '2026-05-18')
            self.events[symbol] = [('2026-05-22', '2026-05-26', '2026-05-27')]
        now = instant('2026-05-22T14:37:00')
        report, code = self.run_request(runner.request_for(group='group-3', now=now), now)
        self.assertEqual(code, 0, report)
        self.assertEqual(set(runner.read_state(self.state)['cycles']['group-3:2026-05-25']['matchedDeclarationDates'].values()), {'2026-05-22'})
        payload = json.loads((self.public/'distribution-ticker-msst.json').read_text())
        latest = payload['history'][0]
        self.assertEqual((latest['declared_date'], latest['ex_date'], latest['payable_date']), ('2026-05-22', '2026-05-26', '2026-05-27'))

    def test_missing_cycles_are_retained_and_newer_week_cannot_fill_older_week(self):
        self.primary('group-3')
        self.add_group('group-3', '2026-11-02')
        now = instant('2026-11-03T00:37:00')
        report, code = self.run_request(runner.request_for(group='group-3', now=now), now)
        state = runner.read_state(self.state)
        self.assertEqual(state['provider'], 'yieldmax')
        self.assertEqual(state['cycles']['group-3:2026-10-26']['status'], 'overdue')
        self.assertEqual(state['cycles']['group-3:2026-10-26']['matchedDeclarationDates'], {})
        self.assertEqual(state['cycles']['group-3:2026-11-02']['status'], 'collected')
        self.assertEqual(code, 1)
        with self.assertRaisesRegex(ValueError, 'another provider'):
            schedule_roundhill.read_state(self.state)

    def test_batch_budget_leaves_unattempted_tickers_for_next_run(self):
        self.add_group('group-2', '2026-10-28')
        with patch.dict(POLICY, {'maxBatchesPerRun': 1}):
            self.primary('group-2')
            first = {r.metadata['ticker'] for r in self.requests}
            self.requests.clear()
            self.primary('group-2')
        second = {r.metadata['ticker'] for r in self.requests}
        self.assertEqual((len(first), len(second)), (6, 6))
        self.assertFalse(first & second)
        self.assertEqual(len(runner.read_state(self.state)['cycles']['group-2:2026-10-28']['missingTickers']), 32)

    def test_process_failure_keeps_cycle_and_does_not_mark_missing_as_complete(self):
        now = instant('2026-10-28T11:05:00')
        request = runner.request_for(cron=PRIMARY_CRONS[1], created_at=now, now=now)
        with patch.object(runner, 'run_refresh', side_effect=subprocess.TimeoutExpired('refresh', 180)):
            report, code = runner.run_observations(request, self.database, now=now, state_path=self.state, raw_dir=self.root/'raw', public_dir=self.public, legacy_data_dir=self.root/'legacy')
        self.assertEqual((report['status'], report['stateChanged'], code), ('failed', True, 1))
        self.assertEqual(len(report['cycles']), 1)
        self.assertEqual(len(runner.read_state(self.state)['cycles']['group-2:2026-10-28']['missingTickers']), 44)

    def test_read_only_smoke_reads_existing_facts_without_collecting_or_saving(self):
        for symbol in GROUPS['group-3']['tickers']:
            self.seed(symbol, '2026-10-19')
        before = self.database.path.read_bytes()
        args = ['schedule_yieldmax.py', '--dry-run', '--group', 'group-3', '--declaration-date', '2026-10-19',
                '--db', str(self.database.path), '--state', str(self.state), '--public-dir', str(self.public),
                '--report', str(self.root/'smoke.json')]
        with patch('sys.argv', args), patch.object(runner, 'run_refresh') as run, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(runner.main(), 0)
        run.assert_not_called()
        report = json.loads(output.getvalue())
        self.assertTrue(report['stateAccessible'])
        self.assertEqual(report['checks'][0]['verifiedTickerCount'], 3)
        self.assertEqual((report['attempted'], report['publish'], report['stateChanged']), (False, False, False))
        self.assertFalse(self.state.exists())
        self.assertEqual(self.database.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
