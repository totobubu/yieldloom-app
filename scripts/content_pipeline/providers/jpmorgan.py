from __future__ import annotations

import re
import subprocess
from pathlib import Path

from ..models import SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date
from ..models import DistributionEvent


class JPMorganAdapter(OfficialHTTPAdapter):
    slug = "jpmorgan"
    display_name = "J.P. Morgan Asset Management"
    official_homepage = "https://am.jpmorgan.com/"
    parser_version = "1"
    allowed_hosts = ("am.jpmorgan.com",)
    fund_urls = {
        "JEPI": "https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-46641q332#/dividends",
        "JEPQ": "https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-nasdaq-equity-premium-income-etf-46654q203#/dividends",
    }

    def discover(self):
        for ticker, url in self.fund_urls.items():
            yield SourceCandidate(url=url, source_type="official_fund_history", metadata={"ticker": ticker})

    def parse(self, document: SourceDocument):
        ticker = str(document.metadata.get("ticker") or "").upper()
        if not ticker:
            match = re.search(r"jpmorgan-(?:nasdaq-)?equity-premium-income-etf", document.source_url)
            ticker = "JEPQ" if match and "nasdaq" in match.group(0) else "JEPI"
        text = document.content.decode("utf-8", errors="replace")
        schedule = text.split("Dividend Schedule", 1)[-1].split("Capital Gains Schedule", 1)[0]
        pattern = re.compile(
            r"(\d{1,2}/\d{1,2}/\d{4})\s+"
            r"(\d{1,2}/\d{1,2}/\d{4})\s+"
            r"(\d{1,2}/\d{1,2}/\d{4})\s+"
            r"([0-9]+(?:\.[0-9]+)?)"
        )
        events = []
        for ex_value, record_value, pay_value, amount in pattern.findall(schedule):
            ex_date = parse_date(ex_value)
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    distribution_per_share=amount,
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=parse_date(record_value),
                    payable_date=parse_date(pay_value),
                    frequency="monthly",
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("J.P. Morgan rendered dividend schedule contained no rows")
        return events

    def request_bytes(self, url: str) -> bytes:
        self.validate_url(url)
        script = Path(__file__).resolve().parents[1] / "fetch_rendered_text.mjs"
        result = subprocess.run(
            ["node", str(script), url, "Dividend Schedule"],
            check=True,
            capture_output=True,
            timeout=90,
        )
        return result.stdout
