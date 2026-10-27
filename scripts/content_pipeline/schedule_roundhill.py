"""Observe Roundhill announcements through the shared durable scheduler."""
from __future__ import annotations

import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline import roundhill_schedule as schedule
from scripts.content_pipeline import scheduled_observation as shared
# Preserve the existing Roundhill entry point and patchable process boundaries.
from scripts.content_pipeline.scheduled_observation import os, signal, subprocess, run_refresh

_observer = shared.build_observer(schedule, "roundhill")
DEFAULT_STATE = _observer.default_state
request_for = _observer.request_for
read_state, write_state = _observer.read_state, _observer.write_state
_add_cycle = _observer._add_cycle
_facts, _matches, _cycle_matches = _observer._facts, _observer._matches, _observer._cycle_matches


def run_observations(request, database, **kwargs):
    return _observer.run_observations(request, database, refresh_runner=run_refresh, **kwargs)


def main() -> int:
    return shared.main(_observer, run_observations)


if __name__ == "__main__":
    raise SystemExit(main())
