from __future__ import annotations

import re

from ..html_tables import column_index, find_table, parse_html
from ..models import DistributionEvent, SourceDocument
from .parsing import parse_date


def parse_standard_history(
    document: SourceDocument,
    *,
    provider_slug: str,
    ticker: str,
    frequency: str,
) -> list[DistributionEvent]:
    parsed = parse_html(document.content, document.source_url)
    headers, rows = find_table(
        parsed,
        ("declaration date", "ex", "record date", "payable date", "amount"),
    )
    declared_index = column_index(headers, "declaration date", "declared date")
    ex_index = column_index(headers, "ex div date", "ex dividend date", "ex date")
    record_index = column_index(headers, "record date")
    payable_index = column_index(headers, "payable date", "payment date")
    amount_index = column_index(headers, "amount", "distribution per share")
    events = []
    for row in rows:
        if max(declared_index, ex_index, record_index, payable_index, amount_index) >= len(row):
            continue
        amount = re.search(r"\$?([0-9]+(?:\.[0-9]+)?)", row[amount_index])
        if not amount or float(amount.group(1)) <= 0:
            continue
        events.append(
            DistributionEvent(
                provider_slug=provider_slug,
                ticker=ticker,
                distribution_per_share=amount.group(1),
                declared_date=parse_date(row[declared_index]),
                ex_date=parse_date(row[ex_index]),
                record_date=parse_date(row[record_index]),
                payable_date=parse_date(row[payable_index]),
                frequency=frequency,
                official_url=document.source_url,
                verification_status="official",
            )
        )
    if not events:
        raise ValueError(f"{provider_slug} history contained no distribution rows")
    return events
