"""YieldMax group policy; share the US calendar and cron resolver with Roundhill."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from . import roundhill_schedule as shared

POLICY = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
GROUPS = POLICY["groups"]
TRACKED_SYMBOLS = tuple(ticker for group in GROUPS.values() for ticker in group["tickers"])
TICKER_START_DATES = {
    ticker: date.fromisoformat(value)
    for ticker, value in POLICY.get("tickerStartDates", {}).items()
}
if set(TICKER_START_DATES) - set(TRACKED_SYMBOLS):
    raise ValueError("YieldMax start dates reference unconfigured tickers")


def eligible_tickers(group: str, today: date) -> list[str]:
    return [
        ticker for ticker in GROUPS[group]["tickers"]
        if today >= TICKER_START_DATES.get(ticker, date.min)
    ]
if len(TRACKED_SYMBOLS) != len(set(TRACKED_SYMBOLS)):
    raise ValueError("YieldMax groups must have distinct ticker lists")
if not (0 <= POLICY["earlyDays"] <= 3 and 0 <= POLICY["lateDays"] <= 3):
    raise ValueError("YieldMax weekly observation windows must not overlap")
if not (1 <= POLICY["maxTickersPerBatch"] <= 6 and 1 <= POLICY["maxBatchesPerRun"] <= 8):
    raise ValueError("YieldMax batches must fit within the workflow time budget")
SEOUL = ZoneInfo(POLICY["timezone"])
PRIMARY_CRONS = (
    "45,50,55 10 * * 1-3", "0,5,10,15,20,25,30 11 * * 1-3",
    "45,50,55 11 * * 1-3", "0,5,10,15,20,25,30 12 * * 1-3", "0 13 * * 1-3",
)
# Stagger recovery from Roundhill's :17 jobs while keeping the common writer lock.
RECOVERY_CRON = "37 0,3,9,14 * * *"


def candidate_dates(anchor: date, today: date) -> list[date]:
    return shared.candidate_dates(anchor, today, policy=POLICY)


def scheduled_slot(cron: str, created_at: datetime) -> datetime:
    return shared.scheduled_slot(cron, created_at, allowed_crons=(*PRIMARY_CRONS, RECOVERY_CRON))


def select_primary(cron: str, created_at: datetime) -> tuple[str, date] | None:
    slot = scheduled_slot(cron, created_at).astimezone(SEOUL)
    if cron == RECOVERY_CRON:
        return None
    group = next(name for name, row in GROUPS.items() if row["weekday"] == slot.weekday())
    row = GROUPS[group]
    anchor = slot.date() - timedelta(days=(slot.weekday() - row["weekday"]) % 7)
    minutes = slot.hour * 60 + slot.minute - row["hour"] * 60
    winter = not bool(slot.astimezone(shared.NEW_YORK).dst())
    if -15 <= minutes <= 30 or minutes == 60 or (winter and (45 <= minutes <= 90 or minutes == 120)):
        return group, anchor
    return None
