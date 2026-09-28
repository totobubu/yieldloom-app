import json
import tempfile
import unittest
from pathlib import Path

from scripts.content_pipeline.validate_refresh_outputs import validate


class RefreshOutputValidationTest(unittest.TestCase):
    def test_workflow_keeps_feature_branch_state_and_push_isolated(self):
        workflow = Path(".github/workflows/content-studio-refresh.yml").read_text(encoding="utf-8")
        self.assertNotIn("git push origin HEAD:main", workflow)
        self.assertIn('git push origin "HEAD:${GITHUB_REF_NAME}"', workflow)
        self.assertIn("content-studio/state/branches/${safe_ref}.tar.gz", workflow)
        self.assertIn("'statestreet'", workflow)

    def test_accepts_complete_approval_gated_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payloads = {
                "content.json": {"bundles": []},
                "dashboard.json": {"providers": []},
                "distribution-index.json": {"tickers": []},
                "price-index.json": {"source": "yahoo_eod", "prices": {}},
                "price-quality.json": {"source": "yahoo_eod", "findings": []},
                "reconciliation.json": {"writeMode": "approval-gated", "reviews": []},
                "sources.json": {"providers": []},
            }
            for name, payload in payloads.items():
                (root / name).write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(validate(root), {"providers": 0, "tickers": 0, "reviews": 0, "pricedTickers": 0})

    def test_rejects_snapshot_without_approval_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, payload in {
                "content.json": {"bundles": []},
                "dashboard.json": {"providers": []},
                "distribution-index.json": {"tickers": []},
                "price-index.json": {"source": "yahoo_eod", "prices": {}},
                "price-quality.json": {"source": "yahoo_eod", "findings": []},
                "reconciliation.json": {"reviews": []},
                "sources.json": {"providers": []},
            }.items():
                (root / name).write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "approval gate"):
                validate(root)
