"""Assess whether Content Studio is ready to leave its feature branch."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.providers import PROVIDERS


PUBLISHABLE_STATUSES = {"official", "cross_checked"}


def _read(path: Path) -> dict:
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}


def assess(
    public_root: Path = Path("public/content-studio"),
    workflow_path: Path = Path(".github/workflows/content-studio-refresh.yml"),
    *,
    expected_providers: set[str] | None = None,
) -> dict:
    expected = expected_providers or set(PROVIDERS)
    dashboard = _read(public_root / "dashboard.json")
    distributions = _read(public_root / "distribution-index.json")
    reconciliation = _read(public_root / "reconciliation.json")
    content = _read(public_root / "content.json")
    canary = _read(public_root / "canary-evidence.json")
    workflow = workflow_path.read_text(encoding="utf-8") if workflow_path.is_file() else ""

    providers = {row.get("slug"): row for row in dashboard.get("providers", [])}
    bundles = content.get("bundles", [])
    manifests = [item.get("manifest", {}) for item in bundles if isinstance(item, dict)]
    fallback = distributions.get("fallbackObservations", [])
    checks = {
        "provider_registry_complete": expected.issubset(providers),
        "expanded_provider_evidence": (
            int(providers.get("ishares", {}).get("catalog_ticker_count") or 0) > 0
            and int(providers.get("statestreet", {}).get("event_count") or 0) > 0
        ),
        "canary_passed": (
            canary.get("status") == "success"
            and canary.get("provider") == "statestreet"
            and bool(canary.get("workflowRunId"))
            and bool(canary.get("commitSha"))
        ),
        "approval_gate_present": reconciliation.get("writeMode") == "approval-gated",
        "legacy_audit_present": (
            isinstance(reconciliation.get("legacyAudit", {}).get("tickers"), list)
            and isinstance(reconciliation.get("legacyAudit", {}).get("summary"), dict)
        ),
        "publishable_bundles_only": all(
            manifest.get("verificationStatus") in PUBLISHABLE_STATUSES
            and bool(manifest.get("sourceClass"))
            and bool(manifest.get("sourceProvider"))
            and isinstance(manifest.get("precisionDigits"), int)
            for manifest in manifests
        ),
        "fallback_stays_noncanonical": all(
            row.get("verification_status") in {
                "third_party_only", "market_confirmed", "cross_checked",
                "conflicting", "needs_review", "rejected",
            }
            for row in fallback
        ),
        "branch_safe_workflow": (
            "git push origin HEAD:main" not in workflow
            and 'git push origin "HEAD:${GITHUB_REF_NAME}"' in workflow
            and "content-studio/state/branches/${safe_ref}.tar.gz" in workflow
            and "record_canary_evidence.py" in workflow
        ),
    }
    blockers = [name for name, passed in checks.items() if not passed]
    return {
        "ready": not blockers,
        "checks": checks,
        "blockers": blockers,
        "expectedProviderCount": len(expected),
        "observedProviderCount": len(providers),
        "bundleCount": len(manifests),
        "fallbackObservationCount": len(fallback),
        "canary": canary or None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Assess Content Studio release readiness")
    parser.add_argument("--public-root", type=Path, default=Path("public/content-studio"))
    parser.add_argument("--workflow", type=Path, default=Path(".github/workflows/content-studio-refresh.yml"))
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()
    report = assess(args.public_root, args.workflow)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["ready"] or args.report_only else 1


if __name__ == "__main__":
    raise SystemExit(main())
