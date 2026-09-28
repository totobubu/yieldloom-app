from __future__ import annotations

import re
from decimal import Decimal

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class ProSharesAdapter(OfficialHTTPAdapter):
    """Collect the latest official distributions from the ProShares ETF table."""

    slug = "proshares"
    display_name = "ProShares"
    official_homepage = "https://www.proshares.com/"
    parser_version = "1"
    allowed_hosts = ("proshares.com",)
    fetch_mode = "browser"
    browser_content = "html"
    timeout_seconds = 90
    distributions_url = "https://www.proshares.com/our-etfs/find-proshares-etfs"
    geared_distributions_url = (
        "https://www.proshares.com/our-etfs/find-leveraged-and-inverse-etfs"
    )

    def discover(self):
        for url in (self.distributions_url, self.geared_distributions_url):
            yield SourceCandidate(
                url=url,
                source_type="official_latest_distribution_table",
            )

    @staticmethod
    def _amount(parts: list[str]) -> str | None:
        values: list[tuple[Decimal, int]] = []
        for part in parts:
            match = re.fullmatch(r"\$\s*([0-9]+(?:\.([0-9]+))?)", part.strip())
            if match:
                values.append((Decimal(match.group(1)), len(match.group(2) or "")))
        if not values:
            return None
        total = sum((value for value, _precision in values), Decimal("0"))
        if total <= 0:
            return None
        precision = max(precision for _value, precision in values)
        return f"{total:.{precision}f}"

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        parsed = parse_html(document.content, document.source_url)
        total_distribution = False
        try:
            headers, rows = find_table(
                parsed,
                ("ticker", "ex date", "record date", "payable date", "dividend", "return of capital"),
            )
        except ValueError:
            headers, rows = find_table(
                parsed,
                ("ticker", "ex date", "record date", "payable date", "total distribution"),
            )
            total_distribution = True
        ticker_index = column_index(headers, "ticker")
        name_index = column_index(headers, "fund name")
        ex_index = column_index(headers, "ex date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date")
        amount_indices = (
            [column_index(headers, "total distribution")]
            if total_distribution
            else [
                column_index(headers, "dividend"),
                column_index(headers, "return of capital"),
                column_index(headers, "long term cap gains"),
                column_index(headers, "short term cap gains"),
            ]
        )

        events = []
        for row in rows:
            required = [ticker_index, name_index, ex_index, record_index, payable_index, *amount_indices]
            if max(required) >= len(row) or row[ex_index].strip() == "--":
                continue
            ticker = row[ticker_index].strip().upper()
            amount = self._amount([row[index] for index in amount_indices])
            if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", ticker) or amount is None:
                continue
            ex_date = parse_date(row[ex_index])
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    fund_name=row[name_index].strip() or None,
                    distribution_per_share=amount,
                    # The latest-distribution table omits declaration dates.
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=parse_date(row[record_index]),
                    payable_date=parse_date(row[payable_index]),
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("ProShares table contained no current distributions")
        return events
