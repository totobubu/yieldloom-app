from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from ..yieldmax_schedule import GROUPS, TRACKED_SYMBOLS
from .base import NoDataError, SourceCandidate
from .http import OfficialHTTPAdapter
from .parsing import date_from_timestamp, extract_labeled_date, extract_roc_percent, is_roc_column, parse_date


class YieldMaxAdapter(OfficialHTTPAdapter):
    slug = "yieldmax"
    display_name = "YieldMax"
    official_homepage = "https://yieldmaxetfs.com/"
    parser_version = "4"
    # Release pages may be hosted by the issuer's linked GlobeNewswire distributor.
    allowed_hosts = ("yieldmaxetfs.com", "globenewswire.com")
    catalog_url = "https://yieldmaxetfs.com/our-etfs/"
    # Fund history pages are primary; the issuer-linked news release is a
    # fallback for weeks when those tables have not refreshed.
    default_max_sources = 100
    tracked_symbols = TRACKED_SYMBOLS
    http_requests = 0

    def request_bytes(self, url: str) -> bytes:
        self.http_requests += 1
        return super().request_bytes(url)

    def discover_for_tickers(self, tickers):
        symbols = list(dict.fromkeys(ticker.strip().upper() for ticker in tickers))
        if not symbols or any(symbol not in self.tracked_symbols for symbol in symbols):
            raise ValueError("unconfigured YieldMax target ticker")
        for symbol in symbols:
            yield SourceCandidate(
                url=f"{self.official_homepage}our-etfs/{symbol.lower()}/",
                source_type="official_fund_history",
                metadata={"ticker": symbol},
            )

    def discover_announcements_for_tickers(self, tickers, limit=5):
        """Find recent issuer-hosted release pages as a fallback for stale fund histories."""
        symbols = {ticker.strip().upper() for ticker in tickers}
        if not symbols or any(symbol not in self.tracked_symbols for symbol in symbols):
            raise ValueError("unconfigured YieldMax target ticker")
        groups = {name: set(row["tickers"]) for name, row in GROUPS.items()}
        target_group = next((name for name, members in groups.items() if symbols <= members), None)
        if target_group is None:
            raise ValueError("YieldMax announcement fallback requires tickers from one configured group")
        news_url = f"{self.official_homepage}news/"
        listing = parse_html(self.request_bytes(news_url), news_url)
        accepted = 0
        seen_urls = set()
        for url, title in listing.links:
            normalized = title.lower()
            is_group_3_release = target_group == "group-3" and all(symbol.lower() in normalized for symbol in groups[target_group])
            is_group_release = target_group in {"group-1", "group-2"} and target_group.replace("-", " ") in normalized
            if not (is_group_3_release or is_group_release) or url in seen_urls:
                continue
            try:
                self.validate_url(url)
            except ValueError:
                continue
            seen_urls.add(url)
            yield SourceCandidate(
                url=url,
                source_type="official_press_release",
                metadata={"tickers": sorted(symbols), "group": target_group},
            )
            accepted += 1
            if accepted >= limit:
                break

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
        if document.source_type == "official_fund_history":
            # Targeted observations require the issuer's explicit declared date.
            # A release table elsewhere on the page must not use fetched_at as
            # evidence that this is a newly declared distribution.
            return self._parse_fund_history(document, parsed)
        try:
            return self._parse_press_release(document, parsed)
        except ValueError as press_release_error:
            try:
                return self._parse_fund_history(document, parsed)
            except NoDataError:
                raise
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
        )
        if not declared_date:
            raise ValueError("YieldMax release publication date was not found")
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
        roc_index = next((index for index, header in enumerate(headers) if is_roc_column(header)), None)

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
            roc = extract_roc_percent(row[roc_index]) if roc_index is not None and roc_index < len(row) else None
            review_note = None
            verification_status = "official"
            if roc_index is not None:
                invalid_roc = False
                if roc is not None:
                    try:
                        invalid_roc = not Decimal("0") <= Decimal(roc) <= Decimal("100")
                    except InvalidOperation:
                        invalid_roc = True
                if invalid_roc:
                    raw_roc = row[roc_index].strip() if roc_index < len(row) else ""
                    review_note = (
                        f"Issuer-published ROC value {raw_roc!r} is outside 0–100%; "
                        "the reported value was withheld pending review."
                    )
                    roc = None
                    verification_status = "needs_review"
            event = DistributionEvent(
                provider_slug=self.slug,
                ticker=ticker,
                distribution_per_share=amount_match.group(1),
                declared_date=parse_date(row[declared_index]),
                ex_date=parse_date(row[ex_index]),
                record_date=parse_date(row[record_index]),
                payable_date=parse_date(row[payable_index]),
                frequency="weekly",
                roc_percent=roc,
                verification_status=verification_status,
                verification_note=review_note,
                official_url=document.source_url,
            )
            events_by_key[event.event_key] = event
        if not events_by_key:
            raise NoDataError("YieldMax official fund history contained no distribution rows")
        return list(events_by_key.values())
