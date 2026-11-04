import io
import tempfile
import unittest
from pathlib import Path

from scripts.data_pipeline.download_market_originals import download
from scripts.data_pipeline.extract_amount_fixed import preserve


class Store:
    def __init__(self):
        self.body = b'{"tickerInfo":{"symbol":"EXAMPLE"},"backtestData":[{"amountFixed":0.123400,"close":1}]}'
        self.operations = []
        self.corrupt = False
        self.changed = False
        self.pages = 0

    def get_paginator(self, operation):
        self.operations.append(operation)
        assert operation == 'list_objects_v2'
        return self

    def paginate(self, Bucket, Prefix):
        self.pages += 1
        if Prefix != 'data/nyse/':
            return iter([{}])
        return iter([{'Contents': [{'Key': Prefix + 'example.json', 'ETag': '"source-etag"', 'Size': len(self.body), 'LastModified': 'changed' if self.changed and self.pages > 5 else 'original'}]}])

    def get_object(self, **kwargs):
        self.operations.append('get_object')
        assert kwargs['Bucket'] == 'divgrow-data'
        assert kwargs['IfMatch'] == '"source-etag"'
        return {'ETag': '"source-etag"', 'ContentLength': len(self.body), 'Body': io.BytesIO(self.body[:-1] if self.corrupt else self.body)}


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / 'transfer'
        self.store = Store()

    def test_download_then_extraction_preserves_raw_number_and_origin(self):
        report = download(self.store, 'divgrow-data', self.output)
        self.assertTrue(report['verifiedRawTransfer'])
        self.assertEqual((self.output / 'sources/nyse/example.json').read_bytes(), self.store.body)
        extraction = preserve(self.output / 'sources', self.root / 'extracted', source_manifest_path=self.output / 'source-objects.json')
        self.assertEqual(extraction['fixedDividendRows'], 1)
        self.assertEqual(set(self.store.operations), {'list_objects_v2', 'get_object'})

    def test_truncated_body_and_changed_inventory_are_never_verified(self):
        self.store.corrupt = True
        with self.assertRaisesRegex(ValueError, 'Truncated'):
            download(self.store, 'divgrow-data', self.output)
        self.assertFalse((self.output / 'source-objects.json').exists())
        self.store.corrupt = False
        self.store.changed = True
        self.store.pages = 0
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            download(self.store, 'divgrow-data', self.root / 'second')

    def test_wrong_bucket_and_existing_output_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'authorized'):
            download(self.store, 'other-bucket', self.output)
        self.output.mkdir()
        with self.assertRaisesRegex(ValueError, 'new isolated'):
            download(self.store, 'divgrow-data', self.output)


if __name__ == '__main__':
    unittest.main()
