import importlib.util
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from api.toss_extractor import parse_cash_transaction_lines

spec = importlib.util.spec_from_file_location('api.portfolio_import', Path(__file__).resolve().parents[1] / 'api/portfolio-import.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CashImportTest(unittest.TestCase):
    def test_local_and_foreign_cash_are_not_counted_twice(self):
        won = parse_cash_transaction_lines(['2026.10.15 원화입금 0.00 0 100,000 100,000 0 0 0 0 0 100,000'],0)
        self.assertEqual((won['currency'],won['amount'],won['suggestedKind']),('KRW',100000,'external_deposit'))
        fx = parse_cash_transaction_lines(['2026.10.15 환전원화출금 1,400.00 0 42,000 42,000 0 0 0 0 0 58,000'],0)
        self.assertEqual(fx['suggestedKind'],'exchange')
        usd = parse_cash_transaction_lines(['2026.10.15 외화입금 1,400.00 0 140,000 140,000 0 0 0 0 0 182,000','($ 100.00) ($ 100.00) ($ 0.00) ($ 0.00) ($ 0.00) ($ 0.00) ($ 130.00)'],0)
        self.assertEqual((usd['currency'],usd['amount'],usd['balance']),('USD',100,130))

    def test_uncertain_layout_and_security_dividends_do_not_become_external_deposits(self):
        self.assertEqual(parse_cash_transaction_lines(['2026.10.15 외화입금 숫자 열이 부족함'],0),{'unparsed':True})
        self.assertEqual(parse_cash_transaction_lines(['2026.10.15 외화입금 1,400.00 0 140,000 140,000 0 0 0 0 0 182,000'],0),{'unparsed':True})
        self.assertIsNone(parse_cash_transaction_lines(['2026.10.15 외화증권배당금입금 ETF 1,400.00 0 140,000 140,000 0 0 0 0 0 182,000','(US88636X8801)'],0))

    def test_cash_review_does_not_require_a_security_mapping_or_write_classifications(self):
        db=MagicMock(); db.collection.return_value.document.return_value.collection.return_value.stream.return_value=[]
        item={'kind':'cash','code':'CASH','date':'20261015','rawType':'원화입금','currency':'KRW','amount':100000,'balance':100000,'suggestedKind':'external_deposit','type':'cash'}
        with patch.object(module,'security_mapping') as mapping:
            rows=module.review_rows(db,'owner',[item])
            self.assertEqual(rows[0]['status'],'ready'); mapping.assert_not_called()
            result=module.persist_items(db,{'uid':'owner'},[item]);self.assertEqual(result['cashCount'],1);mapping.assert_not_called()
        writes=db.batch.return_value.set.call_args_list
        self.assertEqual(len(writes),2) # portfolio metadata + raw cash; no confirmed principal
        self.assertTrue(all(call.args[1].get('classification') is None for call in writes))

    def test_cash_identity_keeps_real_repeated_rows_and_ignores_instrument_mapping(self):
        row={'kind':'cash','date':'20261015','rawType':'원화입금','currency':'KRW','amount':100,'balance':200,'occurrence':0}
        self.assertNotEqual(module.stable_id(row),module.stable_id({**row,'balance':300}))
        self.assertNotEqual(module.stable_id(row),module.stable_id({**row,'occurrence':1}))
