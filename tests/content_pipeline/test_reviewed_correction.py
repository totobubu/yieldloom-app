import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.reviewed_correction import MANIFEST, apply_correction


class ReviewedCorrectionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = ContentDatabase(Path(self.temp.name)/'ledger.sqlite')
        self.db.initialize()
        self.db.upsert_provider('yieldmax','YieldMax','https://yieldmaxetfs.com/')
        self.original = {}
        for ticker, amount in MANIFEST['amounts'].items():
            url=f'https://yieldmaxetfs.com/our-etfs/{ticker.lower()}/'
            doc=SourceDocument('yieldmax',url,'official_fund_history',b'original issuer history')
            source=self.db.add_source_document(doc)
            event=DistributionEvent('yieldmax',ticker,amount,MANIFEST['before']['declared_date'],
                MANIFEST['before']['ex_date'],url,record_date='2026-11-05',payable_date='2026-11-05',
                frequency='weekly',roc_percent='29.28')
            self.original[ticker]=(self.db.upsert_distribution_event(event,source),event,source)
        self.document=SourceDocument('yieldmax',MANIFEST['source'],'official_press_release',
            Path('tests/content_pipeline/fixtures/yieldmax_monthly_2026_11.html').read_bytes())

    def rows(self):
        with self.db.connect() as c:
            return [dict(r) for r in c.execute('SELECT * FROM distribution_events ORDER BY ticker')]

    def test_inspection_does_not_change_source_or_canonical_ledger(self):
        before=self.rows()
        with self.db.connect() as c:
            sources=c.execute('SELECT COUNT(*) FROM source_documents').fetchone()[0]
        self.assertFalse(apply_correction(self.db,self.document)['apply'])
        self.assertEqual(self.rows(),before)
        with self.db.connect() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM source_documents').fetchone()[0],sources)

    def test_correction_preserves_ids_original_observations_revisions_and_roc(self):
        before=self.rows()
        result=apply_correction(self.db,self.document,apply=True)
        self.assertEqual(len(result['events']),3)
        for row in self.rows():
            self.assertEqual(row['id'],self.original[row['ticker']][0])
            self.assertTrue(all(row[k]==v for k,v in MANIFEST['after'].items()))
            self.assertEqual(row['roc_percent'],'29.28')
            self.assertEqual(row['official_url'],MANIFEST['source'])
        with self.db.connect() as c:
            revisions=[json.loads(r[0]) for r in c.execute('SELECT snapshot_json FROM distribution_event_revisions')]
            self.assertEqual(len(revisions),3)
            for old in before:
                revision=next(r for r in revisions if r['ticker']==old['ticker'])
                self.assertTrue(all(revision[k]==v for k,v in MANIFEST['before'].items()))
                self.assertEqual(revision['source_document_id'],old['source_document_id'])
            self.assertEqual(c.execute('SELECT COUNT(*) FROM distribution_observations').fetchone()[0],6)
        again=apply_correction(self.db,self.document,apply=True)
        self.assertTrue(all(r['alreadyApplied'] for r in again['events']))
        with self.db.connect() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM distribution_event_revisions').fetchone()[0],3)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM distribution_observations').fetchone()[0],6)

    def test_later_stale_or_conflicting_source_cannot_resurrect_or_revert(self):
        apply_correction(self.db,self.document,apply=True)
        before=self.rows()
        for ticker,(id,event,source) in self.original.items():
            self.assertEqual(self.db.upsert_distribution_event(event,source),id)
            self.assertEqual(self.db.upsert_distribution_event(event,source),id)
            changed=replace(event,distribution_per_share='9.9999')
            self.db.upsert_distribution_event(changed,source)
            corrected=replace(event,declared_date='2026-11-03',record_date='2026-11-04',frequency='monthly')
            self.db.upsert_distribution_event(corrected,source)
        self.assertEqual(self.rows(),before)
        with self.db.connect() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM reviewed_correction_observations').fetchone()[0],9)

    def test_changed_before_or_source_rejects_entire_batch(self):
        with self.db.connect() as c:
            c.execute("UPDATE distribution_events SET distribution_per_share='1.0000' WHERE ticker='SOXY'")
        before=self.rows()
        with self.assertRaisesRegex(ValueError,'existing event changed'):
            apply_correction(self.db,self.document,apply=True)
        self.assertEqual(self.rows(),before)
        with self.db.connect() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM reviewed_distribution_corrections').fetchone()[0],0)
        wrong=replace(self.document,content=self.document.content.replace(b'$0.4977',b'$0.0001'))
        with self.assertRaises(ValueError):
            apply_correction(self.db,wrong,apply=True)
        self.assertEqual(self.rows(),before)

    def test_cli_exports_corrected_history_and_workflow_outputs(self):
        import io
        from contextlib import chdir, redirect_stdout
        from unittest.mock import patch
        from scripts.content_pipeline.reviewed_correction import main
        from scripts.content_pipeline.validate_refresh_outputs import validate
        root=Path(self.temp.name)
        # Prices are already present in the restored public snapshot. The
        # correction must preserve them without starting a price collector.
        public=root/'public/content-studio'
        public.mkdir(parents=True)
        (public/'price-index.json').write_text('{"source":"yahoo_eod","prices":{}}')
        (public/'price-quality.json').write_text('{"source":"yahoo_eod","findings":[]}')
        output=root/'outputs.txt' 
        args=['reviewed_correction.py','--correction',MANIFEST['id'],'--apply',
              '--db',str(self.db.path),'--github-output',str(output)]
        with chdir(root), patch('sys.argv',args), \
             patch('scripts.content_pipeline.reviewed_correction.YieldMaxAdapter.fetch',return_value=self.document), \
             redirect_stdout(io.StringIO()):
            self.assertEqual(main(),0)
            validate(root/'public/content-studio')
            for ticker in MANIFEST['amounts']:
                data=json.loads((root/f'public/content-studio/distribution-ticker-{ticker.lower()}.json').read_text())
                self.assertEqual(len(data['history']),1)
                self.assertEqual(data['history'][0]['declared_date'],'2026-11-03')
                self.assertEqual(data['history'][0]['frequency'],'monthly')
        self.assertIn('stateChanged=true',output.read_text())
        self.assertIn('publish=true',output.read_text())

    def test_mid_batch_failure_rolls_back_all_canonical_changes(self):
        import sqlite3
        before=self.rows()
        with self.db.connect() as c:
            c.executescript("""CREATE TRIGGER fail_second_correction BEFORE UPDATE ON distribution_events
                WHEN NEW.ticker='RNTY' AND NEW.frequency='monthly'
                BEGIN SELECT RAISE(ABORT,'fixture failure'); END;""")
        with self.assertRaises(sqlite3.IntegrityError):
            apply_correction(self.db,self.document,apply=True)
        self.assertEqual(self.rows(),before)
        with self.db.connect() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM reviewed_distribution_corrections').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM distribution_event_revisions').fetchone()[0],0)

    def test_october_and_other_tickers_remain_unchanged(self):
        _,event,source=self.original['BIGY']
        october=replace(event,declared_date='2026-10-06',ex_date='2026-10-07',record_date='2026-10-07',
                        payable_date='2026-10-08',frequency='monthly',distribution_per_share='0.5323')
        october_id=self.db.upsert_distribution_event(october,source)
        other_id=self.db.upsert_distribution_event(replace(event,ticker='TSLY'),source)
        before={r['id']:r for r in self.rows() if r['id'] in (october_id,other_id)}
        apply_correction(self.db,self.document,apply=True)
        after={r['id']:r for r in self.rows() if r['id'] in (october_id,other_id)}
        self.assertEqual(before,after)

    def test_duplicate_existing_same_ex_date_is_never_merged_implicitly(self):
        _,event,source=self.original['BIGY']
        self.db.upsert_distribution_event(replace(event,declared_date='2026-11-03'),source)
        before=self.rows()
        with self.assertRaisesRegex(ValueError,'exactly one'):
            apply_correction(self.db,self.document,apply=True)
        self.assertEqual(self.rows(),before)


if __name__=='__main__':
    unittest.main()
