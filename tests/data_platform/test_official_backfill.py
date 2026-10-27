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

    def test_missing_index_uses_registered_issuer_and_fallback_preserves_both_routes(self):
        from scripts.content_pipeline.providers.schwab import SchwabAdapter
        from scripts.content_pipeline.models import DistributionEvent
        from scripts.content_pipeline.providers.base import CollectionError
        calls=[]
        class Schwab(SchwabAdapter):
            def fetch(self,candidate):
                calls.append(candidate.url)
                return SourceDocument(self.slug,candidate.url,'html',b'fixture')
            def parse(self,document):
                return [DistributionEvent(provider_slug=self.slug,ticker='SCHD',distribution_per_share='0.25',
                    declared_date='2026-09-20',ex_date='2026-09-23',record_date='2026-09-23',payable_date='2026-09-26',
                    currency='USD',official_url=document.source_url,verification_status='needs_review')]
        instrument={'symbol':'SCHD','isin':'US8085247976','market':'NYSE','currency':'USD','ipoDate':'2011-10-20'}
        job={'entity':'instrument:isin:US8085247976:NYSE','dataset':'dividends','start':'2026-01-01','end':'2026-10-27'}
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            result=official_adapter([instrument],index=[],providers={'schwab':Schwab},now=NOW)(store,job)
            self.assertEqual(result['outcome'],'partial');self.assertEqual(len(calls),1)
            review=candidate_review(store,[])
            self.assertEqual(review['candidateCount'],0);self.assertEqual(len(review['rejected']),1)
            class Denied(Schwab):
                def fetch(self,candidate):
                    calls.append(candidate.url);raise CollectionError('denied',code='blocked')
            calls.clear()
            with self.assertRaises(RuntimeError):
                official_adapter([instrument],index=[{'ticker':'SCHD','providerSlug':'schwab','latest':{'official_url':'https://www.schwabassetmanagement.com/products/schd/history'}}],providers={'schwab':Denied},now=NOW)(store,job)
            self.assertEqual(len(calls),1) # Denial never changes URL to bypass access control.
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],1)
            store.close()

    def test_empty_primary_uses_secondary_and_cross_route_conflicts_hold_candidate(self):
        calls=[]
        secondary='https://yieldmaxetfs.com/tsly-distribution-announcement/'
        class Routes(FixtureYieldMax):
            def fetch(self,candidate):
                calls.append(candidate.url)
                return SourceDocument(self.slug,candidate.url,'html',RAW,metadata={'ticker':'TSLY'})
            def parse(self,document):
                if document.source_url==URL:return []
                return super().parse(document)
        instrument=next(r for r in json.loads((ROOT/'data-v2/catalog-seed.json').read_text())['instruments'] if r['symbol']=='TSLY')
        job={'entity':f"instrument:isin:{instrument['isin']}:{instrument['market']}",'dataset':'dividends','start':'2026-01-01','end':'2026-10-27'}
        index=[{'ticker':'TSLY','providerSlug':'yieldmax','latest':{'official_url':secondary}}]
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            official_adapter([instrument],index=index,providers={'yieldmax':Routes},now=NOW)(store,job)
            self.assertEqual(calls,[URL,secondary])
            self.assertEqual(candidate_review(store,[])['candidateCount'],1)
            class Conflict(Routes):
                def parse(self,document):
                    if document.source_url==URL:
                        document=SourceDocument(self.slug,URL,'html',RAW.replace(b'0.2127',b'0.2227'))
                    return FixtureYieldMax.parse(self,document)
            official_adapter([instrument],index=index,providers={'yieldmax':Conflict},now=NOW)(store,job)
            self.assertEqual(len(candidate_review(store,[])['conflicts']),1)
            store.close()

    def test_ivv_without_published_history_uses_existing_real_parser(self):
        from scripts.content_pipeline.providers.ishares import ISharesAdapter
        class IShares(ISharesAdapter):
            def fetch(self,candidate):
                return SourceDocument(self.slug,candidate.url,'html',(ROOT/'tests/content_pipeline/fixtures/ishares_ivv.txt').read_bytes(),metadata=candidate.metadata)
        instrument=next(r for r in json.loads((ROOT/'data-v2/catalog-seed.json').read_text())['instruments'] if r['symbol']=='IVV')
        job={'entity':f"instrument:isin:{instrument['isin']}:{instrument['market']}",'dataset':'dividends','start':'2026-01-01','end':'2026-10-27'}
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            result=official_adapter([instrument],index=[],providers={'ishares':IShares},now=NOW)(store,job)
            self.assertEqual(result['outcome'],'partial')
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],2)
            self.assertFalse(candidate_review(store,[])['ready'])
            store.close()

    def test_bac_existing_official_parser_keeps_unknown_ex_date_unapproved(self):
        url='https://newsroom.bankofamerica.com/content/newsroom/press-releases/2026/10/stock-dividends.html'
        body=b'<p>October 21, 2026 at 4:15 PM Eastern</p><p>Bank of America Corporation today announced a regular quarterly cash dividend on Bank of America common stock of $0.32 per share, payable on December 24, 2026 to shareholders of record as of December 4, 2026.</p>'
        def fetcher(target):
            return body if target==url else ('<a href="'+url+'">Common stock dividend</a>').encode()
        instrument={'symbol':'BAC','isin':'US0605051046','market':'NYSE','currency':'USD','ipoDate':'1973-02-21'}
        job={'entity':'instrument:isin:US0605051046:NYSE','dataset':'dividends','start':'2026-01-01','end':'2026-10-27'}
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            result=official_adapter([instrument],index=[],issuer_fetcher=fetcher,now=NOW)(store,job)
            self.assertEqual(result['outcome'],'partial')
            row=json.loads(store.db.execute('SELECT payload FROM observations').fetchone()[0])
            self.assertIsNone(row['value']['exDate']);self.assertEqual(row['value']['amountRaw'],'0.32')
            self.assertEqual(candidate_review(store,[])['candidateCount'],0)
            store.close()
