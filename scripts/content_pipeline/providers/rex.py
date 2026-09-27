from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import date_from_timestamp, parse_date


class RexAdapter(OfficialHTTPAdapter):
    slug = "rex"
    display_name = "REX Shares"
    official_homepage = "https://www.rexshares.com/"
    parser_version = "1"
    allowed_hosts = ("rexshares.com",)
    news_url = "https://www.rexshares.com/news-insights/?llm_view=1"

    def discover(self):
        yield SourceCandidate(url=self.news_url, source_type="official_distribution_index")

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        parsed = parse_html(document.content, document.source_url)
        headers, rows = find_table(parsed, ("ticker", "ex date", "distribution"))
        fund_index = column_index(headers, "fund")
        ticker_index = column_index(headers, "ticker")
        ex_index = column_index(headers, "ex date")
        amount_index = column_index(headers, "distribution")
        frequency_index = column_index(headers, "frequency")
        observed_date = date_from_timestamp(document.published_at) or date_from_timestamp(document.fetched_at)

        events: list[DistributionEvent] = []
        for row in rows:
            if max(ticker_index, ex_index, amount_index) >= len(row):
                continue
            ticker = row[ticker_index].strip().upper()
            amount_match = re.search(r"\$?([0-9]+(?:\.[0-9]+)?)", row[amount_index])
            if not re.fullmatch(r"[A-Z][A-Z0-9.-]{1,11}", ticker) or not amount_match:
                continue
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    fund_name=row[fund_index] if fund_index < len(row) else None,
                    distribution_per_share=amount_match.group(1),
                    declared_date=observed_date,
                    ex_date=parse_date(row[ex_index]),
                    frequency=row[frequency_index].lower(),
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("REX latest distributions table contained no rows")
        return events
