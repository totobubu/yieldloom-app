from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class FirstTrustAdapter(OfficialHTTPAdapter):
    """Collect paid ETF distributions published by First Trust / FT Vest.

    The catalog is coverage evidence.  Only the small reviewed income seed is
    collected by default; operators can use ``--url`` for an individual fund
    or raise ``--max-sources`` only after reviewing the request estimate.
    """

    slug = "firsttrust"
    display_name = "First Trust / FT Vest"
    official_homepage = "https://www.ftportfolios.com/"
    parser_version = "1"
    allowed_hosts = ("ftportfolios.com",)
    fetch_mode = "browser"
    browser_content = "html"
    timeout_seconds = 90
    catalog_url = (
        "https://www.ftportfolios.com/Retail/etf/etflist.aspx?"
        "DisplayType=FundInfo&ViewAsList=1"
    )
    # BuyWrite and target-income funds reviewed 2026-09-26.  A catalog fetch
    # still records the broader official universe without issuing a request
    # for every fund in one run.
    distribution_tickers = ("FTHI", "FTQI", "HYTI", "LQTI", "TDVI", "XISE")

    def discover(self):
        yield SourceCandidate(
            url=self.catalog_url,
            source_type="official_product_catalog",
            metadata={"catalogOnly": True},
        )
        for ticker in self.distribution_tickers:
            yield SourceCandidate(
                url=(
                    "https://www.ftportfolios.com/Retail/Etf/"
                    f"EtfDividHistory.aspx?Ticker={ticker}"
                ),
                source_type="official_fund_history",
                metadata={"ticker": ticker},
            )

    def catalog_seed(self):
        for ticker in self.distribution_tickers:
            yield SourceCandidate(
                url=(
                    "https://www.ftportfolios.com/Retail/Etf/"
                    f"EtfDividHistory.aspx?Ticker={ticker}"
                ),
                source_type="official_income_seed_2026-09-26",
                metadata={"ticker": ticker},
            )

    def parse_catalog(self, document: SourceDocument) -> list[SourceCandidate]:
        parsed = parse_html(document.content, document.source_url)
        tickers = set(re.findall(r"\bTicker=([A-Z][A-Z0-9.-]{0,11})\b", parsed.text, re.I))
        for url, _label in parsed.links:
            match = re.search(r"[?&]Ticker=([A-Z][A-Z0-9.-]{0,11})\b", url, re.I)
            if match:
                tickers.add(match.group(1).upper())
        return [SourceCandidate(
            url="https://www.ftportfolios.com/Retail/Etf/EtfDividHistory.aspx?Ticker=" + ticker,
            source_type="official_fund_history",
            metadata={"ticker": ticker},
        ) for ticker in sorted(tickers)]

    @staticmethod
    def _ticker(document: SourceDocument) -> str:
        ticker = str(document.metadata.get("ticker") or "").strip().upper()
        if ticker:
            return ticker
        match = re.search(r"[?&]Ticker=([A-Z][A-Z0-9.-]{0,11})\b", document.source_url, re.I)
        if not match:
            raise ValueError("First Trust fund ticker was not found")
        return match.group(1).upper()

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        headers, rows = find_table(
            parse_html(document.content, document.source_url),
            ("ex-date", "record date", "payable date", "distribution amount"),
        )
        ex_index = column_index(headers, "ex-date", "ex date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date")
        amount_index = column_index(headers, "distribution amount", "distribution")
        ticker = self._ticker(document)
        events = []
        for row in rows:
            if max(ex_index, record_index, payable_index, amount_index) >= len(row):
                continue
            amount = re.fullmatch(r"\$\s*([0-9]+(?:\.[0-9]+)?)", row[amount_index].strip())
            if not amount or row[ex_index].strip() in {"", "--"}:
                continue
            ex_date = parse_date(row[ex_index])
            events.append(DistributionEvent(
                provider_slug=self.slug, ticker=ticker,
                distribution_per_share=amount.group(1),
                # Paid-history pages do not include a declaration date.
                declared_date=ex_date, ex_date=ex_date,
                record_date=parse_date(row[record_index]),
                payable_date=parse_date(row[payable_index]),
                official_url=document.source_url,
                verification_status="needs_review",
            ))
        if not events:
            raise ValueError(f"{ticker} First Trust history contained no paid distributions")
        return events
