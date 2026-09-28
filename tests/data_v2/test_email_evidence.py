import unittest

from scripts.data_v2.compare_email_evidence import compare
from scripts.data_v2.ingest_email_evidence import extract_candidates


class EmailEvidenceTests(unittest.TestCase):
    def test_ocr_candidates_keep_source_amount_text(self):
        candidates = extract_candidates("SPYI $0.25660\n")
        self.assertEqual(candidates[0]["ticker"], "SPYI")
        self.assertEqual(candidates[0]["amount"], "0.25660")

    def test_exact_official_match_requires_same_provider_ticker_and_amount(self):
        ocr = {"candidates": [{"ticker": "SPYI", "amount": "0.25660", "line": "SPYI 0.25660"}]}
        review = {"evidenceId": "a" * 64, "provider": "neos", "declaredDate": "2026-09-15"}
        events = [{"provider": "neos", "ticker": "SPYI", "amount": "0.25660", "declaredDate": "2026-09-15", "exDate": "2026-09-16"}]
        report = compare(ocr, review, events)
        self.assertEqual(report["overallStatus"], "matched_official")

    def test_amount_mismatch_stays_in_review(self):
        ocr = {"candidates": [{"ticker": "SPYI", "amount": "0.24568", "line": "SPYI 0.24568"}]}
        review = {"evidenceId": "a" * 64, "provider": "neos", "declaredDate": None}
        events = [{"provider": "neos", "ticker": "SPYI", "amount": "0.25660", "declaredDate": "2026-09-15", "exDate": "2026-09-16"}]
        report = compare(ocr, review, events)
        self.assertEqual(report["overallStatus"], "needs_review")
