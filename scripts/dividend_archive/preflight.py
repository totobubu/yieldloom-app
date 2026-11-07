"""Read only the authenticated home and synthetic target ancestors before writing.

Personal account details and shared-link URLs never leave this function. No
original dividend path is queried. Missing permissions stop the probe; they do
not cause a new grant or a different credential/namespace to be selected.
"""
import json

from .storage import Missing, RemoteError, encode


class PreflightFailure(RuntimeError):
    def __init__(self, stage, category=None, status=None):
        self.stage, self.category, self.status = stage, category, status
        super().__init__(stage)


def preflight(store, *, externally_checked_run_id=None):
    stage = "read_account_context"

    def api(route, body):
        raw, _ = store._request("https://api.dropboxapi.com/2/" + route, encode(body),
                                {"Content-Type": "application/json"})
        return json.loads(raw)

    try:
        account = api("users/get_current_account", None)
        root = account.get("root_info", {})
        if account.get("team") or root.get(".tag") != "user":
            raise PreflightFailure(stage, "personal_home_not_established")
        checked = 0
        for path in ("/DividendArchive", "/DividendArchive/v1", "/DividendArchive/v1/shadow",
                     "/DividendArchive/v1/shadow/verification"):
            stage = "read_synthetic_ancestor_metadata"
            try:
                metadata = api("files/get_metadata", {"path": path})
            except Missing:
                # The remaining descendants do not yet exist. A new directory
                # beneath this verified personal, unshared ancestry is isolated.
                return {"personalHomeChecked": True, "existingAncestorsChecked": checked,
                        "targetAncestorAbsent": True, "sharedAncestorDetected": False}
            if metadata.get(".tag") != "folder":
                raise PreflightFailure(stage, "ancestor_is_not_a_folder")
            sharing = metadata.get("sharing_info") or {}
            if any(sharing.get(key) for key in ("shared_folder_id", "parent_shared_folder_id", "is_team_folder")):
                raise PreflightFailure(stage, "shared_ancestor_detected")
            if externally_checked_run_id:
                # A trusted operator has read the SAME existing synthetic run's
                # ancestry and exhausted its links through the approved connected
                # reader. Never repeat an unsupported/denied sharing endpoint or
                # change grants. Native account/folder metadata is still checked.
                checked += 1
                continue
            stage = "read_synthetic_ancestor_shared_links"
            links = api("sharing/list_shared_links", {"path": path, "direct_only": True})
            pages = 0
            while True:
                if links.get("links"):
                    raise PreflightFailure(stage, "existing_link_detected")
                if not links.get("has_more"):
                    break
                pages += 1
                if pages > 10 or not links.get("cursor"):
                    raise PreflightFailure(stage, "sharing_verification_incomplete")
                links = api("sharing/list_shared_links", {"cursor": links["cursor"]})
            checked += 1
        return {"personalHomeChecked": True, "existingAncestorsChecked": checked,
                "targetAncestorAbsent": False, "sharedAncestorDetected": False,
                "sharedLinksCheck": "approved_connected_reader" if externally_checked_run_id else "native_api",
                "externallyCheckedRunId": externally_checked_run_id}
    except RemoteError as error:
        raise PreflightFailure(stage, error.category or "remote_error", error.status) from None
    except (ValueError, TypeError, AttributeError):
        raise PreflightFailure(stage, "response_invalid") from None
