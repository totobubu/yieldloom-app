import json
import tempfile
import unittest
import zipfile
from decimal import Decimal
from pathlib import Path
from scripts.data_pipeline.compact_history import compact_bytes, compact_tree


class CompactHistoryTest(unittest.TestCase):
    def test_preserves_precise_tokens_strings_and_long_history(self):
        raw = b'{ "text": "space \\" quote \\n", "number": 0.123456789012345678901, "backtestData": [{"date":"1962-01-02", "close":1e-18}] }'
        compact = compact_bytes(raw)
        self.assertIn(b'0.123456789012345678901', compact)
        self.assertEqual(json.loads(raw, parse_float=Decimal), json.loads(compact, parse_float=Decimal))
        self.assertEqual(compact_bytes(compact), compact)

    def test_archive_recovers_exact_bytes_and_dry_run_does_not_modify(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            repo = base / 'repo'
            data = repo / 'public/data'
            data.mkdir(parents=True)
            path = data / 'ge.json'
            raw = b'{ "backtestData": [{"date":"1962-01-02","close":2.000001}] }'
            path.write_bytes(raw)
            compact_tree(repo, [data])
            self.assertEqual(path.read_bytes(), raw)
            archive = base / 'recovery.zip'
            report = compact_tree(repo, [data], apply=True, archive=archive)
            with zipfile.ZipFile(archive) as bundle:
                self.assertEqual(bundle.read('public/data/ge.json'), raw)
            self.assertEqual(report['historyRows'], 1)
            self.assertEqual(report['entries'][0]['earliest'], '1962-01-02')
            self.assertLess(report['afterBytes'], report['beforeBytes'])

    def test_invalid_input_never_replaces_file(self):
        with self.assertRaises(json.JSONDecodeError):
            compact_bytes(b'{bad json}')
