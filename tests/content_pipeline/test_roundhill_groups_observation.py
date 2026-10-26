import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from scripts.content_pipeline import collect, observe_roundhill, refresh
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome
from scripts.content_pipeline.providers.roundhill import ANNOUNCEMENT_GROUPS, RoundhillAdapter


DATES = {'crypto': date(2026, 10, 20), 'zero-dte': date(2026, 10, 21), 'weeklypay': date(2026, 10, 23)}


class RoundhillGroupsObservationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.db = ContentDatabase(self.root / 'ledger.sqlite')
        self.db.initialize()
        self.requests = []
        self.captured_commands = []

    def run_command(self, command, **kwargs):
        self.captured_commands.append(command)
        self.assertIn(command[1], ('scripts/content_pipeline/refresh.py', 'scripts/content_pipeline/collect.py'))
        entrypoint = refresh.main if command[1].endswith('refresh.py') else collect.main
        with patch('sys.argv', command[1:]), redirect_stdout(io.StringIO()) as output:
            code = entrypoint()
        return subprocess.CompletedProcess(command, code, output.getvalue(), '')

    def table(self, declared, symbols):
        ex_date, payable = declared + timedelta(days=1), declared + timedelta(days=3)
        rows = ''.join(f'<tr><td>{s}</td><td>Roundhill {s}</td><td>{ex_date}</td><td>{ex_date}</td><td>{payable}</td><td>$0.123456</td><td>Weekly</td></tr>' for s in symbols)
        return ('<table><tr><th>Symbol</th><th>Name</th><th>Ex-Date</th><th>Record Date</th><th>Payable Date</th><th>Distribution Amount</th><th>Frequency</th></tr>' + rows + '</table>').encode()

    def fetch(self, candidates):
        outcomes = []
        for candidate in candidates:
            self.requests.append(candidate)
            query = parse_qs(urlparse(candidate.url).query)
            if candidate.source_type.endswith('_json'):
                content = b'[]'
            else:
                declared = date.fromisoformat(query['declaration_dt'][0])
                symbols = query['symbols'][0].split(',')
                if hasattr(self, 'only_symbols'):
                    symbols = [s for s in symbols if s in self.only_symbols]
                if hasattr(self, 'only_date') and declared != self.only_date:
                    symbols = []
                # A shared source may include a ticker outside the requested group.
                content = self.table(declared, [*symbols, 'TOPW'])
            outcomes.append(FetchOutcome(candidate, SourceDocument('roundhill', candidate.url,
                candidate.source_type, content, metadata=candidate.metadata)))
        return outcomes

    def observe(self, group, require=False):
        with patch.object(observe_roundhill.subprocess, 'run', side_effect=self.run_command), patch.object(RoundhillAdapter, 'fetch_many', side_effect=self.fetch), patch('scripts.content_pipeline.reconcile_public_data.run_new_ticker_workflow') as onboard:
            result = observe_roundhill.observe_group(self.db, DATES[group], group=group,
                raw_dir=self.root / 'raw', public_dir=self.root / 'public',
                legacy_data_dir=self.root / 'legacy', require_announcement=require)
        onboard.assert_not_called()
        return result

    def test_config_matches_the_requested_weekdays_and_tickers(self):
        self.assertEqual(ANNOUNCEMENT_GROUPS['crypto'], (1, ('YBTC', 'YETH')))
        self.assertEqual(ANNOUNCEMENT_GROUPS['zero-dte'], (2, ('XDTE', 'QDTE', 'RDTE')))
        self.assertEqual(ANNOUNCEMENT_GROUPS['weeklypay'], (4, tuple('AAPW AMDW AMZW ARMW AVGW BABW BRKW COIW COSW GOOW HOOW METW MSFW NFLW NVDW PLTW TSLW UBEW UNHW GDXW GLDW TSYW'.split())))
        for group in DATES:
            weekday, symbols = ANNOUNCEMENT_GROUPS[group]
            self.assertTrue(set(symbols).issubset(RoundhillAdapter.tracked_symbols))
            recovery = DATES[group] + timedelta(days=1)
            self.assertEqual(observe_roundhill.announcement_date(datetime.fromisoformat(f'{recovery}T00:00:00+00:00'), symbols[0]), DATES[group])

    def test_crypto_group_collects_in_one_shared_request_then_stops(self):
        self.assert_complete_flow('crypto')

    def test_zero_dte_group_collects_in_one_shared_request_then_stops(self):
        self.assert_complete_flow('zero-dte')

    def test_all_22_weeklypay_tickers_collect_in_one_request_then_stop(self):
        self.assert_complete_flow('weeklypay')

    def assert_complete_flow(self, group):
        report, code = self.observe(group)
        targets = set(ANNOUNCEMENT_GROUPS[group][1])
        self.assertEqual((report['status'], report['publish'], code), ('collected', True, 0), report)
        self.assertEqual(set(report['completedTickers']), targets)
        self.assertEqual(report['missingTickers'], [])
        self.assertEqual(len(self.requests), 1)
        query = parse_qs(urlparse(self.requests[0].url).query)
        self.assertEqual(set(query['symbols'][0].split(',')), targets)
        with self.db.connect() as connection:
            self.assertEqual({r['ticker'] for r in connection.execute('SELECT ticker FROM distribution_events')}, targets)
        second, code = self.observe(group)
        self.assertEqual((second['status'], second['attempted'], second['publish'], code), ('already_collected', False, False, 0))
        self.assertEqual(len(self.requests), 1)

    def test_partial_completion_publishes_received_ticker_and_retries_only_missing(self):
        self.only_symbols = {'YBTC'}
        first, code = self.observe('crypto')
        self.assertEqual((first['status'], first['publish'], code), ('pending', True, 0))
        self.assertEqual(first['missingTickers'], ['YETH'])
        self.assertEqual([c.metadata.get('issuerTicker') for c in self.requests[1:]], ['YETH'])
        self.requests.clear()
        self.only_symbols = {'YETH'}
        second, code = self.observe('crypto')
        self.assertEqual((second['status'], code), ('collected', 0))
        self.assertEqual(parse_qs(urlparse(self.requests[0].url).query)['symbols'], ['YETH'])
        self.assertEqual(len(self.requests), 1)

    def test_no_new_data_does_not_trigger_publication_and_final_recovery_lists_missing(self):
        self.only_symbols = set()
        report, code = self.observe('zero-dte', require=True)
        self.assertEqual((report['status'], report['publish'], code), ('missing', False, 1))
        self.assertEqual(set(report['missingTickers']), {'XDTE', 'QDTE', 'RDTE'})
        cboe_dates = [parse_qs(urlparse(c.url).query)['declaration_dt'][0] for c in self.requests if not c.source_type.endswith('_json')]
        self.assertEqual(cboe_dates, ['2026-10-21', '2026-10-20'])

    def test_final_recovery_preserves_actual_early_declaration_dates(self):
        self.only_date = date(2026, 10, 20)
        report, code = self.observe('zero-dte', require=True)
        self.assertEqual((report['status'], code), ('collected', 0), report)
        self.assertEqual(set(report['matchedDeclarationDates'].values()), {'2026-10-20'})

    def test_group_arguments_reject_unregistered_targets_before_fetch(self):
        for arguments in (['--tickers', 'YBTC,INVALID', '--declaration-date', '2026-10-20'], ['--tickers', 'YBTC,YETH']):
            with patch('sys.argv', ['collect.py', '--provider', 'roundhill', *arguments]), patch('sys.stderr', io.StringIO()), patch.object(RoundhillAdapter, 'fetch_many') as fetch:
                with self.assertRaises(SystemExit):
                    collect.main()
                fetch.assert_not_called()

    def test_group_cli_writes_publish_output(self):
        output, report_path = self.root / 'output', self.root / 'report.json'
        payload = {'status': 'pending', 'attempted': True, 'publish': True}
        with patch('sys.argv', ['observe_roundhill.py', '--group', 'crypto', '--declaration-date', '2026-10-20', '--report', str(report_path), '--github-output', str(output)]), patch.object(observe_roundhill, 'observe_group', return_value=(payload, 0)) as observe, redirect_stdout(io.StringIO()):
            self.assertEqual(observe_roundhill.main(), 0)
        self.assertEqual(observe.call_args.kwargs['group'], 'crypto')
        self.assertIn('publish=true', output.read_text())


if __name__ == '__main__':
    unittest.main()
