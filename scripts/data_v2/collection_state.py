"""Versioned R2 state for incremental official-source collection."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from botocore.exceptions import ClientError

from scripts.cloud.r2_helper import get_r2_client


PREFIX = "yieldloom/v2/collection-state"
SCHEMA_VERSION = 1


def empty_state() -> dict[str, Any]:
    return {"schemaVersion": SCHEMA_VERSION, "generatedAt": None, "sources": {}}


def load_local(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return empty_state()
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schemaVersion") != SCHEMA_VERSION or not isinstance(value.get("sources"), dict):
        raise ValueError(f"Unsupported collection state: {path}")
    return value


def load_r2() -> dict[str, Any]:
    client, bucket = get_r2_client()
    if not client or not bucket:
        raise RuntimeError("R2 credentials are required for incremental collection state")
    try:
        pointer = json.loads(client.get_object(Bucket=bucket, Key=f"{PREFIX}/current.json")["Body"].read())
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
            return empty_state()
        raise
    state_key = pointer.get("stateKey")
    if not isinstance(state_key, str) or not state_key.startswith(f"{PREFIX}/snapshots/"):
        raise ValueError("Invalid collection state pointer")
    state = json.loads(client.get_object(Bucket=bucket, Key=state_key)["Body"].read())
    if state.get("schemaVersion") != SCHEMA_VERSION or not isinstance(state.get("sources"), dict):
        raise ValueError("Unsupported collection state in R2")
    return state


def save_r2(state: dict[str, Any], run_id: str) -> None:
    client, bucket = get_r2_client()
    if not client or not bucket:
        raise RuntimeError("R2 credentials are required for incremental collection state")
    state = dict(state)
    state["generatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    state_key = f"{PREFIX}/snapshots/{run_id}/state.json"
    body = json.dumps(state, ensure_ascii=False, indent=2).encode("utf-8")
    client.put_object(Bucket=bucket, Key=state_key, Body=body, ContentType="application/json", CacheControl="public, max-age=31536000, immutable")
    pointer = {"schemaVersion": SCHEMA_VERSION, "runId": run_id, "stateKey": state_key}
    client.put_object(Bucket=bucket, Key=f"{PREFIX}/current.json", Body=json.dumps(pointer, indent=2).encode("utf-8"), ContentType="application/json", CacheControl="no-cache")

