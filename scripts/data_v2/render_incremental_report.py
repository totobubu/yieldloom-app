"""Render the machine-readable incremental report as concise PR-review Markdown."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data-v2/review/incremental-report.json"))
    parser.add_argument("--output", type=Path, default=Path("data-v2/review/incremental-report.md"))
    args = parser.parse_args()
    report = json.loads(args.input.read_text(encoding="utf-8"))
    summary = report["summary"]
    lines = ["# Incremental collection review", "", f"Run: `{report['runId']}`", "", "| Selected sources | Skipped sources | New | Changed | Deletion suspected | Unchanged sources | Failed sources |", "| ---: | ---: | ---: | ---: | ---: | ---: |", f"| {summary.get('selectedSources', 0)} | {summary.get('skippedSources', 0)} | {summary['new']} | {summary['changed']} | {summary['suspectedRemoved']} | {summary['unchangedSources']} | {summary['failedSources']} |", ""]
    if report.get("publicationBlocked"):
        lines += ["**Publication blocked: conflicting event values. No candidate or durable state was saved.**", ""]
    elif "candidateEvents" in summary:
        lines += [f"Candidate event identities after source deduplication: {summary['candidateEvents']}", ""]
    for conflict in report.get("conflicts", []):
        identity = conflict["identity"]
        lines += [f"## Conflict: {identity['ticker']} {identity['declaredDate']} / {identity['exDate']}",
                  "", "Different fields: " + ", ".join(conflict["differentFields"]), ""]
        for item in conflict["observations"]:
            row = item["event"]
            lines += [f"- Source `{item['sourceKey']}`: {row['officialUrl']} (SHA-256 `{row['sourceSha256']}`)",
                      "  - " + "; ".join(f"{field}: {json.dumps(row.get(field), ensure_ascii=False)}" for field in conflict["differentFields"])]
        lines.append("")
    if report.get("equivalentEvents"):
        lines += [f"{len(report['equivalentEvents'])} duplicate event identities have equal economic/verification values; all source evidence was retained.", ""]
    for provider, details in report["providers"].items():
        lines += [f"## {provider} — {details['status']}", ""]
        if details["errors"]:
            lines += ["Failures:", *[f"- {item}" for item in details["errors"]], ""]
        if details.get("warnings"):
            lines += ["Warnings:", *[f"- {item}" for item in details["warnings"]], ""]
        if details.get("needsReview"):
            lines += [f"{len(details['needsReview'])} distribution rows require review and were excluded from the publishable candidate.", ""]
        if details["changed"]:
            lines += ["Corrections requiring review:", *[f"- `{item['after']['ticker']}` {item['after']['declaredDate']} / {item['after']['exDate']}: `{item['before']['amount']}` → `{item['after']['amount']}`" for item in details["changed"]], ""]
        if details["suspectedRemoved"]:
            lines += ["Rows retained pending deletion review:", *[f"- `{item['ticker']}` {item['declaredDate']} / {item['exDate']}" for item in details["suspectedRemoved"]], ""]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
