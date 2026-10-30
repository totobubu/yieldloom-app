"""Publication metadata regression; public release excerpts, no network calls."""
import re
import unittest
from pathlib import Path

from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.providers.yieldmax import YieldMaxAdapter


FIXTURES = Path(__file__).parent / "fixtures"


def document(content, **kwargs):
    return SourceDocument(
        "yieldmax",
        kwargs.pop("url", "https://www.globenewswire.com/news-release/2026/10/26/3387931/0/en/example.html"),
        kwargs.pop("source_type", "official_press_release"),
        content.encode() if isinstance(content, str) else content,
        fetched_at="2026-10-30T00:00:00Z",
        **kwargs,
    )


class YieldMaxPublicationDateTests(unittest.TestCase):
    def setUp(self):
        self.content = (FIXTURES / "yieldmax_globenewswire_group-3.html").read_text()
        self.adapter = YieldMaxAdapter()

    def test_actual_group_three_structure_and_targets(self):
        events = self.adapter.parse(document(self.content))
        self.assertEqual([(e.ticker, e.distribution_per_share) for e in events],
                         [("MSST", "0.1419"), ("NVIT", "0.2302"), ("TEST", "0.1807")])
        self.assertEqual({e.declared_date for e in events}, {"2026-10-26"})
        self.assertEqual({(e.ex_date, e.record_date, e.payable_date) for e in events},
                         {("2026-10-27", "2026-10-27", "2026-10-28")})

    def test_actual_group_two_footnoted_muy_structure(self):
        content = (FIXTURES / "yieldmax_globenewswire_group-2.html").read_bytes()
        event, = self.adapter.parse(document(content, url="https://www.globenewswire.com/news-release/2026/10/28/3389994/0/en/example.html"))
        self.assertEqual((event.ticker, event.declared_date, event.ex_date, event.payable_date),
                         ("MUY", "2026-10-28", "2026-10-29", "2026-10-30"))
        self.assertEqual(event.distribution_per_share, "0.1530")

    def test_each_supported_publication_metadata_alias_is_sufficient(self):
        stripped = re.sub(r'<meta (?:name="DC.date.issued"|property="og:article:published_time")[^>]*>', '', self.content)
        for name in ("article:published_time", "og:article:published_time", "DC.date.issued", "date"):
            with self.subTest(name=name):
                content = stripped.replace("<head>", f'<head><meta name="{name}" content="2026-10-26">')
                self.assertEqual(self.adapter.parse(document(content))[0].declared_date, "2026-10-26")

    def test_conflicting_metadata_and_candidate_dates_are_not_ignored(self):
        conflict = self.content.replace('name="DC.date.issued" content="2026-10-26"',
                                        'name="DC.date.issued" content="2026-10-25"')
        for source_type in ("html", "official_press_release"):
            with self.subTest(source_type=source_type), self.assertRaisesRegex(ValueError, "publication dates conflict") as caught:
                self.adapter.parse(document(conflict, source_type=source_type))
            self.assertNotIn("history", str(caught.exception))
        with self.assertRaisesRegex(ValueError, "publication dates conflict"):
            self.adapter.parse(document(self.content, published_at="2026-10-25"))

    def test_missing_metadata_never_uses_url_fetch_time_modified_time_or_related_news(self):
        content = re.sub(r'<meta (?:name="DC.date.issued"|property="og:article:published_time")[^>]*>', '', self.content)
        for source_type in ("html", "official_press_release"):
            with self.subTest(source_type=source_type), self.assertRaisesRegex(ValueError, "publication date was not found") as caught:
                self.adapter.parse(document(content, source_type=source_type))
            self.assertNotIn("required HTML table", str(caught.exception))

    def test_invalid_metadata_does_not_fall_back_to_another_field_or_truncate_a_date(self):
        for value in ("2026-02-30", "2026-10-26not-a-timestamp"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "publication date is invalid"):
                self.adapter.parse(document(self.content.replace('name="DC.date.issued" content="2026-10-26"',
                                                                 f'name="DC.date.issued" content="{value}"')))

    def test_agreeing_publication_metadata_after_the_ex_date_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "dates are inconsistent"):
            self.adapter.parse(document(self.content.replace("2026-10-26", "2026-10-29")))

    def test_globenewswire_publication_uses_et_calendar_for_utc_midnight(self):
        content = self.content.replace("2026-10-26T10:55:00Z", "2026-10-27T03:55:00Z")
        self.assertEqual(self.adapter.parse(document(content))[0].declared_date, "2026-10-26")
        # Standard time uses the same explicit publisher calendar, without a fixed UTC offset.
        content = content.replace("2026-10-26", "2026-12-26").replace("2026-10-27T03:55:00Z", "2026-12-27T04:55:00Z")
        content = content.replace("October 27, 2026", "December 27, 2026").replace("October 28, 2026", "December 28, 2026")
        self.assertEqual(self.adapter.parse(document(content))[0].declared_date, "2026-12-26")


if __name__ == "__main__":
    unittest.main()
