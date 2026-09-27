from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Append a sanitized public workflow log")
    parser.add_argument("--path", type=Path, default=Path("public/content-studio/system-logs.json"))
    parser.add_argument("--request-id")
    parser.add_argument("--scope", required=True)
    parser.add_argument("--provider")
    parser.add_argument("--ticker")
    parser.add_argument("--event-id", type=int)
    parser.add_argument("--status", choices=("success", "no_change", "partial", "failed"), required=True)
    parser.add_argument("--message", default="")
    args = parser.parse_args()
    try:
        payload = json.loads(args.path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        payload = {"runs": []}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    item = {
        "runId": None,
        "requestId": args.request_id,
        "scope": args.scope,
        "provider": args.provider,
        "ticker": args.ticker,
        "eventId": args.event_id,
        "startedAt": now,
        "finishedAt": now,
        "status": args.status,
        "addedEvents": 0,
        "addedSources": 0,
        "steps": [{
            "name": "render-png" if args.scope == "render" else "workflow",
            "provider": args.provider,
            "status": "failed" if args.status == "failed" else "success",
            "retryable": args.status == "failed",
            "message": args.message.replace("\r", " ").replace("\n", " ")[:500],
            "startedAt": now,
            "finishedAt": now,
        }],
    }
    payload["generatedAt"] = now
    payload["runs"] = [item, *(payload.get("runs") or [])][:50]
    args.path.parent.mkdir(parents=True, exist_ok=True)
    args.path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
