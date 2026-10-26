import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from scripts.content_pipeline import collect, observe_roundhill, refresh
from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.export_admin_data import export_all
from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers.base import FetchOutcome
from scripts.content_pipeline.providers.roundhill import RoundhillAdapter


THURSDAY = date(2026, 10, 22)
FIXTURE = Path("tests/content_pipeline/fixtures/roundhill_magy_cboe.html")


class MagyObservationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = ContentDatabase(self.root / "ledger.sqlite")
        self.database.initialize()

    def observe(self, **kwargs):
        return observe_roundhill.observe(
            self.database, THURSDAY, ticker="MAGY", raw_dir=self.root / "raw",
            public_dir=self.root / "public", legacy_data_dir=self.root / "legacy", **kwargs,
        )

    def seed(self, ticker="MAGY", declared=THURSDAY, status="cross_checked"):
        adapter = RoundhillAdapter()
        self.database.upsert_provider(adapter.slug, adapter.display_name, adapter.official_homepage)
        candidate = next(adapter.discover_for_declaration_date(declared, ticker))
        source = SourceDocument("roundhill", candidate.url, candidate.source_type, FIXTURE.read_bytes())
        source_id = self.database.add_source_document(source)
        ex_date = declared + timedelta(days=1)
        self.database.upsert_distribution_event(DistributionEvent(
            "roundhill", ticker, "0.166988", declared, ex_date, source.source_url,
            record_date=ex_date, payable_date=declared + timedelta(days=4),
            verification_status=status,
        ), source_id)
        export_all(self.database.path, self.root / "bundles", self.root / "public")

    def test_friday_recovery_and_pre_thursday_days_target_latest_thursday_in_seoul(self):
        for timestamp in ("2026-10-22T10:45:00+00:00", "2026-10-22T23:59:00+00:00", "2026-10-23T00:00:00+00:00", "2026-10-26T14:00:00+00:00"):
            self.assertEqual(observe_roundhill.announcement_date(datetime.fromisoformat(timestamp), "MAGY"), THURSDAY)
        self.assertEqual(
            observe_roundhill.announcement_date(datetime.fromisoformat("2026-10-28T15:00:00+00:00"), "MAGY"),
            date(2026, 10, 29),
        )

    def test_actual_cboe_magy_notice_parses_and_targets_one_registered_ticker(self):
        candidate = next(RoundhillAdapter().discover_for_declaration_date(THURSDAY, "MAGY"))
        query = parse_qs(urlparse(candidate.url).query)
        self.assertEqual(query["symbols"], ["MAGY"])
        self.assertEqual(query["declaration_dt"], ["2026-10-22"])
        self.assertEqual(candidate.metadata["tickers"], ["MAGY"])
        rows = RoundhillAdapter().parse(SourceDocument("roundhill", candidate.url, candidate.source_type, FIXTURE.read_bytes()))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].ticker, "MAGY")
        self.assertEqual(rows[0].distribution_per_share, "0.166988")
        self.assertEqual((rows[0].declared_date, rows[0].ex_date, rows[0].record_date, rows[0].payable_date),
                         ("2026-10-22", "2026-10-23", "2026-10-23", "2026-10-26"))

    def test_other_ticker_previous_week_and_review_data_do_not_skip_current_magy(self):
        self.seed(ticker="TOPW")
        self.seed(declared=THURSDAY - timedelta(days=7))
        self.seed(status="needs_review")
        with patch.object(observe_roundhill.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{}', '')) as run:
            report, code = self.observe()
        self.assertEqual((report["status"], code), ("pending", 0))
        self.assertEqual(run.call_count, 1)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--ticker") + 1], "MAGY")
        self.assertEqual(command[command.index("--declaration-date") + 1], "2026-10-22")

    def test_collected_magy_or_early_wednesday_makes_zero_external_requests(self):
        for declared in (THURSDAY, THURSDAY - timedelta(days=1)):
            with self.subTest(declared=declared):
                self.seed(declared=declared)
                with patch.object(observe_roundhill.subprocess, "run") as run:
                    report, code = self.observe(require_announcement=True)
                self.assertEqual((report["status"], report["attempted"], code), ("already_collected", False, 0))
                run.assert_not_called()
                with self.database.connect() as connection:
                    connection.execute("DELETE FROM distribution_events")

    def test_missing_final_recovery_checks_only_thursday_and_wednesday(self):
        with patch.object(observe_roundhill.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{}', '')) as run:
            report, code = self.observe(require_announcement=True)
        self.assertEqual((report["status"], code), ("missing", 1))
        self.assertEqual([call.args[0][call.args[0].index("--declaration-date") + 1] for call in run.call_args_list],
                         ["2026-10-22", "2026-10-21"])
        self.assertEqual(len(report["observations"]), 2)

    def test_primary_source_error_is_not_hidden_by_wednesday_recovery(self):
        with patch.object(observe_roundhill.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, '{"outcome":"failed"}', '')) as run:
            report, code = self.observe(require_announcement=True)
        self.assertEqual((report["status"], code), ("failed", 1))
        self.assertEqual(run.call_count, 1)

    def run_pipeline(self, *, early=False):
        requested_dates = []

        def fetch(candidates):
            self.assertEqual(len(candidates), 1)
            candidate = candidates[0]
            if candidate.source_type.endswith('_json'):
                return [FetchOutcome(candidate, SourceDocument('roundhill', candidate.url,
                    candidate.source_type, b'[]', metadata=candidate.metadata))]
            query = parse_qs(urlparse(candidate.url).query)
            self.assertEqual(query["symbols"], ["MAGY"])
            requested_dates.append(query["declaration_dt"][0])
            content = FIXTURE.read_bytes()
            if early and query["declaration_dt"] == ["2026-10-22"]:
                content = content.replace(b"MAGY", b"TOPW")
            return [FetchOutcome(candidate, SourceDocument("roundhill", candidate.url, candidate.source_type, content))]

        def run(command, **kwargs):
            self.assertIn(command[1], ("scripts/content_pipeline/refresh.py", "scripts/content_pipeline/collect.py"))
            entrypoint = refresh.main if command[1].endswith("refresh.py") else collect.main
            with patch("sys.argv", command[1:]), redirect_stdout(io.StringIO()) as output:
                code = entrypoint()
            return subprocess.CompletedProcess(command, code, output.getvalue(), "")

        with patch.object(observe_roundhill.subprocess, "run", side_effect=run), patch.object(RoundhillAdapter, "fetch_many", side_effect=fetch), patch("scripts.content_pipeline.reconcile_public_data.run_new_ticker_workflow") as onboard:
            report, code = self.observe(require_announcement=early)
            self.assertEqual((report["status"], code), ("collected", 0), report)
            second, code = self.observe()
            self.assertEqual((second["status"], code), ("already_collected", 0))
        onboard.assert_not_called()
        snapshot = json.loads((self.root / "public" / "distribution-ticker-magy.json").read_text())
        self.assertEqual([row["ticker"] for row in snapshot["history"]], ["MAGY"])
        with self.database.connect() as connection:
            self.assertEqual([r["ticker"] for r in connection.execute("SELECT ticker FROM distribution_events")], ["MAGY"])
        return report, requested_dates, snapshot

    def test_full_magy_collect_export_and_stop_flow(self):
        report, requested, snapshot = self.run_pipeline()
        self.assertEqual(requested, ["2026-10-22"])
        self.assertEqual(report["matchedDeclarationDate"], "2026-10-22")
        self.assertEqual(snapshot["history"][0]["distribution_per_share"], "0.166988")

    def test_final_recovery_preserves_early_wednesday_declaration_date(self):
        report, requested, snapshot = self.run_pipeline(early=True)
        self.assertEqual(requested, ["2026-10-22", "2026-10-21"])
        self.assertEqual(report["declarationDate"], "2026-10-22")
        self.assertEqual(report["matchedDeclarationDate"], "2026-10-21")
        self.assertEqual(snapshot["history"][0]["declared_date"], "2026-10-21")

    def test_cli_uses_magy_report_and_rejects_invalid_dates(self):
        for declared in ("2026-10-22", "2026-10-21"):
            output = self.root / "github-output"
            report_path = self.root / "magy-report.json"
            args = ["observe_roundhill.py", "--ticker", "MAGY", "--declaration-date", declared,
                    "--report", str(report_path), "--github-output", str(output)]
            with patch("sys.argv", args), patch.object(observe_roundhill, "observe", return_value=({"ticker": "MAGY", "attempted": False, "status": "already_collected"}, 0)) as observe, redirect_stdout(io.StringIO()):
                self.assertEqual(observe_roundhill.main(), 0)
            self.assertEqual(observe.call_args.kwargs["ticker"], "MAGY")
            self.assertEqual(observe.call_args.args[1], date.fromisoformat(declared))
            self.assertEqual(json.loads(report_path.read_text())["ticker"], "MAGY")
            self.assertIn("attempted=false", output.read_text())
        for declared in ("2026-10-19", "2030-01-03"):
            with patch("sys.argv", ["observe_roundhill.py", "--ticker", "MAGY", "--declaration-date", declared]), patch("sys.stderr", io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    observe_roundhill.main()
                self.assertEqual(raised.exception.code, 2)

    def test_topw_legacy_cli_delegates_to_shared_entrypoint(self):
        from scripts.content_pipeline import observe_topw
        self.assertIs(observe_topw.main, observe_roundhill.main)


if __name__ == "__main__":
    unittest.main()
