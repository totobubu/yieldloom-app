import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline.models import DistributionEvent, SourceDocument
from scripts.content_pipeline.providers import CollectionError, SourceCandidate
from scripts.data_v2.prepare_incremental_candidate import backfill_target, main


class FakeAdapter:
    candidate = SourceCandidate("https://example.com/fund", metadata={"ticker": "TEST"})
    error = None
    catalog = False

    def discover(self):
        return [self.candidate]

    def fetch(self, candidate):
        if self.error:
            raise self.error
        return SourceDocument("neos", candidate.url, "html", b"official evidence")

    def parse(self, document):
        if self.catalog:
            raise AssertionError("A catalog must never reach the distribution parser")
        return [DistributionEvent(
            "neos", "TEST", "0.123456", "2026-10-01", "2026-10-01", document.source_url,
            verification_status="needs_review",
        )]

    def parse_catalog(self, document):
        return [SourceCandidate("https://example.com/test", metadata={"ticker": "TEST"})]

    def catalog_seed(self):
        return self.parse_catalog(None)


class IncrementalCollectionTests(unittest.TestCase):
    def run_collection(self, root, adapter, now="2026-10-15T10:00:00Z", extra_args=()):
        argv = ["collect", "--provider", "neos", "--state-file", str(root / "state.json"),
                "--candidate-output", str(root / "events.json"),
                "--report-output", str(root / "report.json"),
                "--state-output", str(root / "state-copy.json"), "--now", now]
        argv.extend(extra_args)
        with patch("sys.argv", argv), patch.dict(
            "scripts.data_v2.prepare_incremental_candidate.PROVIDERS", {"neos": lambda: adapter}
        ):
            self.assertEqual(main(), 0)
        return json.loads((root / "report.json").read_text()), json.loads((root / "state.json").read_text())

    def test_backfill_fetches_official_source_once_even_when_not_due(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapter = FakeAdapter()
            self.run_collection(root, adapter)
            with patch.object(adapter, 'discover_for_ex_date', create=True,
                              return_value=[adapter.candidate, adapter.candidate]) as discover, \
                 patch.object(adapter, 'fetch', wraps=adapter.fetch) as fetch:
                report, state = self.run_collection(root, adapter, "2026-10-15T11:00:00Z",
                                                    ['--backfill', 'neos:2026-10-01'])
            self.assertEqual(discover.call_args.args[0].isoformat(), '2026-10-01')
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(report['providers']['neos']['sources'][0]['reason'], 'manual_backfill')
            self.assertEqual(len(state['sources']), 1)
            self.assertEqual(json.loads((root / 'events.json').read_text()), [])

    def test_backfill_rejects_unknown_providers_and_invalid_dates(self):
        import argparse
        for value in ('unknown:2026-10-01', 'neos:2026-99-01', 'neos'):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                backfill_target(value)

    def test_review_rows_are_persisted_but_never_published_or_repeated_hourly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapter = FakeAdapter()
            report, state = self.run_collection(root, adapter)
            self.assertEqual(report["summary"]["failedSources"], 0)
            self.assertEqual(len(report["providers"]["neos"]["needsReview"]), 1)
            self.assertEqual(json.loads((root / "events.json").read_text()), [])
            self.assertEqual(len(next(iter(state["sources"].values()))["reviewEvents"]), 1)
            with patch.object(adapter, "fetch", side_effect=AssertionError("Not due")):
                report, _ = self.run_collection(root, adapter, "2026-10-15T11:00:00Z")
            self.assertEqual(report["summary"]["selectedSources"], 0)

    def test_catalog_is_parsed_as_coverage_not_distribution_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = FakeAdapter()
            adapter.catalog = True
            adapter.candidate = SourceCandidate("https://example.com/catalog", metadata={"catalogOnly": True})
            report, state = self.run_collection(Path(directory), adapter)
            self.assertEqual(report["summary"]["failedSources"], 0)
            self.assertEqual(state["catalogs"]["neos"]["tickers"], ["TEST"])
            self.assertEqual(report["providers"]["neos"]["sources"][0]["status"], "catalog")

    def test_blocked_catalog_can_use_reviewed_seed_with_visible_warning(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = FakeAdapter()
            adapter.candidate = SourceCandidate("https://example.com/catalog", metadata={"catalogOnly": True})
            adapter.error = CollectionError("HTTP 403", code="blocked")
            report, _ = self.run_collection(Path(directory), adapter)
            self.assertEqual(report["summary"]["failedSources"], 0)
            self.assertIn("HTTP 403", report["providers"]["neos"]["warnings"][0])

    def test_first_failure_is_retained_for_retry_and_recovers_without_stale_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapter = FakeAdapter()
            adapter.error = CollectionError("HTTP 403", code="blocked")
            report, state = self.run_collection(root, adapter)
            self.assertEqual(report["summary"]["failedSources"], 1)
            self.assertEqual(next(iter(state["sources"].values()))["failureCount"], 1)
            adapter.error = None
            report, state = self.run_collection(root, adapter, "2026-10-15T11:00:00Z")
            source = next(iter(state["sources"].values()))
            self.assertEqual(source["failureCount"], 0)
            self.assertNotIn("nextRetryAt", source)

    def test_404_is_reported_as_not_found_and_not_as_empty_data(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = FakeAdapter()
            adapter.error = CollectionError("official source returned HTTP 404", code="not_found", retryable=False)
            report, _ = self.run_collection(Path(directory), adapter)
            self.assertEqual(report["summary"]["failedSources"], 1)
            self.assertIn("HTTP 404", report["providers"]["neos"]["errors"][0])
            self.assertIn("code=not_found", report["providers"]["neos"]["errors"][0])
            self.assertIn("retryable=false", report["providers"]["neos"]["errors"][0])

    def test_review_only_result_keeps_previously_approved_events(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapter = FakeAdapter()
            _, state = self.run_collection(root, adapter)
            source = next(iter(state["sources"].values()))
            approved = dict(source["reviewEvents"][0], verificationStatus="official", amount="0.111111")
            source["events"] = [approved]
            (root / "state.json").write_text(json.dumps(state))
            self.run_collection(root, adapter, "2026-10-16T10:00:00Z")
            self.assertEqual(json.loads((root / "events.json").read_text()), [approved])


if __name__ == "__main__":
    unittest.main()
