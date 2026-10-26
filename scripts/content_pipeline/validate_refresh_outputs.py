"""Fail closed when generated Content Studio snapshots are incomplete or invalid."""
from __future__ import annotations

import json
import sys
from pathlib import Path


if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

REQUIRED_SNAPSHOTS = (
    "content.json",
    "dashboard.json",
    "distribution-index.json",
    "price-index.json",
    "price-quality.json",
    "reconciliation.json",
    "sources.json",
)
PUBLISHABLE_STATUSES = {"official", "cross_checked"}


def validate(root: Path = Path("public/content-studio")) -> dict[str, int]:
    payloads: dict[str, dict] = {}
    for name in REQUIRED_SNAPSHOTS:
        path = root / name
        if not path.is_file():
            raise ValueError(f"required Content Studio snapshot is missing: {path}")
        text = path.read_text(encoding="utf-8")
        if "NaN" in text or "Infinity" in text:
            raise ValueError(f"non-JSON numeric value detected: {path}")
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise ValueError(f"snapshot root must be an object: {path}")
        payloads[name] = payload

    bundles = payloads["content.json"].get("bundles", [])
    for item in bundles:
        status = item.get("manifest", {}).get("verificationStatus")
        if status not in PUBLISHABLE_STATUSES:
            raise ValueError(f"non-publishable bundle escaped approval gate: {status}")

    dashboard = payloads["dashboard.json"]
    distribution_index = payloads["distribution-index.json"]
    price_index = payloads["price-index.json"]
    price_quality = payloads["price-quality.json"]
    reconciliation = payloads["reconciliation.json"]
    if not isinstance(dashboard.get("providers"), list):
        raise ValueError("dashboard providers must be an array")
    if not isinstance(distribution_index.get("tickers"), list):
        raise ValueError("distribution index tickers must be an array")
    if price_index.get("source") != "yahoo_eod" or not isinstance(price_index.get("prices"), dict):
        raise ValueError("price snapshot must contain Yahoo EOD prices")
    if price_quality.get("source") != "yahoo_eod" or not isinstance(price_quality.get("findings"), list):
        raise ValueError("price quality snapshot must contain findings")
    if reconciliation.get("writeMode") != "approval-gated":
        raise ValueError("reconciliation snapshot lost its approval gate")
    stock_index = root / "stock-evidence-index.json"
    if stock_index.exists():
        from scripts.content_pipeline.stock_collection import validate_stock_export
        validate_stock_export(root)
    return {
        "providers": len(dashboard["providers"]),
        "tickers": len(distribution_index["tickers"]),
        "reviews": len(reconciliation.get("reviews", [])),
        "pricedTickers": len(price_index["prices"]),
    }


def main() -> int:
    print(json.dumps(validate(), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
