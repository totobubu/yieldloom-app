from __future__ import annotations

import re
from datetime import date, timedelta
from urllib.parse import parse_qs, urlencode, urlparse

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import NoDataError, SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class RoundhillAdapter(OfficialHTTPAdapter):
    slug = "roundhill"
    display_name = "Roundhill Investments"
    official_homepage = "https://www.roundhillinvestments.com/"
    parser_version = "1"
    allowed_hosts = ("roundhillinvestments.com", "cboe.com")
    cboe_url = "https://www.cboe.com/us/equities/notices/dividends/details/"
    tracked_symbols = (
        "AAPW", "AMDW", "AMZW", "ARMW", "AVGW", "BABW", "BRKW", "COIW",
        "COSW", "GDXW", "GLDW", "GOOW", "HOOW", "METW", "MSFW", "MSTW",
        "NFLW", "NVDW", "PLTW", "TOPW", "TSLW", "TSYW", "UBEW", "UNHW",
    )

    def discover(self):
        symbols = ",".join(self.tracked_symbols)
        today = date.today()
        for offset in range(0, 7):
            declaration_date = today - timedelta(days=offset)
            query = urlencode(
                {
                    "declaration_dt": declaration_date.isoformat(),
                    "firm_name": "Roundhill Financial Inc.",
                    "symbols": symbols,
                }
            )
            yield SourceCandidate(
                url=f"{self.cboe_url}?{query}",
                source_type="official_exchange_notice",
                published_at=declaration_date.isoformat(),
                metadata={"primary_provider": "Roundhill Investments", "exchange": "Cboe"},
            )

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        parsed = parse_html(document.content, document.source_url)
        headers, rows = find_table(parsed, ("symbol", "distribution amount", "ex date"))
        symbol_index = column_index(headers, "symbol")
        name_index = column_index(headers, "name")
        ex_index = column_index(headers, "ex date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date", "pay date")
        amount_index = column_index(headers, "distribution amount", "amount paid")
        frequency_index = column_index(headers, "frequency")

        query_date = parse_qs(urlparse(document.source_url).query).get("declaration_dt", [None])[0]
        declared_date = document.published_at or query_date
        if not declared_date:
            raise ValueError("Roundhill declaration date was not found")
        declared_date = parse_date(declared_date)

        events: list[DistributionEvent] = []
        for row in rows:
            if max(symbol_index, amount_index, ex_index) >= len(row):
                continue
            ticker = row[symbol_index].strip().upper()
            amount_match = re.search(r"\$?([0-9]+(?:\.[0-9]+)?)", row[amount_index])
            if ticker not in self.tracked_symbols or not amount_match:
                continue
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker,
                    fund_name=row[name_index] if name_index < len(row) else None,
                    distribution_per_share=amount_match.group(1),
                    declared_date=declared_date,
                    ex_date=parse_date(row[ex_index]),
                    record_date=parse_date(row[record_index]),
                    payable_date=parse_date(row[payable_index]),
                    frequency=row[frequency_index].lower(),
                    official_url=document.source_url,
                    verification_status="cross_checked",
                )
            )
        if not events:
            raise NoDataError("Cboe notice contained no tracked Roundhill rows")
        return events
