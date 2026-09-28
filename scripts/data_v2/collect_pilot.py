"""Fetch current official Roundhill and NEOS events into a PR-reviewable candidate file."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.content_pipeline.providers import NoDataError, PROVIDERS


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data-v2/candidates/pilot-events.json"))
    parser.add_argument("--provider", action="append", choices=("roundhill", "neos"))
    args = parser.parse_args()
    providers = args.provider or ["roundhill", "neos"]
    rows: list[dict[str, object]] = []
    errors: list[str] = []
    provider_event_counts = {slug: 0 for slug in providers}
    for slug in providers:
        adapter = PROVIDERS[slug]()
        for candidate in adapter.discover():
            try:
                document = adapter.fetch(candidate)
                document = replace(document, published_at=candidate.published_at, metadata=candidate.metadata)
                for event in adapter.parse(document):
                    if event.verification_status not in {"official", "cross_checked"}:
                        continue
                    rows.append({
                        "provider": event.provider_slug,
                        "ticker": event.ticker,
                        "amount": event.distribution_per_share,
                        "currency": event.currency,
                        "declaredDate": event.declared_date,
                        "exDate": event.ex_date,
                        "recordDate": event.record_date,
                        "payableDate": event.payable_date,
                        "frequency": event.frequency,
                        "officialUrl": event.official_url,
                        "sourceSha256": document.content_sha256,
                        "verificationStatus": event.verification_status,
                        "collectionMethod": "official_fetch",
                    })
                    provider_event_counts[slug] += 1
            except NoDataError:
                # No new announcement is a safe no-change outcome, not a parsing error.
                continue
            except Exception as error:  # report every source; partial data is not silently released
                errors.append(f"{slug}: {candidate.url}: {error}")
    if errors:
        raise RuntimeError("Official collection was incomplete:\n" + "\n".join(errors))
    missing = [slug for slug, count in provider_event_counts.items() if count == 0]
    if missing:
        raise RuntimeError(
            "No current official events for " + ", ".join(missing)
            + "; no candidate file was written. Retry after the next declaration."
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Collected {len(rows)} official events into {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
