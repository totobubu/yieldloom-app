import json
from pathlib import Path
import tempfile
import unittest
from scripts.data_platform.pipeline import Store
from scripts.data_platform.opendart import collect_financials,parse_financials,request_spec

PARAMS=request_spec('00126380',2025,'11011','CFS')
def body(**changes):
    row={'corp_code':'00126380','bsns_year':'2025','reprt_code':'11011','fs_div':'CFS',
         'account_id':'ifrs-full_Revenue','sj_div':'IS','currency':'KRW','thstrm_amount':'1,000',
         'frmtrm_amount':'0','bfefrmtrm_amount':'-','thstrm_nm':'제 57 기',**changes}
    return json.dumps({'status':'000','list':[row]}).encode()

class DartTests(unittest.TestCase):
    def test_period_basis_zero_and_missing_are_distinct(self):
        rows=parse_financials(body(),PARAMS)
        self.assertEqual([r['value'] for r in rows],['1000','0'])
        self.assertTrue(all(r['asOfDate'] is None for r in rows))
        self.assertEqual(rows[0]['qualifiers']['statementBasis'],'CFS')
        for changes in [{'corp_code':'00000000'},{'fs_div':'OFS'},{'reprt_code':'11012'}]:
            with self.assertRaises(ValueError): parse_financials(body(**changes),PARAMS)
    def test_disabled_no_requests_and_no_data_preserves_observations(self):
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d));calls=[]
            def transport(params,key): calls.append(params);return body()
            args=(store,'00126380',2025,'11011','CFS')
            self.assertEqual(collect_financials(*args,transport=transport)['status'],'disabled')
            self.assertEqual(calls,[])
            result=collect_financials(*args,enabled=True,api_key='fixture-secret-key',transport=transport)
            self.assertEqual(result['observations'],2)
            result=collect_financials(*args,enabled=True,api_key='fixture-secret-key',transport=lambda *_:b'{"status":"013"}')
            self.assertEqual(result['status'],'no_data')
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],2)
            for row in store.db.execute('SELECT url FROM documents'):
                self.assertNotIn('crtfc_key',row['url'])
            store.close()
