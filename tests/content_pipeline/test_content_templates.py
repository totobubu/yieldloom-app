import tempfile
import unittest
import subprocess
from dataclasses import replace
from pathlib import Path

from scripts.content_pipeline.content_cards import social_square_html
from scripts.content_pipeline.content_templates import ContentEvent, MonthlyDistribution, blog_explainer_markdown, naver_markdown, toss_text
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
        self.assertIn("함께 볼 항목", blog_explainer_markdown(self.event))
        self.assertIn(self.event.official_url, blog_explainer_markdown(self.event))

    def test_weekly_thumbnail_includes_monthly_amount_table(self):
        html = social_square_html(self.event)
        self.assertNotIn("최근 월별 주배당 합계", html)
        self.assertIn("26.09", html)
        self.assertIn("$0.8244", html)
        self.assertIn("Made by 토또부부", html)
        self.assertIn("배당공시일", html)
        self.assertIn("260916", html)
        self.assertIn("직전 대비 +6.4% | + $0.0127", html)

    def test_templates_preserve_official_precision_and_show_source_badges(self):
        precise = replace(
            self.event,
            distribution_per_share="0.252500000",
            source_class="exchange_official",
            source_provider="NASDAQ",
            verification_status="cross_checked",
            precision_digits=9,
        )
        self.assertIn("$0.252500000", toss_text(precise))
        self.assertIn("거래소 공식 공시", naver_markdown(precise))
        html = social_square_html(precise)
        self.assertIn('data-source-class="exchange_official"', html)
        self.assertIn("교차 검증", html)
        self.assertIn("원문 소수 9자리", html)
        self.assertIn("$0.252500000", html)

    def test_bundle_has_all_publishable_assets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle = generate_bundle(self.event, Path(temp_dir))
            self.assertTrue((bundle / "toss.txt").exists())
            self.assertTrue((bundle / "naver-blog.md").exists())
            self.assertTrue((bundle / "blog-explainer.md").exists())
            self.assertIn("1080px", (bundle / "social-square.html").read_text("utf-8"))
            manifest = (bundle / "manifest.json").read_text("utf-8")
            self.assertIn('"requiresApproval": true', manifest)
            self.assertIn('"blog-explainer"', manifest)

    def test_publish_preflight_is_a_dry_run_for_a_verified_bundle(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle = generate_bundle(self.event, Path(temp_dir))
            (bundle / "social-square.png").write_bytes(b"placeholder")
            (bundle / "blog-cover.png").write_bytes(b"placeholder")
            result = subprocess.run(
                ["node", "scripts/content_pipeline/prepare_publish.mjs", str(bundle)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
            )
            self.assertIn('"mode": "dry-run"', result.stdout)
            self.assertIn("No browser login", result.stdout)


if __name__ == "__main__":
    unittest.main()
