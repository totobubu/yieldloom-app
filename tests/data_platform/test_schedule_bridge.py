import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from scripts.data_platform.pipeline import Store
from scripts.data_platform.schedule_bridge import enqueue_plan
from scripts.data_platform.collection_jobs import claim

class ScheduleBridgeTest(unittest.TestCase):
    def test_existing_plan_is_shared_once_and_does_not_steal_active_job(self):
        schedule=SimpleNamespace(GROUPS={'group':{'tickers':['TSLY']}},POLICY={'earlyDays':3,'lateDays':3})
        catalog=[{'symbol':'TSLY','isin':'US88634T4931','market':'NASDAQ'}]
        request={'enabled':True,'group':'group','anchor':'2026-10-21','scheduledAt':'2026-10-21T11:00:00Z'}
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            self.assertEqual(enqueue_plan(store,'yieldmax',request,schedule,catalog)['status'],'legacy_owner')
            first=enqueue_plan(store,'yieldmax',request,schedule,catalog,owner='queue')
            self.assertEqual(len(first['jobs']),1)
            self.assertEqual(enqueue_plan(store,'yieldmax',request,schedule,catalog,owner='queue')['status'],'reused')
            job=claim(store,'2026-10-21T12:00:00Z',source='official-dividends')
            enqueue_plan(store,'yieldmax',{**request,'scheduledAt':'2026-10-21T11:05:00Z'},schedule,catalog,owner='queue')
            self.assertIsNone(claim(store,'2026-10-21T12:01:00Z',source='official-dividends'))
            self.assertEqual(store.db.execute('SELECT owner FROM collection.jobs WHERE id=?',(job['id'],)).fetchone()[0],job['owner'])
            store.close()
