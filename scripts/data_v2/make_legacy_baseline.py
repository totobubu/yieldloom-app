"""Convert legacy Content Studio records into a comparison-only baseline.

The output intentionally cannot be passed to build_release.py: it records prior
evidence for review, but a new release must come from a fresh official fetch.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public" / "content-studio"
OUTPUT = ROOT / "data-v2" / "review" / "legacy-roundhill-neos.json"
ROUNDHILL = {
    "AAPW", "AMDW", "AMZW", "ARMW", "AVGW", "BABW", "BRKW", "COIW", "COSW", "GDXW", "GLDW", "GOOW",
    "HOOW", "METW", "MSFW", "MSTW", "NFLW", "NVDW", "PLTW", "TOPW", "TSLW", "TSYW", "UBEW", "UNHW",
}
NEOS = {"SPYI", "QQQI", "IWMI"}


def source_hash(row: dict[str, object]) -> str:
    evidence = f"{row.get('official_url')}|{row.get('declared_date')}|{row.get('distribution_per_share')}"
    return hashlib.sha256(evidence.encode()).hexdigest()


def main() -> int:
    events: list[dict[str, object]] = []
    for path in sorted(SOURCE.glob("distribution-ticker-*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        ticker = str(payload.get("ticker") or "").upper()
        if ticker not in ROUNDHILL | NEOS:
            continue
        for row in payload.get("history", []):
            status = row.get("verification_status")
            if status not in {"official", "cross_checked"}:
                continue
            events.append({
                "provider": row["provider_slug"], "ticker": ticker,
                "amount": row["distribution_per_share"], "currency": row.get("currency") or "USD",
                "declaredDate": row["declared_date"], "exDate": row["ex_date"],
                "recordDate": row.get("record_date"), "payableDate": row.get("payable_date"),
                "frequency": row.get("frequency"), "officialUrl": row["official_url"],
                "sourceSha256": source_hash(row), "verificationStatus": status,
                "collectionMethod": "legacy_baseline",
            })
    events.sort(key=lambda item: (str(item["provider"]), str(item["ticker"]), str(item["exDate"])))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"purpose": "comparison_only", "events": events}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(events)} comparison-only events to {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
