"""Build a private API-compatible long-history candidate; performs no remote writes."""
import math
from datetime import datetime,timezone
from scripts.data_platform.request_bridge import stored_prices
from scripts.data_platform.pipeline import private_path,encode


def build_model(store,instrument):
    entity=f"instrument:isin:{instrument['isin']}:{instrument['market']}"
    saved=stored_prices(store,entity)
    candles=[];excluded=0
    for row in saved['candles']:
        if any(row.get(k) is None for k in ('open','high','low','close')):
            excluded+=1;continue
        values={k:float(row[k]) for k in ('open','high','low','close')}
        if not all(math.isfinite(v) and v>0 for v in values.values()): raise ValueError('Invalid owned price')
        if not values['low']<=min(values['open'],values['close'])<=max(values['open'],values['close'])<=values['high']:
            raise ValueError('Invalid owned OHLC bounds')
        volume=float(row['volume']) if row.get('volume') is not None else None
        if volume is not None and (not math.isfinite(volume) or volume<0): raise ValueError('Invalid owned volume')
        candles.append({'date':row['date'],**values,'volume':volume})
    if not candles: raise ValueError('No complete observed candles to export')
    from scripts.data_platform.collection_status import build_status
    status=build_status(store,instrument,datetime.now(timezone.utc).date().isoformat())
    collection_coverage={row['dataset']:row['coverage'] for row in status['datasets']}
    # Unreviewed price adjustment basis/incomplete OHLC must not certify a calculation.
    collection_coverage['market-prices']['complete']=False
    return {'collectionCoverage':collection_coverage,'schemaVersion':1,'identity':{k:instrument.get(k) for k in ('symbol','isin','market','currency','ipoDate')},
            'symbol':instrument['symbol'],'currency':instrument['currency'],'candles':candles,'events':[],
            'asOf':datetime.now(timezone.utc).isoformat(),'source':'Yieldloom owned history',
            'coverage':{'status':'partial','targetStart':instrument.get('ipoDate'),
                        'reason':'historical_completeness_unverified','excludedIncompleteCandles':excluded,
                        'conflictingDates':saved['conflictingDates']},
            'collectionRequest':{'status':'partial','dataset':'market-prices','targetStart':instrument.get('ipoDate')},
            'revisions':[],'adjustmentBasis':'upstream_unverified'}


def export_model(store,instrument,output):
    model=build_model(store,instrument)
    path=private_path(output)
    if path.exists(): raise ValueError('Read model candidate already exists')
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    path.write_text(encode(model)+'\n')
    return {'symbol':model['symbol'],'candles':len(model['candles']),'published':False}
