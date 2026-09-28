from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class KurvAdapter(OfficialHTTPAdapter):
    """Collect full distribution histories from official Kurv fund pages."""

    slug = "kurv"
    display_name = "Kurv Investment Management"
    official_homepage = "https://www.kurvinvest.com/"
    parser_version = "1"
    allowed_hosts = ("kurvinvest.com",)
    fetch_mode = "browser"
    browser_content = "html"
    timeout_seconds = 90
    catalog_url = "https://www.kurvinvest.com/etfs"
    # Reviewed against the official lineup on 2026-09-26. The catalog source is
    # also parsed on every run so new tickers become visible as catalog evidence.
    catalog_seed_tickers = (
        "KMEM", "LQID", "KQQQ", "KYLD", "LCTO", "KGLD", "KSLV", "KCOP",
        "KEO", "AMZP", "AAPY", "GOOP", "MSFY", "NFLP", "TSLP", "XSHP",
    )
    distribution_tickers = tuple(
        ticker for ticker in catalog_seed_tickers if ticker != "KMEM"
    )

    def discover(self):
        yield SourceCandidate(
            url=self.catalog_url,
            source_type="official_product_catalog",
            metadata={"catalogOnly": True},
        )
        for ticker in self.distribution_tickers:
            yield SourceCandidate(
                url=f"https://www.kurvinvest.com/etf/{ticker.lower()}",
                source_type="official_fund_history",
                metadata={"ticker": ticker},
            )

    def catalog_seed(self):
        for ticker in self.catalog_seed_tickers:
            yield SourceCandidate(
                url=f"https://www.kurvinvest.com/etf/{ticker.lower()}",
                source_type="official_catalog_seed_2026-09-26",
                metadata={"ticker": ticker},
            )

    def parse_catalog(self, document: SourceDocument) -> list[SourceCandidate]:
        funds: dict[str, SourceCandidate] = {}
        for url, _label in parse_html(document.content, document.source_url).links:
            match = re.fullmatch(
                r"https://www\.kurvinvest\.com/etf/([a-z0-9.-]+)/?", url, re.I
            )
            if not match:
                continue
            ticker = match.group(1).upper()
            funds[ticker] = SourceCandidate(
                url=f"https://www.kurvinvest.com/etf/{match.group(1).lower()}",
                source_type="official_fund_history",
                metadata={"ticker": ticker},
            )
        if not funds:
            raise ValueError("Kurv official ETF catalog contained no fund links")
        return [funds[ticker] for ticker in sorted(funds)]

    @staticmethod
    def _ticker(document: SourceDocument) -> str:
        ticker = str(document.metadata.get("ticker") or "").strip().upper()
        if ticker:
            return ticker
        match = re.search(r"/etf/([a-z0-9.-]+)/?", document.source_url, re.I)
        if not match:
            raise ValueError("Kurv fund ticker was not found")
        return match.group(1).upper()

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        parsed = parse_html(document.content, document.source_url)
        headers, rows = find_table(
            parsed,
            ("declaration date", "ex-dividend date", "record date", "payable date", "$ per share"),
        )
        declared_index = column_index(headers, "declaration date")
        ex_index = column_index(headers, "ex-dividend date", "ex dividend date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date")
        amount_index = column_index(headers, "$ per share", "per share")
        ticker = self._ticker(document)
        frequency_match = re.search(
            r"Distributions\s+(Weekly|Monthly|Quarterly|Annual)\b", parsed.text, re.I
        )
        frequency = frequency_match.group(1).lower() if frequency_match else None

        events = []
        for row in rows:
            if max(declared_index, ex_index, record_index, payable_index, amount_index) >= len(row):
                continue
            amount = re.fullmatch(r"\$\s*([0-9]+(?:\.[0-9]+)?)", row[amount_index].strip())
            # Kurv publishes future scheduled rows with "--" amounts. They are
            # schedule evidence, not declared distribution events.
            if not amount:
                continue
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    distribution_per_share=amount.group(1),
                    declared_date=parse_date(row[declared_index]),
                    ex_date=parse_date(row[ex_index]),
                    record_date=parse_date(row[record_index]),
                    payable_date=parse_date(row[payable_index]),
                    frequency=frequency,
                    official_url=document.source_url,
                    verification_status="official",
                )
            )
        if not events:
            raise ValueError(f"{ticker} Kurv history contained no declared distribution rows")
        return events
