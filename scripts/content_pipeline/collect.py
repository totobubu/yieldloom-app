from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.providers import NoDataError, PROVIDERS, SourceCandidate


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect official ETF distributions")
    parser.add_argument("--provider", choices=sorted(PROVIDERS), required=True)
    parser.add_argument("--url", help="Parse one explicit allowed official URL")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-sources", type=int,
                        help="candidate cap; provider default is used when omitted")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    adapter = PROVIDERS[args.provider]()
    database = None
    if not args.dry_run:
        database = ContentDatabase(args.db)
        database.initialize()
        database.upsert_provider(
            adapter.slug,
            adapter.display_name,
            adapter.official_homepage,
            adapter.parser_version,
        )

    candidates = (
        [SourceCandidate(url=args.url, source_type="explicit_official_url")]
        if args.url
        else list(adapter.discover())
    )
    report = {
        "provider": adapter.slug,
        "sources": [],
        "events": 0,
        "noData": [],
        "errors": [],
    }

    max_sources = args.max_sources or getattr(adapter, "default_max_sources", 3)
    for candidate in candidates[:max_sources]:
        try:
            document = adapter.fetch(candidate)
            raw_path = args.raw_dir / adapter.slug / f"{document.content_sha256}.html"
            if not args.dry_run:
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_bytes(document.content)
                document = replace(document, local_path=str(raw_path))
                source_id = database.add_source_document(document)
            else:
                source_id = None

            events = adapter.parse(document)
            if not args.dry_run:
                for event in events:
                    database.upsert_distribution_event(event, source_id)
            report["sources"].append(
                {
                    "url": candidate.url,
                    "sha256": document.content_sha256,
                    "events": len(events),
                }
            )
            report["events"] += len(events)
        except NoDataError as exc:
            report["noData"].append({"url": candidate.url, "message": str(exc)})
        except Exception as exc:
            report["errors"].append({"url": candidate.url, "error": str(exc)})

    if report["errors"] and report["sources"]:
        report["status"] = "partial"
    elif report["errors"]:
        report["status"] = "failed"
    elif report["sources"]:
        report["status"] = "success"
    else:
        report["status"] = "no_change"
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
