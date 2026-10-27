"""Consume API outbox requests and run bounded historical Yahoo observations.

Revalidates identity against server-owned catalog, never trusts remote request URLs.
Uses existing private checkpoint store and fixed-host provider transport.
"""
from datetime import datetime, timezone
import json
import re
from urllib.parse import urlencode, quote
from scripts.data_platform.checkpoints import MissingObject
from scripts.data_platform.discovery_requests import request_collection
from scripts.data_platform.collection_worker import run_next
from scripts.data_platform.parsers import fact
from scripts.content_pipeline.stock_collection import fetch_source, parse_market


def receive_requests(store, remote, symbols, catalog, now):
    if len(symbols)>20: raise ValueError('At most 20 targeted requests per run')
    results=[]
    for symbol in sorted(set(symbols)):
        if not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,15}',symbol): raise ValueError('Invalid requested ticker')
        try: body,etag=remote.get(f'market/v1/requests/{quote(symbol,safe="")}.json')
        except MissingObject:
            results.append({'symbol':symbol,'status':'missing_request'});continue
        if len(body)>16384: raise ValueError('Oversize collection request')
        request=json.loads(body)
        identity=request.get('identity',{})
        matches=[r for r in catalog if r.get('symbol')==symbol and r.get('active',True)]
        if len(matches)!=1 or request.get('schemaVersion')!=1:
            raise ValueError('Unknown request identity')
        expected={key:matches[0].get(key) for key in ('symbol','isin','market','currency','ipoDate')}
        if identity!=expected: raise ValueError('Request identity does not match owned catalog')
        status=request_collection(store,symbol,identity['market'],request['requestedThrough'],catalog=catalog,now=now)
        results.append({'symbol':symbol,'status':status['status']})
    return results


def yahoo_adapter(catalog, *, fetcher=fetch_source, now=None):
    clock=now or datetime.now(timezone.utc)
    directory={f"instrument:isin:{r.get('isin')}:{r.get('market')}":r for r in catalog if r.get('active',True)}
    def collect(store,job):
        instrument=directory.get(job['entity'])
        if not instrument or job['dataset']!='market-prices': raise ValueError('Unregistered market target')
        symbol=instrument['symbol']; yahoo_symbol=re.sub(r'\.([AB])$',r'-\1',symbol)
        stamp=lambda day:int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
        query=urlencode({'period1':stamp(job['start']),
                         'period2':stamp(job['end'])+86400,'interval':'1d','events':'div,splits'})
        for host in ('query1.finance.yahoo.com','query2.finance.yahoo.com'):
            url=f'https://{host}/v8/finance/chart/{quote(yahoo_symbol,safe="")}?{query}'
            try:
                body=fetcher(url)
                parsed=parse_market(body,symbol,instrument['currency'],clock.date())
                break
            except Exception: pass
        else: raise RuntimeError('Historical market providers failed') from None
        timestamp=clock.isoformat()
        _,sha=store.document(url,{'status':200,'body':body},timestamp)
        rows=[fact('market-prices',job['entity'],'daily_ohlcv',row,as_of=row['date'],unit='record',
                   currency=instrument['currency'],priceBasis='upstream_unverified')
              for row in parsed['candles'] if job['start']<=row['date']<=job['end']]
        if not rows: return {'outcome':'partial','evidence':sha}
        source={'id':'yahoo-history-'+symbol.lower().replace('.','-'),'url':url,'parserVersion':'1'}
        store.accept(source,rows,sha,timestamp,'yahoo-history-v1')
        # Valid observations do not prove exchange-calendar coverage or split basis.
        return {'outcome':'partial','evidence':sha}
    return collect


def process_requests(store, remote, symbols, catalog, *, enabled=False, now=None, fetcher=fetch_source, max_jobs=1, dividends=False, official_providers=None, official_index=None):
    if not enabled: return {'status':'disabled','requests':[],'jobs':[]}
    if not 1<=max_jobs<=5: raise ValueError('Worker batch must be 1..5 jobs')
    clock=now or datetime.now(timezone.utc)
    if len(symbols)>20: raise ValueError('At most 20 targeted requests per run')
    requests=[]
    for symbol in sorted(set(symbols)):
        try: requests.extend(receive_requests(store,remote,[symbol],catalog,clock))
        except ValueError: requests.append({'symbol':symbol,'status':'invalid_request'})
    market_requests=0
    def counted_fetch(url):
        nonlocal market_requests
        market_requests+=1
        return fetcher(url)
    adapter=yahoo_adapter(catalog,fetcher=counted_fetch,now=clock)
    jobs=[]
    for _ in range(max_jobs):
        result=run_next(store,'yahoo-chart',adapter,enabled=True,now=clock)
        jobs.append(result)
        if result['status'] in {'idle','retry'}: break
    report={'status':'processed','requests':requests,'jobs':jobs,'marketHttpRequests':market_requests}
    if dividends:
        from scripts.data_platform.official_backfill import official_adapter, candidate_review
        from scripts.data_v2.check_cutover import read_legacy
        from pathlib import Path
        official=official_adapter(catalog,providers=official_providers,index=official_index,now=clock)
        report['dividendJob']=run_next(store,'official-dividends',official,enabled=True,now=clock)
        baseline=read_legacy(Path(__file__).resolve().parents[2]/'public/content-studio')
        report['dividendReview']=candidate_review(store,baseline)
    return report


def stored_prices(store, entity):
    """Private read model keeps original observations; changed values remain reviewable."""
    by_date={};conflicts=set()
    for record in store.db.execute('SELECT payload FROM observations ORDER BY id'):
        value=json.loads(record['payload'])
        if value.get('entityId')!=entity or value.get('field')!='daily_ohlcv': continue
        day=value['asOfDate']; row=value['value']
        if day in by_date and by_date[day]!=row: conflicts.add(day)
        else: by_date[day]=row
    return {'candles':[by_date[k] for k in sorted(by_date)],'conflictingDates':sorted(conflicts),
            'coverage':'partial','priceBasis':'upstream_unverified'}
