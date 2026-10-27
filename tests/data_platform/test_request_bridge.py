import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from datetime import datetime,timezone
from urllib.parse import urlparse,parse_qs
from scripts.data_platform.pipeline import Store
from scripts.data_platform.request_bridge import process_requests,stored_prices
from scripts.data_platform.checkpoints import MissingObject

ROOT=Path(__file__).resolve().parents[2]
NODE=r'''
import { createCandleLedger } from './lib/candle-ledger.js';
import { createStockCandleLoader } from './api/stock-prices.js';
const objects=new Map(); let revision=0;
const storage={async send({input:i}) {
 const old=objects.get(i.Key);
 if(i.Body===undefined) {
  if(!old) throw Object.assign(Error('missing'),{name:'NoSuchKey'});
  return {ETag:old.etag,Body:{transformToString:async()=>old.body}};
 }
 if((i.IfNoneMatch==='*'&&old)||(i.IfMatch&&i.IfMatch!==old?.etag)) throw Object.assign(Error('conflict'),{$metadata:{httpStatusCode:412}});
 objects.set(i.Key,{body:i.Body,etag:String(++revision)}); return {};
}};
const ledger=createCandleLedger({storage,bucket:'test'});
const load=createStockCandleLoader({getLedger:()=>ledger});
const fetcher=async()=>({ok:true,json:async()=>({chart:{result:[{
 meta:{symbol:'AAPL',currency:'USD',exchangeName:'NMS',exchangeTimezoneName:'America/New_York'},
 timestamp:[1767272400],indicators:{quote:[{open:[100],high:[110],low:[90],close:[101],volume:[10]}]}}
]}})});
await Promise.all([load('AAPL',fetcher),load('aapl',fetcher)]);
console.log(JSON.stringify(Object.fromEntries(objects)));
'''
class Remote:
    def __init__(self,objects):self.objects=objects
    def get(self,key):
        if key not in self.objects: raise MissingObject(key)
        row=self.objects[key];return row['body'].encode(),row['etag']

class RequestBridgeTest(unittest.TestCase):
    def test_real_api_request_to_queue_provider_parser_storage_and_read_model(self):
        objects=json.loads(subprocess.run(['node','--input-type=module','-e',NODE],cwd=ROOT,text=True,capture_output=True,check=True).stdout)
        catalog=json.loads((ROOT/'data-v2/catalog-seed.json').read_text())['instruments']
        calls=[]
        def provider(url):
            calls.append(url)
            if 'query1.' in url: raise RuntimeError('temporary provider failure')
            stamp=int(parse_qs(urlparse(url).query)['period1'][0])+43200
            return json.dumps({'chart':{'result':[{'meta':{'symbol':'AAPL','currency':'USD','exchangeTimezoneName':'America/New_York'},
                'timestamp':[stamp],'indicators':{'quote':[{'open':[10],'high':[12],'low':[9],'close':[11],'volume':[100]}]}}]}}).encode()
        with tempfile.TemporaryDirectory() as directory:
            store=Store(Path(directory))
            result=process_requests(store,Remote(objects),['AAPL'],catalog,enabled=True,fetcher=provider)
            self.assertEqual(result['requests'][0]['status'],'queued')
            self.assertEqual(result['jobs'][0]['status'],'partial')
            self.assertEqual(len(calls),2)
            row=store.db.execute("SELECT entity,start FROM collection.jobs WHERE status='partial'").fetchone()
            saved=stored_prices(store,row['entity'])
            self.assertEqual(saved['candles'][0]['date'],row['start'])
            self.assertEqual(saved['candles'][0]['close'],'11')
            from scripts.data_platform.owned_price_model import export_model
            instrument=next(r for r in catalog if r['symbol']=='AAPL')
            candidate=Path(directory)/'review'/'owned-aapl.json'
            self.assertFalse(export_model(store,instrument,candidate)['published'])
            model=json.loads(candidate.read_text())
            self.assertEqual(model['candles'][0]['close'],11)
            self.assertEqual(model['coverage']['status'],'partial')
            with self.assertRaises(ValueError): export_model(store,instrument,candidate)
            count=store.db.execute('SELECT COUNT(*) FROM collection.jobs').fetchone()[0]
            from scripts.data_platform.request_bridge import receive_requests
            receive_requests(store,Remote(objects),['AAPL'],catalog,datetime.now(timezone.utc))
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM collection.jobs').fetchone()[0],count)
            entity=row['entity'];store.close();store=Store(Path(directory))
            self.assertEqual(stored_prices(store,entity),saved)
            def failed(_): raise RuntimeError('provider offline')
            result=process_requests(store,Remote(objects),['AAPL'],catalog,enabled=True,fetcher=failed)
            self.assertEqual(result['jobs'][0]['status'],'retry')
            self.assertEqual(stored_prices(store,entity),saved)
            store.close()

    def test_runner_checkpoints_request_jobs_and_saved_observations(self):
        from scripts.data_platform.run import run
        from scripts.data_platform.checkpoints import restore
        from test_checkpoints import MemoryObjects
        from test_pipeline import registry
        objects=json.loads(subprocess.run(['node','--input-type=module','-e',NODE],cwd=ROOT,text=True,capture_output=True,check=True).stdout)
        remote=MemoryObjects()
        for key,value in objects.items():
            if key.startswith('market/v1/requests/'):
                remote.put(key,value['body'].encode())
        def provider(url):
            stamp=int(parse_qs(urlparse(url).query)['period1'][0])+43200
            return json.dumps({'chart':{'result':[{'meta':{'symbol':'AAPL','currency':'USD'},'timestamp':[stamp],
                'indicators':{'quote':[{'open':[10],'high':[12],'low':[9],'close':[11],'volume':[100]}]}}]}}).encode()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);clock=datetime.now(timezone.utc)
            result=run(remote,root/'one',registry(),'request-run',True,transport=lambda *_:self.fail('Targeted run must not collect unrelated sources'),now=clock,
                       request_symbols=['AAPL'],request_fetcher=provider,write_status=True,prepare_candidate=True)
            self.assertEqual(result['requestedCollection']['jobs'][0]['status'],'partial')
            self.assertTrue(result['coreCandidate']['candidateBuilt'])
            self.assertFalse(result['coreCandidate']['readyForPublication'])
            self.assertTrue((root/'one/review/core-candidate/core/manifest.json').exists())
            status=json.loads(remote.get('market/v1/status/AAPL.json')[0])
            self.assertEqual(status['datasets'][0]['status'],'partial')
            self.assertIsNotNone(status['datasets'][0]['observedStart'])
            self.assertFalse(status['datasets'][0]['coverage']['complete'])
            restore(remote,root/'restored')
            store=Store(root/'restored')
            entity=store.db.execute("SELECT entity FROM collection.jobs WHERE status='partial'").fetchone()['entity']
            self.assertEqual(len(stored_prices(store,entity)['candles']),1)
            store.close()
            from unittest.mock import patch
            with patch('scripts.data_platform.core_candidate.build_candidate',side_effect=ValueError('invalid candidate')):
                failed=run(remote,root/'two',registry(),'candidate-failed',request_symbols=['AAPL'],
                    request_fetcher=provider,prepare_candidate=True,now=clock)
            self.assertFalse(failed['coreCandidate']['candidateBuilt'])
            self.assertEqual(failed['checkpoint'],'saved')

    def test_forged_identity_does_not_enqueue_or_fetch(self):
        objects=json.loads(subprocess.run(['node','--input-type=module','-e',NODE],cwd=ROOT,text=True,capture_output=True,check=True).stdout)
        key='market/v1/requests/AAPL.json'
        request=json.loads(objects[key]['body']);request['identity']['market']='NYSE'
        objects[key]['body']=json.dumps(request)
        catalog=json.loads((ROOT/'data-v2/catalog-seed.json').read_text())['instruments']
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            result=process_requests(store,Remote(objects),['AAPL'],catalog,enabled=True,
                                    fetcher=lambda _:self.fail('Unverified request must not fetch'))
            self.assertEqual(result['requests'][0]['status'],'invalid_request')
            self.assertEqual(result['jobs'][0]['status'],'idle')
            store.close()
