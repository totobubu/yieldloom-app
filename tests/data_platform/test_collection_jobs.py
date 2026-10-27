import tempfile
import unittest
from pathlib import Path
from scripts.data_platform.pipeline import Store
from scripts.data_platform.collection_jobs import enqueue, claim, finish, coverage


class CollectionJobsTest(unittest.TestCase):
    def test_restart_dedup_and_partial_do_not_claim_completeness(self):
        with tempfile.TemporaryDirectory() as d:
            store = Store(Path(d))
            ids = enqueue(store,'isin:example','dividends','2024-12-01','2025-01-31')
            self.assertEqual(len(ids),2)
            self.assertEqual(ids,enqueue(store,'isin:example','dividends','2024-12-01','2025-01-31'))
            first = claim(store,'2026-01-01')
            finish(store,first['id'],outcome='partial')
            store.close()
            store = Store(Path(d))
            self.assertFalse(coverage(store,'isin:example','dividends','2024-12-01','2025-01-31')['complete'])
            self.assertEqual(claim(store,'2026-01-01')['id'],ids[1])
            self.assertIsNone(claim(store,'2026-01-01'))
            store.close()

    def test_evidence_and_requested_period_are_required(self):
        with tempfile.TemporaryDirectory() as d:
            store = Store(Path(d))
            enqueue(store,'isin:example','dividends','2025-01-01','2025-12-31')
            job = claim(store,'2026-01-01')
            with self.assertRaises(ValueError):
                finish(store,job['id'],outcome='complete')
            _,sha = store.document('https://example.test/history',{'status':200,'body':b'explicit historical evidence'},'2026-01-01')
            finish(store,job['id'],outcome='no_dividends',evidence=sha)
            self.assertTrue(coverage(store,'isin:example','dividends','2025-01-01','2025-12-31')['complete'])
            self.assertFalse(coverage(store,'isin:example','dividends','2024-01-01','2025-12-31')['complete'])
            self.assertFalse(coverage(store,'isin:example','market-prices','2025-01-01','2025-12-31')['complete'])
            store.close()

    def test_retry_wait_and_running_job_not_stolen(self):
        with tempfile.TemporaryDirectory() as d:
            store = Store(Path(d))
            enqueue(store,'isin:example','market-prices','2025-01-01','2025-12-31')
            job = claim(store,'2026-01-01')
            self.assertIsNone(claim(store,'2099-01-01'))
            finish(store,job['id'],outcome='retry',retry_at='2026-02-01',error='rate_limited')
            self.assertIsNone(claim(store,'2026-01-31'))
            self.assertEqual(claim(store,'2026-02-01')['id'],job['id'])
            store.close()
