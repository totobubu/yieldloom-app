from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import NoDataError, SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class GlobalXAdapter(OfficialHTTPAdapter):
    """Read the rendered distribution-history table from official fund pages."""

    slug = "globalx"
    display_name = "Global X ETFs"
    official_homepage = "https://www.globalxetfs.com/"
    parser_version = "2"
    allowed_hosts = ("globalxetfs.com",)
    fetch_mode = "browser"
    browser_ready_selector = 'table[aria-label="Distributions table"]'
    tickers = ("QYLD", "XYLD", "RYLD", "QYLG", "XYLG", "RYLG")

    def discover(self):
        for ticker in self.tickers:
            yield SourceCandidate(
                url=f"https://www.globalxetfs.com/funds/{ticker.lower()}",
                source_type="official_fund_history",
                metadata={"ticker": ticker},
            )

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        ticker = str(document.metadata.get("ticker") or "").upper()
        if ticker not in self.tickers:
            raise ValueError(f"unsupported Global X ticker: {ticker}")

        parsed = parse_html(document.content, document.source_url)
        headers, rows = find_table(parsed, ("ex-date", "record date", "payable date", "amount"))
        ex_index = column_index(headers, "ex-date", "ex date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date")
        amount_index = column_index(headers, "amount")

        events: list[DistributionEvent] = []
        for row in rows:
            if max(ex_index, record_index, payable_index, amount_index) >= len(row):
                continue
            amount = re.sub(r"[$,\s]", "", row[amount_index])
            ex_date = parse_date(row[ex_index])
            if not amount or not ex_date:
                continue
            try:
                if float(amount) <= 0:
                    continue
            except ValueError:
                continue
            events.append(DistributionEvent(
                provider_slug=self.slug,
                ticker=ticker,
                distribution_per_share=amount,
                # Global X's rendered history table does not include a declared date.
                declared_date=ex_date,
                ex_date=ex_date,
                record_date=parse_date(row[record_index]),
                payable_date=parse_date(row[payable_index]),
                frequency="monthly",
                official_url=document.source_url,
                verification_status="official",
            ))
        if not events:
            raise NoDataError("Global X rendered history table contained no distribution rows")
        return events
