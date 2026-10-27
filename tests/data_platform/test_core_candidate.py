from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlparse,parse_qs
from scripts.data_platform.pipeline import Store,digest,encode
from scripts.data_platform.identity_enrichment import enrich_listing,effective_catalog
from scripts.data_platform.request_bridge import process_requests
from scripts.data_platform.official_backfill import official_adapter
from scripts.data_platform.collection_worker import run_next
from scripts.data_platform.core_candidate import build_candidate,validate_core
from test_identity_enrichment import register,Issuer,NOW
from test_official_backfill import FixtureYieldMax,URL

class Remote:
    def __init__(self,identity):self.identity=identity
    def get(self,key):return json.dumps({'schemaVersion':1,'identity':self.identity,'requestedThrough':'2026-10-27'}).encode(),'fixture-etag'

class CoreCandidateTest(unittest.TestCase):
    def test_discovery_enrichment_queue_real_parsers_owned_model_core_validator_all_connected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);store=Store(root/'state')
            listing=register(store)
            self.assertEqual(enrich_listing(store,listing,'2026-10-27',catalog=[],enabled=True,providers={'yieldmax':Issuer},now=NOW)['status'],'queued')
            catalog=effective_catalog(store,[]);instrument=catalog[0]
            identity={k:instrument[k] for k in ('symbol','isin','market','currency','ipoDate')}
            def market(url):
                stamp=int(parse_qs(urlparse(url).query)['period1'][0])+43200
                return json.dumps({'chart':{'result':[{'meta':{'symbol':'TSLY','currency':'USD'},'timestamp':[stamp],
                    'indicators':{'quote':[{'open':[10],'high':[12],'low':[9],'close':[11],'volume':[10]}]},
                    'events':{'dividends':{'1':{'date':stamp,'amount':0.1234}},'splits':{'1':{'date':stamp,'numerator':1,'denominator':2}}}}]}}).encode()
            report=process_requests(store,Remote(identity),['TSLY'],[],enabled=True,now=NOW,fetcher=market,max_jobs=5)
            self.assertEqual(report['requests'][0]['status'],'queued')
            self.assertEqual(len(report['jobs']),5)
            adapter=official_adapter(catalog,index=[],providers={'yieldmax':FixtureYieldMax},now=NOW)
            for _ in range(5): run_next(store,'official-dividends',adapter,enabled=True,now=NOW)
            candidate=build_candidate(store,[],[],['TSLY'],root/'candidate','acceptance-tsly',now=NOW)
            self.assertTrue(candidate['snapshotValid']);self.assertTrue(candidate['candidateBuilt'])
            self.assertEqual(candidate['priceModelCount'],1)
            self.assertEqual(candidate['dividendReview']['candidateCount'],1)
            self.assertFalse(candidate['readyForPublication']);self.assertFalse(candidate['replacementAllowed'])
            self.assertIn('adjustment_basis_unverified',{r['reason'] for r in candidate['blockers']})
            model=json.loads((root/'candidate/core/market-prices/TSLY.json').read_text())
            self.assertEqual(len(model['candles']),5)
            self.assertFalse(model['collectionCoverage']['dividends']['complete'])
            self.assertGreater(len(candidate['sourceDocuments']),1)
            self.assertFalse((root/'candidate/core/current.json').exists())
            with self.assertRaises(ValueError): build_candidate(store,[],[],['TSLY'],root/'candidate','same')
            model['collectionCoverage']['market-prices']['complete']=True
            path=root/'candidate/core/market-prices/TSLY.json'
            path.write_text(encode(model))
            manifest_path=root/'candidate/core/manifest.json'
            manifest=json.loads(manifest_path.read_text())
            for entry in manifest['files']:
                if entry['path']=='market-prices/TSLY.json':entry['sha256']=digest(path.read_bytes())
            manifest_path.write_text(encode(manifest))
            with self.assertRaises(ValueError): validate_core(root/'candidate/core')
            (root/'candidate/core/market-prices/TSLY.json').write_text('{}')
            with self.assertRaises(ValueError): validate_core(root/'candidate/core')
            with self.assertRaises(ValueError): build_candidate(store,[],[],['UNKNOWN'],root/'other','invalid')
            store.close()
