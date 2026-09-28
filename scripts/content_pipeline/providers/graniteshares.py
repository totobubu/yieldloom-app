from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class GraniteSharesAdapter(OfficialHTTPAdapter):
    """Collect the issuer-maintained YieldBOOST distribution table."""

    slug = "graniteshares"
    display_name = "GraniteShares"
    official_homepage = "https://graniteshares.com/"
    parser_version = "1"
    allowed_hosts = ("graniteshares.com",)
    fetch_mode = "browser"
    browser_content = "html"
    timeout_seconds = 90
    distributions_url = "https://graniteshares.com/underlyings/distribution/"
    autocallable_distributions_url = (
        "https://graniteshares.com/underlyings/autocallable-distribution/"
    )

    def discover(self):
        for url in (self.distributions_url, self.autocallable_distributions_url):
            yield SourceCandidate(
                url=url,
                source_type="official_distribution_table",
            )

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        headers, rows = find_table(
            parse_html(document.content, document.source_url),
            ("ticker", "distribution per share", "ex-date", "payment date"),
        )
        ticker_index = column_index(headers, "ticker")
        name_index = column_index(headers, "etf name")
        frequency_index = column_index(headers, "frequency")
        amount_index = column_index(headers, "distribution per share")
        roc_index = column_index(headers, "roc")
        ex_index = column_index(headers, "ex-date", "ex date")
        payable_index = column_index(headers, "payment date", "payable date")

        events = []
        for row in rows:
            required = (
                ticker_index, name_index, frequency_index, amount_index,
                roc_index, ex_index, payable_index,
            )
            if max(required) >= len(row):
                continue
            ticker = row[ticker_index].strip().upper()
            amount = re.search(r"\$?\s*([0-9]+(?:\.[0-9]+)?)", row[amount_index])
            roc = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*%?", row[roc_index])
            if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", ticker) or not amount:
                continue
            ex_date = parse_date(row[ex_index])
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    fund_name=row[name_index].strip() or None,
                    distribution_per_share=amount.group(1),
                    # The official table does not publish a declaration date.
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=ex_date,
                    payable_date=parse_date(row[payable_index]),
                    frequency=row[frequency_index].strip().lower() or None,
                    roc_percent=roc.group(1) if roc else None,
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("GraniteShares table contained no distribution rows")
        return events
