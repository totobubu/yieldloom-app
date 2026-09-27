from __future__ import annotations

import argparse
import json
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage the Divgrow content database")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("init-db", help="Create or migrate the SQLite database")
    subparsers.add_parser("summary", help="Print record counts as JSON")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    database = ContentDatabase(args.db)
    database.initialize()

    if args.command == "init-db":
        print(f"Initialized content database: {args.db}")
        return 0
    if args.command == "summary":
        print(json.dumps(database.summary(), ensure_ascii=False, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
