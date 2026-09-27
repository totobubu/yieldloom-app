from __future__ import annotations

import json

from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter


class GlobalXAdapter(OfficialHTTPAdapter):
    """Read Global X's distributionHistoryData payload from official fund pages."""

    slug = "globalx"
    display_name = "Global X ETFs"
    official_homepage = "https://www.globalxetfs.com/"
    parser_version = "1"
    allowed_hosts = ("globalxetfs.com",)
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
        text = document.content.decode("utf-8", errors="replace")
        marker = '"distributionHistoryData":'
        start = text.find(marker)
        escaped = start < 0
        if escaped:
            marker = r'\"distributionHistoryData\":'
            start = text.find(marker)
        if start < 0:
            raise ValueError("Global X distribution history payload was not found")
        value = text[start + len(marker):]
        # Next.js serializes the RSC payload into an escaped JavaScript string.
        # The payload itself remains JSON after restoring its quote delimiters.
        if escaped:
            value = value.replace(r'\"', '"')
        payload, _ = json.JSONDecoder().raw_decode(value)
        histories = [item for item in payload if item.get("ETF_TICKER", "").upper() == ticker]
        if not histories:
            raise ValueError(f"Global X history payload did not contain {ticker}")
        events = []
        for row in histories[0].get("DISTRIBUTION_HISTORY", []):
            amount = row.get("amount")
            ex_date = row.get("ex_date")
            if amount is None or not ex_date or float(amount) <= 0:
                continue
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    distribution_per_share=str(amount),
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=row.get("record_date"),
                    payable_date=row.get("payable_date"),
                    frequency="monthly",
                    official_url=document.source_url,
                    verification_status="official",
                )
            )
        if not events:
            raise ValueError("Global X distribution history contained no rows")
        return events
