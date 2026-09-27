from __future__ import annotations

import re

from ..models import SourceDocument
from .base import SourceCandidate
from .fund_history import parse_standard_history
from .http import OfficialHTTPAdapter


class NeosAdapter(OfficialHTTPAdapter):
    slug = "neos"
    display_name = "NEOS Investments"
    official_homepage = "https://neosfunds.com/"
    parser_version = "1"
    allowed_hosts = ("neosfunds.com",)
    tickers = ("SPYI", "QQQI", "IWMI")

    def discover(self):
        for ticker in self.tickers:
            yield SourceCandidate(
                url=f"https://neosfunds.com/{ticker.lower()}/",
                source_type="official_fund_history",
                metadata={"ticker": ticker},
            )

    def parse(self, document: SourceDocument):
        ticker = str(document.metadata.get("ticker") or "").upper()
        if not ticker:
            match = re.search(r"neosfunds\.com/([a-z0-9.-]+)/?", document.source_url, re.I)
            ticker = match.group(1).upper() if match else ""
        if ticker not in self.tickers:
            raise ValueError(f"unsupported NEOS ticker: {ticker}")
        return parse_standard_history(
            document, provider_slug=self.slug, ticker=ticker, frequency="monthly"
        )
