import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.providers import (
    AmplifyAdapter,
    DefianceAdapter,
    GlobalXAdapter,
    JPMorganAdapter,
    NeosAdapter,
    RexAdapter,
    RoundhillAdapter,
    SchwabAdapter,
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


if __name__ == "__main__":
    unittest.main()
