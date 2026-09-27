from __future__ import annotations

import re
from datetime import date, datetime


DATE_FORMATS = (
    "%m/%d/%Y",
    "%m/%d/%y",
    "%Y-%m-%d",
    "%B %d, %Y",
    "%b %d, %Y",
)


def parse_date(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value.replace(" ", " ")).strip(" .")
    for date_format in DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, date_format).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"unsupported date: {value}")


def date_from_timestamp(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            return None


def extract_labeled_date(text: str, labels: tuple[str, ...]) -> str | None:
    label_pattern = "|".join(re.escape(label) for label in labels)
    month_pattern = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    match = re.search(
        rf"(?:{label_pattern})\s*:?\s*({month_pattern}\s+\d{{1,2}},\s+\d{{4}}|\d{{1,2}}/\d{{1,2}}/\d{{2,4}})",
        text,
        flags=re.IGNORECASE,
    )
    return parse_date(match.group(1)) if match else None
