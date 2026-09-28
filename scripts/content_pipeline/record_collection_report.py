from __future__ import annotations

from pathlib import Path
from typing import Any

from .database import ContentDatabase


def record_collection_report(db_path: Path, provider: str, payload: dict[str, Any]) -> None:
    """Persist operator-facing outcomes emitted by the isolated collector process."""
    database = ContentDatabase(db_path)
    for source in payload.get("sources", []):
        database.add_collection_attempt(
            provider, str(source.get("url", "")), str(source.get("fetchMode", "http")),
            "success", content_sha256=source.get("sha256"),
            event_count=int(source.get("events", 0)),
        )
    for item in payload.get("noData", []):
        database.add_collection_attempt(
            provider, str(item.get("url", "")), str(item.get("fetchMode", "http")),
            "no_data", message=str(item.get("message", "")),
        )
    for item in payload.get("errors", []):
        database.add_collection_attempt(
            provider, str(item.get("url", "")), str(item.get("fetchMode", "http")),
            str(item.get("code", "parse_failed")),
            retryable=bool(item.get("retryable", False)),
            message=str(item.get("error", "")),
        )
