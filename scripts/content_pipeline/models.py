from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any


TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.-]{0,11}$")
VERIFICATION_STATUSES = {
    "detected",
    "official",
    "cross_checked",
    "needs_review",
    "rejected",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_iso_date(value: str | date | None, *, required: bool = False) -> str | None:
    if value is None or value == "":
        if required:
            raise ValueError("date value is required")
        return None
    if isinstance(value, date):
        return value.isoformat()
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise ValueError(f"invalid ISO date: {value}") from exc


def normalize_decimal(value: str | int | float | Decimal, *, positive: bool = False) -> str:
    try:
        decimal_value = Decimal(str(value).replace("$", "").replace("%", "").strip())
    except (InvalidOperation, AttributeError) as exc:
        raise ValueError(f"invalid decimal value: {value}") from exc
    if not decimal_value.is_finite():
        raise ValueError(f"decimal value must be finite: {value}")
    if positive and decimal_value <= 0:
        raise ValueError(f"decimal value must be positive: {value}")
    return format(decimal_value, "f")


@dataclass(frozen=True)
class SourceDocument:
    provider_slug: str
    source_url: str
    source_type: str
    content: bytes
    fetched_at: str = field(default_factory=utc_now_iso)
    published_at: str | None = None
    local_path: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.provider_slug.strip():
            raise ValueError("provider_slug is required")
        if not self.source_url.startswith(("https://", "http://", "file://")):
            raise ValueError("source_url must be an http(s) or file URL")
        if not self.source_type.strip():
            raise ValueError("source_type is required")
        if not self.content:
            raise ValueError("source content is empty")

    @property
    def content_sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()

    @property
    def metadata_json(self) -> str:
        return json.dumps(self.metadata, ensure_ascii=False, sort_keys=True)


@dataclass(frozen=True)
class DistributionEvent:
    provider_slug: str
    ticker: str
    distribution_per_share: str | int | float | Decimal
    declared_date: str | date
    ex_date: str | date
    official_url: str
    fund_name: str | None = None
    currency: str = "USD"
    record_date: str | date | None = None
    payable_date: str | date | None = None
    frequency: str | None = None
    roc_percent: str | int | float | Decimal | None = None
    verification_status: str = "official"
    collected_at: str = field(default_factory=utc_now_iso)

    def __post_init__(self) -> None:
        ticker = self.ticker.strip().upper()
        provider_slug = self.provider_slug.strip().lower()
        if not TICKER_PATTERN.fullmatch(ticker):
            raise ValueError(f"invalid ticker: {self.ticker}")
        if not provider_slug:
            raise ValueError("provider_slug is required")
        if self.verification_status not in VERIFICATION_STATUSES:
            raise ValueError(f"invalid verification status: {self.verification_status}")
        if not self.official_url.startswith(("https://", "http://")):
            raise ValueError("official_url must be an http(s) URL")

        amount = normalize_decimal(self.distribution_per_share, positive=True)
        roc = None if self.roc_percent is None else normalize_decimal(self.roc_percent)
        if roc is not None and not (Decimal("0") <= Decimal(roc) <= Decimal("100")):
            raise ValueError(f"roc_percent is outside 0-100: {roc}")

        object.__setattr__(self, "provider_slug", provider_slug)
        object.__setattr__(self, "ticker", ticker)
        object.__setattr__(self, "currency", self.currency.strip().upper())
        object.__setattr__(self, "distribution_per_share", amount)
        object.__setattr__(self, "declared_date", normalize_iso_date(self.declared_date, required=True))
        object.__setattr__(self, "ex_date", normalize_iso_date(self.ex_date, required=True))
        object.__setattr__(self, "record_date", normalize_iso_date(self.record_date))
        object.__setattr__(self, "payable_date", normalize_iso_date(self.payable_date))
        object.__setattr__(self, "roc_percent", roc)

    @property
    def event_key(self) -> str:
        identity = "|".join(
            [self.provider_slug, self.ticker, str(self.declared_date), str(self.ex_date)]
        )
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()
