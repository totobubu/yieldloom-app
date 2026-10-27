"""Shared provider-isolated observation engine for official ETF announcements."""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.observe_roundhill import announcement_collected as collected
from scripts.content_pipeline.roundhill_schedule import completed_business_days_since

def run_refresh(command: list[str]) -> subprocess.CompletedProcess:
    # Killing just refresh.py would leave its collector child writing the ledger
    # after the workflow releases the shared state lock.
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, start_new_session=True) as process:
        try:
            stdout, stderr = process.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()
            raise
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def build_observer(schedule, provider: str):
    GROUPS, POLICY, SEOUL = schedule.GROUPS, schedule.POLICY, schedule.SEOUL
    RECOVERY_CRON = schedule.RECOVERY_CRON
    scheduled_slot, select_primary = schedule.scheduled_slot, schedule.select_primary
    candidate_dates = schedule.candidate_dates

    def announcement_collected(database, declared, public_dir, ticker):
        return collected(database, declared, public_dir, ticker, provider=provider)

    def request_for(*, cron: str = "", created_at: datetime | None = None, group: str = "auto",
                    declared: date | None = None, cycle: date | None = None, now: datetime) -> dict:
        if cron:
            if created_at is None or created_at.tzinfo is None:
                raise ValueError("scheduled runs require the run creation timestamp with timezone")
            if group != "auto" or declared or cycle:
                raise ValueError("scheduled runs cannot override the scheduled group/date")
            slot = scheduled_slot(cron, created_at)
            primary = select_primary(cron, created_at)
            if cron != RECOVERY_CRON and primary is None:
                return {"enabled": False}
            return {"enabled": True, "mode": "recovery" if cron == RECOVERY_CRON else "primary",
                    "group": primary[0] if primary else "auto", "anchor": primary[1].isoformat() if primary else None,
                    "scheduledAt": slot.isoformat()}
        if (declared or cycle) and group == "auto":
            raise ValueError("manual dates require a specific group")
        if cycle and not declared:
            raise ValueError("cycle date requires an explicit actual declaration date")
        if any(day and day > now.astimezone(SEOUL).date() for day in (declared, cycle)):
            raise ValueError("manual declaration/cycle dates cannot be in the future")
        if cycle and cycle.weekday() != GROUPS[group]["weekday"]:
            raise ValueError("cycle date must be the group's nominal weekly date")
        return {"enabled": True, "mode": "manual" if declared else "recovery", "group": group,
                "anchor": (cycle or declared).isoformat() if declared else None,
                "declarationDate": declared.isoformat() if declared else None}


    def read_state(path: Path) -> dict:
        if not path.exists():
            return {"schemaVersion": 1, "provider": provider, "cycles": {}}
        state = json.loads(path.read_text(encoding="utf-8"))
        if state.get("schemaVersion") != 1 or not isinstance(state.get("cycles"), dict):
            raise ValueError("invalid durable observation state")
        if state.get("provider", provider) != provider:
            raise ValueError("observation state belongs to another provider")
        return state


    def write_state(path: Path, state: dict) -> None:
        state["provider"] = provider
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)


    def _add_cycle(state: dict, group: str, anchor: date) -> str:
        key = f"{group}:{anchor}"
        state["cycles"].setdefault(key, {"group": group, "anchorDate": anchor.isoformat(), "status": "pending"})
        return key


    def _dates(cycle: dict, today: date) -> list[date]:
        if cycle.get("declarationDates"):
            return [day for value in cycle["declarationDates"] if (day := date.fromisoformat(value)) <= today]
        return candidate_dates(date.fromisoformat(cycle["anchorDate"]), today)


    def _facts(database: ContentDatabase, cycle: dict, today: date, public_dir: Path) -> set[tuple[str, str]]:
        return {(ticker, day.isoformat()) for ticker in GROUPS[cycle["group"]]["tickers"]
                for day in _dates(cycle, today) if announcement_collected(database, day, public_dir, ticker)}


    def _matches(database: ContentDatabase, cycle: dict, today: date, public_dir: Path) -> dict:
        facts = _facts(database, cycle, today, public_dir)
        return {ticker: next(day.isoformat() for day in _dates(cycle, today) if (ticker, day.isoformat()) in facts)
                for ticker in GROUPS[cycle["group"]]["tickers"] if any(symbol == ticker for symbol, _ in facts)}


    def _cycle_matches(database: ContentDatabase, cycle: dict, today: date, public_dir: Path,
                       state: dict, facts: set[tuple[str, str]]) -> tuple[dict, dict]:
        anchor = date.fromisoformat(cycle["anchorDate"])
        previous = {"group": cycle["group"], "anchorDate": str(anchor - timedelta(days=7))}
        previous = state["cycles"].get(f"{cycle['group']}:{previous['anchorDate']}", previous)
        prior_matches = None
        # Explicit manual mappings own their actual date, including when that date
        # falls inside a neighbouring weekly window. Never complete both cycles.
        claimed = {actual for other in state["cycles"].values()
                   if other["group"] == cycle["group"] and other["anchorDate"] != cycle["anchorDate"]
                   for actual in other.get("declarationDates", [])}
        matched = {}
        ambiguous = {}
        for ticker in GROUPS[cycle["group"]]["tickers"]:
            for day in _dates(cycle, today):
                actual = day.isoformat()
                if (ticker, actual) not in facts or actual in claimed:
                    continue
                if day < anchor and not cycle.get("declarationDates"):
                    if prior_matches is None:
                        prior_matches = _matches(database, previous, today, public_dir)
                    if ticker not in prior_matches:
                        ambiguous[ticker] = {"actualDeclarationDate": actual, "unconfirmedPriorCycle": previous["anchorDate"]}
                        continue
                matched[ticker] = actual
                ambiguous.pop(ticker, None)
                break
        return matched, ambiguous


    def run_observations(request: dict, database: ContentDatabase, *, now: datetime, state_path: Path,
                         raw_dir: Path, public_dir: Path, legacy_data_dir: Path, refresh_runner=run_refresh) -> tuple[dict, int]:
        report = {"request": request, "status": "idle", "attempted": False, "publish": False,
                  "stateChanged": False, "cycles": [], "overdue": [], "ambiguous": []}
        if not request["enabled"]:
            return report, 0
        today = now.astimezone(SEOUL).date()
        stamp = now.astimezone(timezone.utc).isoformat()
        state = read_state(state_path)
        database.initialize()
        groups = list(GROUPS) if request["group"] == "auto" else [request["group"]]
        selected_key = None
        if request["anchor"]:
            selected_key = _add_cycle(state, request["group"], date.fromisoformat(request["anchor"]))
            if request["mode"] == "manual":
                state["cycles"][selected_key]["declarationDates"] = [request["declarationDate"]]
        else:
            for group in groups:
                # Bootstrap the most recent cycle and start checking upcoming cycles
                # before their nominal date. Persisted older pending cycles remain.
                weekday = GROUPS[group]["weekday"]
                anchor = today - timedelta(days=(today.weekday() - weekday) % 7)
                _add_cycle(state, group, anchor)
                upcoming = anchor + timedelta(days=7)
                if (upcoming - today).days <= POLICY["earlyDays"]:
                    _add_cycle(state, group, upcoming)

        pending = []
        published_before = {}
        for key, cycle in list(state["cycles"].items()):
            if cycle["group"] not in groups or selected_key and key != selected_key:
                continue
            facts = _facts(database, cycle, today, public_dir)
            published_before[key] = facts
            matched, ambiguous = _cycle_matches(database, cycle, today, public_dir, state, facts)
            cycle["matchedDeclarationDates"] = matched
            cycle["ambiguousTickers"] = ambiguous
            cycle["missingTickers"] = [ticker for ticker in GROUPS[cycle["group"]]["tickers"] if ticker not in matched]
            if not cycle["missingTickers"]:
                cycle["status"] = "collected"
                if (today - date.fromisoformat(cycle["anchorDate"])).days > 28:
                    del state["cycles"][key]
            else:
                cycle["status"] = "needs_review" if ambiguous else "pending"
                pending.append(cycle)
        pending.sort(key=lambda cycle: (cycle.get("lastCheckedAt", ""), cycle["anchorDate"], cycle["group"]))
        budget = 1 if selected_key else POLICY["maxCyclesPerRecovery"]
        failed = False
        batches_remaining = POLICY.get("maxBatchesPerRun", budget)
        for cycle in pending[:budget]:
            if batches_remaining <= 0:
                break
            initial = published_before[f"{cycle['group']}:{cycle['anchorDate']}"]
            dates = _dates(cycle, today)
            anchor = date.fromisoformat(cycle["anchorDate"])
            if request["mode"] == "primary" and today == anchor:
                dates = [anchor]
            if not dates:
                continue
            targets = list(cycle["missingTickers"])
            batch_size = POLICY.get("maxTickersPerBatch", len(targets))
            for offset in range(0, len(targets), batch_size):
                if batches_remaining <= 0:
                    break
                batch = targets[offset:offset + batch_size]
                batches_remaining -= 1
                command = [sys.executable, "scripts/content_pipeline/refresh.py", "--scope", "provider",
                           "--provider", provider, "--tickers", ",".join(batch),
                           "--declaration-dates", ",".join(day.isoformat() for day in dates),
                           "--db", str(database.path), "--raw-dir", str(raw_dir), "--public-dir", str(public_dir),
                           "--legacy-data-dir", str(legacy_data_dir)]
                report["attempted"] = True
                cycle["lastCheckedAt"] = stamp
                attempt = {"group": cycle["group"], "anchorDate": cycle["anchorDate"],
                           "queriedDates": [day.isoformat() for day in dates], "tickers": list(batch)}
                try:
                    result = refresh_runner(command)
                    try:
                        attempt["refresh"] = json.loads(result.stdout)
                    except json.JSONDecodeError:
                        attempt["error"] = "refresh did not return a JSON collection report"
                    if result.returncode or "error" in attempt:
                        failed = True
                        attempt["error"] = "collection failed; cycle retained for retry"
                except subprocess.TimeoutExpired:
                    failed = True
                    attempt["error"] = "collection timed out; cycle retained for retry"
                except OSError:
                    failed = True
                    attempt["error"] = "could not start collection; cycle retained for retry"
                facts = _facts(database, cycle, today, public_dir)
                matched, ambiguous = _cycle_matches(database, cycle, today, public_dir, state, facts)
                cycle["matchedDeclarationDates"] = matched
                cycle["ambiguousTickers"] = ambiguous
                cycle["missingTickers"] = [ticker for ticker in GROUPS[cycle["group"]]["tickers"] if ticker not in matched]
                cycle["status"] = "needs_review" if ambiguous else "pending" if cycle["missingTickers"] else "collected"
                report["publish"] |= bool(facts - initial)
                report["cycles"].append({**attempt, "status": cycle["status"], "missingTickers": cycle["missingTickers"],
                                         "matchedDeclarationDates": matched, "ambiguousTickers": ambiguous})
                if "error" in attempt:
                    break

        # An alert is not completion: overdue work stays queued, including across
        # weekends/US closures and across the following week's nominal schedule.
        for cycle in state["cycles"].values():
            if cycle["group"] not in groups or selected_key and f"{cycle['group']}:{cycle['anchorDate']}" != selected_key:
                continue
            if cycle.get("ambiguousTickers"):
                report["ambiguous"].append({"group": cycle["group"], "anchorDate": cycle["anchorDate"],
                                            "tickers": cycle["ambiguousTickers"]})
            if cycle.get("missingTickers") and completed_business_days_since(date.fromisoformat(cycle["anchorDate"]), now) >= POLICY["overdueBusinessDays"]:
                cycle["status"] = "overdue"
                report["overdue"].append({"group": cycle["group"], "anchorDate": cycle["anchorDate"], "missingTickers": cycle["missingTickers"]})
        write_state(state_path, state)
        report["stateChanged"] = True
        overdue_alert = bool(report["overdue"]) and request["mode"] != "primary"
        ambiguous_alert = bool(report["ambiguous"]) and request["mode"] != "primary"
        report["status"] = "failed" if failed else "needs_review" if ambiguous_alert else "overdue" if overdue_alert else "collected" if report["publish"] else "pending" if pending else "already_collected"
        return report, int(failed or overdue_alert or ambiguous_alert)


    return SimpleNamespace(
        provider=provider, groups=GROUPS,
        default_state=Path(f"var/content-studio/generated/{provider}-observations.json"),
        default_report=Path(f"var/content-studio/{provider}-observation.json"),
        request_for=request_for, run_observations=run_observations,
        read_state=read_state, write_state=write_state, _add_cycle=_add_cycle,
        _facts=_facts, _matches=_matches, _cycle_matches=_cycle_matches,
    )


def main(observer, execute) -> int:
    parser = argparse.ArgumentParser(description=f"Observe scheduled {observer.provider} announcements")
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--event-schedule", default="")
    parser.add_argument("--scheduled-at", type=datetime.fromisoformat)
    parser.add_argument("--group", choices=["auto", *observer.groups], default="auto")
    parser.add_argument("--declaration-date", type=date.fromisoformat)
    parser.add_argument("--cycle-date", type=date.fromisoformat)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--state", type=Path, default=observer.default_state)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--public-dir", type=Path, default=Path("public/content-studio"))
    parser.add_argument("--legacy-data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--report", type=Path, default=observer.default_report)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    try:
        request = observer.request_for(cron=args.event_schedule, created_at=args.scheduled_at, group=args.group,
                              declared=args.declaration_date, cycle=args.cycle_date, now=now)
    except ValueError as exc:
        parser.error(str(exc))
    if args.plan_only:
        report, code = {"enabled": request["enabled"], "request": request}, 0
    else:
        report, code = execute(request, ContentDatabase(args.db), now=now, state_path=args.state,
            raw_dir=args.raw_dir, public_dir=args.public_dir, legacy_data_dir=args.legacy_data_dir)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as handle:
            for key, value in report.items():
                if key in {"enabled", "attempted", "publish", "stateChanged", "status"}:
                    handle.write(f"{key}={str(value).lower()}\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return code
