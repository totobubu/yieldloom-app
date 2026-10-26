import io
import json
import tempfile
import unittest
from datetime import date
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline import collect
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome, SourceCandidate
from scripts.content_pipeline.providers.base import NoDataError
from scripts.content_pipeline.providers.roundhill import RoundhillAdapter


class TickerCollectionTest(unittest.TestCase):
    def test_shared_official_document_only_persists_selected_ticker(self):
        class Adapter:
            slug = 'yieldmax'
            display_name = 'Fixture'
            official_homepage = 'https://issuer.example'
            parser_version = '1'
            fetch_mode = 'http'
            browser_content = 'html'

            def catalog_seed(self):
                return [SourceCandidate('https://issuer.example/shared', metadata={'tickers': ['QLDY', 'AAPL']})]

            def fetch_many(self, candidates):
                return [FetchOutcome(c, SourceDocument('yieldmax', c.url, 'html', b'official table')) for c in candidates]

            def parse(self, document):
                return [DistributionEvent(provider_slug='yieldmax', ticker=symbol,
                    distribution_per_share='0.15', declared_date='2026-10-21', ex_date='2026-10-22',
                    official_url=document.source_url) for symbol in ['QLDY', 'AAPL']]

        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'ledger.sqlite'
            args = ['collect.py', '--provider', 'yieldmax', '--url', 'https://issuer.example/shared', '--ticker', 'QLDY', '--db', str(db), '--raw-dir', str(Path(directory)/'raw')]
            with patch.object(collect, 'PROVIDERS', {'yieldmax': Adapter}), patch('sys.argv', args), redirect_stdout(io.StringIO()) as output:
                code = collect.main()
            self.assertEqual(code, 0, output.getvalue())
            self.assertEqual(json.loads(output.getvalue())['events'], 1)
            with ContentDatabase(db).connect() as connection:
                self.assertEqual([row['ticker'] for row in connection.execute('SELECT ticker FROM distribution_events')], ['QLDY'])
                self.assertEqual([row['ticker'] for row in connection.execute('SELECT ticker FROM provider_funds')], ['QLDY'])


class RoundhillIssuerCollectionTest(unittest.TestCase):
    fixture = Path('tests/content_pipeline/fixtures/roundhill_topw_issuer.json')

    def document(self, content=None):
        candidate = RoundhillAdapter().issuer_candidate('TOPW')
        return SourceDocument('roundhill', candidate.url, candidate.source_type,
                              self.fixture.read_bytes() if content is None else content,
                              metadata=candidate.metadata)

    def test_issuer_dates_amount_and_planned_rows_are_preserved(self):
        events = RoundhillAdapter().parse(self.document())
        self.assertEqual(len(events), 2)
        latest = events[-1]
        self.assertEqual((latest.declared_date, latest.ex_date, latest.record_date, latest.payable_date),
                         ('2026-10-26', '2026-10-27', '2026-10-27', '2026-10-28'))
        self.assertEqual(latest.distribution_per_share, '0.155646')
        self.assertEqual(latest.verification_status, 'official')
        precise = self.fixture.read_bytes().replace(b'0.155646', b'0.1234567890123456789')
        self.assertEqual(RoundhillAdapter().parse(self.document(precise))[-1].distribution_per_share,
                         '0.1234567890123456789')

    def test_empty_malformed_or_inconsistent_response_is_not_a_distribution(self):
        with self.assertRaises(NoDataError):
            RoundhillAdapter().parse(self.document(b'[]'))
        for content in (b'{}', b'[["bad"]]', self.fixture.read_bytes().replace(b'2026-10-27', b'2026-10-20')):
            with self.subTest(content=content[:20]), self.assertRaises(ValueError):
                RoundhillAdapter().parse(self.document(content))

    def test_public_ajax_session_is_reused_without_storing_token(self):
        from unittest.mock import MagicMock
        opener = MagicMock()
        opener.open.side_effect = [io.BytesIO(b'fixture-public-token'), io.BytesIO(self.fixture.read_bytes()),
                                   io.BytesIO(self.fixture.read_bytes())]
        with patch('scripts.content_pipeline.providers.roundhill.build_opener', return_value=opener):
            adapter = RoundhillAdapter()
            first = adapter.fetch(adapter.issuer_candidate('TOPW'))
            adapter.fetch(adapter.issuer_candidate('TOPW'))
        self.assertEqual(opener.open.call_count, 3)  # one token + two data requests
        self.assertEqual(first.source_type, 'official_issuer_distribution_json')
        self.assertNotIn('fixture-public-token', first.metadata_json)
        self.assertEqual(opener.open.call_args.args[0].get_header('X-requested-with'), 'XMLHttpRequest')

    def test_cboe_lag_falls_back_to_issuer_and_persists_only_requested_date(self):
        self.collect_fallback(self.fixture.read_bytes(), expected_events=1)

    def test_old_issuer_history_is_not_saved_as_a_new_announcement(self):
        rows = json.loads(self.fixture.read_text())
        content = json.dumps([row for row in rows if row[0].startswith('2026-10-19')]).encode()
        self.collect_fallback(content, expected_events=0)

    def collect_fallback(self, content, expected_events):
        adapter = RoundhillAdapter()
        requested = []

        def fetch(candidates):
            self.assertEqual(len(candidates), 1)
            candidate = candidates[0]
            requested.append(candidate)
            data = content if candidate.source_type.endswith('_json') else Path('tests/content_pipeline/fixtures/roundhill_cboe.html').read_bytes()
            return [FetchOutcome(candidate, SourceDocument('roundhill', candidate.url, candidate.source_type,
                                                           data, metadata=candidate.metadata))]

        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'ledger.sqlite'
            args = ['collect.py', '--provider', 'roundhill', '--ticker', 'TOPW', '--declaration-date',
                    '2026-10-26', '--db', str(db), '--raw-dir', str(Path(directory) / 'raw')]
            with patch('sys.argv', args), patch.object(RoundhillAdapter, 'fetch_many', side_effect=fetch), redirect_stdout(io.StringIO()) as output:
                code = collect.main()
            report = json.loads(output.getvalue())
            self.assertEqual(code, 0, report)
            self.assertEqual(report['events'], expected_events)
            self.assertEqual(len(requested), 2)
            self.assertEqual(requested[-1].url, adapter.issuer_candidate('TOPW').url)
            with ContentDatabase(db).connect() as connection:
                events = connection.execute('SELECT ticker, declared_date, distribution_per_share FROM distribution_events').fetchall()
            self.assertEqual(len(events), expected_events)
            if expected_events:
                self.assertEqual(tuple(events[0]), ('TOPW', '2026-10-26', '0.155646'))

    def test_topw_publication_triggers_deployment_only_after_collection(self):
        workflow = Path('.github/workflows/observe-roundhill-topw.yml').read_text()
        self.assertIn("steps.observation.outputs.status == 'collected'", workflow)
        self.assertIn('REFRESH_SCOPE: ticker', workflow)
        self.assertIn('REFRESH_REQUEST_ID: roundhill-topw-${{ github.run_id }}', workflow)
