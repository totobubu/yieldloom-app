from pathlib import Path
import json
import tempfile
import unittest
from scripts.data_platform.pipeline import Store, encode
from scripts.data_platform.market_import import ingest, prepare, prices, reconcile
from scripts.data_platform.checkpoints import backup, restore
from test_checkpoints import MemoryObjects


def row(**changes):
    return {'entityId': 'instrument:isin:US4642872000', 'asOfDate': '2026-10-21',
            'currency': 'USD', 'priceBasis': 'unadjusted', 'coverage': 'close_only',
            'close': '100.0000', 'volume': None, **changes}


def batch(rows=None, actions=None, **changes):
    return encode({'schemaVersion': 1, 'sourceId': 'test-provider', 'sourceUrl': 'https://example.com/history',
                   'prices': rows if rows is not None else [row()], 'actions': actions or [], **changes}).encode()


class MarketImportTests(unittest.TestCase):
    def test_incremental_import_keeps_history_and_corrects_without_duplicates(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            try:
                self.assertEqual(ingest(store, batch())['new'], 1)
                self.assertEqual(ingest(store, batch())['unchanged'], 1)
                ingest(store, batch([row(asOfDate='2026-10-22')]))
                self.assertEqual(len(prices(store, 'test-provider')), 2)
                self.assertEqual(ingest(store, batch([row(close='101.0000')]))['revised'], 1)
                revisions = store.db.execute('SELECT payload FROM market_revisions ORDER BY revision DESC').fetchall()
                self.assertEqual(json.loads(revisions[0][0])['supersedesRevision'], 1)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM market_revisions').fetchone()[0], 3)
                self.assertEqual(len(prices(store, 'test-provider')), 2)
            finally:
                store.close()

    def test_new_document_adds_evidence_without_revising_identical_value(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            try:
                ingest(store, batch())
                result = ingest(store, batch(note='provider metadata changed'))
                self.assertEqual(result['unchanged'], 1)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM market_evidence').fetchone()[0], 2)
                self.assertFalse(store.db.execute("SELECT 1 FROM collection.cache WHERE url LIKE 'https:%'").fetchone())
            finally:
                store.close()

    def test_invalid_or_duplicate_batch_is_rejected_before_archival(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            try:
                for body in [batch([row(), row(asOfDate='2026-10-22', close='0')]), batch([row(), row()]), batch([row(sourceId='override')]), batch([])]:
                    with self.assertRaises(ValueError):
                        ingest(store, body)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM documents').fetchone()[0], 0)
            finally:
                store.close()

    def test_actions_use_stable_event_id_and_retain_effective_date_correction(self):
        action = {'entityId': row()['entityId'], 'eventId': 'split-1', 'effectiveDate': '2026-10-01',
                  'actionType': 'split', 'newShares': '2', 'oldShares': '1'}
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            try:
                ingest(store, batch([], [action]))
                result = ingest(store, batch([], [{**action, 'effectiveDate': '2026-10-02'}]))
                self.assertEqual(result['revised'], 1)
                del action['eventId']
                with self.assertRaisesRegex(ValueError, 'eventId'):
                    ingest(store, batch([], [action]))
            finally:
                store.close()

    def test_market_ledger_and_original_bytes_survive_checkpoint_restore(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'original')
            ingest(store, batch())
            remote = MemoryObjects()
            manifest = backup(store, remote, None, 'market-test')
            store.close()
            restore(remote, Path(root) / 'restored')
            recovered = Store(Path(root) / 'restored')
            try:
                self.assertEqual(prices(recovered, 'test-provider')[0]['close'], '100.0000')
                sha = recovered.db.execute('SELECT sha FROM documents').fetchone()[0]
                self.assertEqual(recovered.raw(sha), batch())
                self.assertEqual(len(manifest['files']), 3)
            finally:
                recovered.close()

    def test_comparison_refuses_mixed_basis_and_adjustment_vintages(self):
        def canonical(**changes):
            return {**row(**changes), 'sourceId': 'provider', 'sourceDocumentId': 'a' * 64}
        left = [canonical(), canonical(asOfDate='2026-10-20', priceBasis='split_adjusted', adjustmentAsOfDate='2026-10-21')]
        right = [canonical(close='100.01'), canonical(asOfDate='2026-10-20', priceBasis='split_adjusted', adjustmentAsOfDate='2026-10-22'), canonical(asOfDate='2026-10-19')]
        result = reconcile(left, right)
        self.assertEqual(len(result['differences']), 1)
        self.assertEqual(len(result['incomparable']), 1)
        self.assertEqual(len(result['rightOnly']), 1)
        self.assertFalse(result['cutoverReady'])
        self.assertEqual(reconcile(left[:1], right[:1], '0.02')['matchedCount'], 1)
        adjusted = [canonical(priceBasis='split_adjusted', adjustmentAsOfDate='2026-10-22')]
        result = reconcile(left[:1], adjusted)
        self.assertEqual(result['matchedCount'], 0)
        self.assertEqual(len(result['leftOnly']), 1)
        self.assertEqual(len(result['rightOnly']), 1)

    def test_coverage_and_unknown_volume_are_reported(self):
        canonical = {**row(), 'sourceId': 'provider', 'sourceDocumentId': 'a' * 64}
        right = {**canonical, 'coverage': 'ohlc', 'open': '100', 'high': '101', 'low': '99', 'volume': '0', 'volumeUnit': 'shares'}
        report = reconcile([canonical], [right])
        self.assertEqual(report['differences'][0]['reasons'], ['coverage_mismatch', 'volume_mismatch'])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            reconcile([canonical, canonical], [right])
