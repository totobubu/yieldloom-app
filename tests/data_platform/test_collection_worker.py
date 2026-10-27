import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from scripts.data_platform.pipeline import Store
from scripts.data_platform.collection_jobs import enqueue, claim, finish, recover, coverage
from scripts.data_platform.collection_worker import run_next

NOW = datetime(2026,1,1,tzinfo=timezone.utc)

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.store=Store(Path(self.temp.name))
    def tearDown(self):
        self.store.close(); self.temp.cleanup()
    def enqueue(self,entity='a',source='official',end='2025-12-31'):
        return enqueue(self.store,entity,'dividends','2025-01-01',end,source=source)
    def test_disabled_worker_makes_no_calls_or_claim(self):
        self.enqueue()
        def forbidden(*args): raise AssertionError('must not call')
        self.assertEqual(run_next(self.store,'official',forbidden)['status'],'disabled')
        self.assertIsNotNone(claim(self.store,NOW.isoformat(),source='official'))
    def test_repeated_extended_requests_only_add_tail(self):
        original=self.enqueue(end='2025-06-30')
        extended=self.enqueue()
        self.assertEqual(len(extended),2)
        self.assertIn(original[0],extended)
        rows=list(self.store.db.execute('SELECT start,end FROM collection.jobs ORDER BY start'))
        self.assertEqual([(r['start'],r['end']) for r in rows],[('2025-01-01','2025-06-30'),('2025-07-01','2025-12-31')])
    def test_source_serialization_and_fenced_recovery(self):
        self.enqueue(); self.enqueue('b'); self.enqueue('c','other')
        a=claim(self.store,NOW.isoformat(),source='official')
        self.assertIsNone(claim(self.store,'2099-01-01',source='official'))
        self.assertIsNotNone(claim(self.store,NOW.isoformat(),source='other'))
        with self.assertRaises(ValueError): recover(self.store,a['id'],a['owner'])
        recover(self.store,a['id'],a['owner'],worker_stopped=True)
        b=claim(self.store,NOW.isoformat(),source='official')
        self.assertEqual(a['id'],b['id']); self.assertNotEqual(a['owner'],b['owner'])
        with self.assertRaises(ValueError): finish(self.store,a['id'],owner=a['owner'],outcome='partial')
    def test_errors_backoff_entire_source_without_recording_secrets(self):
        self.enqueue(); self.enqueue('b')
        def broken(*args): raise RuntimeError('api_key=secret')
        result=run_next(self.store,'official',broken,enabled=True,now=NOW)
        self.assertEqual(result['status'],'retry')
        self.assertIsNone(claim(self.store,NOW.isoformat(),source='official'))
        row=self.store.db.execute("SELECT error FROM collection.jobs WHERE status='retry'").fetchone()
        self.assertEqual(row['error'],'adapter_failed')
    def test_empty_output_is_partial_and_full_window_needs_evidence(self):
        self.enqueue()
        result=run_next(self.store,'official',lambda *_:{},enabled=True,now=NOW)
        self.assertEqual(result['status'],'partial')
        self.assertFalse(coverage(self.store,'a','dividends','2025-01-01','2025-12-31')['complete'])
        self.enqueue('b')
        result=run_next(self.store,'official',lambda *_:{'outcome':'complete'},enabled=True,now=NOW)
        self.assertEqual(result['status'],'retry')
