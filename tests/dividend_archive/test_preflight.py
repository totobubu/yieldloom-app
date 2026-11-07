import json
import unittest

from scripts.dividend_archive.preflight import PreflightFailure, preflight
from scripts.dividend_archive.storage import Missing, RemoteError, encode


class Store:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def _request(self, url, body, headers):
        self.calls.append((url, json.loads(body)))
        result = next(self.responses)
        if isinstance(result, Exception):
            raise result
        return encode(result), {}


PERSONAL = {"root_info":{".tag":"user"},"account_id":"DO-NOT-PRINT-ACCOUNT","email":"DO-NOT-PRINT-EMAIL"}


class PreflightTests(unittest.TestCase):
    def test_missing_new_top_folder_is_checked_without_original_paths_or_identity_output(self):
        store = Store([PERSONAL, Missing()])
        result = preflight(store)
        self.assertTrue(result["targetAncestorAbsent"])
        self.assertEqual(len(store.calls), 2)
        self.assertEqual(store.calls[1][1], {"path":"/DividendArchive"})
        self.assertNotIn("DO-NOT-PRINT", json.dumps(result))

    def test_shared_ancestor_stops_before_any_link_or_file_write(self):
        store = Store([PERSONAL, {".tag":"folder","sharing_info":{"shared_folder_id":"private-id"}}])
        with self.assertRaises(PreflightFailure) as caught: preflight(store)
        self.assertEqual(caught.exception.category, "shared_ancestor_detected")
        self.assertEqual(len(store.calls), 2)

    def test_shared_link_stops_without_exposing_its_url(self):
        store = Store([PERSONAL, {".tag":"folder"}, {"links":[{"url":"DO-NOT-PRINT-PRIVATE-LINK"}]}])
        with self.assertRaises(PreflightFailure) as caught: preflight(store)
        self.assertEqual(caught.exception.category, "existing_link_detected")
        self.assertNotIn("DO-NOT-PRINT", str(caught.exception))

    def test_empty_shared_link_pages_are_exhausted_before_descending(self):
        store = Store([PERSONAL, {".tag":"folder"}, {"links":[],"has_more":True,"cursor":"cursor-1"},
                       {"links":[],"has_more":False}, Missing()])
        result = preflight(store)
        self.assertEqual(result["existingAncestorsChecked"], 1)
        self.assertEqual(store.calls[3][1], {"cursor":"cursor-1"})

    def test_scope_failure_stops_without_changing_authentication(self):
        store = Store([RemoteError("DO-NOT-PRINT-BODY",status=403,category="missing_scope")])
        with self.assertRaises(PreflightFailure) as caught: preflight(store)
        self.assertEqual(caught.exception.stage, "read_account_context")
        self.assertEqual(caught.exception.category, "missing_scope")
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(len(store.calls), 1)

    def test_team_context_is_not_silently_treated_as_personal(self):
        store = Store([{"root_info":{".tag":"team"},"team":{"id":"DO-NOT-PRINT-TEAM"}}])
        with self.assertRaises(PreflightFailure) as caught: preflight(store)
        self.assertEqual(caught.exception.category, "personal_home_not_established")
        self.assertEqual(len(store.calls), 1)

    def test_external_read_proof_retains_native_account_and_ancestor_metadata_checks(self):
        store=Store([PERSONAL,*({".tag":"folder"} for _ in range(4))])
        result=preflight(store,externally_checked_run_id="gh-approved-1")
        self.assertEqual(result["existingAncestorsChecked"],4)
        self.assertEqual(result["externallyCheckedRunId"],"gh-approved-1")
        self.assertEqual(result["sharedLinksCheck"],"approved_connected_reader")
        self.assertFalse(any("sharing/list_shared_links" in call[0] for call in store.calls))

    def test_external_read_proof_does_not_override_native_shared_folder_detection(self):
        store=Store([PERSONAL,{".tag":"folder","sharing_info":{"shared_folder_id":"not-allowed"}}])
        with self.assertRaises(PreflightFailure):preflight(store,externally_checked_run_id="gh-approved-1")


if __name__ == "__main__": unittest.main()
