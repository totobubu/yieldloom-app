"""Bounded issuer identity enrichment for exact, officially discovered listings.

Only explicitly labelled ISIN, exchange, currency and listing date can promote a
listing. Fund inception, CIK, name similarity and CUSIP never stand in for them.
"""
from datetime import datetime,timezone
import json
from scripts.data_platform.collection_scope import TARGETS,FUND_ROUTES
from scripts.data_platform.discovery_requests import resolve_registered_listing,valid_isin
from scripts.data_platform.parsers import fact
from scripts.data_platform.pipeline import encode
from scripts.content_pipeline.providers import PROVIDERS
from scripts.content_pipeline.providers.base import SourceCandidate
from scripts.content_pipeline.providers.parsing import parse_date

LABELS={'ticker':'symbol','ticker symbol':'symbol','isin':'isin','exchange':'market',
        'primary exchange':'market','currency':'currency','trading currency':'currency',
        'listing date':'ipoDate','ipo date':'ipoDate','inception date':'fundInceptionDate','cusip':'cusip'}
MARKETS={'NASDAQ':'NASDAQ','NYSE':'NYSE','NYSE ARCA':'NYSEARCA','NYSEARCA':'NYSEARCA',
         'CBOE BZX':'BATS','BATS':'BATS'}


def parse_identity(content,symbol,market):
    from bs4 import BeautifulSoup
    soup=BeautifulSoup(content,'html.parser'); pairs=[]
    for row in soup.select('tr'):
        cells=row.find_all(['th','td'],recursive=False)
        if len(cells)==2: pairs.append(tuple(c.get_text(' ',strip=True) for c in cells))
    for label in soup.select('dt'):
        value=label.find_next_sibling('dd')
        if value: pairs.append((label.get_text(' ',strip=True),value.get_text(' ',strip=True)))
    fields={}
    for label,value in pairs:
        key=LABELS.get(label.strip().lower().rstrip(':'))
        if not key: continue
        value=value.strip()
        if key in {'symbol','isin','currency','market','cusip'}: value=value.upper()
        if key=='market': value=MARKETS.get(value,value)
        if key in {'ipoDate','fundInceptionDate'}: value=parse_date(value)
        if key in fields and fields[key]!=value: raise ValueError('Ambiguous identity fields')
        fields[key]=value
    if fields.get('symbol')!=symbol or fields.get('market')!=market:
        raise ValueError('Issuer identity does not match official listing')
    if fields.get('isin') and not valid_isin(fields['isin']): raise ValueError('Invalid issuer ISIN')
    if fields.get('currency') and len(fields['currency'])!=3: raise ValueError('Invalid currency')
    return fields


def effective_catalog(store,catalog):
    result=[dict(row) for row in catalog]
    if not store.db.execute("SELECT 1 FROM collection.sqlite_master WHERE name='lookup_registrations'").fetchone(): return result
    for row in store.db.execute("SELECT payload FROM collection.lookup_registrations WHERE status='identity_verified'"):
        identity=json.loads(row['payload']).get('reviewedIdentity')
        if not identity: continue
        matches=[r for r in result if r.get('symbol')==identity['symbol'] and r.get('market')==identity['market']]
        if not matches and not any(r.get('symbol')==identity['symbol'] for r in result): result.append(identity)
        elif len(matches)==1 and all(not matches[0].get(k) or matches[0][k]==identity.get(k) for k in ('isin','currency','ipoDate')):
            matches[0].update(identity)
    return result


def enrich_listing(store,listing_id,end,*,catalog,enabled=False,providers=None,now=None):
    if not enabled: return {'status':'disabled'}
    record=store.db.execute('SELECT payload FROM collection.lookup_registrations WHERE listing_id=?',(listing_id,)).fetchone()
    if not record: raise ValueError('Official listing registration required')
    pending=json.loads(record['payload']);symbol,market=pending['symbol'],pending['market']
    if symbol not in TARGETS: return {'status':'outside_acceptance_scope'}
    if any(r.get('symbol')==symbol and r.get('market')!=market for r in catalog):
        return {'status':'identity_conflict','reason':'catalog_exchange_mismatch'}
    # Existing independently reviewed server catalog is already an approved identity source.
    known=resolve_registered_listing(store,listing_id,end,catalog=catalog,now=now)
    if known['status']=='queued': return known
    if symbol not in FUND_ROUTES: return {'status':'identity_enrichment_pending','reason':'official_instrument_identifier_route_unavailable'}
    slug,url=FUND_ROUTES[symbol];adapter=(providers or PROVIDERS)[slug]()
    clock=now or datetime.now(timezone.utc)
    try:
        candidate=SourceCandidate(url=url,metadata={'ticker':symbol,'browserContent':'html'})
        adapter.validate_url(url);document=adapter.fetch(candidate)
        adapter.validate_url(document.source_url)
        if document.source_url!=url: raise ValueError('Unexpected identity document')
        _,sha=store.document(url,{'status':200,'body':document.content},clock.isoformat())
        identity=parse_identity(document.content,symbol,market)
        store.accept({'id':'issuer-identity-'+symbol.lower(),'url':url,'parserVersion':'1'},
            [fact('identity',listing_id,'issuer_listing',identity)],sha,clock.isoformat(),'issuer-identity-v1')
    except Exception:
        return {'status':'identity_enrichment_pending','reason':'official_identity_unverified'}
    required=('isin','currency','ipoDate')
    missing=[k for k in required if not identity.get(k)]
    if missing: return {'status':'identity_enrichment_pending','missingFields':missing,'sourceDocumentId':sha}
    if identity['ipoDate']>end: return {'status':'identity_enrichment_pending','reason':'future_listing_date'}
    matches=[r for r in catalog if r.get('symbol')==symbol and r.get('market')==market]
    if len(matches)>1 or any(any(r.get(k) and r[k]!=identity[k] for k in required) for r in matches):
        return {'status':'identity_conflict'}
    previous=pending.get('reviewedIdentity')
    if previous and any(previous.get(k)!=identity[k] for k in required): return {'status':'identity_conflict'}
    supplemented=[r for r in catalog if r not in matches]+[{**(matches[0] if matches else {}),**identity}]
    result=resolve_registered_listing(store,listing_id,end,catalog=supplemented,now=clock)
    if result['status']=='queued':
        current=json.loads(store.db.execute('SELECT payload FROM collection.lookup_registrations WHERE listing_id=?',(listing_id,)).fetchone()['payload'])
        current['identitySourceDocumentId']=sha
        with store.db: store.db.execute('UPDATE collection.lookup_registrations SET payload=? WHERE listing_id=?',(encode(current),listing_id))
    return result


def enrich_targets(store,symbols,end,*,catalog,enabled=False,providers=None,now=None):
    if not enabled: return []
    if not set(symbols)<=TARGETS: raise ValueError('Outside identity acceptance scope')
    if not store.db.execute("SELECT 1 FROM collection.sqlite_master WHERE name='lookup_registrations'").fetchone(): return []
    results=[]
    for row in store.db.execute('SELECT listing_id,payload FROM collection.lookup_registrations ORDER BY listing_id').fetchall():
        pending=json.loads(row['payload'])
        if pending['symbol'] not in symbols: continue
        if len(results)==2: break
        results.append({'symbol':pending['symbol'],**enrich_listing(store,row['listing_id'],end,
            catalog=catalog,enabled=True,providers=providers,now=now)})
    return results
