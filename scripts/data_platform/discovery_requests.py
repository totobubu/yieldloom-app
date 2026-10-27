"""Register exact listing lookups from current archived official directory evidence.

This private registry is not the public catalog. Currency, stable instrument ID
and inception must be enriched before scheduling historical financial collection.
"""
from datetime import datetime, timedelta, timezone
import json
import re
from scripts.data_platform.pipeline import encode

SOURCES = ('nasdaq-listed','nasdaq-other-listed')
EXCHANGES = {'N':'NYSE','A':'NYSEAMERICAN','P':'NYSEARCA','Z':'BATS','V':'IEX'}


def register_lookup(store, symbol, market, *, now=None):
    symbol = str(symbol).strip().upper()
    if not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,15}',symbol):
        raise ValueError('Exact ticker required, not a name or search phrase')
    clock = now or datetime.now(timezone.utc)
    matches = []
    for source in SOURCES:
        state = store.state(source)
        success = state.get('lastSuccessAt')
        if not success or state.get('failureCount'):
            continue
        age = clock-datetime.fromisoformat(success)
        if age < timedelta(0) or age > timedelta(hours=48):
            continue
        for identifier in state.get('currentObservationIds',[]):
            stored = store.db.execute('SELECT payload FROM observations WHERE id=?',(identifier,)).fetchone()
            if not stored:
                continue
            observation = json.loads(stored['payload'])
            row = observation.get('value',{})
            row_market = 'NASDAQ' if source == 'nasdaq-listed' else EXCHANGES.get(row.get('Exchange'))
            ticker = row.get('Symbol',row.get('ACT Symbol'))
            if (observation.get('sourceId') != source or observation.get('dataset') != 'identity'
                    or ticker != symbol or row_market != market or row.get('Test Issue') != 'N'):
                continue
            store.raw(observation['sourceDocumentId'])
            matches.append({'symbol':symbol,'market':market,'name':row.get('Security Name'),
                'securityType':'etf' if row.get('ETF') == 'Y' else 'unclassified',
                'sourceId':source,'sourceDocumentId':observation['sourceDocumentId']})
    if len(matches) != 1:
        return {'status':'ambiguous' if matches else 'unverified','registered':False}
    candidate = matches[0]
    key = f'listing:{market}:{symbol}'
    store.db.execute('''CREATE TABLE IF NOT EXISTS collection.lookup_registrations
        (listing_id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL)''')
    with store.db:
        old = store.db.execute('SELECT payload,status FROM collection.lookup_registrations WHERE listing_id=?',(key,)).fetchone()
        if old:
            previous = json.loads(old['payload'])
            if previous['name'] != candidate['name'] or previous['securityType'] != candidate['securityType']:
                return {'status':'identity_conflict','registered':False}
            return {'status':old['status'],'registered':True,'listingId':key,'reused':True}
        store.db.execute('INSERT INTO collection.lookup_registrations VALUES (?,?,?)',
                         (key,encode(candidate),'identity_enrichment_pending'))
    return {'status':'identity_enrichment_pending','registered':True,'listingId':key,'reused':False}


def request_collection(store, symbol, market, end, *, catalog=None, now=None):
    """Server-side lookup handoff. Catalog is trusted configuration, never client JSON."""
    from pathlib import Path
    from datetime import date
    from scripts.data_platform.collection_jobs import enqueue, coverage
    normalized = str(symbol).strip().upper()
    clock = now or datetime.now(timezone.utc)
    if date.fromisoformat(end) > clock.date():
        raise ValueError('Future collection end rejected')
    if catalog is None:
        catalog = json.loads((Path(__file__).resolve().parents[2]/'data-v2/catalog-seed.json').read_text())['instruments']
    matches = [row for row in catalog if row.get('symbol') == normalized and row.get('market') == market and row.get('active',True)]
    if len(matches) > 1:
        return {'status':'ambiguous','registered':False}
    if not matches:
        return register_lookup(store,normalized,market,now=clock)
    instrument=matches[0]
    if (not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{9}[0-9]',instrument.get('isin',''))
            or not re.fullmatch(r'[A-Z]{3}',instrument.get('currency',''))
            or not instrument.get('ipoDate')):
        return {'status':'identity_enrichment_pending','registered':True}
    inception=instrument['ipoDate']
    if date.fromisoformat(inception) > date.fromisoformat(end):
        raise ValueError('Requested interval precedes inception')
    entity=f"instrument:isin:{instrument['isin']}:{market}"
    jobs={}
    for dataset,source in [('market-prices','yahoo-chart'),('dividends','official-dividends')]:
        jobs[dataset]={'ids':enqueue(store,entity,dataset,inception,end,source=source),
                       'coverage':coverage(store,entity,dataset,inception,end)}
    return {'status':'queued','registered':True,'entityId':entity,'jobs':jobs}


def valid_isin(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{9}[0-9]',value): return False
    digits=''.join(str(ord(c)-55) if c.isalpha() else c for c in value)
    total=0
    for index,c in enumerate(reversed(digits)):
        digit=int(c)*(2 if index%2 else 1)
        total+=digit//10+digit%10
    return total%10==0


def resolve_registered_listing(store, listing_id, end, *, catalog=None, now=None):
    """Enrich pending listings only from the server's reviewed catalog; never guess IDs."""
    from pathlib import Path
    row=store.db.execute('SELECT payload FROM collection.lookup_registrations WHERE listing_id=?',(listing_id,)).fetchone()
    if not row: raise ValueError('Unknown pending listing')
    pending=json.loads(row['payload'])
    if catalog is None:
        catalog=json.loads((Path(__file__).resolve().parents[2]/'data-v2/catalog-seed.json').read_text())['instruments']
    matches=[r for r in catalog if r.get('symbol')==pending['symbol'] and r.get('market')==pending['market'] and r.get('active',True)]
    if len(matches)!=1 or not valid_isin(matches[0].get('isin')):
        return {'status':'identity_enrichment_pending','registered':True}
    result=request_collection(store,pending['symbol'],pending['market'],end,catalog=catalog,now=now)
    if result['status']=='queued':
        with store.db:
            pending['reviewedIdentity']={k:matches[0].get(k) for k in ('isin','currency','ipoDate','market','symbol')}
            store.db.execute('UPDATE collection.lookup_registrations SET payload=?,status=? WHERE listing_id=?',
                             (encode(pending),'identity_verified',listing_id))
    return result
