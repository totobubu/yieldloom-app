from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
import unittest
from scripts.data_platform.pipeline import Store
from scripts.data_platform.parsers import nasdaq
from scripts.data_platform.discovery_requests import register_lookup
from scripts.data_platform.identity_enrichment import enrich_listing,effective_catalog,parse_identity
from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.providers.yieldmax import YieldMaxAdapter

NOW=datetime(2026,10,27,tzinfo=timezone.utc)
HTML=b'<table><tr><td>Ticker</td><td>TSLY</td></tr><tr><td>ISIN</td><td>US88636J4444</td></tr><tr><td>Exchange</td><td>NYSE Arca</td></tr><tr><td>Currency</td><td>USD</td></tr><tr><td>Listing Date</td><td>November 23, 2022</td></tr></table>'
class Issuer(YieldMaxAdapter):
    body=HTML
    calls=0
    def fetch(self,candidate):
        Issuer.calls+=1
        return SourceDocument(self.slug,candidate.url,'html',self.body)

def register(store):
    source={'id':'nasdaq-other-listed','url':'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt','parserVersion':'1'}
    body=b'ACT Symbol|Security Name|Exchange|Test Issue|ETF\nTSLY|YieldMax TSLA ETF|P|N|Y\nFile Creation Time: 20261027||||\n'
    _,sha=store.document(source['url'],{'status':200,'body':body},NOW.isoformat())
    store.accept(source,nasdaq(body,source),sha,NOW.isoformat(),'fixture')
    return register_lookup(store,'TSLY','NYSEARCA',now=NOW)['listingId']

class IdentityEnrichmentTest(unittest.TestCase):
    def test_official_listing_and_issuer_proof_promote_private_identity_without_public_edit(self):
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d));listing=register(store);Issuer.calls=0
            self.assertEqual(enrich_listing(store,listing,'2026-10-27',catalog=[])['status'],'disabled')
            self.assertEqual(Issuer.calls,0)
            conflict=enrich_listing(store,listing,'2026-10-27',catalog=[{'symbol':'TSLY','market':'NYSE'}],enabled=True,providers={'yieldmax':Issuer},now=NOW)
            self.assertEqual(conflict['status'],'identity_conflict');self.assertEqual(Issuer.calls,0)
            result=enrich_listing(store,listing,'2026-10-27',catalog=[],enabled=True,providers={'yieldmax':Issuer},now=NOW)
            self.assertEqual(result['status'],'queued')
            catalog=effective_catalog(store,[])
            self.assertEqual(catalog[0]['isin'],'US88636J4444')
            payload=json.loads(store.db.execute('SELECT payload FROM collection.lookup_registrations').fetchone()[0])
            self.assertTrue(store.raw(payload['identitySourceDocumentId']))
            second=enrich_listing(store,listing,'2026-10-27',catalog=catalog,enabled=True,providers={'yieldmax':Issuer},now=NOW)
            self.assertEqual(result,second);self.assertEqual(Issuer.calls,1)
            store.close()

    def test_inception_cannot_replace_listing_and_conflicts_are_held(self):
        class Inception(Issuer): body=HTML.replace(b'Listing Date',b'Inception Date')
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d));listing=register(store)
            result=enrich_listing(store,listing,'2026-10-27',catalog=[],enabled=True,providers={'yieldmax':Inception},now=NOW)
            self.assertEqual(result['missingFields'],['ipoDate'])
            self.assertEqual(effective_catalog(store,[]),[])
            result=enrich_listing(store,listing,'2026-10-27',catalog=[{'symbol':'TSLY','market':'NYSEARCA','currency':'KRW'}],enabled=True,providers={'yieldmax':Issuer},now=NOW)
            self.assertEqual(result['status'],'identity_conflict')
            store.close()
        for changed in [HTML.replace(b'TSLY',b'OTHER'),HTML.replace(b'US88636J4444',b'US88636J4445'),HTML.replace(b'NYSE Arca',b'NASDAQ'),HTML.replace(b'</table>',b'<tr><td>ISIN</td><td>US0378331005</td></tr></table>')]:
            with self.assertRaises(ValueError):parse_identity(changed,'TSLY','NYSEARCA')
