"""Synthetic public-market fixtures; no live requests or production state writes."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers import SourceCandidate
from scripts.data_v2.prepare_incremental_candidate import EventConflict, all_events, main, update_source
from scripts.data_v2.render_incremental_report import main as render_report


def event(**changes):
    row = {
        "provider": "roundhill", "ticker": "TOPW", "amount": "0.1234567890123456789012345678",
        "currency": "USD", "declaredDate": "2025-02-03", "exDate": "2025-02-04",
        "recordDate": "2025-02-04", "payableDate": "2025-02-05", "frequency": "weekly",
        "officialUrl": "https://example.com/synthetic/first", "sourceSha256": "a" * 64,
        "verificationStatus": "cross_checked", "verificationNote": None, "collectionMethod": "official_fetch",
    }
    return {**row, **changes}


class FakeRoundhill:
    def __init__(self, second_amount=None):
        self.second_amount = second_amount

    def discover(self):
        return [SourceCandidate(f"https://example.com/synthetic/{i}", published_at="2025-02-03",
                                metadata={"ticker": "TOPW", "slot": i}) for i in (1, 2)]

    def fetch(self, candidate):
        return SourceDocument("roundhill", candidate.url, "html",
                              f"synthetic document {candidate.metadata['slot']}".encode(), metadata=candidate.metadata)

    def parse(self, document):
        amount = self.second_amount if document.metadata["slot"] == 2 and self.second_amount else event()["amount"]
        return [DistributionEvent("roundhill", "TOPW", amount, "2025-02-03", "2025-02-04", document.source_url,
                                  record_date="2025-02-04", payable_date="2025-02-05", frequency="weekly",
                                  verification_status="cross_checked")]


class IncrementalConflictTests(unittest.TestCase):
    def test_hash_only_difference_retains_both_sources_without_double_count_or_input_mutation(self):
        state = {"sources": {"b": {"events": [event(sourceSha256="b" * 64, officialUrl="https://example.com/synthetic/second")]},
                             "a": {"events": [event()]}}}
        before = copy.deepcopy(state)
        diagnostics = {}
        rows = all_events(state, diagnostics)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["amount"], event()["amount"])
        self.assertEqual([item["sha256"] for item in rows[0]["sourceEvidence"]], ["a" * 64, "b" * 64])
        self.assertEqual(len(diagnostics["equivalentEvents"]), 1)
        self.assertEqual(diagnostics["conflicts"], [])
        self.assertEqual(state, before)
        self.assertEqual(all_events({"sources": dict(reversed(list(state["sources"].items())))}), rows)

    def test_every_economic_or_verification_disagreement_still_blocks(self):
        for field, value in {"amount": "0.9", "currency": "KRW", "recordDate": "2025-02-05",
                             "payableDate": "2025-02-06", "frequency": "monthly",
                             "verificationStatus": "official", "verificationNote": "synthetic correction"}.items():
            with self.subTest(field=field):
                state = {"sources": {"a": {"events": [event()]}, "b": {"events": [event(**{field: value}, sourceSha256="b" * 64)]}}}
                with self.assertRaises(EventConflict) as caught:
                    all_events(state)
                conflict = caught.exception.conflicts[0]
                self.assertEqual(conflict["differentFields"], [field])
                self.assertEqual(len(conflict["observations"]), 2)

    def test_document_refresh_is_not_an_economic_correction(self):
        previous = {"provider": "roundhill", "url": event()["officialUrl"], "events": [event()]}
        updated, diff = update_source(previous, [event(sourceSha256="b" * 64)], "b" * 64, "2025-02-06T00:00:00Z")
        self.assertEqual(diff["changed"], [])
        self.assertEqual(updated["events"][0]["sourceSha256"], "b" * 64)
        self.assertEqual(previous["events"][0]["sourceSha256"], "a" * 64)

    def run_collection(self, root, adapter, *, local=True, same_audit_path=False):
        args = ["collect", "--provider", "roundhill", "--now", "2025-02-06T00:00:00Z",
                "--candidate-output", str(root / "candidate.json"), "--report-output", str(root / "report.json"),
                "--state-output", str(root / ("state.json" if same_audit_path else "audit.json"))]
        if local:
            args += ["--state-file", str(root / "state.json")]
        with patch("sys.argv", args), patch.dict("scripts.data_v2.prepare_incremental_candidate.PROVIDERS", {"roundhill": lambda: adapter}), \
             patch("scripts.data_v2.prepare_incremental_candidate.load_r2", return_value={"sources": {}, "catalogs": {}}), \
             patch("scripts.data_v2.prepare_incremental_candidate.save_r2") as save:
            result = main()
            save.assert_not_called()
        return result, json.loads((root / "report.json").read_text())

    def test_equal_duplicate_collection_produces_one_candidate_and_retains_raw_hashes_and_state_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, report = self.run_collection(root, FakeRoundhill())
            self.assertEqual(result, 0)
            self.assertEqual(report["summary"]["candidateEvents"], 1)
            rows = json.loads((root / "candidate.json").read_text())
            self.assertEqual(len(rows), 1)
            self.assertEqual(len(rows[0]["sourceEvidence"]), 2)
            self.assertEqual(len(json.loads((root / "state.json").read_text())["sources"]), 2)
            for raw in report["rawEvidence"]:
                self.assertEqual(hashlib.sha256(Path(raw["file"]).read_bytes()).hexdigest(), raw["sha256"])

    def test_real_conflict_preserves_diagnostics_and_original_state_without_candidate_or_r2_save(self):
        for local, same_audit in [(False, False), (True, False), (True, True)]:
            with self.subTest(local=local, same_audit=same_audit), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                original = b'{"schemaVersion":2,"sources":{},"catalogs":{}}\n'
                (root / "state.json").write_bytes(original)
                result, report = self.run_collection(root, FakeRoundhill(second_amount="0.9"), local=local, same_audit_path=same_audit)
                self.assertEqual(result, 1)
                self.assertTrue(report["publicationBlocked"])
                self.assertEqual(report["summary"]["conflictingEvents"], 1)
                self.assertEqual(report["conflicts"][0]["differentFields"], ["amount"])
                self.assertEqual(len(report["rawEvidence"]), 2)
                self.assertFalse((root / "candidate.json").exists())
                self.assertEqual((root / "state.json").read_bytes(), original)
                if not same_audit:
                    self.assertTrue(json.loads((root / "audit.json").read_text())["auditOnly"])
                with patch("sys.argv", ["render", "--input", str(root / "report.json"), "--output", str(root / "report.md")]):
                    self.assertEqual(render_report(), 0)
                text = (root / "report.md").read_text()
                self.assertIn("Publication blocked", text)
                self.assertIn("0.9", text)
                self.assertIn("synthetic/1", text)
                self.assertIn("synthetic/2", text)


if __name__ == "__main__":
    unittest.main()
