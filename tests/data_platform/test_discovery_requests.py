from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from scripts.data_platform.pipeline import Store
from scripts.data_platform.parsers import nasdaq
from scripts.data_platform.discovery_requests import register_lookup

NOW=datetime(2026,1,1,tzinfo=timezone.utc)

class DiscoveryTest(unittest.TestCase):
    def test_exact_listing_registers_once_without_inventing_currency_or_inception(self):
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            source={'id':'nasdaq-listed','url':'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt','parserVersion':'1'}
            raw=b'Symbol|Security Name|Test Issue|ETF\nTEST|Example Company|N|N\nFile Creation Time: 20260101|||\n'
            _,sha=store.document(source['url'],{'status':200,'body':raw},NOW.isoformat())
            store.accept(source,nasdaq(raw,source),sha,NOW.isoformat(),'fixture')
            self.assertEqual(register_lookup(store,'TEST','NYSE',now=NOW)['status'],'unverified')
            self.assertEqual(register_lookup(store,'TSET','NASDAQ',now=NOW)['status'],'unverified')
            with self.assertRaises(ValueError): register_lookup(store,'Example Company','NASDAQ',now=NOW)
            first=register_lookup(store,'test','NASDAQ',now=NOW)
            second=register_lookup(store,'TEST','NASDAQ',now=NOW)
            self.assertTrue(first['registered']);self.assertFalse(first['reused']);self.assertTrue(second['reused'])
            self.assertEqual(first['status'],'identity_enrichment_pending')
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM collection.lookup_registrations').fetchone()[0],1)
            self.assertEqual(register_lookup(store,'TEST','NASDAQ',now=datetime(2026,1,4,tzinfo=timezone.utc))['status'],'unverified')
            store.close()

    def test_verified_catalog_lookup_connects_to_deduplicated_inception_queue(self):
        from scripts.data_platform.discovery_requests import request_collection
        from scripts.data_platform.collection_worker import run_next
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            catalog=[{'symbol':'AAPL','market':'NASDAQ','currency':'USD','isin':'US0378331005','ipoDate':'1980-12-12'}]
            first=request_collection(store,'aapl','NASDAQ','2025-12-31',catalog=catalog,now=NOW)
            second=request_collection(store,'AAPL','NASDAQ','2025-12-31',catalog=catalog,now=NOW)
            self.assertEqual(first,second)
            self.assertEqual(len(first['jobs']['market-prices']['ids']),46)
            self.assertFalse(first['jobs']['dividends']['coverage']['complete'])
            windows=[]
            def adapter(store,job):
                windows.append([job['start'],job['end']])
                return {} # No proof of complete history, so leave partial.
            self.assertEqual(run_next(store,'yahoo-chart',adapter,enabled=True,now=NOW)['status'],'partial')
            self.assertEqual(windows,[['1980-12-12','1980-12-31']])
            store.close()

    def test_pending_listing_requires_reviewed_valid_identity_and_exact_exchange(self):
        import json
        from scripts.data_platform.discovery_requests import resolve_registered_listing,valid_isin
        self.assertTrue(valid_isin('US0378331005'))
        self.assertFalse(valid_isin('US0378331006'))
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d))
            store.db.execute('CREATE TABLE collection.lookup_registrations (listing_id TEXT PRIMARY KEY,payload TEXT,status TEXT)')
            with store.db:
                store.db.execute('INSERT INTO collection.lookup_registrations VALUES (?,?,?)',
                    ('listing:NASDAQ:AAPL',json.dumps({'symbol':'AAPL','market':'NASDAQ'}),'identity_enrichment_pending'))
            row={'symbol':'AAPL','market':'NASDAQ','currency':'USD','isin':'US0378331005','ipoDate':'1980-12-12'}
            for catalog in ([],[{**row,'market':'NYSE'}],[{**row,'isin':'US0378331006'}],[{**row,'ipoDate':None}]):
                result=resolve_registered_listing(store,'listing:NASDAQ:AAPL','2025-12-31',catalog=catalog,now=NOW)
                self.assertEqual(result['status'],'identity_enrichment_pending')
            first=resolve_registered_listing(store,'listing:NASDAQ:AAPL','2025-12-31',catalog=[row],now=NOW)
            second=resolve_registered_listing(store,'listing:NASDAQ:AAPL','2025-12-31',catalog=[row],now=NOW)
            self.assertEqual(first,second)
            self.assertEqual(first['status'],'queued')
            self.assertEqual(store.db.execute('SELECT status FROM collection.lookup_registrations').fetchone()[0],'identity_verified')
            store.close()
