from contextlib import redirect_stdout
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
from urllib.parse import parse_qs

from scripts.dividend_archive.smoke import ProbeFailure, main, plan, probe
from scripts.dividend_archive.storage import Conflict, DropboxStore, LocalStore, Missing, RemoteError, UncertainWrite, encode


class Response(BytesIO):
    headers = {}


class AuthenticationContractTests(unittest.TestCase):
    def test_refresh_matches_existing_actions_form_without_extra_grants_or_persistence(self):
        requests = []

        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return Response(encode({"access_token": "synthetic-transient-token"}))

        supplied = {"DROPBOX_APP_KEY": "synthetic-app-key", "DROPBOX_APP_SECRET": "synthetic-app-secret",
                    "DROPBOX_REFRESH_TOKEN": "synthetic-refresh-token", "DROPBOX_AUTHORIZATION_CODE": "must-not-be-used"}
        with patch("scripts.dividend_archive.storage.os.environ", supplied), patch(
            "scripts.dividend_archive.storage.urllib.request.build_opener", return_value=Opener()
        ), patch("builtins.open", side_effect=AssertionError("Authentication must not persist a credential")):
            result = DropboxStore.from_environment(refresh=True)
        self.assertIsInstance(result, DropboxStore)
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.full_url, "https://api.dropboxapi.com/oauth2/token")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Content-type"), "application/x-www-form-urlencoded")
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(parse_qs(request.data.decode()), {
            "grant_type": ["refresh_token"], "client_id": ["synthetic-app-key"],
            "client_secret": ["synthetic-app-secret"], "refresh_token": ["synthetic-refresh-token"],
        })

    def test_allowlisted_refresh_error_preserves_category_without_error_description(self):
        class Opener:
            def open(self, request, timeout):
                raise urllib.error.HTTPError(request.full_url, 400, "error", {},
                    Response(encode({"error": "invalid_grant", "error_description": "DO-NOT-PRINT-THIS-SECRET"})))
        store = DropboxStore("synthetic", opener=Opener())
        with self.assertRaises(RemoteError) as caught:
            store._request("https://api.dropboxapi.com/oauth2/token", b"synthetic-form", {}, auth=False)
        self.assertEqual(caught.exception.category, "invalid_grant")
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(caught.exception.stage, "authentication_refresh")
        self.assertNotIn("DO-NOT-PRINT", str(caught.exception))

    def test_unknown_error_strings_are_not_logged(self):
        class Opener:
            def open(self, request, timeout):
                raise urllib.error.HTTPError(request.full_url, 401, "error", {},
                    Response(encode({"error": "DO-NOT-PRINT-THIS-SECRET"})))
        store = DropboxStore("synthetic", opener=Opener())
        with self.assertRaises(RemoteError) as caught:
            store.get("verification/test/state.json")
        self.assertEqual(caught.exception.category, "http_error")
        self.assertNotIn("DO-NOT-PRINT", str(caught.exception))

    def test_actual_upload_write_failed_envelope_is_a_conflict(self):
        class Opener:
            def open(self,request,timeout):
                raise urllib.error.HTTPError(request.full_url,409,"error",{},Response(encode({"error":{
                    ".tag":"path","path":{"reason":{".tag":"conflict","conflict":{".tag":"file"}},
                        "upload_session_id":"DO-NOT-PRINT-UPLOAD-SESSION"}}})))
        with self.assertRaises(Conflict) as caught:
            DropboxStore("synthetic",opener=Opener()).put("verification/test/state.json",b"synthetic")
        self.assertNotIn("DO-NOT-PRINT",str(caught.exception))

    def test_other_upload_path_errors_are_not_misclassified_as_conflicts(self):
        class Opener:
            def open(self,request,timeout):
                raise urllib.error.HTTPError(request.full_url,409,"error",{},Response(encode({"error":{
                    ".tag":"path","path":{"reason":{".tag":"no_write_permission"}}}})))
        with self.assertRaises(RemoteError):
            DropboxStore("synthetic",opener=Opener()).put("verification/test/state.json",b"synthetic")


class SyntheticProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = LocalStore(self.temp.name)

    def test_default_is_offline_and_never_loads_credentials(self):
        output = StringIO()
        with patch.object(DropboxStore, "from_environment", side_effect=AssertionError("No credential access")), redirect_stdout(output):
            self.assertEqual(main(["--run-id", "offline-1"]), 0)
        result = json.loads(output.getvalue())
        self.assertFalse(result["applied"])
        self.assertFalse(result["originalDividendAccess"])

    def test_external_sharing_proof_cannot_select_a_different_run_or_a_new_probe(self):
        for args in (["--apply","--run-id","one","--sharing-checked-run-id","two"],
                     ["--apply","--run-id","one","--sharing-checked-run-id","one"]):
            output=StringIO()
            with patch.object(DropboxStore,"from_environment",side_effect=AssertionError("No credential access")),redirect_stdout(output):
                self.assertEqual(main(args),2)
            self.assertEqual(json.loads(output.getvalue())["stage"],"external_sharing_check_binding_invalid")

    def test_probe_covers_roundtrip_conflicts_concurrency_and_restoration(self):
        result = probe(self.store, "isolated-1")
        self.assertEqual(len(result["checks"]), 6)
        self.assertTrue(result["completed"])
        self.assertFalse(result["originalDividendModified"])
        files = sorted(path.relative_to(self.store.root).as_posix() for path in self.store.root.rglob("*.json"))
        self.assertEqual(files, ["verification/isolated-1/receipt.json", "verification/isolated-1/state.json"])
        payload = json.loads(self.store.get("verification/isolated-1/state.json")[0])
        self.assertEqual(payload["phase"], "original")

    def test_resume_reuses_only_the_exact_known_original_synthetic_file(self):
        key="verification/paused-1/state.json"
        self.store.put(key,encode({"kind":"yieldloom-synthetic-storage-probe","runId":"paused-1","phase":"original"}))
        result=probe(self.store,"paused-1",resume_original=True)
        self.assertTrue(result["completed"])
        self.assertEqual(len(list(self.store.root.rglob("*.json"))),2)

    def test_resume_refuses_a_different_value_without_writing(self):
        key="verification/paused-1/state.json"
        self.store.put(key,b"DO-NOT-OVERWRITE-DIFFERENT-BYTES")
        with self.assertRaises(ProbeFailure):probe(self.store,"paused-1",resume_original=True)
        self.assertEqual(self.store.get(key)[0],b"DO-NOT-OVERWRITE-DIFFERENT-BYTES")

    def test_resume_refuses_an_already_completed_probe(self):
        probe(self.store,"complete-1")
        before={p:p.read_bytes() for p in self.store.root.rglob("*.json")}
        with self.assertRaises(ProbeFailure):probe(self.store,"complete-1",resume_original=True)
        self.assertEqual(before,{p:p.read_bytes() for p in self.store.root.rglob("*.json")})

    def test_existing_probe_is_not_overwritten_or_retried(self):
        probe(self.store, "isolated-1")
        before = {path: path.read_bytes() for path in self.store.root.rglob("*.json")}
        with self.assertRaises(ProbeFailure) as caught:
            probe(self.store, "isolated-1")
        self.assertEqual(caught.exception.stage, "create_unique_probe")
        self.assertEqual(before, {path: path.read_bytes() for path in self.store.root.rglob("*.json")})

    def test_failure_has_no_completion_receipt_and_reports_exact_safe_stage(self):
        original = self.store.put

        def fail(key, body, expected_revision=None):
            if b'"phase":"updated"' in body:
                raise RemoteError("DO-NOT-PRINT-TRANSPORT-DETAIL")
            return original(key, body, expected_revision)

        self.store.put = fail
        with self.assertRaises(ProbeFailure) as caught:
            probe(self.store, "failed-1")
        self.assertEqual(caught.exception.stage, "revision_update")
        self.assertNotIn("DO-NOT-PRINT", str(caught.exception))
        with self.assertRaises(Missing): self.store.get("verification/failed-1/receipt.json")

    def test_uncertain_first_write_is_not_retried(self):
        original = self.store.put
        calls = []

        def fail_after_write(key, body, expected_revision=None):
            calls.append(key)
            original(key, body, expected_revision)
            raise UncertainWrite("DO-NOT-PRINT-TRANSPORT-DETAIL")

        self.store.put = fail_after_write
        with self.assertRaises(ProbeFailure): probe(self.store, "uncertain-1")
        self.assertEqual(len(calls), 1)
        self.assertEqual(json.loads(self.store.get(calls[0])[0])["phase"], "original")

    def test_missing_write_scope_reports_safe_category_without_changing_auth(self):
        calls = []

        def missing_scope(key, body, expected_revision=None):
            calls.append(key)
            raise RemoteError("DO-NOT-PRINT-ERROR-BODY", status=403, category="missing_scope", stage="files_api")

        self.store.put = missing_scope
        with self.assertRaises(ProbeFailure) as caught: probe(self.store, "no-write-scope")
        self.assertEqual(caught.exception.stage, "create_unique_probe")
        self.assertEqual(caught.exception.category, "missing_scope")
        self.assertEqual(caught.exception.http_status, 403)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("DO-NOT-PRINT", str(caught.exception))

    def test_plan_refuses_other_namespaces_and_path_traversal(self):
        for value in ("../Dividend", "/Dividend", "nested/path", "", "a" * 81):
            with self.assertRaises(ValueError): plan(value)
        self.assertEqual(plan("gh-123-1")["namespace"], "/DividendArchive/v1/shadow/verification/gh-123-1")

    def test_probe_cli_does_not_print_raw_failure_messages(self):
        output = StringIO()
        with patch.object(DropboxStore, "from_environment", return_value=self.store), patch(
            "scripts.dividend_archive.smoke.probe", side_effect=ProbeFailure("revision_update", "RemoteError")
        ), patch("scripts.dividend_archive.smoke.preflight", return_value={"personalHomeChecked":True}), redirect_stdout(output):
            self.assertEqual(main(["--apply", "--run-id", "mock-1"]), 2)
        self.assertEqual(json.loads(output.getvalue())["stage"], "revision_update")


if __name__ == "__main__": unittest.main()
