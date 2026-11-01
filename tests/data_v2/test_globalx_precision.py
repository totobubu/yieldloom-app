"""Synthetic fixtures plus public-table structure; no live requests or R2 writes."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.providers import SourceCandidate
from scripts.content_pipeline.providers.globalx import GlobalXAdapter
from scripts.data_v2.collection_schedule import source_key
from scripts.data_v2.prepare_incremental_candidate import all_events, main, to_candidate, update_source
from scripts.data_v2.render_incremental_report import main as render_report

URL = "https://www.globalxetfs.com/funds/qyld"
NOW = "2026-11-01T12:00:00Z"
FIXTURE = Path(__file__).parents[1] / "content_pipeline/fixtures/globalx_history_display.html"


def event(amount="0.1767", **changes):
    return {"provider": "globalx", "ticker": "QYLD", "amount": amount, "currency": "USD",
            "declaredDate": "2026-09-21", "exDate": "2026-09-21", "recordDate": "2026-09-21",
            "payableDate": "2026-09-24", "frequency": "monthly", "officialUrl": URL,
            "sourceSha256": "a" * 64, "verificationStatus": "official", "verificationNote": None,
            "collectionMethod": "official_fetch", **changes}


def display(amount="0.18", **changes):
    return event(amount, verificationStatus="needs_review", verificationNote="globalx_display_precision_unverified",
                 amountPrecision={"kind": "official_display", "exactAmountVerified": False, "decimalPlaces": 2},
                 sourceSha256="b" * 64, **changes)


def source(*rows):
    return {"provider": "globalx", "ticker": "QYLD", "url": URL, "events": list(rows),
            "candidate": {"url": URL, "sourceType": "official_fund_history", "metadata": {"ticker": "QYLD"}}}


class GlobalXPrecisionTests(unittest.TestCase):
    def update(self, old, rows):
        before = copy.deepcopy(old)
        updated, diff = update_source(old, rows, "b" * 64, NOW)
        self.assertEqual(old, before)
        return updated, diff

    def test_rounded_display_is_not_an_exact_correction(self):
        updated, diff = self.update(source(event()), [display()])
        self.assertEqual(updated["events"], [event()])
        self.assertEqual(diff["changed"], [])
        self.assertEqual(diff["suspectedRemoved"], [])
        review = diff["needsReview"][0]
        self.assertEqual(review["reviewReason"], "rounded_display_may_match")
        self.assertEqual(review["retainedEvent"], event())
        self.assertEqual(review["sourceSha256"], "b" * 64)

    def test_actual_other_value_is_a_correction_proposal_not_discarded(self):
        for amount in ("0.19", "0.175432", "0.1700"):
            with self.subTest(amount=amount):
                updated, diff = self.update(source(event()), [display(amount)])
                self.assertEqual(updated["events"], [event()])
                self.assertEqual(diff["needsReview"][0]["reviewReason"], "amount_correction_requires_review")
                self.assertEqual(diff["needsReview"][0]["amount"], amount)

    def test_new_display_event_has_no_invented_exact_amount(self):
        updated, diff = self.update(source(), [display()])
        self.assertEqual(updated["events"], [])
        self.assertEqual(diff["new"], [])
        self.assertEqual(diff["needsReview"][0]["reviewReason"], "exact_amount_unverified")
        self.assertFalse(diff["needsReview"][0]["amountPrecision"]["exactAmountVerified"])

    def test_first_observation_without_previous_state_keeps_source_identity(self):
        updated, diff = self.update(None, [display()])
        self.assertEqual(updated["provider"], "globalx")
        self.assertEqual(updated["ticker"], "QYLD")
        self.assertEqual(updated["url"], URL)
        self.assertEqual(updated["sourceKey"], source_key("globalx", "QYLD", URL))
        self.assertEqual(len(diff["needsReview"]), 1)

    def test_same_decimal_value_preserves_precision_and_links_both_sources(self):
        old = event("0.1800")
        updated, diff = self.update(source(old), [display()])
        self.assertEqual(diff["changed"], [])
        adopted = updated["events"][0]
        self.assertEqual(adopted["amount"], "0.1800")
        self.assertEqual(adopted["sourceSha256"], "a" * 64)
        self.assertEqual(adopted["amountObservations"][0]["sourceSha256"], "b" * 64)
        repeat, _ = self.update(updated, [display()])
        self.assertEqual(repeat["events"], updated["events"])

    def test_history_absence_preserves_adopted_and_unresolved_observations(self):
        updated, _ = self.update(source(event()), [display()])
        again, diff = self.update(updated, [])
        self.assertEqual(again["events"], [event()])
        self.assertEqual(diff["suspectedRemoved"], [event()])
        self.assertEqual(len(again["reviewEvents"]), 1)
        repeat, _ = self.update(updated, [display()])
        self.assertEqual(repeat["reviewEvents"], updated["reviewEvents"])

    def test_date_currency_or_verification_change_is_not_hidden_by_equal_amount(self):
        for changes in ({"currency": "EUR"}, {"payableDate": "2026-09-25"},
                        {"verificationNote": "official correction proposal"}):
            with self.subTest(changes=changes):
                row = {**display("0.1767"), **changes}
                updated, diff = self.update(source(event()), [row])
                self.assertEqual(updated["events"], [event()])
                self.assertEqual(diff["needsReview"][0]["reviewReason"], "event_fields_changed_requires_review")

    def test_provider_marks_public_display_and_skips_future_empty_cells(self):
        document = SourceDocument("globalx", URL, "official_fund_history", FIXTURE.read_bytes(), metadata={"ticker": "QYLD"})
        rows = GlobalXAdapter().parse(document)
        self.assertEqual(len(rows), 2)
        self.assertEqual([row.distribution_per_share for row in rows], ["0.18", "0.18"])
        self.assertTrue(all(row.verification_status == "needs_review" for row in rows))
        candidate = to_candidate(rows[0], document)
        self.assertEqual(candidate["amountPrecision"]["decimalPlaces"], 2)
        self.assertEqual(candidate["sourceSha256"], hashlib.sha256(FIXTURE.read_bytes()).hexdigest())

    def test_equal_numeric_amount_across_sources_keeps_precision_without_conflict(self):
        state = {"sources": {"a": source(event("0.18")),
                             "b": source(event("0.1800", sourceSha256="b" * 64))}}
        rows = all_events(state)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["amount"], "0.1800")
        self.assertEqual(len(rows[0]["sourceEvidence"]), 2)

    def test_other_provider_update_contract_is_unchanged(self):
        before = event(provider="neos", ticker="SPYI")
        after = {**before, "amount": "0.19"}
        updated, diff = self.update({**source(before), "provider": "neos"}, [after])
        self.assertEqual(updated["events"], [after])
        self.assertEqual(len(diff["changed"]), 1)
        self.assertNotIn("needsReview", diff)

    def test_full_offline_collection_reparses_same_hash_and_retains_old_candidate(self):
        class Adapter(GlobalXAdapter):
            def discover(self):
                return [SourceCandidate(URL, "official_fund_history", metadata={"ticker": "QYLD"})]

            def fetch(self, candidate):
                return SourceDocument("globalx", URL, candidate.source_type, FIXTURE.read_bytes(), metadata=candidate.metadata)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_file = root / "state.json"
            key = source_key("globalx", "QYLD", URL)
            baseline = source(event(), event("0.123456", declaredDate="2020-01-01", exDate="2020-01-01"))
            baseline["contentSha256"] = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
            state_file.write_text(json.dumps({"schemaVersion": 2, "sources": {key: baseline}, "catalogs": {}}))
            argv = ["collect", "--provider", "globalx", "--state-file", str(state_file), "--now", NOW,
                    "--candidate-output", str(root / "candidate.json"), "--report-output", str(root / "report.json"),
                    "--state-output", str(root / "audit.json")]
            with patch("sys.argv", argv), patch.dict("scripts.data_v2.prepare_incremental_candidate.PROVIDERS", {"globalx": Adapter}), \
                 patch("scripts.data_v2.prepare_incremental_candidate.save_r2") as save:
                self.assertEqual(main(), 0)
                save.assert_not_called()
            report = json.loads((root / "report.json").read_text())
            candidate = json.loads((root / "candidate.json").read_text())
            self.assertEqual(len(candidate), 2)
            self.assertEqual({row["amount"] for row in candidate}, {"0.1767", "0.123456"})
            self.assertEqual(report["summary"]["failedSources"], 0)
            self.assertEqual(report["providers"]["globalx"]["errors"], [])
            self.assertEqual(report["summary"]["needsReview"], 2)
            self.assertEqual(report["summary"]["suspectedRemoved"], 1)
            self.assertEqual(report["summary"]["changed"], 0)
            with patch("sys.argv", ["report", "--input", str(root / "report.json"), "--output", str(root / "report.md")]):
                self.assertEqual(render_report(), 0)
            self.assertIn("rounded_display_may_match", (root / "report.md").read_text())
            persisted = json.loads(state_file.read_text())
            self.assertEqual(persisted["sources"][key]["providerParserVersion"], "3")
            self.assertEqual(len(all_events(persisted)), 2)
