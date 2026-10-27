"""Roundhill observation policy. Calendars guide polling, never alter official dates."""
from __future__ import annotations

import argparse
import calendar
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

POLICY = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
GROUPS = POLICY["groups"]
if not (0 <= POLICY["earlyDays"] <= 3 and 0 <= POLICY["lateDays"] <= 3):
    raise ValueError("Roundhill weekly observation windows must not overlap")
ANNOUNCEMENT_GROUPS = {name: (row["weekday"], tuple(row["tickers"])) for name, row in GROUPS.items()}
SEOUL = ZoneInfo(POLICY["timezone"])
NEW_YORK = ZoneInfo("America/New_York")
RECOVERY_CRON = "17 0,3,9,14 * * *"
DAILY_CRONS = (
    "45,50,55 10 * * 2-5", "0,5,10,15,20,25,30 11 * * 2-5",
    "45,50,55 11 * * 2-5", "0,5,10,15,20,25,30 12 * * 2-5", "0 13 * * 2-5",
)
TOPW_CRONS = (
    "45,50,55 12 * * 1", "0,5,10,15,20,25,30 13 * * 1",
    "45,50,55 13 * * 1", "0,5,10,15,20,25,30 14 * * 1", "0 15 * * 1",
)


def parse_dates(value: str) -> list[date]:
    try:
        values = list(dict.fromkeys(date.fromisoformat(part) for part in value.split(",")))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expected comma-separated ISO declaration dates") from exc
    if not 1 <= len(values) <= 7:
        raise argparse.ArgumentTypeError("select between one and seven declaration dates")
    return values


def _nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (occurrence - 1))


def _observed(day: date) -> date:
    return day + timedelta(days={5: -1, 6: 1}.get(day.weekday(), 0))


def _easter(year: int) -> date:
    # Gregorian computus, used only for the NYSE Good Friday closure.
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    return date(year, (h + l - 7 * m + 114) // 31, (h + l - 7 * m + 114) % 31 + 1)


def us_closures(year: int) -> set[date]:
    # NYSE does not observe Saturday New Year's Day on the preceding Friday.
    new_year = date(year, 1, 1)
    last_may = date(year, 5, calendar.monthrange(year, 5)[1])
    days = {
        new_year + timedelta(days=int(new_year.weekday() == 6)),
        _nth_weekday(year, 1, 0, 3), _nth_weekday(year, 2, 0, 3),
        _easter(year) - timedelta(days=2), last_may - timedelta(days=last_may.weekday()),
        _observed(date(year, 7, 4)), _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 11, 3, 4), _observed(date(year, 12, 25)),
    }
    if year >= 2022:
        days.add(_observed(date(year, 6, 19)))
    return days | {date.fromisoformat(value) for value in POLICY["extraUsClosures"]}


def us_business_day(day: date) -> bool:
    return day.weekday() < 5 and day not in us_closures(day.year)


def business_days_since(anchor: date, today: date) -> int:
    return sum(us_business_day(anchor + timedelta(days=offset)) for offset in range(1, (today - anchor).days + 1))


def completed_business_days_since(anchor: date, now: datetime) -> int:
    local = now.astimezone(NEW_YORK)
    # Use the regular-session upper bound even on early-close days. This may
    # defer an alert a few hours; it never counts an unopened US session in KST.
    cutoff = local.date() - timedelta(days=int(local.hour < 16))
    return business_days_since(anchor, cutoff)


def candidate_dates(anchor: date, today: date) -> list[date]:
    # Non-overlapping weekly windows prevent a newer week's notice from completing
    # a missing older cycle. Closed days remain eligible: issuers may still publish.
    dates = [anchor + timedelta(days=offset) for offset in range(-POLICY["earlyDays"], POLICY["lateDays"] + 1)]
    return sorted((day for day in dates if day <= today),
                  key=lambda day: (day != anchor, not us_business_day(day), abs((day - anchor).days), day))


def scheduled_slot(cron: str, created_at: datetime) -> datetime:
    """Recover the cron slot from the run's immutable creation time, including reruns."""
    if cron not in (*DAILY_CRONS, *TOPW_CRONS, RECOVERY_CRON):
        raise ValueError("unknown Roundhill schedule")
    minute, hour, _, _, weekdays = cron.split()

    def matches(value: int, field: str) -> bool:
        if field == "*":
            return True
        return any(int(part.split("-")[0]) <= value <= int(part.split("-")[-1]) for part in field.split(","))

    slot = created_at.astimezone(timezone.utc).replace(second=0, microsecond=0)
    for _ in range(8 * 24 * 60):
        if matches(slot.minute, minute) and matches(slot.hour, hour) and matches((slot.weekday() + 1) % 7, weekdays):
            return slot
        slot -= timedelta(minutes=1)
    raise ValueError("could not resolve the scheduled observation time")


def select_primary(cron: str, created_at: datetime) -> tuple[str, date] | None:
    slot = scheduled_slot(cron, created_at).astimezone(SEOUL)
    if cron == RECOVERY_CRON:
        return None
    group = "topw" if cron in TOPW_CRONS else next(name for name, row in GROUPS.items() if row["weekday"] == slot.weekday())
    row = GROUPS[group]
    anchor = slot.date() - timedelta(days=(slot.weekday() - row["weekday"]) % 7)
    minutes = (slot.date() - anchor).days * 1440 + slot.hour * 60 + slot.minute - row["hour"] * 60
    # Keep the observed KST window in both seasons. Add a one-hour-later window
    # in US standard time without asserting that every issuer follows DST.
    winter = not bool(slot.astimezone(NEW_YORK).dst())
    if -15 <= minutes <= 30 or minutes == 60 or (winter and (45 <= minutes <= 90 or minutes == 120)):
        return group, anchor
    return None
