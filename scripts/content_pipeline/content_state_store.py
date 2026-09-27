from __future__ import annotations

import argparse
import os
import tarfile
import tempfile
from pathlib import Path

import boto3
from botocore.exceptions import ClientError


STATE_PATHS = (
    Path("var/content-studio/distribution-events.sqlite"),
    Path("var/content-studio/raw"),
    Path("var/content-studio/generated"),
)
DEFAULT_KEY = "content-studio/state/latest.tar.gz"


def _client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def restore(root: Path, key: str) -> bool:
    bucket = os.environ["R2_BUCKET_NAME"]
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as handle:
        archive = Path(handle.name)
    try:
        try:
            _client().download_file(bucket, key, str(archive))
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
                return False
            raise
        with tarfile.open(archive, "r:gz") as tar:
            destination = root.resolve()
            for member in tar.getmembers():
                resolved = (destination / member.name).resolve()
                if destination not in resolved.parents and resolved != destination:
                    raise ValueError("unsafe path in Content Studio state archive")
            tar.extractall(destination)
        return True
    finally:
        archive.unlink(missing_ok=True)


def save(root: Path, key: str) -> None:
    bucket = os.environ["R2_BUCKET_NAME"]
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as handle:
        archive = Path(handle.name)
    try:
        with tarfile.open(archive, "w:gz") as tar:
            for relative in STATE_PATHS:
                source = root / relative
                if source.exists():
                    tar.add(source, arcname=relative.as_posix(), recursive=True)
        _client().upload_file(str(archive), bucket, key)
    finally:
        archive.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Persist Content Studio state in R2")
    parser.add_argument("command", choices=("restore", "save"))
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--key", default=DEFAULT_KEY)
    args = parser.parse_args()
    if args.command == "restore":
        print("restored" if restore(args.root, args.key) else "state-not-found")
    else:
        save(args.root, args.key)
        print("saved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
