import tempfile
import unittest
from pathlib import Path
from scripts.data_platform.pipeline import Store
from scripts.data_platform.discovery_requests import request_collection
from scripts.data_platform.collection_status import build_status,publish_status
from scripts.data_platform.collection_jobs import claim,finish
from scripts.data_platform.checkpoints import ConditionalConflict
from test_checkpoints import MemoryObjects

class CollectionStatusTest(unittest.TestCase):
    def test_missing_retry_and_stale_writer_never_become_complete(self):
        instrument={'symbol':'AAPL','isin':'US0378331005','market':'NASDAQ','currency':'USD','ipoDate':'1980-12-12'}
        with tempfile.TemporaryDirectory() as directory:
            store=Store(Path(directory));remote=MemoryObjects()
            initial=build_status(store,instrument,'2026-01-01')
            self.assertEqual(initial['datasets'][0]['status'],'uncollected')
            self.assertEqual(publish_status(remote,initial)['status'],'disabled')
            request_collection(store,'AAPL','NASDAQ','2026-01-01',catalog=[instrument])
            job=claim(store,'2026-01-02T00:00:00Z',source='yahoo-chart')
            finish(store,job['id'],owner=job['owner'],outcome='retry',retry_at='2026-01-02T01:00:00Z',error='adapter_failed')
            failed=build_status(store,instrument,'2026-01-01')
            self.assertEqual(failed['datasets'][0]['status'],'retry')
            self.assertIsNone(failed['datasets'][0]['observedStart'])
            self.assertFalse(failed['datasets'][0]['coverage']['complete'])
            publish_status(remote,failed,enabled=True)
            with self.assertRaises(ConditionalConflict): publish_status(remote,initial,enabled=True)
            store.close()

    def test_runner_rejects_invalid_status_targets_before_any_remote_io(self):
        from scripts.data_platform.run import run
        class ForbiddenRemote:
            def get(self,*args): raise AssertionError('Unexpected remote read')
        for targets in ([],['../AAPL'],['AAPL']*21+['MSFT'+str(i) for i in range(21)]):
            with self.assertRaises(ValueError):
                run(ForbiddenRemote(),Path('/tmp/never-created-collection-test'),{},'invalid',request_symbols=targets,write_status=True)
