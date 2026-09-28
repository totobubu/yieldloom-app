"""Read one official source per registered provider without writing application data."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.content_pipeline.providers import NoDataError, PROVIDERS


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("provider-probe.json"))
    parser.add_argument("--provider", action="append", choices=sorted(PROVIDERS))
    args = parser.parse_args()
    report = []
    def save() -> None:
        args.output.write_text(json.dumps({"providers": report}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for slug in args.provider or sorted(PROVIDERS):
        adapter = PROVIDERS[slug]()
        candidate = next(iter(adapter.discover()), None)
        if candidate is None:
            report.append({"provider": slug, "status": "unsupported", "events": 0})
            save()
            continue
        try:
            document = adapter.fetch(candidate)
            events = adapter.parse(document)
            report.append({"provider": slug, "status": "success", "events": len(events), "url": candidate.url, "sha256": document.content_sha256})
        except NoDataError as error:
            report.append({"provider": slug, "status": "no_change", "events": 0, "url": candidate.url, "detail": str(error)})
        except Exception as error:
            report.append({"provider": slug, "status": "failed", "events": 0, "url": candidate.url, "detail": str(error)})
        save()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
