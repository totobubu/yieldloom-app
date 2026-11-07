"""Prepare an isolated synthetic storage probe; no network unless --apply.

Use only an already approved credential source in its existing environment. This
does not configure auth, copy secrets, touch /Dividend, or test issuer access.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import re

from .storage import Conflict, DropboxStore, Missing, RemoteError, SHADOW, UncertainWrite, encode
from .preflight import PreflightFailure, preflight


class ProbeFailure(RuntimeError):
    """Contains only a fixed safe stage, never an exception/response body."""
    def __init__(self, stage, category=None, http_status=None):
        self.stage = stage
        self.category = category
        self.http_status = http_status
        super().__init__(stage)


def plan(run_id):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}", run_id):
        raise ValueError("Probe run ID must be a short path-safe identifier")
    return {"schemaVersion": 1, "runId": run_id, "namespace": SHADOW + "/verification/" + run_id,
            "syntheticOnly": True, "originalDividendAccess": False, "issuerAccess": False,
            "newCredentialSetup": False, "automaticCleanup": False}


def probe(store, run_id, *, resume_original=False):
    """Uses only two new synthetic files. Never retries or deletes a prior probe."""
    result = plan(run_id)
    key = "verification/" + run_id + "/state.json"
    body = lambda phase: encode({"kind": "yieldloom-synthetic-storage-probe", "runId": run_id, "phase": phase})
    checks = []
    stage = "create_unique_probe"
    try:
        original = body("original")
        if resume_original:
            stage = "verify_initial_synthetic_state_before_resume"
            raw, revision = store.get(key)
            if raw != original:
                raise ProbeFailure(stage, "synthetic_state_does_not_match")
            try:
                store.get("verification/" + run_id + "/receipt.json")
            except Missing:
                pass
            else:
                raise ProbeFailure(stage, "completion_receipt_already_exists")
        else:
            revision = store.put(key, original)
        stage = "read_back_hash_and_revision"
        raw, read_revision = store.get(key)
        if raw != original or read_revision != revision:
            raise ProbeFailure(stage)
        checks.append(stage)
        stage = "strict_add_conflict"
        try:
            store.put(key, original)
        except Conflict:
            pass
        else:
            raise ProbeFailure(stage)
        checks.append(stage)
        stage = "revision_update"
        updated = body("updated")
        revision2 = store.put(key, updated, revision)
        if store.get(key) != (updated, revision2):
            raise ProbeFailure(stage)
        checks.append(stage)
        stage = "stale_revision_rejected"
        try:
            store.put(key, body("stale_must_not_win"), revision)
        except Conflict:
            pass
        else:
            raise ProbeFailure(stage)
        if store.get(key) != (updated, revision2):
            raise ProbeFailure(stage)
        checks.append(stage)
        stage = "two_writers_one_revision"

        def writer(name):
            payload = body(name)
            try:
                return (payload, store.put(key, payload, revision2))
            except Conflict:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(writer, ["writer_a", "writer_b"]))
        winners = [row for row in outcomes if row is not None]
        if len(winners) != 1 or store.get(key) != winners[0]:
            raise ProbeFailure(stage)
        checks.append(stage)
        stage = "restore_synthetic_bytes_with_cas"
        restored_revision = store.put(key, original, winners[0][1])
        if store.get(key) != (original, restored_revision):
            raise ProbeFailure(stage)
        checks.append(stage)
        stage = "write_completion_receipt"
        receipt = {**result, "completed": True, "checks": checks,
                   "productionActivated": False, "originalDividendModified": False}
        receipt_body = encode(receipt)
        receipt_key = "verification/" + run_id + "/receipt.json"
        receipt_revision = store.put(receipt_key, receipt_body)
        if store.get(receipt_key) != (receipt_body, receipt_revision):
            raise ProbeFailure(stage)
        return receipt
    except (RemoteError, UncertainWrite, Conflict, OSError) as error:
        # Do not retry an uncertain write or broaden authentication. The new
        # namespace remains available for a separately authorized inspection.
        safe_categories = {"invalid_client", "invalid_grant", "invalid_request", "unsupported_grant_type",
                           "missing_scope", "expired_access_token", "invalid_access_token", "insufficient_permissions",
                           "rate_limit", "path", "http_error"}
        category = error.category if isinstance(error, RemoteError) and error.category in safe_categories else type(error).__name__
        status = error.status if isinstance(error, RemoteError) else None
        raise ProbeFailure(stage, category, status) from None


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--apply", action="store_true", help="Explicitly write synthetic shadow files")
    parser.add_argument("--refresh", action="store_true", help="Use an existing approved refresh grant in this environment")
    parser.add_argument("--resume-original", action="store_true", help="Resume only an exact original synthetic state without a completion receipt")
    parser.add_argument("--sharing-checked-run-id", help="Explicit operator attestation from the approved reader for this same existing synthetic run only")
    args = parser.parse_args(argv)
    result = plan(args.run_id)
    if not args.apply:
        print(json.dumps({**result, "applied": False}))
        return 0
    if args.sharing_checked_run_id and (not args.resume_original or args.sharing_checked_run_id != args.run_id):
        print(json.dumps({"completed": False, "stage": "external_sharing_check_binding_invalid", "writeAttempted": False}))
        return 2
    try:
        store = DropboxStore.from_environment(refresh=args.refresh)
        context = preflight(store, externally_checked_run_id=args.sharing_checked_run_id)
        result = probe(store, args.run_id, resume_original=args.resume_original)
        result["preflight"] = context
    except RemoteError as error:
        # _request only attaches allowlisted error categories, no raw response.
        print(json.dumps({"completed": False, "stage": "existing_authentication",
                          "status": error.status, "category": error.category}))
        return 2
    except ProbeFailure as error:
        print(json.dumps({"completed": False, "stage": error.stage, "category": error.category,
                          "httpStatus": error.http_status}))
        return 2
    except PreflightFailure as error:
        print(json.dumps({"completed": False, "stage": error.stage, "category": error.category,
                          "httpStatus": error.status, "writeAttempted": False}))
        return 2
    except ValueError:
        # A missing configured token or an unsafe/incomplete storage stage is a
        # failed probe, never an invitation to request a broader grant.
        print(json.dumps({"completed": False, "stage": "storage_probe_incomplete"}))
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
