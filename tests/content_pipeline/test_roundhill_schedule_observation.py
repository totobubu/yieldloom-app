import io
import json
import re
import signal
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

from scripts.content_pipeline import collect, refresh, schedule_roundhill as runner
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome
from scripts.content_pipeline.providers.roundhill import RoundhillAdapter
from scripts.content_pipeline.roundhill_schedule import (
    DAILY_CRONS, TOPW_CRONS, RECOVERY_CRON, GROUPS, POLICY, business_days_since,
    candidate_dates, completed_business_days_since, select_primary, us_business_day,
)


def instant(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class RoundhillSchedulePolicyTest(unittest.TestCase):
    def test_scheduled_group_survives_queue_delay_across_midnight_and_rerun(self):
        for now in (instant('2026-10-21T01:00:00'), instant('2026-11-30T00:00:00')):
            request = runner.request_for(cron=DAILY_CRONS[1], created_at=instant('2026-10-20T11:05:00'), now=now)
            self.assertEqual((request['group'], request['anchor']), ('crypto', '2026-10-20'))
        delayed_scheduler = runner.request_for(cron=DAILY_CRONS[1], created_at=instant('2026-10-21T01:04:00'), now=now)
        self.assertEqual(delayed_scheduler['anchor'], '2026-10-20')
        with self.assertRaisesRegex(ValueError, 'unknown'):
            runner.request_for(cron='* * * * *', created_at=now, now=now)

    def test_dst_keeps_kst_baseline_and_adds_winter_hour_without_collecting_extra_groups(self):
        self.assertIsNone(select_primary(DAILY_CRONS[3], instant('2026-10-27T12:05:00')))
        self.assertEqual(select_primary(DAILY_CRONS[3], instant('2026-11-03T12:05:00')), ('crypto', date(2026, 11, 3)))
        self.assertEqual(select_primary(DAILY_CRONS[1], instant('2026-11-03T11:05:00')), ('crypto', date(2026, 11, 3)))
        self.assertEqual(select_primary(TOPW_CRONS[-1], instant('2026-11-02T15:00:00')), ('topw', date(2026, 11, 2)))
        # Korean Lunar New Year does not suppress the US fund's Tuesday poll.
        self.assertEqual(select_primary(DAILY_CRONS[1], instant('2026-02-17T11:05:00')), ('crypto', date(2026, 2, 17)))

    def test_us_exchange_closures_are_not_bank_holidays_or_polling_blackouts(self):
        for closed in ('2026-04-03', '2026-06-19', '2026-11-26', '2026-12-25', '2025-01-09'):
            self.assertFalse(us_business_day(date.fromisoformat(closed)), closed)
        for opened in ('2021-12-31', '2026-10-12', '2026-11-11', '2026-11-27'):
            self.assertTrue(us_business_day(date.fromisoformat(opened)), opened)
        anchor = date(2026, 11, 26)
        self.assertEqual(business_days_since(anchor, date(2026, 11, 29)), 1)
        self.assertEqual(business_days_since(anchor, date(2026, 11, 30)), 2)
        self.assertEqual(completed_business_days_since(anchor, instant('2026-11-27T00:17:00')), 0)
        self.assertEqual(completed_business_days_since(anchor, instant('2026-11-30T23:17:00')), 2)
        dates = candidate_dates(date(2026, 5, 25), date(2026, 5, 26))
        self.assertIn(date(2026, 5, 22), dates)  # Friday before Memorial Day Monday.
        self.assertIn(date(2026, 5, 25), dates)  # Still accept issuer publication on a closure.
        self.assertIn(date(2026, 5, 24), dates)  # Weekend publication remains eligible.
        self.assertNotIn(date(2026, 5, 27), dates)  # Never query a future declaration date.

    def test_weekly_windows_cannot_complete_two_weeks_with_one_notice(self):
        anchor = date(2026, 12, 25)
        self.assertLess(POLICY['earlyDays'] + POLICY['lateDays'], 7)
        self.assertFalse(set(candidate_dates(anchor, date(2027, 1, 9))) & set(candidate_dates(anchor + timedelta(days=7), date(2027, 1, 9))))

    def test_workflow_covers_all_slots_and_persists_queue_inside_existing_lock(self):
        workflow = Path('.github/workflows/observe-roundhill.yml').read_text()
        crons = re.findall(r"cron: '([^']+)'", workflow)
        self.assertEqual(set(crons), {*DAILY_CRONS, *TOPW_CRONS, RECOVERY_CRON})
        self.assertEqual(len(list(Path('.github/workflows').glob('observe-roundhill*.yml'))), 1)
        self.assertIn('group: content-studio-state-write', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertIn("needs.plan.outputs.enabled == 'true'", workflow)
        self.assertIn('steps.observation.outputs.stateChanged', workflow)
        self.assertEqual(runner.DEFAULT_STATE.parent, Path('var/content-studio/generated'))

    def test_explicit_shifted_date_is_allowed_without_overwriting_the_nominal_cycle_date(self):
        request = runner.request_for(group='topw', declared=date(2026, 10, 30), cycle=date(2026, 10, 26), now=instant('2026-11-01T00:00:00'))
        self.assertEqual((request['anchor'], request['declarationDate']), ('2026-10-26', '2026-10-30'))
        with self.assertRaisesRegex(ValueError, 'future'):
            runner.request_for(group='crypto', declared=date(2027, 1, 1), now=instant('2026-10-20T00:00:00'))
        with self.assertRaisesRegex(ValueError, 'specific group'):
            runner.request_for(declared=date(2026, 10, 20), now=instant('2026-10-20T00:00:00'))


class RoundhillRecoveryFlowTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = ContentDatabase(self.root / 'ledger.sqlite')
        self.database.initialize()
        self.state = self.root / 'generated/roundhill-observations.json'
        self.public = self.root / 'public'
        self.events = {}  # ticker -> actual official dates/amount
        self.requests = []

    def bridge(self, command, **kwargs):
        entrypoint = refresh.main if command[1].endswith('refresh.py') else collect.main
        with patch('sys.argv', command[1:]), redirect_stdout(io.StringIO()) as output:
            code = entrypoint()
        return subprocess.CompletedProcess(command, code, output.getvalue(), '')

    def fetch(self, candidates):
        outcomes = []
        for candidate in candidates:
            self.requests.append(candidate)
            if candidate.source_type.endswith('_json'):
                event = self.events.get(candidate.metadata['issuerTicker'])
                rows = [] if event is None else [[f'{day} 00:00:00' for day in event[:4]] + [event[4]]]
                content = json.dumps(rows).encode()
            else:
                # Cboe is deliberately behind the issuer for these scenarios.
                content = b'<table><tr><th>Symbol</th><th>Name</th><th>Ex-Date</th><th>Record Date</th><th>Payable Date</th><th>Distribution Amount</th><th>Frequency</th></tr></table>'
            outcomes.append(FetchOutcome(candidate, SourceDocument('roundhill', candidate.url, candidate.source_type, content, metadata=candidate.metadata)))
        return outcomes

    def run_request(self, request, now):
        with patch.object(runner, 'run_refresh', side_effect=self.bridge), patch.object(refresh.subprocess, 'run', side_effect=self.bridge), patch.object(RoundhillAdapter, 'fetch_many', side_effect=self.fetch), patch('scripts.content_pipeline.reconcile_public_data.run_new_ticker_workflow') as onboard:
            result = runner.run_observations(request, ContentDatabase(self.database.path), now=now, state_path=self.state,
                raw_dir=self.root / 'raw', public_dir=self.public, legacy_data_dir=self.root / 'legacy')
        onboard.assert_not_called()
        return result

    def recovery(self, group, now):
        return self.run_request(runner.request_for(group=group, now=now), now)

    def seed(self, ticker, declared, ex_date, payable):
        self.database.upsert_provider('roundhill', 'Roundhill', 'https://www.roundhillinvestments.com/')
        document = SourceDocument('roundhill', 'https://www.roundhillinvestments.com/etf/topw/', 'official', b'fixture')
        source_id = self.database.add_source_document(document)
        self.database.upsert_distribution_event(DistributionEvent('roundhill', ticker, '0.123456', declared, ex_date,
            document.source_url, record_date=ex_date, payable_date=payable, verification_status='official'), source_id)
        export_all(self.database.path, self.root / 'generated', self.public)

    def test_next_day_shift_is_collected_with_actual_dates_then_stops_all_http(self):
        now = instant('2026-10-20T11:00:00')
        request = runner.request_for(cron=DAILY_CRONS[1], created_at=now, now=now)
        first, code = self.run_request(request, now)
        self.assertEqual((first['status'], first['publish'], code), ('pending', False, 0))
        for ticker in ('YBTC', 'YETH'):
            self.events[ticker] = ('2026-10-21', '2026-10-23', '2026-10-23', '2026-10-27', 0.123456)
        self.requests.clear()
        second, code = self.recovery('crypto', instant('2026-10-21T14:17:00'))
        self.assertEqual((second['status'], second['publish'], code), ('collected', True, 0), second)
        self.assertEqual(second['cycles'][0]['matchedDeclarationDates'], {'YBTC': '2026-10-21', 'YETH': '2026-10-21'})
        # A range is one batch: issuer history is fetched once per missing ticker.
        self.assertEqual([c.metadata['issuerTicker'] for c in self.requests if c.source_type.endswith('_json')], ['YBTC', 'YETH'])
        with self.database.connect() as connection:
            rows = connection.execute('SELECT declared_date,ex_date,payable_date,distribution_per_share FROM distribution_events').fetchall()
        self.assertEqual([tuple(row) for row in rows], [('2026-10-21', '2026-10-23', '2026-10-27', '0.123456')] * 2)
        self.requests.clear()
        third, code = self.recovery('crypto', instant('2026-10-21T15:17:00'))
        self.assertEqual((third['attempted'], third['publish'], code), (False, False, 0))
        self.assertEqual(self.requests, [])

    def test_friday_early_notice_for_monday_us_holiday_is_observed_before_monday(self):
        self.seed('TOPW', '2026-05-18', '2026-05-19', '2026-05-20')
        self.events['TOPW'] = ('2026-05-22', '2026-05-26', '2026-05-26', '2026-05-27', 0.4)
        report, _ = self.recovery('topw', instant('2026-05-22T14:17:00'))
        queue = runner.read_state(self.state)['cycles']
        self.assertEqual(queue['topw:2026-05-25']['status'], 'collected', report)
        self.assertEqual(queue['topw:2026-05-25']['matchedDeclarationDates'], {'TOPW': '2026-05-22'})
        self.assertTrue(report['publish'])

    def test_thanksgiving_early_notice_keeps_official_early_close_day_ex_date(self):
        self.seed('MAGY', '2026-11-19', '2026-11-20', '2026-11-23')
        self.events['MAGY'] = ('2026-11-25', '2026-11-27', '2026-11-27', '2026-11-30', 0.35)
        report, _ = self.recovery('magy', instant('2026-11-25T14:17:00'))
        self.assertEqual(runner.read_state(self.state)['cycles']['magy:2026-11-26']['matchedDeclarationDates'], {'MAGY': '2026-11-25'}, report)
        with self.database.connect() as connection:
            row = connection.execute("SELECT ex_date,payable_date FROM distribution_events WHERE declared_date='2026-11-25'").fetchone()
        self.assertEqual(tuple(row), ('2026-11-27', '2026-11-30'))

    def test_partial_group_retries_only_missing_ticker_and_survives_new_process(self):
        self.events['YBTC'] = ('2026-10-20', '2026-10-22', '2026-10-22', '2026-10-23', 0.2)
        first, code = self.recovery('crypto', instant('2026-10-21T00:17:00'))
        self.assertTrue(first['publish'])
        self.assertEqual(runner.read_state(self.state)['cycles']['crypto:2026-10-20']['missingTickers'], ['YETH'])
        self.requests.clear()
        self.events['YETH'] = self.events['YBTC']
        second, code = self.recovery('crypto', instant('2026-10-21T03:17:00'))
        self.assertEqual(code, 0, second)
        self.assertEqual({c.metadata['issuerTicker'] for c in self.requests if c.source_type.endswith('_json')}, {'YETH'})
        self.assertTrue(all(parse_qs(urlparse(c.url).query)['symbols'] == ['YETH'] for c in self.requests if not c.source_type.endswith('_json')))

    def test_missing_cycle_rolls_into_next_week_without_accepting_newer_week_as_completion(self):
        self.recovery('crypto', instant('2026-10-21T00:17:00'))
        for ticker in ('YBTC', 'YETH'):
            self.seed(ticker, '2026-10-27', '2026-10-28', '2026-10-29')
            self.events[ticker] = ('2026-10-27', '2026-10-28', '2026-10-28', '2026-10-29', 0.2)
        report, code = self.recovery('crypto', instant('2026-10-28T00:17:00'))
        queue = runner.read_state(self.state)['cycles']
        self.assertEqual(code, 1)
        self.assertEqual(queue['crypto:2026-10-20']['status'], 'overdue')
        self.assertEqual(queue['crypto:2026-10-20']['matchedDeclarationDates'], {})
        self.assertEqual(queue['crypto:2026-10-27']['status'], 'collected')
        self.assertIn('2026-10-23', report['cycles'][0]['queriedDates'])
        self.assertNotIn('2026-10-27', report['cycles'][0]['queriedDates'])

    def test_far_shift_requires_explicit_official_date_and_nominal_cycle_mapping(self):
        self.events['TOPW'] = ('2026-10-30', '2026-11-02', '2026-11-02', '2026-11-03', 0.155646)
        now = instant('2026-10-31T00:17:00')
        request = runner.request_for(group='topw', declared=date(2026, 10, 30), cycle=date(2026, 10, 26), now=now)
        report, code = self.run_request(request, now)
        self.assertEqual((report['publish'], code), (True, 0), report)
        self.assertEqual(runner.read_state(self.state)['cycles']['topw:2026-10-26']['matchedDeclarationDates'], {'TOPW': '2026-10-30'})

    def test_long_delay_is_not_claimed_as_next_weeks_early_notice(self):
        self.recovery('topw', instant('2026-10-27T00:17:00'))
        self.events['TOPW'] = ('2026-10-30', '2026-11-02', '2026-11-02', '2026-11-03', 0.155646)
        report, code = self.recovery('topw', instant('2026-10-30T14:17:00'))
        queue = runner.read_state(self.state)['cycles']
        self.assertTrue(report['publish'])  # Publish the official fact even if its cycle is ambiguous.
        self.assertEqual((report['status'], code), ('needs_review', 1))
        self.assertEqual(queue['topw:2026-10-26']['status'], 'overdue')
        self.assertEqual(queue['topw:2026-11-02']['status'], 'needs_review')
        self.assertEqual(queue['topw:2026-11-02']['matchedDeclarationDates'], {})
        now = instant('2026-10-31T00:17:00')
        manual = runner.request_for(group='topw', declared=date(2026, 10, 30), cycle=date(2026, 10, 26), now=now)
        self.run_request(manual, now)
        self.recovery('topw', now)
        queue = runner.read_state(self.state)['cycles']
        self.assertEqual(queue['topw:2026-10-26']['status'], 'collected')
        self.assertEqual(queue['topw:2026-11-02']['status'], 'pending')
        self.assertEqual(queue['topw:2026-11-02']['matchedDeclarationDates'], {})
        self.events['TOPW'] = ('2026-11-02', '2026-11-03', '2026-11-03', '2026-11-04', 0.2)
        report, code = self.recovery('topw', instant('2026-11-02T14:17:00'))
        self.assertEqual(code, 0, report)
        self.assertEqual(runner.read_state(self.state)['cycles']['topw:2026-11-02']['matchedDeclarationDates'], {'TOPW': '2026-11-02'})

    def test_failure_and_timeout_keep_work_in_durable_queue(self):
        now = instant('2026-10-20T11:00:00')
        request = runner.request_for(cron=DAILY_CRONS[1], created_at=now, now=now)
        with patch.object(runner, 'run_refresh', side_effect=subprocess.TimeoutExpired('refresh', 180)):
            report, code = runner.run_observations(request, self.database, now=now, state_path=self.state,
                raw_dir=self.root/'raw', public_dir=self.public, legacy_data_dir=self.root/'legacy')
        self.assertEqual((report['status'], code), ('failed', 1))
        self.assertTrue(report['stateChanged'])
        self.assertEqual(runner.read_state(self.state)['cycles']['crypto:2026-10-20']['missingTickers'], ['YBTC', 'YETH'])

    def test_old_cycle_still_requires_exact_public_and_ledger_history_match(self):
        for day in (5, 12, 19, 26):
            declared = date(2026, 10, day)
            self.seed('TOPW', str(declared), str(declared + timedelta(days=1)), str(declared + timedelta(days=2)))
        cycle = {'group': 'topw', 'anchorDate': '2026-10-05'}
        self.assertEqual(runner._matches(self.database, cycle, date(2026, 10, 27), self.public), {'TOPW': '2026-10-05'})
        path = self.public / 'distribution-ticker-topw.json'
        payload = json.loads(path.read_text())
        self.assertEqual(len(payload['history']), 4)
        payload['history'][-1]['distribution_per_share'] = '999'
        path.write_text(json.dumps(payload))
        self.assertEqual(runner._matches(self.database, cycle, date(2026, 10, 27), self.public), {})

    def test_recovery_budget_rotates_old_pending_cycles_without_starvation(self):
        state = {'schemaVersion': 1, 'cycles': {}}
        for offset in range(9):
            runner._add_cycle(state, 'crypto', date(2026, 10, 27) - timedelta(days=offset * 7))
        runner.write_state(self.state, state)
        keys = []
        for now in (instant('2026-10-28T00:17:00'), instant('2026-10-28T03:17:00')):
            request = runner.request_for(group='crypto', now=now)
            with patch.object(runner, 'run_refresh', return_value=subprocess.CompletedProcess([], 0, '{}', '')):
                report, _ = runner.run_observations(request, self.database, now=now, state_path=self.state,
                    raw_dir=self.root/'raw', public_dir=self.public, legacy_data_dir=self.root/'legacy')
            self.assertLessEqual(len(report['cycles']), POLICY['maxCyclesPerRecovery'])
            keys.extend(row['anchorDate'] for row in report['cycles'])
        self.assertEqual(len(set(keys)), 9)

    def test_timeout_terminates_collector_descendants_before_returning(self):
        process = MagicMock()
        process.pid = 1234
        process.communicate.side_effect = [subprocess.TimeoutExpired('refresh', 180), subprocess.TimeoutExpired('refresh', 5), ('', '')]
        with patch.object(runner.subprocess, 'Popen') as popen, patch.object(runner.os, 'killpg') as kill:
            popen.return_value.__enter__.return_value = process
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.run_refresh(['python', 'refresh.py'])
        self.assertEqual(kill.call_args_list[0].args, (1234, signal.SIGTERM))
        self.assertEqual(kill.call_args_list[1].args, (1234, signal.SIGKILL))


if __name__ == '__main__':
    unittest.main()
