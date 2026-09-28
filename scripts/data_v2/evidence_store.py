"""Private R2 evidence storage. It never falls back to the public data bucket."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


PREFIX = "yieldloom-evidence/screenshots"


def get_evidence_client():
    required = ("EVIDENCE_R2_ACCOUNT_ID", "EVIDENCE_R2_ACCESS_KEY_ID", "EVIDENCE_R2_SECRET_ACCESS_KEY", "EVIDENCE_R2_BUCKET_NAME")
    values = {key: os.getenv(key) for key in required}
    if not all(values.values()):
        raise RuntimeError("Private evidence R2 credentials are required")
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{values['EVIDENCE_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=values["EVIDENCE_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=values["EVIDENCE_R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    return client, values["EVIDENCE_R2_BUCKET_NAME"]


def key(evidence_id: str, name: str) -> str:
    return f"{PREFIX}/{evidence_id}/{name}"


def exists(client: Any, bucket: str, object_key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=object_key)
        return True
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def put_immutable(client: Any, bucket: str, object_key: str, body: bytes, content_type: str) -> None:
    if exists(client, bucket, object_key):
        return
    client.put_object(Bucket=bucket, Key=object_key, Body=body, ContentType=content_type, CacheControl="no-store")


def put_json_immutable(client: Any, bucket: str, object_key: str, value: dict[str, Any]) -> None:
    put_immutable(client, bucket, object_key, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8"), "application/json")


def get_json(client: Any, bucket: str, object_key: str) -> dict[str, Any]:
    return json.loads(client.get_object(Bucket=bucket, Key=object_key)["Body"].read())


def get_bytes(client: Any, bucket: str, object_key: str) -> bytes:
    return client.get_object(Bucket=bucket, Key=object_key)["Body"].read()
