import base64
import json
import subprocess
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.collect import event_snapshot, stable_event_key
from scripts.content_pipeline.providers import (
    AmplifyAdapter,
    DefianceAdapter,
    GlobalXAdapter,
    GraniteSharesAdapter,
    ISharesAdapter,
    JPMorganAdapter,
    KurvAdapter,
    NeosAdapter,
    ProSharesAdapter,
    RexAdapter,
    RoundhillAdapter,
    SchwabAdapter,
    StateStreetAdapter,
    YieldMaxAdapter,
)


FIXTURES = Path(__file__).with_name("fixtures")


def document(provider: str, fixture: str, url: str, **kwargs) -> SourceDocument:
    return SourceDocument(
        provider_slug=provider,
        source_url=url,
        source_type="fixture",
        content=(FIXTURES / fixture).read_bytes(),
        **kwargs,
    )


class ProviderParserTest(unittest.TestCase):
    def test_graniteshares_tables_share_a_stable_duplicate_identity(self):
        adapter = GraniteSharesAdapter()
        first = adapter.parse(document(
            "graniteshares", "graniteshares_distributions.html", adapter.distributions_url,
        ))[0]
        repeated = type(first)(
            provider_slug=first.provider_slug, ticker=first.ticker,
            distribution_per_share=first.distribution_per_share,
            declared_date=first.declared_date, ex_date=first.ex_date,
            record_date=first.record_date, payable_date=first.payable_date,
            frequency=first.frequency, roc_percent=first.roc_percent,
            official_url=adapter.autocallable_distributions_url,
            verification_status=first.verification_status,
        )
        self.assertEqual(stable_event_key(first), stable_event_key(repeated))
        self.assertEqual(event_snapshot(first), event_snapshot(repeated))

    def test_graniteshares_latest_distribution_table(self):
        events = GraniteSharesAdapter().parse(
            document(
                "graniteshares",
                "graniteshares_distributions.html",
                GraniteSharesAdapter.distributions_url,
            )
        )
        self.assertEqual([event.ticker for event in events], ["NVYY", "TQQY"])
        self.assertEqual(events[0].distribution_per_share, "0.07586")
        self.assertEqual(events[0].roc_percent, "95.30")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_kurv_catalog_and_declared_history(self):
        adapter = KurvAdapter()
        catalog = adapter.parse_catalog(
            document("kurv", "kurv_catalog.html", adapter.catalog_url)
        )
        self.assertEqual([item.metadata["ticker"] for item in catalog], ["KEO", "NFLP"])
        events = adapter.parse(
            document(
                "kurv",
                "kurv_history.html",
                "https://www.kurvinvest.com/etf/nflp",
                metadata={"ticker": "NFLP"},
            )
        )
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].distribution_per_share, "0.2500")
        self.assertEqual(events[0].declared_date, "2026-08-25")
        self.assertEqual(events[0].frequency, "monthly")
        self.assertEqual(events[0].verification_status, "official")

    def test_proshares_preserves_precision_and_sums_distribution_components(self):
        events = ProSharesAdapter().parse(
            document(
                "proshares",
                "proshares_distributions.html",
                ProSharesAdapter.distributions_url,
            )
        )
        self.assertEqual([event.ticker for event in events], ["ANEW", "TEST"])
        self.assertEqual(events[0].distribution_per_share, "0.029989")
        self.assertEqual(events[1].distribution_per_share, "0.120000")
        self.assertEqual(events[1].verification_status, "needs_review")

    def test_proshares_geared_table_uses_total_distribution_column(self):
        """The leveraged/inverse table omits the ordinary dividend column."""
        events = ProSharesAdapter().parse(SourceDocument(
            provider_slug="proshares",
            source_url=ProSharesAdapter.geared_distributions_url,
            source_type="fixture",
            content=b"""<table><thead><tr>
                <th>Ticker</th><th>Fund Name</th><th>Ex Date</th>
                <th>Record Date</th><th>Payable Date</th><th>Total Distribution</th>
            </tr></thead><tbody>
                <tr><td>BIB</td><td>Ultra Nasdaq Biotechnology</td><td>09/23/2026</td>
                <td>09/23/2026</td><td>09/29/2026</td><td>$0.082554</td></tr>
                <tr><td>AGQ</td><td>Ultra Silver</td><td>--</td>
                <td>--</td><td>--</td><td>--</td></tr>
            </tbody></table>""",
        ))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].ticker, "BIB")
        self.assertEqual(events[0].distribution_per_share, "0.082554")

    def test_kurv_catalog_only_fund_is_not_a_distribution_candidate(self):
        adapter = KurvAdapter()
        self.assertIn("KMEM", {item.metadata["ticker"] for item in adapter.catalog_seed()})
        self.assertNotIn("KMEM", {
            item.metadata["ticker"] for item in adapter.discover()
            if "ticker" in item.metadata
        })

    def test_amplify_standard_history(self):
        events = AmplifyAdapter().parse(
            document(
                "amplify",
                "amplify_history.html",
                "https://amplifyetfs.com/divo/",
                metadata={"ticker": "DIVO"},
            )
        )
        self.assertEqual(events[0].ticker, "DIVO")
        self.assertEqual(events[0].distribution_per_share, "0.18264")
        self.assertEqual(events[0].payable_date, "2026-01-30")

    def test_global_x_distribution_history_payload(self):
        events = GlobalXAdapter().parse(
            document(
                "globalx",
                "globalx_history.html",
                "https://www.globalxetfs.com/funds/qyld",
                metadata={"ticker": "QYLD"},
            )
        )
        self.assertEqual(events[0].ticker, "QYLD")
        self.assertEqual(events[0].distribution_per_share, "0.1653")
        self.assertEqual(events[0].ex_date, "2026-07-20")

    def test_ishares_catalog_and_distribution_history(self):
        adapter = ISharesAdapter()
        catalog = adapter.parse_catalog(
            document("ishares", "ishares_catalog.html", adapter.catalog_url)
        )
        self.assertEqual([item.metadata["ticker"] for item in catalog], ["DGRO", "IVV"])
        self.assertTrue(catalog[1].url.endswith("/ishares-core-sp-500-etf"))
        events = adapter.parse(
            document(
                "ishares",
                "ishares_ivv.txt",
                "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf",
            )
        )
        self.assertEqual(events[0].ticker, "IVV")
        self.assertEqual(events[0].distribution_per_share, "2.202607")
        self.assertEqual(events[0].record_date, "2026-09-15")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_state_street_official_distribution_table(self):
        events = StateStreetAdapter().parse(
            document(
                "statestreet",
                "statestreet_distributions.txt",
                StateStreetAdapter.distributions_url,
            )
        )
        self.assertEqual([event.ticker for event in events], ["BIL", "SPY"])
        self.assertEqual(events[0].distribution_per_share, "0.279771")
        self.assertEqual(events[0].frequency, "monthly")
        self.assertEqual(events[1].frequency, "quarterly")
        self.assertEqual(events[1].payable_date, "2026-09-29")

    def test_yieldmax_press_release(self):
        events = YieldMaxAdapter().parse(
            document(
                "yieldmax",
                "yieldmax_release.html",
                "https://www.globenewswire.com/news-release/example",
            )
        )
        self.assertEqual([event.ticker for event in events], ["TSLY", "NVDY"])
        self.assertEqual(events[0].distribution_per_share, "0.2296")
        self.assertEqual(events[0].declared_date, "2026-08-05")
        self.assertEqual(events[0].ex_date, "2026-08-06")
        self.assertEqual(events[0].payable_date, "2026-08-07")

    def test_roundhill_cboe_notice(self):
        events = RoundhillAdapter().parse(
            document(
                "roundhill",
                "roundhill_cboe.html",
                "https://www.cboe.com/us/equities/notices/dividends/details/?declaration_dt=2025-09-05",
                published_at="2025-09-05",
            )
        )
        self.assertEqual([event.ticker for event in events], ["AAPW", "NVDW"])
        self.assertEqual(events[1].distribution_per_share, "0.384278")
        self.assertEqual(events[1].verification_status, "cross_checked")

    def test_yieldmax_individual_fund_history(self):
        events = YieldMaxAdapter().parse(
            document(
                "yieldmax",
                "yieldmax_fund.html",
                "https://yieldmaxetfs.com/our-etfs/tsly/",
            )
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].ticker, "TSLY")
        self.assertEqual(events[0].distribution_per_share, "0.2127")
        self.assertEqual(events[0].roc_percent, "0.00")

    def test_yieldmax_discovers_only_its_official_fund_history_pages(self):
        catalog = b'''<a href="https://yieldmaxetfs.com/our-etfs/tsly/">TSLY</a>
        <a href="https://www.globenewswire.com/news-release/example">release</a>
        <a href="https://yieldmaxetfs.com/our-etfs/nvdy/">NVDY</a>'''
        with patch.object(YieldMaxAdapter, "request_bytes", return_value=catalog):
            candidates = list(YieldMaxAdapter().discover())
        self.assertEqual([candidate.url for candidate in candidates], [
            "https://yieldmaxetfs.com/our-etfs/tsly/",
            "https://yieldmaxetfs.com/our-etfs/nvdy/",
        ])
        self.assertEqual([candidate.metadata["ticker"] for candidate in candidates], ["TSLY", "NVDY"])

    def test_rex_latest_distributions(self):
        events = RexAdapter().parse(
            document(
                "rex",
                "rex_latest.html",
                "https://www.rexshares.com/news-insights/?llm_view=1",
                published_at="2026-03-19",
            )
        )
        self.assertEqual([event.ticker for event in events], ["FEPI", "AIPI"])
        self.assertEqual(events[0].distribution_per_share, "0.5821")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_provider_rejects_unofficial_hosts(self):
        with self.assertRaises(ValueError):
            YieldMaxAdapter().validate_url("https://example.com/fake-release")

    def test_jpmorgan_standard_history(self):
        events = JPMorganAdapter().parse(
            document(
                "jpmorgan",
                "jpmorgan_rendered.txt",
                "https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-46641q332",
                metadata={"ticker": "JEPI"},
            )
        )
        self.assertEqual(events[0].ticker, "JEPI")
        self.assertEqual(events[0].distribution_per_share, "0.37142")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_neos_standard_history(self):
        events = NeosAdapter().parse(
            document(
                "neos",
                "standard_history.html",
                "https://neosfunds.com/spyi/",
                metadata={"ticker": "SPYI"},
            )
        )
        self.assertEqual(events[0].ex_date, "2026-09-16")
        self.assertEqual(events[0].verification_status, "official")

    def test_schd_missing_declaration_requires_review(self):
        events = SchwabAdapter().parse(
            document(
                "schwab",
                "schd_history.html",
                "https://www.schwabassetmanagement.com/products/schd",
                fetched_at="2026-06-24T12:00:00+00:00",
            )
        )
        self.assertEqual(events[0].ticker, "SCHD")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_schwab_catalog_discovers_funds_without_collecting_them_as_events(self):
        adapter = SchwabAdapter()
        catalog = next(iter(adapter.discover()))
        self.assertTrue(catalog.metadata["catalogOnly"])
        funds = adapter.parse_catalog(SourceDocument(
            provider_slug="schwab",
            source_url=catalog.url,
            source_type=catalog.source_type,
            content=(
                b"34 of 34 showing\nSCHD Schwab U.S. Dividend Equity ETF\n"
                b"SCHB Schwab U.S. Broad Market ETF\nSGVT Schwab Government Money Market ETF"
            ),
        ))
        self.assertEqual([item.metadata["ticker"] for item in funds], ["SCHB", "SCHD", "SGVT"])
        self.assertEqual(funds[0].url, "https://www.schwabassetmanagement.com/products/schb")
        seed = list(adapter.catalog_seed())
        self.assertEqual(len(seed), 34)
        self.assertIn("SCUS", {item.metadata["ticker"] for item in seed})

    def test_defiance_latest_card_requires_date_review(self):
        events = DefianceAdapter().parse(
            document(
                "defiance",
                "defiance_latest.html",
                "https://www.defianceetfs.com/explore-our-etfs/",
                fetched_at="2026-09-18T12:00:00+00:00",
            )
        )
        self.assertEqual(events[0].ticker, "QQQY")
        self.assertEqual(events[0].roc_percent, "69.22")
        self.assertEqual(events[0].verification_status, "needs_review")

    def test_browser_adapter_reuses_batch_collector_and_preserves_fetch_evidence(self):
        adapter = JPMorganAdapter()
        candidate = next(iter(adapter.discover()))
        body = "Dividend Schedule 09/01/2026 09/01/2026 09/03/2026 0.37142"
        completed = subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout=json.dumps([{
                "ok": True, "httpStatus": 200, "finalUrl": candidate.url,
                "pageTitle": "JPMorgan ETF",
                "contentBase64": base64.b64encode(body.encode()).decode(),
            }]), stderr="",
        )
        with patch("scripts.content_pipeline.providers.http.subprocess.run", return_value=completed) as run:
            outcome = adapter.fetch_many([candidate])[0]
        self.assertIsNone(outcome.error)
        self.assertEqual(outcome.document.content.decode(), body)
        self.assertEqual(outcome.document.metadata["fetchMode"], "browser")
        self.assertEqual(outcome.document.metadata["httpStatus"], 200)
        payload = json.loads(run.call_args.kwargs["input"])
        self.assertEqual(len(payload["sources"]), 1)
        self.assertEqual(payload["sources"][0]["content"], "text")

    def test_browser_adapter_classifies_challenge_without_fabricating_document(self):
        adapter = SchwabAdapter()
        candidate = next(iter(adapter.discover()))
        completed = subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout=json.dumps([{
                "ok": False, "code": "challenge_detected", "retryable": False,
                "message": "anti-automation challenge detected; collection stopped",
            }]), stderr="",
        )
        with patch("scripts.content_pipeline.providers.http.subprocess.run", return_value=completed):
            outcome = adapter.fetch_many([candidate])[0]
        self.assertIsNone(outcome.document)
        self.assertEqual(outcome.error.code, "challenge_detected")
        self.assertFalse(outcome.error.retryable)

    def test_roundhill_ex_date_discovery_uses_bounded_prior_notice_window(self):
        candidates = list(RoundhillAdapter().discover_for_ex_date(date(2026, 9, 25)))
        self.assertEqual(len(candidates), 7)
        self.assertIn("declaration_dt=2026-09-24", candidates[0].url)
        self.assertIn("declaration_dt=2026-09-18", candidates[-1].url)


if __name__ == "__main__":
    unittest.main()
