"""Publish an already-validated immutable release, then atomically move its pointer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.cloud.r2_helper import get_r2_client
PREFIX = "yieldloom/v2"


def put(client, bucket: str, key: str, body: bytes, cache: str) -> None:
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json", CacheControl=cache)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data-v2")
    args = parser.parse_args()
    data_dir = args.data_dir.resolve()
    manifest_path = data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("releaseId") != args.release_id:
        raise ValueError("release-id does not match data-v2/manifest.json")
    client, bucket = get_r2_client()
    if not client or not bucket:
        raise RuntimeError("R2 credentials are required")
    release_prefix = f"{PREFIX}/snapshots/{args.release_id}"
    for entry in manifest["files"]:
        relative = Path(entry["path"])
        body = (data_dir / relative).read_bytes()
        put(client, bucket, f"{release_prefix}/{relative.as_posix()}", body, "public, max-age=31536000, immutable")
    put(client, bucket, f"{release_prefix}/manifest.json", manifest_path.read_bytes(), "public, max-age=31536000, immutable")
    pointer = {"schemaVersion": 1, "releaseId": args.release_id, "manifestKey": f"{release_prefix}/manifest.json"}
    put(client, bucket, f"{PREFIX}/releases/current.json", json.dumps(pointer, indent=2).encode(), "public, max-age=60")
    print(f"Published {args.release_id} to {release_prefix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
