import json
import tempfile
import unittest
from pathlib import Path

from scripts.content_pipeline.release_readiness import assess


class ReleaseReadinessTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.public = self.root / "public"
        self.public.mkdir()
        self.workflow = self.root / "workflow.yml"
        self.workflow.write_text(
            'git push origin "HEAD:${GITHUB_REF_NAME}"\n'
            'content-studio/state/branches/${safe_ref}.tar.gz\n'
            'record_canary_evidence.py\n',
            encoding="utf-8",
        )
        payloads = {
            "dashboard.json": {"providers": [
                {"slug": "ishares", "catalog_ticker_count": 481, "event_count": 0},
                {"slug": "statestreet", "catalog_ticker_count": 168, "event_count": 168},
            ]},
            "distribution-index.json": {"fallbackObservations": [
                {"verification_status": "third_party_only"}
            ]},
            "reconciliation.json": {
                "writeMode": "approval-gated",
                "legacyAudit": {"tickers": [], "summary": {}},
            },
            "content.json": {"bundles": [{"manifest": {
                "verificationStatus": "official",
                "sourceClass": "issuer_official",
                "sourceProvider": "ishares",
                "precisionDigits": 6,
            }}]},
            "canary-evidence.json": {
                "status": "success", "provider": "statestreet",
                "workflowRunId": "123", "commitSha": "abc", "ref": "codex/test",
            },
        }
        for name, payload in payloads.items():
            (self.public / name).write_text(json.dumps(payload), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_ready_when_all_release_evidence_is_present(self):
        report = assess(
            self.public, self.workflow,
            expected_providers={"ishares", "statestreet"},
        )
        self.assertTrue(report["ready"])
        self.assertEqual(report["blockers"], [])

    def test_missing_canary_blocks_release(self):
        (self.public / "canary-evidence.json").unlink()
        report = assess(
            self.public, self.workflow,
            expected_providers={"ishares", "statestreet"},
        )
        self.assertFalse(report["ready"])
        self.assertIn("canary_passed", report["blockers"])
