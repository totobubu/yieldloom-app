import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from datetime import datetime,timezone
from scripts.data_platform.pipeline import Store
from scripts.data_platform.collection_jobs import enqueue
from scripts.data_platform.collection_worker import run_next
from scripts.data_platform.official_backfill import official_adapter,candidate_review
from scripts.content_pipeline.providers.yieldmax import YieldMaxAdapter
from scripts.content_pipeline.models import SourceDocument

ROOT=Path(__file__).resolve().parents[2]
URL='https://yieldmaxetfs.com/our-etfs/tsly/'
RAW=(ROOT/'tests/content_pipeline/fixtures/yieldmax_fund.html').read_bytes()
NOW=datetime(2026,10,27,tzinfo=timezone.utc)

class FixtureYieldMax(YieldMaxAdapter):
    content=RAW
    def fetch(self,candidate): return SourceDocument(self.slug,candidate.url,'html',self.content)

class OfficialBackfillTest(unittest.TestCase):
    def test_official_parser_worker_candidate_builder_validator_and_conflict_gate(self):
        catalog=json.loads((ROOT/'data-v2/catalog-seed.json').read_text())['instruments']
        instrument=next(r for r in catalog if r['symbol']=='TSLY')
        entity=f"instrument:isin:{instrument['isin']}:{instrument['market']}"
        index=[{'ticker':'TSLY','providerSlug':'yieldmax','latest':{'official_url':URL}}]
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);store=Store(root/'state')
            enqueue(store,entity,'dividends','2026-01-01','2026-10-27',source='official-dividends')
            adapter=official_adapter(catalog,providers={'yieldmax':FixtureYieldMax},index=index,now=NOW)
            result=run_next(store,'official-dividends',adapter,enabled=True,now=NOW)
            self.assertEqual(result['status'],'partial')
            event=FixtureYieldMax().parse(SourceDocument('yieldmax',URL,'html',RAW))[0]
            baseline=[{'provider':'yieldmax','ticker':'TSLY','exDate':event.ex_date,'amount':event.distribution_per_share,
                       'currency':'USD','declaredDate':event.declared_date,'recordDate':event.record_date,
                       'payableDate':event.payable_date,'verificationStatus':'official'}]
            review=candidate_review(store,baseline,root/'review')
            self.assertTrue(review['ready']);self.assertFalse(review['published'])
            mini=root/'catalog.json';mini.write_text(json.dumps({'instruments':[instrument]}))
            for command in [
                [sys.executable,'scripts/data_v2/build_release.py','--input',str(root/'review/candidates.json'),'--catalog-input',str(mini),'--release-id','test-official-backfill','--output',str(root/'release')],
                [sys.executable,'scripts/data_v2/validate_snapshot.py','--data-dir',str(root/'release')],
            ]:
                result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            missing={**baseline[0],'exDate':'2026-01-01'}
            self.assertFalse(candidate_review(store,baseline+[missing])['ready'])
            class Correction(FixtureYieldMax): content=RAW.replace(b'0.2127',b'0.2227')
            corrected=official_adapter(catalog,providers={'yieldmax':Correction},index=index,now=NOW)
            # An explicit source recheck supplies another observation for the same event.
            corrected(store,{'entity':entity,'dataset':'dividends','start':'2026-01-01','end':'2026-10-27'})
            review=candidate_review(store,baseline)
            self.assertFalse(review['ready']);self.assertEqual(len(review['conflicts']),1)
            store.close()
