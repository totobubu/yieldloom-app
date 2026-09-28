from __future__ import annotations

import re

from ..html_tables import normalize_header, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class ISharesAdapter(OfficialHTTPAdapter):
    """Collect the official iShares US ETF catalog and fund distributions."""

    slug = "ishares"
    display_name = "iShares by BlackRock"
    official_homepage = "https://www.ishares.com/us/"
    parser_version = "1"
    allowed_hosts = ("ishares.com",)
    fetch_mode = "browser"
    # Targeted fund refreshes use rendered text; the catalog explicitly opts
    # back into HTML so official product links remain available.
    browser_content = "text"
    timeout_seconds = 90
    catalog_url = "https://www.ishares.com/us/products/etf-investments"

    def discover(self):
        yield SourceCandidate(
            url=self.catalog_url,
            source_type="official_product_catalog",
            metadata={"catalogOnly": True, "browserContent": "html"},
        )

    def parse_catalog(self, document: SourceDocument) -> list[SourceCandidate]:
        parsed = parse_html(document.content, document.source_url)
        catalog_tickers: set[str] = set()
        for table in parsed.tables:
            if not table:
                continue
            headers = [normalize_header(value) for value in table[0]]
            if not headers or headers[0] != "ticker":
                continue
            if len(headers) < 2 or headers[1] not in {"name", "fund name"}:
                continue
            catalog_tickers.update(
                row[0].strip().upper()
                for row in table[1:]
                if row and re.fullmatch(r"[A-Z0-9][A-Z0-9.-]{0,11}", row[0].strip().upper())
            )
            break
        if not catalog_tickers:
            raise ValueError("iShares official ETF catalog table contained no tickers")
        funds: dict[str, SourceCandidate] = {}
        for url, label in parsed.links:
            ticker = label.strip().upper()
            if ticker not in catalog_tickers:
                continue
            if not re.search(r"/us/products/\d+/[^/?#]+/?$", url):
                continue
            funds[ticker] = SourceCandidate(
                url=url,
                source_type="official_fund_history",
                metadata={"ticker": ticker, "browserContent": "text"},
            )
        if not funds:
            raise ValueError("iShares official ETF catalog contained no fund links")
        return [funds[ticker] for ticker in sorted(funds)]

    @staticmethod
    def _ticker(text: str, document: SourceDocument) -> str:
        metadata_ticker = str(document.metadata.get("ticker") or "").strip().upper()
        if metadata_ticker:
            return metadata_ticker
        match = re.search(
            r"(?:^|\n)([A-Z0-9][A-Z0-9.-]{0,11})\s*\n"
            r"[^\n]{1,40}\n(?:iShares|BlackRock)",
            text,
        )
        if not match:
            raise ValueError("iShares fund ticker was not found")
        return match.group(1)

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        text = document.content.decode("utf-8", errors="replace").replace("\r\n", "\n")
        ticker = self._ticker(text, document)
        if "Distributions" not in text:
            raise ValueError("iShares distributions section was not found")
        section = text.rsplit("\nDistributions\n", 1)[-1]
        section = section.split("\nFees\n", 1)[0]
        row_pattern = re.compile(
            r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+"
            r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+"
            r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+"
            r"\$([0-9]+(?:\.[0-9]+)?)"
        )
        frequency_match = re.search(r"Distribution\s+Frequency\s+([^\n]+)", text, re.I)
        frequency = frequency_match.group(1).strip().lower() if frequency_match else None
        events = []
        for record_value, ex_value, payable_value, amount in row_pattern.findall(section):
            if float(amount) <= 0:
                continue
            ex_date = parse_date(ex_value)
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    distribution_per_share=amount,
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=parse_date(record_value),
                    payable_date=parse_date(payable_value),
                    frequency=frequency,
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError(f"{ticker} iShares history contained no distribution rows")
        return events
