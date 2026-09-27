from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .base import SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import date_from_timestamp, extract_labeled_date, parse_date


class YieldMaxAdapter(OfficialHTTPAdapter):
    slug = "yieldmax"
    display_name = "YieldMax"
    official_homepage = "https://yieldmaxetfs.com/"
    parser_version = "2"
    allowed_hosts = ("yieldmaxetfs.com",)
    catalog_url = "https://yieldmaxetfs.com/our-etfs/"
    # Fund history pages contain the official amount plus declaration, ex,
    # record and payment dates.  GlobeNewswire is not a collection source.
    default_max_sources = 100

    def discover(self):
        parsed = parse_html(self.request_bytes(self.catalog_url), self.catalog_url)
        seen: set[str] = set()
        for url, label in parsed.links:
            match = re.search(r"/our-etfs/([a-z0-9.-]+)/?", url, re.IGNORECASE)
            if not match:
                continue
            if url in seen:
                continue
            self.validate_url(url)
            seen.add(url)
            yield SourceCandidate(
                url=url,
                source_type="official_fund_history",
                metadata={"ticker": match.group(1).upper()},
            )

    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        parsed = parse_html(document.content, document.source_url)
        try:
            return self._parse_press_release(document, parsed)
        except ValueError as press_release_error:
            try:
                return self._parse_fund_history(document, parsed)
            except ValueError as fund_history_error:
                raise ValueError(
                    f"unsupported YieldMax page: {press_release_error}; {fund_history_error}"
                ) from fund_history_error

    def _parse_press_release(self, document, parsed) -> list[DistributionEvent]:
        headers, rows = find_table(parsed, ("ticker", "distribution per share"))
        ticker_index = column_index(headers, "etf ticker", "ticker")
        amount_index = column_index(headers, "distribution per share")
        frequency_index = column_index(headers, "distribution frequency", "frequency")

        declared_date = (
            date_from_timestamp(document.published_at)
            or date_from_timestamp(parsed.metadata.get("article:published_time"))
            or date_from_timestamp(parsed.metadata.get("date"))
            or date_from_timestamp(document.fetched_at)
        )
        ex_date = extract_labeled_date(parsed.text, ("Ex. & Record Date", "Ex & Record Date"))
        payable_date = extract_labeled_date(parsed.text, ("Payment Date", "Payable Date"))
        if not ex_date or not payable_date:
            raise ValueError("YieldMax release dates were not found")

        events: list[DistributionEvent] = []
        for row in rows:
            if max(ticker_index, amount_index, frequency_index) >= len(row):
                continue
            ticker_match = re.search(r"\b[A-Z][A-Z0-9.-]{1,11}\b", row[ticker_index].upper())
            amount_match = re.search(r"\$?([0-9]+(?:\.[0-9]+)?)", row[amount_index])
            if not ticker_match or not amount_match:
                continue
            events.append(
                DistributionEvent(
                    provider_slug=self.slug,
                    ticker=ticker_match.group(0),
                    fund_name=row[ticker_index + 1] if ticker_index + 1 < len(row) else None,
                    distribution_per_share=amount_match.group(1),
                    declared_date=declared_date,
                    ex_date=ex_date,
                    record_date=ex_date,
                    payable_date=payable_date,
                    frequency=row[frequency_index].lower(),
                    official_url=document.source_url,
                    verification_status="official",
                )
            )
        if not events:
            raise ValueError("YieldMax table contained no distribution rows")
        return events

    def _parse_fund_history(self, document, parsed) -> list[DistributionEvent]:
        headers, rows = find_table(
            parsed,
            ("distribution per share", "declared date", "ex date", "payable date"),
        )
        amount_index = column_index(headers, "distribution per share")
        declared_index = column_index(headers, "declared date")
        ex_index = column_index(headers, "ex date")
        record_index = column_index(headers, "record date")
        payable_index = column_index(headers, "payable date")
        try:
            roc_index = column_index(headers, "roc")
        except ValueError:
            roc_index = None

        ticker = str(document.metadata.get("ticker") or "").upper()
        if not ticker:
            for heading in parsed.headings:
                match = re.fullmatch(r"[A-Z][A-Z0-9.-]{1,11}", heading.strip().upper())
                if match:
                    ticker = match.group(0)
                    break
        if not ticker:
            path_match = re.search(r"/our-etfs/([a-z0-9.-]+)/?", document.source_url, re.IGNORECASE)
            ticker = path_match.group(1).upper() if path_match else ""
        if not ticker:
            raise ValueError("YieldMax fund ticker was not found")

        events_by_key: dict[str, DistributionEvent] = {}
        for row in rows:
            if max(amount_index, declared_index, ex_index, record_index, payable_index) >= len(row):
                continue
            amount_match = re.search(r"\$?([0-9]+(?:\.[0-9]+)?)", row[amount_index])
            if not amount_match:
                continue
            roc_match = None
            if roc_index is not None and roc_index < len(row):
                roc_match = re.search(r"([0-9]+(?:\.[0-9]+)?)", row[roc_index])
            event = DistributionEvent(
                provider_slug=self.slug,
                ticker=ticker,
                distribution_per_share=amount_match.group(1),
                declared_date=parse_date(row[declared_index]),
                ex_date=parse_date(row[ex_index]),
                record_date=parse_date(row[record_index]),
                payable_date=parse_date(row[payable_index]),
                frequency="weekly",
                roc_percent=roc_match.group(1) if roc_match else None,
                official_url=document.source_url,
                verification_status="official",
            )
            events_by_key[event.event_key] = event
        if not events_by_key:
            raise ValueError("YieldMax fund history contained no distribution rows")
        return list(events_by_key.values())
