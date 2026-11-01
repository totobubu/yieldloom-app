"""Global X display amounts never overwrite the canonical SQLite event."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline import collect
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome
from scripts.content_pipeline.providers.globalx import GlobalXAdapter

URL = "https://www.globalxetfs.com/funds/qyld"
FIXTURE = Path(__file__).with_name("fixtures") / "globalx_history_display.html"


class GlobalXCanonicalProtectionTests(unittest.TestCase):
    def setup_database(self, root):
        db = ContentDatabase(root / "ledger.sqlite")
        db.initialize()
        db.upsert_provider("globalx", "Global X", "https://www.globalxetfs.com/", "3")
        document = SourceDocument("globalx", URL, "official_fund_history", FIXTURE.read_bytes(), metadata={"ticker": "QYLD"})
        display = GlobalXAdapter().parse(document)[1]
        exact = replace(display, distribution_per_share="0.1767", verification_status="official", verification_note=None)
        prior = SourceDocument("globalx", URL, "official_fund_history", b"synthetic exact payment evidence")
        prior_id = db.add_source_document(prior)
        db.upsert_distribution_event(exact, prior_id)
        return db, document, exact

    def test_direct_database_call_preserves_exact_amount_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            db, document, _ = self.setup_database(Path(directory))
            with db.connect() as connection:
                before = dict(connection.execute("SELECT * FROM distribution_events").fetchone())
            source_id = db.add_source_document(document)
            for _ in range(2):
                for display in GlobalXAdapter().parse(document):
                    self.assertIsNone(db.upsert_distribution_event(display, source_id))
            with db.connect() as connection:
                rows = [dict(row) for row in connection.execute("SELECT * FROM distribution_events")]
                self.assertEqual(rows, [before])
                observations = list(connection.execute("SELECT * FROM distribution_observations WHERE verification_status='needs_review'"))
                self.assertEqual(len(observations), 2)
                self.assertTrue(all(row["canonical_event_id"] is None for row in observations))
                self.assertTrue(all(row["amount_raw"] == "0.18" for row in observations))
                self.assertTrue(all(row["content_sha256"] == document.content_sha256 for row in observations))
                self.assertTrue(all(json.loads(row["raw_json"])["exactAmountVerified"] is False for row in observations))

    def test_manual_collect_reports_observations_and_does_not_upsert_canonical(self):
        class Adapter(GlobalXAdapter):
            def fetch_many(self, candidates):
                return [FetchOutcome(c, SourceDocument("globalx", c.url, c.source_type, FIXTURE.read_bytes(), metadata=c.metadata)) for c in candidates]

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db, _, _ = self.setup_database(root)
            argv = ["collect", "--provider", "globalx", "--ticker", "QYLD", "--db", str(db.path), "--raw-dir", str(root / "raw")]
            with patch.object(collect, "PROVIDERS", {"globalx": Adapter}), patch("sys.argv", argv), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(collect.main(), 0)
            report = json.loads(output.getvalue())
            self.assertEqual(report["errors"], [])
            self.assertEqual(report["events"], 0)
            self.assertEqual(report["reviewObservations"], 2)
            self.assertTrue(report["warnings"])
            with db.connect() as connection:
                self.assertEqual([row[0] for row in connection.execute("SELECT distribution_per_share FROM distribution_events")], ["0.1767"])

    def test_repeated_amount_retains_both_hashes_in_dedicated_display_channel(self):
        with tempfile.TemporaryDirectory() as directory:
            db, document, _ = self.setup_database(Path(directory))
            display = GlobalXAdapter().parse(document)[1]
            for content in (document.content, document.content + b"<!-- changed document -->"):
                revision = replace(document, content=content)
                doc_id = db.add_source_document(revision)
                db.upsert_distribution_event(display, doc_id)
            with db.connect() as connection:
                row = connection.execute("SELECT * FROM distribution_observations WHERE source_provider='globalx_display'").fetchone()
                evidence = json.loads(row["raw_json"])["sourceEvidence"]
                self.assertEqual(len(evidence), 2)
                self.assertEqual(row["content_sha256"], evidence[0]["sha256"])
                self.assertNotEqual(evidence[0]["sha256"], evidence[1]["sha256"])
                for item in evidence:
                    saved = connection.execute("SELECT content_sha256 FROM source_documents WHERE id=?", (item["sourceDocumentId"],)).fetchone()
                    self.assertEqual(item["sha256"], saved[0])

    def test_equal_textual_amount_does_not_relabel_old_canonical_observation(self):
        with tempfile.TemporaryDirectory() as directory:
            db, document, exact = self.setup_database(Path(directory))
            doc_id = db.add_source_document(document)
            exact = replace(exact, distribution_per_share="0.18")
            db.upsert_distribution_event(exact, doc_id)
            display = GlobalXAdapter().parse(document)[1]
            db.upsert_distribution_event(display, doc_id)
            with db.connect() as connection:
                rows = list(connection.execute("SELECT * FROM distribution_observations WHERE amount_raw='0.18'"))
                self.assertEqual(len(rows), 2)
                self.assertEqual({row["source_provider"] for row in rows}, {"globalx", "globalx_display"})
                official = next(row for row in rows if row["source_provider"] == "globalx")
                self.assertEqual(official["verification_status"], "official")
                self.assertIsNotNone(official["canonical_event_id"])

    def test_reviewed_official_correction_can_use_existing_adoption_path(self):
        with tempfile.TemporaryDirectory() as directory:
            db, _, exact = self.setup_database(Path(directory))
            correction = replace(exact, distribution_per_share="0.174321", verification_note="synthetic reviewed official correction")
            source = SourceDocument("globalx", URL, "official_correction", b"synthetic correction evidence")
            self.assertIsNotNone(db.upsert_distribution_event(correction, db.add_source_document(source)))
            with db.connect() as connection:
                self.assertEqual(connection.execute("SELECT distribution_per_share FROM distribution_events").fetchone()[0], "0.174321")
