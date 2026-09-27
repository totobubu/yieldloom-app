from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class SchwabAdapter(OfficialHTTPAdapter):
    slug = "schwab"
    display_name = "Schwab Asset Management"
    official_homepage = "https://www.schwabassetmanagement.com/"
    parser_version = "1"
    allowed_hosts = ("schwabassetmanagement.com",)
    fund_url = "https://www.schwabassetmanagement.com/products/schd"

    def discover(self):
        yield SourceCandidate(
            url=self.fund_url, source_type="official_fund_history", metadata={"ticker": "SCHD"}
        )

    def parse(self, document: SourceDocument):
        parsed = parse_html(document.content, document.source_url)
        headers, rows = find_table(
            parsed, ("ex date", "record date", "payable date", "total distribution")
        )
        ex_index = column_index(headers, "ex date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date")
        amount_index = column_index(headers, "total distribution")
        events = []
        for row in rows:
            if max(ex_index, record_index, payable_index, amount_index) >= len(row):
                continue
            amount = re.search(r"([0-9]+(?:\.[0-9]+)?)", row[amount_index])
            if not amount or float(amount.group(1)) <= 0:
                continue
            ex_date = parse_date(row[ex_index])
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker="SCHD",
                    fund_name="Schwab U.S. Dividend Equity ETF",
                    distribution_per_share=amount.group(1),
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=parse_date(row[record_index]),
                    payable_date=parse_date(row[payable_index]),
                    frequency="quarterly",
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("SCHD history contained no distribution rows")
        return events
