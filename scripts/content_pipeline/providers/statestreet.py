from __future__ import annotations

import re

from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class StateStreetAdapter(OfficialHTTPAdapter):
    """Collect the issuer-maintained SPDR dividend distribution table."""

    slug = "statestreet"
    display_name = "State Street SPDR ETFs"
    official_homepage = "https://www.ssga.com/us/en/individual/etfs"
    parser_version = "1"
    allowed_hosts = ("ssga.com",)
    fetch_mode = "browser"
    browser_content = "text"
    browser_ready_text = "SPDR Dividend Distributions"
    timeout_seconds = 90
    distributions_url = (
        "https://www.ssga.com/us/en/individual/resources/documents/"
        "etf-dividend-distributions"
    )

    def discover(self):
        yield SourceCandidate(
            url=self.distributions_url,
            source_type="official_distribution_table",
            metadata={"browserContent": "text", "browserReadyText": self.browser_ready_text},
        )

    @staticmethod
    def _frequency(text: str, offset: int) -> str | None:
        matches = []
        for label, normalized in (
            ("Monthly", "monthly"),
            ("Quarterly", "quarterly"),
            ("Semi-Annual", "semi-annual"),
            ("Annual", "annual"),
        ):
            position = text.rfind(f"\n{label}\n", 0, offset + 1)
            if position >= 0:
                matches.append((position, normalized))
        return max(matches)[1] if matches else None

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        text = document.content.decode("utf-8", errors="replace").replace("\r\n", "\n")
        if "Historical Distributions" not in text:
            raise ValueError("State Street distribution table was not found")
        pattern = re.compile(
            r"(?:^|\n)Show\s+(.+?)\s+"
            r"([A-Z][A-Z0-9.-]{0,11})\s+"
            r"([A-Z0-9]{8,9})\s+"
            r"(\d{2}/\d{2}/\d{4})\s+"
            r"(\d{2}/\d{2}/\d{4})\s+"
            r"(\d{2}/\d{2}/\d{4})\s+"
            r"([0-9]+(?:\.[0-9]+)?)\s+",
            re.DOTALL,
        )
        events = []
        for match in pattern.finditer(text):
            fund_name, ticker, _cusip, ex_value, record_value, pay_value, amount = match.groups()
            if float(amount) <= 0:
                continue
            ex_date = parse_date(ex_value)
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    fund_name=" ".join(fund_name.split()),
                    distribution_per_share=amount,
                    declared_date=ex_date,
                    ex_date=ex_date,
                    record_date=parse_date(record_value),
                    payable_date=parse_date(pay_value),
                    frequency=self._frequency(text, match.start()),
                    official_url=document.source_url,
                    verification_status="needs_review",
                )
            )
        if not events:
            raise ValueError("State Street table contained no positive distributions")
        return events
