import json
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from scripts.content_pipeline.database import ContentDatabase
from scripts.content_pipeline.official_discovery import (
    SEC_COMPANYFACTS_URL,
    SEC_SUBMISSIONS_URL,
    collect_sec_evidence,
    collect_official_evidence,
    collect_opendart_evidence,
    resolve_sec_ticker,
)
from scripts.content_pipeline import refresh


DIRECTORY = json.dumps({
    "0": {"cik_str": 70858, "ticker": "BAC", "title": "BANK OF AMERICA CORP /DE/"}
}).encode()
SUBMISSIONS = json.dumps({
    "cik": "0000070858", "tickers": ["BAC"], "filings": {"recent": {}}
}).encode()
COMPANYFACTS = json.dumps({"cik": 70858, "facts": {"us-gaap": {}}}).encode()


class OfficialDiscoveryTest(unittest.TestCase):
    def test_sec_directory_resolves_bac_identity(self):
        self.assertEqual(resolve_sec_ticker(DIRECTORY, "bac"), {
            "ticker": "BAC", "cik": "0000070858", "name": "BANK OF AMERICA CORP /DE/"
        })

    @staticmethod
    def _dart_directory():
        content = """<?xml version='1.0' encoding='UTF-8'?><result><list>
        <corp_code>00126380</corp_code><corp_name>삼성전자</corp_name>
        <stock_code>005930</stock_code><modify_date>20261001</modify_date>
        </list></result>""".encode()
        output = BytesIO()
        with ZipFile(output, "w") as archive:
            archive.writestr("CORPCODE.xml", content)
        return output.getvalue()

    def test_opendart_registers_korean_identity_without_leaking_key(self):
        profile = json.dumps({
            "status": "000", "corp_code": "00126380", "corp_name": "삼성전자",
            "stock_code": "005930",
        }, ensure_ascii=False).encode()
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "ledger.sqlite"
            with patch(
                "scripts.content_pipeline.official_discovery.fetch_opendart",
                side_effect=[self._dart_directory(), profile],
            ):
                report = collect_opendart_evidence("005930", db, "private-key")
            self.assertEqual(report["corpCode"], "00126380")
            database = ContentDatabase(db)
            with database.connect() as connection:
                urls = [row["source_url"] for row in connection.execute(
                    "SELECT source_url FROM source_documents"
                )]
                fund = connection.execute("SELECT * FROM provider_funds").fetchone()
            self.assertTrue(all("private-key" not in url and "crtfc_key" not in url for url in urls))
            self.assertEqual(fund["provider_slug"], "opendart")
            self.assertEqual(fund["ticker"], "005930")

    def test_market_router_uses_opendart_for_korea(self):
        with patch(
            "scripts.content_pipeline.official_discovery.collect_opendart_evidence",
            return_value={"source": "opendart"},
        ) as collect:
            self.assertEqual(
                collect_official_evidence("005930", "KOSPI", Path("unused.sqlite")),
                {"source": "opendart"},
            )
        collect.assert_called_once_with("005930", Path("unused.sqlite"))

    def test_sec_evidence_registers_official_source_without_inventing_event(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "ledger.sqlite"
            responses = [DIRECTORY, SUBMISSIONS, COMPANYFACTS]
            with patch(
                "scripts.content_pipeline.official_discovery.fetch_sec_json",
                side_effect=responses,
            ):
                report = collect_sec_evidence("BAC", db, "YieldLoom test@example.com")
            self.assertEqual(report["cik"], "0000070858")
            self.assertEqual(report["addedSources"], 2)
            database = ContentDatabase(db)
            with database.connect() as connection:
                fund = connection.execute("SELECT * FROM provider_funds").fetchone()
                sources = connection.execute(
                    "SELECT source_url FROM source_documents ORDER BY source_url"
                ).fetchall()
                events = connection.execute("SELECT COUNT(*) FROM distribution_events").fetchone()[0]
            self.assertEqual(fund["provider_slug"], "sec")
            self.assertEqual(fund["ticker"], "BAC")
            self.assertEqual(fund["official_url"], SEC_SUBMISSIONS_URL.format(cik="0000070858"))
            self.assertEqual(
                {row["source_url"] for row in sources},
                {
                    SEC_SUBMISSIONS_URL.format(cik="0000070858"),
                    SEC_COMPANYFACTS_URL.format(cik="0000070858"),
                },
            )
            self.assertEqual(events, 0)

    def _run_refresh(self, db: Path, public_dir: Path, discover, official=None):
        args = [
            "refresh.py", "--scope", "ticker", "--ticker", "BAC",
            "--request-id", "BAC_test", "--market", "NYSE", "--db", str(db),
            "--public-dir", str(public_dir),
            "--legacy-data-dir", str(public_dir.parent / "legacy"),
        ]
        with (
            patch.object(sys, "argv", args),
            patch.object(refresh, "collect_official_evidence", side_effect=discover) as discovery,
            patch.object(
                refresh, "run_collect",
                side_effect=official or (lambda *args, **kwargs: {"status": "success"}),
            ) as official_collect,
            patch.object(refresh, "register_history", return_value={}),
            patch.object(refresh, "export_all"),
            patch.object(refresh, "export_dashboard"),
            patch.object(refresh, "export_reconciliation", return_value={"summary": {}}),
        ):
            code = refresh.main()
        return code, discovery, official_collect

    def test_unmapped_ticker_records_official_discovery_as_partial(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / "ledger.sqlite"
            report = {
                "source": "sec", "ticker": "BAC", "cik": "0000070858",
                "documents": 2, "addedSources": 2, "canonicalEventsCreated": 0,
                "status": "evidence_collected",
            }
            code, discovery, official = self._run_refresh(
                db, root / "public", lambda *args: report
            )
            self.assertEqual(code, 0)
            discovery.assert_called_once_with("BAC", "NYSE", db)
            official.assert_not_called()
            database = ContentDatabase(db)
            with database.connect() as connection:
                run = connection.execute(
                    "SELECT status, report_json FROM pipeline_runs ORDER BY id DESC LIMIT 1"
                ).fetchone()
            payload = json.loads(run["report_json"])
            self.assertEqual(run["status"], "warning")
            self.assertEqual(payload["collectionMode"], "official_discovery")
            self.assertEqual(payload["outcome"], "partial")

    def test_discovery_failure_is_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code, _, _ = self._run_refresh(
                root / "ledger.sqlite", root / "public",
                ValueError("SEC_USER_AGENT is required"),
            )
            self.assertEqual(code, 1)
            database = ContentDatabase(root / "ledger.sqlite")
            with database.connect() as connection:
                step = connection.execute(
                    "SELECT status, message FROM pipeline_run_steps "
                    "WHERE step_name='discover-official-source'"
                ).fetchone()
            self.assertEqual(step["status"], "failed")
            self.assertIn("SEC_USER_AGENT", step["message"])

    def test_existing_mapping_keeps_provider_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / "ledger.sqlite"
            database = ContentDatabase(db)
            database.initialize()
            database.upsert_provider("schwab", "Schwab", "https://issuer.example")
            database.upsert_provider_fund(
                "schwab", "BAC", "https://issuer.example/bac", "official_fund_history"
            )
            code, discovery, official = self._run_refresh(
                db, root / "public", AssertionError("discovery must not run")
            )
            self.assertEqual(code, 0)
            discovery.assert_not_called()
            official.assert_called_once()


if __name__ == "__main__":
    unittest.main()
