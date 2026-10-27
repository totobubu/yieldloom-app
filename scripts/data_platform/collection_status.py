"""Private, credential-free collection status projection. No automatic publication."""
import json
from scripts.data_platform.collection_jobs import initialize,coverage
from scripts.data_platform.request_bridge import stored_prices
from scripts.data_platform.pipeline import encode


def build_status(store,instrument,end):
    initialize(store)
    entity=f"instrument:isin:{instrument['isin']}:{instrument['market']}"
    datasets=[]
    observations=[json.loads(r['payload']) for r in store.db.execute('SELECT payload FROM observations ORDER BY id')]
    for dataset in ('market-prices','dividends'):
        jobs=[dict(r) for r in store.db.execute('SELECT * FROM collection.jobs WHERE entity=? AND dataset=? ORDER BY start,end',(entity,dataset))]
        rows=[r for r in observations if r.get('entityId')==entity and r.get('dataset')==dataset]
        dates=sorted(r['asOfDate'] for r in rows if r.get('asOfDate'))
        errors=[r for r in jobs if r.get('error')]
        verified=coverage(store,entity,dataset,instrument['ipoDate'],end)
        conflicts=stored_prices(store,entity)['conflictingDates'] if dataset=='market-prices' else sorted({r['asOfDate'] for r in rows if r.get('revision',1)>1 and r.get('asOfDate')})
        datasets.append({'dataset':dataset,'status':'complete' if verified['complete'] and not conflicts else
                         'retry' if errors else 'partial' if rows else 'pending' if jobs else 'uncollected',
                         'observedStart':dates[0] if dates else None,'observedEnd':dates[-1] if dates else None,
                         'sources':sorted({r['sourceId'] for r in rows}|{r['source'] for r in jobs}),
                         'lastSuccessAt':max((r.get('observedAt','') for r in rows),default=None),
                         # Existing queue has no attempt timestamp: do not invent a latest-error time.
                         'lastError':'adapter_failed' if errors else None,'lastErrorAt':None,
                         'coverage':{**verified,'conflictingDates':conflicts},'jobs':len(jobs)})
    return {'schemaVersion':1,'symbol':instrument['symbol'],'entityId':entity,'asOf':end,'datasets':datasets}


def publish_status(remote,status,*,enabled=False,expected=None):
    if not enabled: return {'status':'disabled'}
    # Caller captures ETag before collection/checkpoint; stale writers cannot replace it.
    key='market/v1/status/'+status['symbol']+'.json'
    remote.put(key,encode(status).encode(),expected=expected)
    return {'status':'stored'}
