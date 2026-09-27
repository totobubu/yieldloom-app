from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class AmplifyAdapter(OfficialHTTPAdapter):
    """Collect distribution histories published on Amplify fund pages."""

    slug = "amplify"
    display_name = "Amplify ETFs"
    official_homepage = "https://amplifyetfs.com/"
    parser_version = "1"
    allowed_hosts = ("amplifyetfs.com",)
    # Each is a confirmed live page with an official distribution-history table.
    tickers = ("DIVO", "IDVO", "QDVO")

    def discover(self):
        for ticker in self.tickers:
            yield SourceCandidate(
                url=f"https://amplifyetfs.com/{ticker.lower()}/",
                source_type="official_fund_history",
                metadata={"ticker": ticker},
            )

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        ticker = str(document.metadata.get("ticker") or "").upper()
        if ticker not in self.tickers:
            raise ValueError(f"unsupported Amplify ticker: {ticker}")
        headers, rows = find_table(
            parse_html(document.content, document.source_url),
            ("ex-date", "record date", "payable date", "amount"),
        )
        ex_index = column_index(headers, "ex-date", "ex date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date")
        amount_index = column_index(headers, "amount (usd)", "amount")
        events = []
        for row in rows:
            if max(ex_index, record_index, payable_index, amount_index) >= len(row):
                continue
            match = re.search(r"\$?([0-9]+(?:\.[0-9]+)?)", row[amount_index])
            if not match or float(match.group(1)) <= 0:
                continue
            ex_date = parse_date(row[ex_index])
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    distribution_per_share=match.group(1),
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=parse_date(row[record_index]),
                    payable_date=parse_date(row[payable_index]),
                    frequency="monthly",
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("Amplify distribution history contained no rows")
        return events
