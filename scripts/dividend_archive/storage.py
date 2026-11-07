"""Byte-preserving stores with revision compare-and-swap; no blind overwrites.

Dropbox writes are confined to one new shadow namespace. Credentials are used in
memory only. An HTTP failure is never treated as a missing file except the exact
Dropbox path/not_found tag. Transport errors on writes have an uncertain outcome.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

SHADOW = "/DividendArchive/v1/shadow"
MAX_BYTES = 64 * 1024 * 1024


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def content_hash(body):
    """Dropbox SHA-256 of concatenated binary hashes of 4 MiB blocks."""
    return sha256(b"".join(hashlib.sha256(body[i:i + 4194304]).digest()
                           for i in range(0, len(body), 4194304)))


class Conflict(RuntimeError):
    pass


class Missing(RuntimeError):
    pass


class UncertainWrite(RuntimeError):
    pass


class RemoteError(RuntimeError):
    def __init__(self, message, *, status=None, category=None, stage=None):
        super().__init__(message)
        self.status, self.category, self.stage = status, category, stage


def safe_key(key):
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_./-]+", key):
        raise ValueError("Invalid archive key")
    if key.startswith("/") or any(p in {"", ".", ".."} for p in key.split("/")):
        raise ValueError("Unsafe archive key")
    return key


def private_root(path):
    root = Path(path).resolve()
    repo = Path(__file__).resolve().parents[2]
    # Inside the checkout only ignored runtime storage is accepted.
    if root == repo or repo in root.parents:
        allowed = (repo / "var/dividend-archive").resolve()
        if root != allowed and allowed not in root.parents:
            raise ValueError("Archive data inside the checkout must use var/dividend-archive")
        allowed.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


class LocalStore:
    """Local test/replay store. Serializes CAS across processes with flock."""
    def __init__(self, root):
        self.root = private_root(root)

    def get(self, key):
        path = self.root / safe_key(key)
        if self.root not in path.resolve().parents:
            raise ValueError("Archive path escapes its root")
        try:
            body = path.read_bytes()
        except FileNotFoundError as error:
            raise Missing() from error
        return body, sha256(body)

    def put(self, key, body, expected_revision=None):
        path = self.root / safe_key(key)
        if self.root not in path.resolve().parents:
            raise ValueError("Archive path escapes its root")
        with (self.root / ".writer.lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                _, revision = self.get(key)
            except Missing:
                revision = None
            if revision != expected_revision:
                raise Conflict("Archive revision changed")
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".pending-")
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(body)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp, path)
            finally:
                if os.path.exists(temp):
                    os.unlink(temp)
            return sha256(body)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class DropboxStore:
    def __init__(self, token, *, opener=None):
        if not token:
            raise ValueError("Existing Dropbox authentication is required")
        self._token = token
        self.opener = opener or urllib.request.build_opener(NoRedirect)

    @classmethod
    def from_environment(cls, *, refresh=False):
        if not refresh:
            return cls(os.environ.get("DROPBOX_ACCESS_TOKEN"))
        # Refreshes an existing grant only; never exchanges authorization codes,
        # changes scopes, writes tokens, or falls back to a different identity.
        required = ("DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN")
        if not all(os.environ.get(key) for key in required):
            raise ValueError("Existing refresh credentials are required")
        store = cls("refresh-pending")
        payload = urllib.parse.urlencode({
            "grant_type": "refresh_token", "client_id": os.environ[required[0]],
            "client_secret": os.environ[required[1]], "refresh_token": os.environ[required[2]],
        }).encode()
        raw, _ = store._request("https://api.dropboxapi.com/oauth2/token", payload,
                                {"Content-Type": "application/x-www-form-urlencoded"}, auth=False)
        return cls(json.loads(raw).get("access_token"))

    def _request(self, url, body, headers, *, auth=True, writing=False):
        headers = dict(headers)
        if auth:
            headers["Authorization"] = "Bearer " + self._token
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with self.opener.open(request, timeout=40) as response:
                raw = response.read(MAX_BYTES + 1)
                response_headers = response.headers
            if len(raw) > MAX_BYTES:
                if writing:
                    raise UncertainWrite("Dropbox response too large; inspect write target")
                raise RemoteError("Dropbox response exceeded byte limit")
            return raw, response_headers
        except urllib.error.HTTPError as error:
            # Never expose response bodies, bearer tokens or refresh credentials.
            try:
                details = json.loads(error.read(65536)).get("error", {})
            except (ValueError, OSError):
                details = {}
            if error.code == 409 and isinstance(details, dict):
                path = details.get("path", {})
                if details.get(".tag") == "path" and isinstance(path, dict) and path.get(".tag") == "not_found":
                    raise Missing() from None
                if details.get(".tag") == "path" and isinstance(path, dict) and path.get(".tag") == "conflict":
                    raise Conflict("Dropbox revision/path conflict") from None
            if writing and error.code >= 500:
                raise UncertainWrite("Dropbox server error; inspect write target before retry") from None
            known = {"invalid_client", "invalid_grant", "invalid_request", "unsupported_grant_type",
                     "missing_scope", "expired_access_token", "invalid_access_token", "insufficient_permissions",
                     "rate_limit", "path"}
            category = details.get(".tag") if isinstance(details, dict) else details
            category = category if isinstance(category, str) and category in known else "http_error"
            stage = "authentication_refresh" if url == "https://api.dropboxapi.com/oauth2/token" else "files_api"
            raise RemoteError(f"Dropbox {stage}: HTTP {error.code} [{category}]; no automatic retry",
                              status=error.code, category=category, stage=stage) from None
        except (urllib.error.URLError, OSError, TimeoutError):
            if writing:
                raise UncertainWrite("Dropbox write outcome unknown; read target before retry") from None
            raise RemoteError("Dropbox network/TLS failure") from None

    def rpc(self, route, value):
        raw, _ = self._request("https://api.dropboxapi.com/2/files/" + route,
                               encode(value), {"Content-Type": "application/json"})
        return json.loads(raw)

    def list_baseline(self):
        page = self.rpc("list_folder", {"path": "/Dividend", "recursive": True, "limit": 2000})
        entries = list(page["entries"])
        while page["has_more"]:
            page = self.rpc("list_folder/continue", {"cursor": page["cursor"]})
            entries.extend(page["entries"])
        return [row for row in entries if row[".tag"] == "file"]

    def download(self, path, *, revision=None):
        if not (path.lower().startswith("/dividend/") or path.startswith(SHADOW + "/")):
            raise ValueError("Read outside the dividend namespaces")
        args = {"path": path}
        if revision:
            args["rev"] = revision
        raw, headers = self._request("https://content.dropboxapi.com/2/files/download", None,
                                     {"Dropbox-API-Arg": encode(args).decode("ascii")})
        meta = json.loads(headers["Dropbox-API-Result"])
        if meta["size"] != len(raw) or meta.get("content_hash") != content_hash(raw):
            raise RemoteError("Dropbox download integrity mismatch")
        if meta.get("path_lower") != path.lower():
            raise RemoteError("Dropbox returned a different path")
        if revision and meta["rev"] != revision:
            raise RemoteError("Dropbox returned a different revision")
        return raw, meta

    def get(self, key):
        raw, meta = self.download(SHADOW + "/" + safe_key(key))
        return raw, meta["rev"]

    def put(self, key, body, expected_revision=None):
        if len(body) > MAX_BYTES:
            raise ValueError("Upload exceeded archive byte limit")
        path = SHADOW + "/" + safe_key(key)
        mode = "add" if expected_revision is None else {".tag": "update", "update": expected_revision}
        args = {"path": path, "mode": mode, "autorename": False, "strict_conflict": True, "mute": True}
        raw, _ = self._request("https://content.dropboxapi.com/2/files/upload", body,
            {"Content-Type": "application/octet-stream", "Dropbox-API-Arg": encode(args).decode("ascii")}, writing=True)
        try:
            meta = json.loads(raw)
            if (meta["content_hash"] != content_hash(body) or meta["size"] != len(body)
                    or meta["path_lower"] != path.lower() or not meta["rev"]):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise UncertainWrite("Upload response invalid; read target before retry") from None
        return meta["rev"]


class Objects:
    def __init__(self, store):
        self.store = store

    def put(self, body):
        key = "objects/" + sha256(body)
        try:
            self.store.put(key, body)
        except (Conflict, UncertainWrite) as error:
            # Identical bytes establish idempotent success. Different/absent bytes
            # leave the conflict/uncertain outcome visible; no blind retry.
            try:
                existing, _ = self.store.get(key)
            except Missing:
                raise error from None
            if existing != body:
                raise Conflict("Immutable object mismatch") from None
        return sha256(body)

    def get(self, digest):
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid object digest")
        raw, _ = self.store.get("objects/" + digest)
        if sha256(raw) != digest:
            raise ValueError("Archive object hash mismatch")
        return raw
