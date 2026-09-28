"""Report field-level differences between the immutable legacy baseline and a fresh candidate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def key(row: dict[str, object]) -> tuple[str, str, str, str]:
    return tuple(str(row[field]) for field in ("provider", "ticker", "declaredDate", "exDate"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, default=Path("data-v2/review/legacy-roundhill-neos.json"))
    parser.add_argument("--candidate", type=Path, default=Path("data-v2/candidates/pilot-events.json"))
    parser.add_argument("--output", type=Path, default=Path("data-v2/review/candidate-diff.json"))
    args = parser.parse_args()
    baseline = {key(row): row for row in json.loads(args.baseline.read_text(encoding="utf-8"))["events"]}
    candidate = {key(row): row for row in json.loads(args.candidate.read_text(encoding="utf-8"))}
    changed = []
    for identity in sorted(set(baseline) & set(candidate)):
        before, after = baseline[identity], candidate[identity]
        fields = [field for field in ("amount", "recordDate", "payableDate", "frequency") if before.get(field) != after.get(field)]
        if fields:
            changed.append({"event": identity, "fields": fields, "before": before, "after": after})
    result = {"new": [candidate[item] for item in sorted(set(candidate) - set(baseline))], "missing": [baseline[item] for item in sorted(set(baseline) - set(candidate))], "changed": changed}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"new={len(result['new'])} missing={len(result['missing'])} changed={len(changed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
