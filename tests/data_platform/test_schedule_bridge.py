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

    def test_real_yieldmax_policy_from_pr164_routes_once(self):
        from datetime import datetime,timezone
        from scripts.content_pipeline import yieldmax_schedule as schedule
        from scripts.content_pipeline.schedule_yieldmax import request_for
        from scripts.data_platform.schedule_bridge import resolve_and_enqueue
        clock=datetime(2026,10,27,11,0,tzinfo=timezone.utc)
        cron='0,5,10,15,20,25,30 11 * * 1-3'
        request=request_for(cron=cron,created_at=clock,now=clock)
        self.assertTrue(request['enabled'])
        tickers=schedule.GROUPS[request['group']]['tickers']
        import json
        catalog=json.loads((Path(__file__).resolve().parents[2]/'data-v2/catalog-seed.json').read_text())['instruments']
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            first=resolve_and_enqueue(store,'yieldmax',catalog,cron=cron,created_at=clock,now=clock,owner='queue')
            self.assertGreater(len(first['jobs']),0)
            self.assertEqual(len(first['jobs'])+len(first['heldTickers']),len(tickers))
            second=resolve_and_enqueue(store,'yieldmax',catalog,cron=cron,created_at=clock,now=clock,owner='queue')
            self.assertEqual(second['status'],'reused')
            store.close()
