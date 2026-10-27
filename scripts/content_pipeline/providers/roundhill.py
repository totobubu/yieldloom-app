from __future__ import annotations

import json
import re
from decimal import Decimal
from datetime import date, timedelta
from http.cookiejar import CookieJar
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from ..roundhill_schedule import ANNOUNCEMENT_GROUPS
from .base import NoDataError, SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import parse_date


class RoundhillAdapter(OfficialHTTPAdapter):
    slug = "roundhill"
    display_name = "Roundhill Investments"
    official_homepage = "https://www.roundhillinvestments.com/"
    parser_version = "2"
    http_requests = 0
    allowed_hosts = ("roundhillinvestments.com", "cboe.com")
    cboe_url = "https://www.cboe.com/us/equities/notices/dividends/details/"
    tracked_symbols = (
        "AAPW", "AMDW", "AMZW", "ARMW", "AVGW", "BABW", "BRKW", "COIW",
        "COSW", "GDXW", "GLDW", "GOOW", "HOOW", "MAGY", "METW", "MSFW", "MSTW",
        "NFLW", "NVDW", "PLTW", "TOPW", "TSLW", "TSYW", "UBEW", "UNHW",
        "XDTE", "QDTE", "RDTE", "YBTC", "YETH",
    )

    def discover(self):
        symbols = ",".join(self.tracked_symbols)
        today = date.today()
        for offset in range(0, 7):
            declaration_date = today - timedelta(days=offset)
            yield self._candidate(declaration_date, symbols)

    def discover_for_ex_date(self, ex_date: date):
        symbols = ",".join(self.tracked_symbols)
        for offset in range(1, 8):
            yield self._candidate(ex_date - timedelta(days=offset), symbols)

    def discover_for_declaration_date(self, declaration_date: date, ticker: str):
        tickers = sorted({value.strip().upper() for value in ticker.split(",") if value.strip()})
        if not tickers or any(value not in self.tracked_symbols for value in tickers):
            raise ValueError(f"unregistered Roundhill tickers: {ticker}")
        yield self._candidate(declaration_date, ",".join(tickers))

    def issuer_candidate(self, ticker: str) -> SourceCandidate:
        ticker = ticker.strip().upper()
        if ticker not in self.tracked_symbols:
            raise ValueError(f"unregistered Roundhill ticker: {ticker}")
        return SourceCandidate(
            url=f"{self.official_homepage}etf/{ticker.lower()}/",
            source_type="official_issuer_distribution_json",
            metadata={"issuerTicker": ticker, "tickers": [ticker]},
        )

    def request_bytes(self, url: str) -> bytes:
        self.http_requests += 1
        return super().request_bytes(url)

    def fetch(self, candidate: SourceCandidate) -> SourceDocument:
        match = re.fullmatch(r"/etf/([a-z0-9]+)/?", urlparse(candidate.url).path)
        if urlparse(candidate.url).hostname != "www.roundhillinvestments.com" or not match:
            return super().fetch(candidate)
        ticker = match.group(1).upper()
        if ticker not in self.tracked_symbols:
            raise ValueError(f"unregistered Roundhill ticker: {ticker}")
        self.validate_url(candidate.url)
        # This is the same public AJAX protocol used by the issuer's fund page.
        # Keep the session cookie and public request token in memory only.
        headers = {
            "User-Agent": "DivgrowContentStudio/1.0 (+official distribution monitor)",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": candidate.url,
            "Origin": self.official_homepage.rstrip("/"),
        }
        if not hasattr(self, "_issuer_opener"):
            opener = build_opener(HTTPCookieProcessor(CookieJar()))
            self.http_requests += 1
            with opener.open(Request(
                f"{self.official_homepage}assets/php/server.php", headers=headers,
            ), timeout=self.timeout_seconds) as response:
                token = response.read().decode().strip()
            if not token:
                raise ValueError("Roundhill public request token response was empty")
            self._issuer_opener, self._issuer_token = opener, token
        endpoint = f"{self.official_homepage}assets/php/distribution-call.php"
        payload = urlencode({"upperetf": ticker, "loweretf": f"{ticker.lower()}/",
                             "token": self._issuer_token, "is_ajax": 1}).encode()
        self.http_requests += 1
        with self._issuer_opener.open(Request(endpoint, data=payload, headers=headers),
                                      timeout=self.timeout_seconds) as response:
            content = response.read()
        if not content:
            raise ValueError("Roundhill distribution response was empty")
        return SourceDocument(
            provider_slug=self.slug, source_url=candidate.url,
            source_type="official_issuer_distribution_json", content=content,
            metadata={**candidate.metadata, "issuerTicker": ticker,
                      "requestEndpoint": endpoint, "fetchMode": "http"},
        )

    def parse_issuer(self, document: SourceDocument) -> list[DistributionEvent]:
        rows = json.loads(document.content, parse_float=Decimal)
        if not isinstance(rows, list):
            raise ValueError("Roundhill distribution response must be an array")
        ticker = document.metadata.get("issuerTicker")
        if ticker not in self.tracked_symbols:
            raise ValueError("Roundhill distribution response has no registered ticker")
        events = []
        for row in rows:
            if not isinstance(row, list) or len(row) < 5:
                raise ValueError("Roundhill distribution row is malformed")
            # The same response contains planned calendar rows without amounts.
            if not isinstance(row[4], (int, Decimal)) or isinstance(row[4], bool):
                continue
            declared, ex_date, record, payable = [parse_date(str(value).split(" ")[0]) for value in row[:4]]
            if not declared <= ex_date <= record <= payable:
                raise ValueError("Roundhill issuer distribution dates are inconsistent")
            events.append(DistributionEvent(
                provider_slug=self.slug, ticker=ticker, distribution_per_share=row[4],
                declared_date=declared, ex_date=ex_date, record_date=record,
                payable_date=payable, frequency="weekly", official_url=document.source_url,
                verification_status="official",
            ))
        if not events:
            raise NoDataError("Roundhill issuer response has no declared distributions")
        return events

    def _candidate(self, declaration_date: date, symbols: str) -> SourceCandidate:
        query = urlencode({
            "declaration_dt": declaration_date.isoformat(),
            "firm_name": "Roundhill Financial Inc.",
            "symbols": symbols,
        })
        return SourceCandidate(
            url=f"{self.cboe_url}?{query}",
            source_type="official_exchange_notice",
            published_at=declaration_date.isoformat(),
            metadata={
                "primary_provider": "Roundhill Investments",
                "exchange": "Cboe",
                "tickers": symbols.split(","),
            },
        )

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        if document.source_type == "official_issuer_distribution_json":
            return self.parse_issuer(document)
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
