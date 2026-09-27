import tempfile
import unittest
from pathlib import Path

from scripts.content_pipeline.content_templates import ContentEvent, MonthlyDistribution, naver_markdown, social_square_html, toss_text
from scripts.content_pipeline.generate_content import generate_bundle


class ContentTemplateTest(unittest.TestCase):
    def setUp(self):
        self.event = ContentEvent(
            id=42,
            provider_slug="yieldmax",
            ticker="TSLY",
            fund_name="YieldMax TSLA Option Income Strategy ETF",
            distribution_per_share="0.212700",
            currency="USD",
            declared_date="2026-09-16",
            ex_date="2026-09-17",
            payable_date="2026-09-18",
            official_url="https://yieldmaxetfs.com/our-etfs/tsly/",
            verification_status="official",
            previous_distribution="0.200000",
            monthly_distributions=(
                MonthlyDistribution("26.09", "0.8244", ("0.2127", "0.2050", "0.1988", "0.2079")),
            ),
        )

    def test_text_templates_include_source_and_change(self):
        self.assertIn("직전 대비 +6.4%", toss_text(self.event))
        self.assertIn("직전 $0.2 → 이번 $0.2127", toss_text(self.event))
        self.assertIn(self.event.official_url, naver_markdown(self.event))

    def test_weekly_thumbnail_includes_monthly_amount_table(self):
        html = social_square_html(self.event)
        self.assertNotIn("최근 월별 주배당 합계", html)
        self.assertIn("26.09", html)
        self.assertIn("$0.8244", html)
        self.assertIn("Made by 토또부부", html)
        self.assertIn("배당공시일", html)
        self.assertIn("260916", html)
        self.assertIn("직전 대비 +6.4% | + $0.0127", html)

    def test_bundle_has_all_publishable_assets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle = generate_bundle(self.event, Path(temp_dir))
            self.assertTrue((bundle / "toss.txt").exists())
            self.assertTrue((bundle / "naver-blog.md").exists())
            self.assertIn("1080px", (bundle / "social-square.html").read_text("utf-8"))
            self.assertTrue((bundle / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
