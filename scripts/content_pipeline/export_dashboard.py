from __future__ import annotations

import argparse
import json
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH


def export_dashboard(db: Path, output: Path, limit: int = 60) -> None:
    database = ContentDatabase(db)
    database.initialize()
    snapshot = database.dashboard_snapshot(limit=limit)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export the content studio dashboard snapshot")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/content-studio/dashboard.json"),
    )
    parser.add_argument("--limit", type=int, default=60)
    args = parser.parse_args()

    export_dashboard(args.db, args.output, args.limit)
    print(f"Exported dashboard snapshot: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
