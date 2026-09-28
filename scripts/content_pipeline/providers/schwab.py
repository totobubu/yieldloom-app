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
    fetch_mode = "browser"
    browser_content = "html"
    timeout_seconds = 60
    catalog_url = "https://www.schwabassetmanagement.com/product-finder/attributions-and-commentary?combine=etf"
    # Reviewed against the official product finder (34 of 34) on 2026-09-26.
    # This seed preserves catalog coverage when the monitored page returns 403;
    # it never creates distribution events.
    catalog_seed_tickers = (
        "SCHJ", "SCHI", "SCCR", "SCYB", "SCHR", "SCHQ", "SMBS", "SCMB",
        "SCHO", "SCHZ", "SCHP", "SCUS", "STCE", "SCHE", "FNDE", "FNDF",
        "FNDC", "SCHY", "SCHF", "SCHC", "SGVT", "SCHH", "SCHK", "SAEF",
        "FNDB", "FNDX", "FNDA", "SCHB", "SCHD", "SCHX", "SCHG", "SCHV",
        "SCHM", "SCHA",
    )

    def discover(self):
        yield SourceCandidate(
            url=self.catalog_url,
            source_type="official_product_catalog",
            metadata={
                "catalogOnly": True,
                "browserContent": "text",
                "browserReadyText": "showing",
            },
        )

    def parse_catalog(self, document: SourceDocument) -> list[SourceCandidate]:
        text = document.content.decode("utf-8", errors="replace")
        tickers = sorted(set(re.findall(
            r"\b([A-Z][A-Z0-9]{2,5})\s+Schwab[^\r\n]{1,140}?\bETF\b",
            text,
        )))
        if not tickers:
            raise ValueError("Schwab official ETF catalog contained no tickers")
        return [
            SourceCandidate(
                url=f"https://www.schwabassetmanagement.com/products/{ticker.lower()}",
                source_type="official_fund_history",
                metadata={"ticker": ticker},
            )
            for ticker in tickers
        ]

    def catalog_seed(self):
        for ticker in self.catalog_seed_tickers:
            yield SourceCandidate(
                url=f"https://www.schwabassetmanagement.com/products/{ticker.lower()}",
                source_type="official_catalog_seed_2026-09-26",
                metadata={"ticker": ticker},
            )

    def parse(self, document: SourceDocument):
        ticker_match = re.search(r"/products/([a-z0-9.-]+)", document.source_url, re.I)
        ticker = str(document.metadata.get("ticker") or (
            ticker_match.group(1) if ticker_match else ""
        )).upper()
        if not ticker:
            raise ValueError("Schwab fund ticker was not found")
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
                    ticker=ticker,
                    fund_name=None,
                    distribution_per_share=amount.group(1),
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=parse_date(row[record_index]),
                    payable_date=parse_date(row[payable_index]),
                    frequency=None,
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError(f"{ticker} history contained no distribution rows")
        return events
