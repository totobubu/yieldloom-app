import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from scripts.content_pipeline import collect, observe_roundhill as observe_topw, refresh
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome
from scripts.content_pipeline.providers.roundhill import RoundhillAdapter


MONDAY = date(2026, 10, 26)


class TopwObservationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = ContentDatabase(self.root / "ledger.sqlite")
        self.database.initialize()

    def seed(self, *, declared="2026-10-26", status="cross_checked", payable="2026-10-28"):
        adapter = RoundhillAdapter()
        self.database.upsert_provider(adapter.slug, adapter.display_name, adapter.official_homepage)
        source = SourceDocument("roundhill", adapter.cboe_url, "official_exchange_notice", b"fixture")
        source_id = self.database.add_source_document(source)
        event = DistributionEvent(
            "roundhill", "TOPW", "0.42", declared, "2026-10-27", source.source_url,
            record_date="2026-10-27", payable_date=payable, verification_status=status,
        )
        self.database.upsert_distribution_event(event, source_id)

    def observe(self, **kwargs):
        return observe_topw.observe(
            self.database, MONDAY, raw_dir=self.root / "raw", public_dir=self.root / "public",
            legacy_data_dir=self.root / "legacy", **kwargs,
        )

    def export_fixture(self):
        with self.database.connect() as connection:
            rows = [dict(row) for row in connection.execute("SELECT * FROM distribution_events")]
        directory = self.root / "public"
        directory.mkdir(exist_ok=True)
        (directory / "distribution-ticker-topw.json").write_text(json.dumps({"history": rows}))

    def test_tuesday_recovery_targets_monday_even_at_utc_day_boundary(self):
        for timestamp in ("2026-10-26T12:45:00+00:00", "2026-10-26T23:59:00+00:00", "2026-10-27T00:00:00+00:00"):
            self.assertEqual(observe_topw.announcement_date(datetime.fromisoformat(timestamp)), MONDAY)
        self.assertEqual(
            observe_topw.announcement_date(datetime(2026, 11, 1, 15, tzinfo=timezone.utc)),
            date(2026, 11, 2),
        )

    def test_only_current_complete_verified_announcement_counts_as_collected(self):
        self.seed(declared="2026-10-19")
        self.assertFalse(observe_topw.announcement_collected(self.database, MONDAY))
        self.seed(status="needs_review")
        self.assertFalse(observe_topw.announcement_collected(self.database, MONDAY))
        self.seed(payable=None)
        self.assertFalse(observe_topw.announcement_collected(self.database, MONDAY))
        self.seed(payable="2026-10-20")
        self.assertFalse(observe_topw.announcement_collected(self.database, MONDAY))
        self.seed()
        self.assertTrue(observe_topw.announcement_collected(self.database, MONDAY))

    def test_completed_week_makes_no_external_request_or_refresh(self):
        self.seed()
        self.export_fixture()
        with patch.object(observe_topw.subprocess, "run") as run:
            report, code = self.observe()
        self.assertEqual((report["status"], report["attempted"], code), ("already_collected", False, 0))
        run.assert_not_called()

    def test_missing_public_export_does_not_skip_recovery(self):
        self.seed()
        with patch.object(observe_topw.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{}', '')) as run:
            report, code = self.observe()
        self.assertEqual(run.call_count, 1)
        self.assertEqual((report["status"], code), ("failed", 1))
        self.export_fixture()
        self.assertTrue(observe_topw.announcement_collected(self.database, MONDAY, self.root / "public"))
        with self.database.connect() as connection:
            connection.execute("UPDATE distribution_events SET distribution_per_share = '0.43'")
        self.assertFalse(observe_topw.announcement_collected(self.database, MONDAY, self.root / "public"))

    def test_no_change_is_pending_then_final_recovery_fails(self):
        with patch.object(observe_topw.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"outcome":"no_change"}', "")) as run:
            report, code = self.observe()
            self.assertEqual((report["status"], code), ("pending", 0))
            report, code = self.observe(require_announcement=True)
            self.assertEqual((report["status"], code), ("missing", 1))
        command = run.call_args.args[0]
        self.assertIn("--declaration-date", command)
        self.assertEqual(command[command.index("--declaration-date") + 1], "2026-10-26")
        self.assertNotIn("--with-insights", command)

    def test_collection_failure_is_not_reported_as_pending(self):
        with patch.object(observe_topw.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, '{"outcome":"failed"}', "")):
            report, code = self.observe()
        self.assertEqual((report["status"], code), ("failed", 1))

    def collect_fixture(self, content):
        candidate = next(RoundhillAdapter().discover_for_declaration_date(MONDAY, "TOPW"))
        document = SourceDocument("roundhill", candidate.url, candidate.source_type, content)
        args = [
            "collect.py", "--provider", "roundhill", "--ticker", "TOPW",
            "--declaration-date", MONDAY.isoformat(), "--db", str(self.database.path),
            "--raw-dir", str(self.root / "raw"),
        ]
        with patch("sys.argv", args), patch.object(RoundhillAdapter, "fetch_many", return_value=[FetchOutcome(candidate, document)]) as fetch, redirect_stdout(io.StringIO()) as output:
            code = collect.main()
        self.assertEqual(len(fetch.call_args.args[0]), 1)
        return code, json.loads(output.getvalue())

    def fixture(self):
        content = Path("tests/content_pipeline/fixtures/roundhill_cboe.html").read_text()
        return content.replace("AAPW", "TOPW").replace("2025-09-08", "2026-10-27").replace("2025-09-09", "2026-10-28").encode()

    def test_exact_date_and_ticker_query_filters_shared_response_and_is_idempotent(self):
        candidate = next(RoundhillAdapter().discover_for_declaration_date(MONDAY, "TOPW"))
        query = parse_qs(urlparse(candidate.url).query)
        self.assertEqual(query["symbols"], ["TOPW"])
        self.assertEqual(query["declaration_dt"], [MONDAY.isoformat()])
        self.assertEqual(candidate.metadata["tickers"], ["TOPW"])
        for _ in range(2):
            code, report = self.collect_fixture(self.fixture())
            self.assertEqual(code, 0, report)
            self.assertEqual(report["events"], 1)
        with self.database.connect() as connection:
            self.assertEqual([r["ticker"] for r in connection.execute("SELECT ticker FROM distribution_events")], ["TOPW"])
            self.assertEqual([r["ticker"] for r in connection.execute("SELECT ticker FROM provider_funds")], ["TOPW"])
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM source_documents").fetchone()[0], 1)
        self.assertTrue(observe_topw.announcement_collected(self.database, MONDAY))

    def test_stale_response_is_not_stored_as_this_weeks_announcement(self):
        code, report = self.collect_fixture(self.fixture().replace(b"2026-10-27", b"2026-10-20"))
        self.assertEqual(code, 1, report)
        self.assertTrue(report["errors"])
        self.assertFalse(observe_topw.announcement_collected(self.database, MONDAY))
        self.assertEqual(self.database.summary()["distribution_events"], 0)

    def test_official_response_without_topw_is_no_change(self):
        code, report = self.collect_fixture(self.fixture().replace(b"TOPW", b"AAPW"))
        self.assertEqual(code, 0, report)
        self.assertEqual(report["status"], "no_change")
        self.assertTrue(report["noData"])
        self.assertEqual(self.database.summary()["distribution_events"], 0)

    def test_observation_stops_after_collector_persists_announcement(self):
        def run(command, **kwargs):
            code, report = self.collect_fixture(self.fixture())
            self.export_fixture()
            return subprocess.CompletedProcess(command, code, json.dumps(report), "")
        with patch.object(observe_topw.subprocess, "run", side_effect=run) as run_mock:
            report, code = self.observe()
            self.assertEqual((report["status"], code), ("collected", 0))
            report, code = self.observe()
            self.assertEqual((report["status"], code), ("already_collected", 0))
        self.assertEqual(run_mock.call_count, 1)

    def test_full_observer_refresh_collect_export_flow_and_second_run_skip(self):
        candidate = next(RoundhillAdapter().discover_for_declaration_date(MONDAY, "TOPW"))
        document = SourceDocument("roundhill", candidate.url, candidate.source_type, self.fixture())

        def run(command, **kwargs):
            entrypoint = refresh.main if command[1].endswith("refresh.py") else collect.main
            self.assertIn(command[1], ("scripts/content_pipeline/refresh.py", "scripts/content_pipeline/collect.py"))
            with patch("sys.argv", command[1:]), redirect_stdout(io.StringIO()) as output:
                code = entrypoint()
            return subprocess.CompletedProcess(command, code, output.getvalue(), "")

        with patch.object(observe_topw.subprocess, "run", side_effect=run) as run_mock, patch.object(RoundhillAdapter, "fetch_many", return_value=[FetchOutcome(candidate, document)]) as fetch, patch("scripts.content_pipeline.reconcile_public_data.run_new_ticker_workflow") as onboard:
            report, code = self.observe()
            self.assertEqual((report["status"], code), ("collected", 0), report)
            self.assertEqual(report["refresh"]["declarationDate"], MONDAY.isoformat())
            self.assertEqual(report["refresh"]["provider"], "roundhill")
            self.assertEqual(report["refresh"]["ticker"], "TOPW")
            second, code = self.observe()
            self.assertEqual((second["status"], code), ("already_collected", 0))
        self.assertEqual(run_mock.call_count, 2)  # refresh subprocess and its collector
        self.assertEqual(fetch.call_count, 1)
        onboard.assert_not_called()
        snapshot = json.loads((self.root / "public" / "distribution-ticker-topw.json").read_text())
        self.assertEqual(len(snapshot["history"]), 1)
        self.assertEqual(snapshot["history"][0]["payable_date"], "2026-10-28")

    def test_refresh_passes_exact_date_without_a_historical_url(self):
        with patch.object(refresh.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{}', '')) as run:
            refresh.run_collect("roundhill", self.database.path, self.root / "raw", ticker="TOPW", declaration_date=MONDAY)
        command = run.call_args.args[0]
        self.assertEqual(command[-2:], ["--declaration-date", "2026-10-26"])
        self.assertNotIn("--url", command)

    def test_declaration_mode_rejects_unregistered_ticker_before_fetch(self):
        with patch("sys.argv", ["collect.py", "--provider", "roundhill", "--ticker", "INVALID", "--declaration-date", MONDAY.isoformat()]), redirect_stdout(io.StringIO()), patch("sys.stderr", io.StringIO()), patch.object(RoundhillAdapter, "fetch_many") as fetch:
            with self.assertRaises(SystemExit) as raised:
                collect.main()
        self.assertEqual(raised.exception.code, 2)
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
