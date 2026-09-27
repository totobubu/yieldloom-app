from __future__ import annotations

import re

from ..html_tables import parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import date_from_timestamp, parse_date


class DefianceAdapter(OfficialHTTPAdapter):
    slug = "defiance"
    display_name = "Defiance ETFs"
    official_homepage = "https://www.defianceetfs.com/"
    parser_version = "1"
    allowed_hosts = ("defianceetfs.com",)
    latest_url = "https://www.defianceetfs.com/explore-our-etfs/"
    tracked_tickers = {"QQQY", "WDTE", "IWMY", "SPYT", "QQQT", "USOY", "GOLI", "MST", "QLDY"}

    def discover(self):
        yield SourceCandidate(url=self.latest_url, source_type="official_latest_distributions")

    def parse(self, document: SourceDocument):
        text = parse_html(document.content, document.source_url).text
        observed = date_from_timestamp(document.published_at) or date_from_timestamp(
            document.fetched_at
        )
        events = []
        for ticker in self.tracked_tickers:
            start = text.find(f"{ticker} ")
            if start < 0:
                continue
            card = text[start : start + 900]
            fund_match = re.match(rf"{ticker}\s+(.*?)\s+Distribution Rate", card)
            amount_match = re.search(r"Latest Distribution\s+\$([0-9]+(?:\.[0-9]+)?)", card)
            payable_match = re.search(r"Payable On\s+(\d{1,2}/\d{1,2}/\d{4})", card)
            roc_match = re.search(
                r"Return of Capital As of\s+\d{1,2}/\d{1,2}/\d{4}\s+([0-9]+(?:\.[0-9]+)?)%",
                card,
            )
            if not all((fund_match, amount_match, payable_match, roc_match)):
                continue
            fund_name = fund_match.group(1)
            amount = amount_match.group(1)
            payable = payable_match.group(1)
            roc = roc_match.group(1)
            if float(amount) <= 0:
                continue
            payable_date = parse_date(payable)
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    fund_name=fund_name,
                    distribution_per_share=amount,
                    declared_date=observed or payable_date,
                    ex_date=payable_date,
                    payable_date=payable_date,
                    frequency="weekly" if ticker in {"QQQY", "WDTE", "IWMY", "USOY", "GOLI", "MST", "QLDY"} else "monthly",
                    roc_percent=roc,
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("Defiance latest distribution cards contained no rows")
        return events
