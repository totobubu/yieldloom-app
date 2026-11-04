import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.data_pipeline.extract_amount_fixed import preserve, verify, valid_isin


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'market'
        self.source.mkdir()
        self.output = self.root / 'preserved'
        self.body = b'{"tickerInfo":{"symbol":"AAPL","isin":"US0378331005","market":"WRONG","currency":"USD","validFrom":null,"sourceUrl":"https://issuer.example/original"},"backtestData":[{"date":"2026-01-01","close":2.10,"amountFixed":0.123400,"source":{"url":"https://issuer.example/dividend","hash":"original-evidence"}},{"date":"2026-01-02","amountFixed":"1.2300"},{"date":"2026-01-03","close":3}]}'
        (self.source / 'aapl.json').write_bytes(self.body)

    def test_preserves_exact_tokens_rows_root_source_and_original_bytes(self):
        report = preserve(self.source, self.output)
        self.assertEqual(report['fixedDividendRows'], 2)
        self.assertFalse(report['deletionAuthorized'])
        rows = json.loads((self.output / 'dividends.json').read_text())['records']
        self.assertEqual(rows[0]['amountFixed'], {'raw': '0.123400', 'valueType': 'number'})
        self.assertEqual(rows[1]['amountFixed'], {'raw': '1.2300', 'valueType': 'string'})
        self.assertEqual(rows[0]['originalRow']['source']['hash'], 'original-evidence')
        self.assertEqual(rows[0]['originalFileMetadata']['tickerInfo']['sourceUrl'], 'https://issuer.example/original')
        self.assertEqual((self.source / 'aapl.json').read_bytes(), self.body)
        self.assertEqual(next((self.output / 'originals').iterdir()).read_bytes(), self.body)
        self.assertTrue(verify(self.source, self.output)['verified'])

    def test_isin_collisions_market_conflicts_and_missing_isin_never_merge(self):
        catalog = self.root / 'catalog.json'
        catalog.write_text(json.dumps({'instruments': [
            {'symbol': 'AAPL', 'isin': 'US0378331005', 'market': 'NASDAQ', 'currency': 'USD'},
            {'symbol': 'WRONG', 'isin': 'US0378331005', 'market': 'NYSE', 'currency': 'USD'}]}))
        (self.source / 'unknown.json').write_text('{"backtestData":[{"amountFixed":0,"date":"2026-01-01"}]}')
        preserve(self.source, self.output, catalog)
        files = json.loads((self.output / 'manifest.json').read_text())['files']
        review = files[0]['identityReview']
        self.assertIn('catalog_disagreement', review['issues'])
        self.assertIn('catalog_isin_multiple_listings_needs_review', review['issues'])
        self.assertFalse(review['mergeAllowed'])
        self.assertIn('missing_isin', files[1]['identityReview']['issues'])
        self.assertTrue(valid_isin('US0378331005'))
        self.assertFalse(valid_isin('US0378331004'))

    def test_each_duplicate_and_invalid_amount_is_preserved_for_review(self):
        (self.source / 'aapl.json').write_text('[{"amountFixed":null},{"amountFixed":"bad"},{"amountFixed":0},{"amountFixed":0}]')
        preserve(self.source, self.output)
        records = json.loads((self.output / 'dividends.json').read_text())['records']
        self.assertEqual(len(records), 4)
        self.assertEqual(len({row['recordId'] for row in records}), 4)
        self.assertIn('invalid_amount_preserved', records[0]['issues'])

    def test_tamper_source_extraction_or_preserved_original_fails(self):
        preserve(self.source, self.output)
        path = self.output / 'dividends.json'
        original = path.read_bytes()
        path.write_bytes(original.replace(b'0.123400', b'0.123401'))
        with self.assertRaisesRegex(ValueError, 'Extracted values'):
            verify(self.source, self.output)
        path.write_bytes(original)
        backup = next((self.output / 'originals').iterdir())
        backup.write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'original bytes'):
            verify(self.source, self.output)
        backup.write_bytes(self.body)
        (self.source / 'aapl.json').write_bytes(self.body + b' ')
        with self.assertRaisesRegex(ValueError, 'Original source changed'):
            verify(self.source, self.output)

    def test_missing_input_and_existing_or_nested_output_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'missing'):
            preserve(self.root / 'missing', self.output)
        with self.assertRaisesRegex(ValueError, 'separate'):
            preserve(self.source, self.source / 'copy')
        preserve(self.source, self.output)
        with self.assertRaisesRegex(ValueError, 'new output'):
            preserve(self.source, self.output)

    def test_identical_files_and_same_isin_are_preserved_as_separate_observations(self):
        (self.source / 'alias.json').write_bytes(self.body)
        report = preserve(self.source, self.output)
        self.assertEqual(report['fixedDividendRows'], 4)
        records = json.loads((self.output / 'dividends.json').read_text())['records']
        self.assertEqual(len({row['recordId'] for row in records}), 4)
        self.assertEqual({row['sourceFile'] for row in records}, {'aapl.json', 'alias.json'})

    def test_r2_origin_hash_and_split_context_are_preserved_without_deleting_price(self):
        body = b'{"tickerInfo":{"symbol":"EXAMPLE"},"backtestData":[{"date":"2026-01-01","close":1.1,"amountFixed":0,"amountOriginal":0.2500,"amountSplitAdjustments":[{"date":"2025-12-01","ratio":2}]}]}'
        source_file = self.source / 'aapl.json'
        source_file.write_bytes(body)
        origin = self.root / 'source-objects.json'
        claim = {'bucket': 'fixture-market', 'key': 'data/us/example.json', 'sha256': hashlib.sha256(body).hexdigest()}
        origin.write_text(json.dumps({'aapl.json': claim}))
        preserve(self.source, self.output, source_manifest_path=origin)
        row = json.loads((self.output / 'dividends.json').read_bytes())['records'][0]
        self.assertEqual(row['sourceObject']['key'], claim['key'])
        self.assertEqual(row['sourceObject']['bucket'], claim['bucket'])
        self.assertEqual(row['amountFixed']['raw'], '0')
        self.assertEqual(row['originalRow']['close'], '1.1')
        self.assertEqual(row['originalRow']['amountOriginal'], '0.2500')
        self.assertEqual(row['originalRow']['amountSplitAdjustments'][0]['ratio'], '2')
        self.assertEqual(row['sourceReferenceStatus'], 'missing')
        self.assertEqual(source_file.read_bytes(), body)
        self.assertTrue(verify(self.source, self.output)['verified'])
        claim['sha256'] = 'wrong'
        origin.write_text(json.dumps({'aapl.json': claim}))
        with self.assertRaisesRegex(ValueError, 'hash evidence'):
            preserve(self.source, self.root / 'bad-copy', source_manifest_path=origin)

    def test_conflicting_row_identity_is_retained_and_flagged(self):
        body = json.loads(self.body)
        body['backtestData'][0]['currency'] = 'KRW'
        body['backtestData'][0]['isin'] = 'BAD'
        (self.source / 'aapl.json').write_text(json.dumps(body))
        preserve(self.source, self.output)
        entry = json.loads((self.output / 'manifest.json').read_text())['files'][0]
        self.assertIn('conflicting_currency', entry['identityReview']['issues'])
        self.assertIn('conflicting_isin', entry['identityReview']['issues'])


if __name__ == '__main__':
    unittest.main()
