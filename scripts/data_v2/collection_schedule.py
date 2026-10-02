"""Choose the smallest safe set of official source documents to check."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def source_key(provider: str, ticker: str, url: str) -> str:
    return f"{provider}|{ticker.upper() or '*'}|{url}"


def schedule_for(history: list[dict[str, str]], now: datetime) -> dict[str, Any]:
    """Use only official timestamps to make a schedule; observations remain evidence only."""
    official = [parse_time(row.get("officialPublishedAt")) for row in history]
    official = sorted(item for item in official if item is not None)[-6:]
    if len(official) < 3:
        return {"mode": "observation", "confidence": "unconfirmed"}
    minutes = [item.hour * 60 + item.minute for item in official]
    center = int(median(minutes))
    spread = max(abs(value - center) for value in minutes)
    gaps = [(right.date() - left.date()).days for left, right in zip(official, official[1:])]
    interval_days = int(median(gaps)) if gaps else 0
    if spread > 120 or interval_days < 1:
        return {"mode": "observation", "confidence": "irregular"}
    next_date = official[-1].date() + timedelta(days=interval_days)
    return {
        "mode": "scheduled",
        "confidence": "official_time_history",
        "predictedMinuteUtc": center,
        "windowMinutes": 60,
        "intervalDays": interval_days,
        "nextExpectedDate": next_date.isoformat(),
        "updatedAt": now.replace(microsecond=0).isoformat(),
    }


def due_reason(source: dict[str, Any], now: datetime) -> str | None:
    """Return one reason to fetch now, or None when the source can be skipped."""
    retry_at = parse_time(source.get("nextRetryAt"))
    if retry_at and retry_at <= now:
        return "retry"
    last_checked = parse_time(source.get("lastCheckedAt"))
    schedule = source.get("schedule") or {}
    if schedule.get("mode") == "scheduled":
        expected = schedule.get("nextExpectedDate")
        minute = schedule.get("predictedMinuteUtc")
        if isinstance(expected, str) and isinstance(minute, int):
            expected_date = datetime.fromisoformat(expected).date()
            if abs((now.date() - expected_date).days) <= 1:
                if abs((now.hour * 60 + now.minute) - minute) > 60:
                    return None
                if last_checked and last_checked.replace(minute=0, second=0, microsecond=0) == now.replace(minute=0, second=0, microsecond=0):
                    return None
                return "announcement_window"
    if not last_checked or last_checked.date() < now.date():
        return "daily_safety"
    return None


def retry_at(now: datetime, failures: int) -> str:
    hours = min(24, 2 ** max(0, failures - 1))
    return (now + timedelta(hours=hours)).replace(microsecond=0).isoformat()
