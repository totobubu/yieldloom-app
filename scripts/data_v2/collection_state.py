"""Versioned R2 state for incremental official-source collection."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from botocore.exceptions import ClientError

from scripts.cloud.r2_helper import get_r2_client


PREFIX = "yieldloom/v2/collection-state"
SCHEMA_VERSION = 2


def empty_state() -> dict[str, Any]:
    return {"schemaVersion": SCHEMA_VERSION, "generatedAt": None, "sources": {}, "catalogs": {}}


def upgrade_state(value: dict[str, Any]) -> dict[str, Any]:
    """Keep v1 collection evidence usable while adding source scheduling state."""
    if not isinstance(value.get("sources"), dict):
        raise ValueError("Collection state sources must be an object")
    version = value.get("schemaVersion")
    if version == SCHEMA_VERSION:
        value.setdefault("catalogs", {})
        return value
    if version != 1:
        raise ValueError("Unsupported collection state")
    sources = {}
    for key, source in value["sources"].items():
        source = dict(source)
        source.setdefault("sourceKey", key)
        source.setdefault("ticker", "*")
        source.setdefault("candidate", {"url": source.get("url"), "metadata": {}})
        source.setdefault("schedule", {"mode": "observation", "confidence": "unconfirmed"})
        sources[key] = source
    return {"schemaVersion": SCHEMA_VERSION, "generatedAt": value.get("generatedAt"), "sources": sources, "catalogs": {}}


def load_local(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return empty_state()
    try:
        return upgrade_state(json.loads(path.read_text(encoding="utf-8")))
    except ValueError as error:
        raise ValueError(f"Unsupported collection state: {path}") from error


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
    return upgrade_state(state)


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
