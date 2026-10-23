import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline import collect
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome, SourceCandidate


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
