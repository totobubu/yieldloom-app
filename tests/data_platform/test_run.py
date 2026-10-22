from datetime import timedelta
from pathlib import Path
import tempfile
import unittest

from scripts.data_platform.run import run, health
from scripts.data_platform.checkpoints import MissingObject, current, restore, backup
from scripts.data_platform.locking import writer_lock
from scripts.data_platform.pipeline import Store, collect
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
            self.assertEqual(result['checkpoint'], 'saved')
            self.assertEqual(result['r2']['getRequests'], 7)
            self.assertEqual(result['r2']['putRequests'], 3)
            self.assertEqual(current(remote)[0]['runId'], 'three')
            restore(remote, root / 'verify')
            store = Store(root / 'verify')
            self.addCleanup(store.close)
            self.assertEqual(store.state('ecb')['failureCount'], 1)
            self.assertEqual(store.state('ecb')['rowCount'], 1)

    def test_twenty_archived_documents_do_not_add_requests_to_daily_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = MemoryObjects()
            store = Store(root / 'initial')
            collect(store, registry(), transport=lambda *_: response(xml()), now=NOW)
            for index in range(19):
                store.document(f'https://example.test/history/{index}',
                               response(xml() + str(index).encode()), NOW.isoformat())
            backup(store, remote, None, 'initial')
            store.close()
            before, _ = current(remote)
            unchanged = run(remote, root / 'unchanged', registry(), 'unchanged',
                            transport=lambda *_: self.fail('Not due'), now=NOW)
            self.assertEqual(unchanged['checkpoint'], 'unchanged')
            self.assertEqual(unchanged['r2']['getRequests'], 3)
            self.assertEqual(unchanged['r2']['putRequests'], 0)
            self.assertEqual(current(remote)[0], before)
            daily = run(remote, root / 'daily', registry(), 'daily',
                        transport=lambda *_: response(xml()), now=NOW + timedelta(days=1))
            self.assertEqual(daily['r2']['getRequests'], 7)
            self.assertEqual(daily['r2']['putRequests'], 3)
            self.assertEqual(len(list((root / 'daily' / 'raw').iterdir())), 1)
            restore(remote, root / 'all')
            # A full recovery still includes all 20 immutable historical documents.
            self.assertEqual(len(list((root / 'all' / 'raw').iterdir())), 20)
            conditional = run(remote, root / 'conditional', registry(), 'conditional',
                              transport=lambda *_: {'status': 304}, now=NOW + timedelta(days=2))
            self.assertEqual(conditional['r2']['getRequests'], 8)
            self.assertEqual(conditional['r2']['putRequests'], 3)
            self.assertEqual(len(list((root / 'conditional' / 'raw').iterdir())), 1)
            updated = run(remote, root / 'updated', registry(), 'updated',
                          transport=lambda *_: response(xml() + b' '), now=NOW + timedelta(days=3))
            self.assertEqual(updated['r2']['getRequests'], 9)
            self.assertEqual(updated['r2']['putRequests'], 4)
            self.assertEqual(updated['httpRequests'], 1)

    def test_parser_change_reuses_one_lazy_document_without_external_http(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = MemoryObjects()
            run(remote, root / 'initial', registry(), 'initial', True, lambda *_: response(xml()), NOW)
            changed = registry()
            changed['sources'][0]['parserVersion'] = 'new-version'
            result = run(remote, root / 'updated', changed, 'updated',
                         transport=lambda *_: self.fail('Duplicate HTTP'), now=NOW)
            self.assertEqual(result['httpRequests'], 0)
            self.assertEqual(result['r2']['getRequests'], 8)
            self.assertEqual(result['r2']['putRequests'], 3)

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
