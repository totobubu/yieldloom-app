"""Optional handoff of existing provider plans to the shared queue.

No schedules are defined here. The existing provider resolver remains authoritative.
Operational workflows must select one owner; default ownership remains legacy.
"""
import importlib
from datetime import date,timedelta
from scripts.data_platform.collection_jobs import enqueue
from scripts.data_platform.pipeline import encode,digest


def enqueue_plan(store,provider,request,schedule,catalog,*,owner='legacy'):
    if owner!='queue': return {'status':'legacy_owner','jobs':[]}
    if provider not in {'roundhill','yieldmax'}: raise ValueError('Unsupported scheduled provider')
    if not request.get('enabled'): return {'status':'outside_window','jobs':[]}
    if not request.get('anchor') or request.get('group') not in schedule.GROUPS:
        return {'status':'recovery_requires_existing_cycle','jobs':[]}
    anchor=date.fromisoformat(request['anchor'])
    start=(anchor-timedelta(days=schedule.POLICY['earlyDays'])).isoformat()
    end=(anchor+timedelta(days=schedule.POLICY['lateDays']+7)).isoformat()
    # Same resolved scheduled slot/manual cycle shares one durable receipt.
    key=digest(encode([provider,request]).encode())
    store.db.execute('CREATE TABLE IF NOT EXISTS collection.schedule_receipts (id TEXT PRIMARY KEY,payload TEXT NOT NULL)')
    if store.db.execute('SELECT 1 FROM collection.schedule_receipts WHERE id=?',(key,)).fetchone():
        return {'status':'reused','jobs':[]}
    ids=[];held=[]
    for ticker in schedule.GROUPS[request['group']]['tickers']:
        matches=[r for r in catalog if r.get('symbol')==ticker and r.get('active',True) and r.get('isin') and r.get('market')]
        if len(matches)!=1:
            held.append(ticker);continue
        row=matches[0];entity=f"instrument:isin:{row['isin']}:{row['market']}"
        jobs=enqueue(store,entity,'dividends',start,end,priority=0,source='official-dividends')
        with store.db:
            for job in jobs:
                # New polling slot may recheck partial evidence, never steal running work.
                store.db.execute("UPDATE collection.jobs SET status='pending' WHERE id=? AND status='partial'",(job,))
        ids.extend(jobs)
    with store.db:
        store.db.execute('INSERT INTO collection.schedule_receipts VALUES (?,?)',(key,encode(ids)))
    return {'status':'queued','jobs':ids,'heldTickers':held}


def resolve_and_enqueue(store,provider,catalog,*,cron,created_at,now,owner='legacy'):
    if owner!='queue': return {'status':'legacy_owner','jobs':[]}
    if provider not in {'roundhill','yieldmax'}: raise ValueError('Unsupported scheduled provider')
    try:
        observer=importlib.import_module('scripts.content_pipeline.schedule_'+provider)
        schedule=importlib.import_module('scripts.content_pipeline.'+provider+'_schedule')
    except ModuleNotFoundError as error:
        if error.name not in {'scripts.content_pipeline.schedule_'+provider,'scripts.content_pipeline.'+provider+'_schedule'}: raise
        return {'status':'existing_scheduler_unavailable','jobs':[]}
    request=observer.request_for(cron=cron,created_at=created_at,now=now)
    return enqueue_plan(store,provider,request,schedule,catalog,owner=owner)
