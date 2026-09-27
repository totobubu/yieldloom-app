from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import DEFAULT_DB_PATH
from scripts.content_pipeline.models import utc_now_iso


SECRET_PATTERN = re.compile(
    r"(?i)(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+"
)


def _safe_message(value: str | None, limit: int = 500) -> str:
    if not value:
        return ""
    return SECRET_PATTERN.sub(r"\1=[redacted]", value.replace("\r", " ").replace("\n", " "))[:limit]


def _outcome(status: str, report: dict) -> str:
    if status == "failed":
        return "failed"
    if status == "warning":
        return "partial"
    return str(report.get("outcome") or "success")


def export_system_logs(db: Path, output: Path, limit: int = 50) -> dict:
    connection = sqlite3.connect(db)
    connection.row_factory = sqlite3.Row
    try:
        runs = connection.execute(
            """SELECT id, started_at, finished_at, status, report_json
               FROM pipeline_runs ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        items = []
        for run in runs:
            try:
                report = json.loads(run["report_json"] or "{}")
            except json.JSONDecodeError:
                report = {}
            steps = connection.execute(
                """SELECT step_name, provider_slug, status, retryable, message,
                          details_json, started_at, finished_at
                   FROM pipeline_run_steps WHERE run_id = ? ORDER BY id""",
                (run["id"],),
            ).fetchall()
            items.append(
                {
                    "runId": run["id"],
                    "requestId": report.get("requestId"),
                    "scope": report.get("scope", "all"),
                    "provider": report.get("provider"),
                    "ticker": report.get("ticker"),
                    "startedAt": run["started_at"],
                    "finishedAt": run["finished_at"],
                    "status": _outcome(run["status"], report),
                    "addedEvents": report.get("addedEvents", 0),
                    "addedSources": report.get("addedSources", 0),
                    "steps": [
                        {
                            "name": step["step_name"],
                            "provider": step["provider_slug"],
                            "status": step["status"],
                            "retryable": bool(step["retryable"]),
                            "message": _safe_message(step["message"]),
                            "startedAt": step["started_at"],
                            "finishedAt": step["finished_at"],
                        }
                        for step in steps
                    ],
                }
            )
    finally:
        connection.close()
    payload = {"generatedAt": utc_now_iso(), "runs": items}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Export sanitized Content Studio system logs")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--output", type=Path, default=Path("public/content-studio/system-logs.json"))
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    export_system_logs(args.db, args.output, args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
