from datetime import timedelta
from pathlib import Path
import tempfile
import unittest

from scripts.data_platform.run import run, health
from scripts.data_platform.checkpoints import MissingObject, current, restore
from scripts.data_platform.locking import writer_lock
from scripts.data_platform.pipeline import Store
from test_checkpoints import MemoryObjects
from test_pipeline import NOW, registry, response, xml


class RunTests(unittest.TestCase):
    def test_separate_runs_restore_cache_and_persist_failure_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = MemoryObjects()
            with self.assertRaises(MissingObject):
                run(remote, root / 'missing', registry(), 'missing')
            run(remote, root / 'one', registry(), 'one', True, lambda *_: response(xml()), NOW)
            result = run(remote, root / 'two', registry(), 'two', transport=lambda *_: self.fail('Duplicate HTTP'), now=NOW)
            self.assertEqual(result['httpRequests'], 0)
            result = run(remote, root / 'three', registry(), 'three', transport=lambda *_: {'status': 503}, now=NOW + timedelta(days=1))
            self.assertEqual(result['status'], 'degraded')
            self.assertEqual(current(remote)[0]['runId'], 'three')
            restore(remote, root / 'verify')
            store = Store(root / 'verify')
            self.addCleanup(store.close)
            self.assertEqual(store.state('ecb')['failureCount'], 1)
            self.assertEqual(store.state('ecb')['rowCount'], 1)

    def test_writer_exclusion_and_no_implicit_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'store'
            with writer_lock(root):
                with self.assertRaisesRegex(RuntimeError, 'writer'):
                    with writer_lock(root):
                        self.fail('Concurrent writer')
            remote = MemoryObjects()
            run(remote, root, registry(), 'one', True, lambda *_: response(xml()), NOW)
            with self.assertRaisesRegex(ValueError, 'fresh'):
                run(remote, root, registry(), 'two')
            with self.assertRaisesRegex(ValueError, 'Bootstrap'):
                run(remote, Path(directory) / 'reset', registry(), 'reset', True)

    def test_no_new_filing_is_not_a_stale_daily_data_error(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            config['sources'][0]['datasets'] = ['filings']
            with store.db:
                store.set_state('ecb', {'lastSuccessAt': NOW.isoformat(), 'asOfDates': ['2020-01-01']})
            self.assertFalse(health(store, config, NOW)[0]['dataStale'])
            self.assertTrue(health(store, config, NOW + timedelta(days=3))[0]['collectionStale'])
