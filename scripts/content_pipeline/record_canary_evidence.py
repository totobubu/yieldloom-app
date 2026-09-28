"""Write machine-readable evidence only after a successful collection canary."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.models import utc_now_iso


def write_evidence(output: Path, *, provider: str, ref: str, run_id: str, sha: str) -> dict:
    if not provider or not ref or not run_id or not sha:
        raise ValueError("provider, ref, run id, and sha are required")
    payload = {
        "status": "success",
        "provider": provider,
        "ref": ref,
        "workflowRunId": run_id,
        "commitSha": sha,
        "recordedAt": utc_now_iso(),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Record Content Studio canary evidence")
    parser.add_argument("--output", type=Path, default=Path("public/content-studio/canary-evidence.json"))
    parser.add_argument("--provider", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    print(json.dumps(write_evidence(
        args.output, provider=args.provider, ref=args.ref,
        run_id=args.run_id, sha=args.sha,
    ), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
