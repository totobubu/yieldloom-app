from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.models import utc_now_iso


def collect_records(bundle_root: Path) -> list[dict]:
    records = []
    for manifest_path in sorted(bundle_root.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        records.append(
            {
                "eventKey": f'{manifest["provider"]}:{manifest["ticker"]}:{manifest["eventId"]}',
                "title": manifest.get("title") or f'{manifest["ticker"]} 배당 발표',
                "provider": manifest["provider"],
                "ticker": manifest["ticker"],
                "status": "Draft",
                "plannedPublishDate": manifest.get("declaredDate"),
                "exDate": manifest.get("exDate"),
                "channels": ["Toss", "Naver Blog"],
                "verificationStatus": manifest["verificationStatus"],
                "officialUrl": manifest["officialUrl"],
                "bundlePath": str(manifest_path.parent.resolve()),
                "generatedAt": manifest["generatedAt"],
            }
        )
    return records


def export_calendar(bundle_root: Path, json_path: Path, csv_path: Path) -> list[dict]:
    records = collect_records(bundle_root)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schemaVersion": 1, "generatedAt": utc_now_iso(), "records": records}
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        fieldnames = [
            "eventKey",
            "title",
            "provider",
            "ticker",
            "status",
            "plannedPublishDate",
            "exDate",
            "channels",
            "verificationStatus",
            "officialUrl",
            "bundlePath",
            "generatedAt",
        ]
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({**record, "channels": ", ".join(record["channels"])})
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the local content calendar")
    parser.add_argument("--bundles", type=Path, default=Path("var/content-studio/generated"))
    parser.add_argument(
        "--json", type=Path, default=Path("var/content-studio/content-calendar.json")
    )
    parser.add_argument(
        "--csv", type=Path, default=Path("var/content-studio/content-calendar.csv")
    )
    args = parser.parse_args()
    records = export_calendar(args.bundles, args.json, args.csv)
    print(f"Exported {len(records)} content calendar records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
