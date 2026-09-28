from __future__ import annotations

import base64
import json
import random
import subprocess
import time
from abc import abstractmethod
from pathlib import Path
from urllib.parse import urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from ..models import SourceDocument
from .base import CollectionError, FetchOutcome, ProviderAdapter, SourceCandidate


class OfficialHTTPAdapter(ProviderAdapter):
    allowed_hosts: tuple[str, ...] = ()
    timeout_seconds = 25
    fetch_mode = "http"
    browser_ready_text = ""
    browser_content = "html"
    browser_min_delay_ms = 5_000
    browser_max_delay_ms = 15_000
    http_min_delay_seconds = 1.0
    http_max_delay_seconds = 3.0

    def validate_url(self, url: str) -> None:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https":
            raise ValueError(f"official source must use HTTPS: {url}")
        if not any(host == allowed or host.endswith(f".{allowed}") for allowed in self.allowed_hosts):
            raise ValueError(f"source host is not allowed for {self.slug}: {host}")

    def request_bytes(self, url: str) -> bytes:
        self.validate_url(url)
        request = Request(
            url,
            headers={
                "User-Agent": "DivgrowContentStudio/1.0 (+official distribution monitor)",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                return response.read()
        except HTTPError as exc:
            code = "rate_limited" if exc.code == 429 else "blocked" if exc.code == 403 else "http_error"
            raise CollectionError(
                f"official source returned HTTP {exc.code}: {url}",
                code=code,
                retryable=exc.code in {408, 425, 429, 500, 502, 503, 504},
            ) from exc

    def fetch(self, candidate: SourceCandidate) -> SourceDocument:
        if self.fetch_mode == "browser":
            outcome = self.fetch_many([candidate])[0]
            if outcome.error:
                raise outcome.error
            assert outcome.document is not None
            return outcome.document
        content = self.request_bytes(candidate.url)
        return SourceDocument(
            provider_slug=self.slug,
            source_url=candidate.url,
            source_type=candidate.source_type,
            content=content,
            published_at=candidate.published_at,
            metadata={**candidate.metadata, "fetchMode": "http"},
        )

    def fetch_many(self, candidates):
        candidates = list(candidates)
        if self.fetch_mode != "browser":
            outcomes = []
            for index, candidate in enumerate(candidates):
                outcomes.extend(super().fetch_many([candidate]))
                if index < len(candidates) - 1:
                    time.sleep(random.uniform(
                        self.http_min_delay_seconds,
                        self.http_max_delay_seconds,
                    ))
            return outcomes
        for candidate in candidates:
            self.validate_url(candidate.url)
        if not candidates:
            return []

        script = Path(__file__).resolve().parents[1] / "fetch_browser_sources.mjs"
        payload = {
            "sources": [
                {
                    "url": candidate.url,
                    "readyText": candidate.metadata.get("browserReadyText", self.browser_ready_text),
                    "content": candidate.metadata.get("browserContent", self.browser_content),
                }
                for candidate in candidates
            ],
            "minDelayMs": self.browser_min_delay_ms,
            "maxDelayMs": self.browser_max_delay_ms,
            "timeoutMs": self.timeout_seconds * 1000,
        }
        try:
            result = subprocess.run(
                ["node", str(script)],
                input=json.dumps(payload),
                text=True,
                encoding="utf-8",
                capture_output=True,
                check=True,
                timeout=max(120, len(candidates) * (self.timeout_seconds + 20)),
            )
            rows = json.loads(result.stdout)
        except (subprocess.SubprocessError, json.JSONDecodeError, OSError) as exc:
            error = CollectionError(f"browser collector failed: {exc}", code="browser_failed")
            return [FetchOutcome(candidate, error=error) for candidate in candidates]

        outcomes = []
        for candidate, row in zip(candidates, rows, strict=False):
            if not row.get("ok"):
                outcomes.append(
                    FetchOutcome(
                        candidate,
                        error=CollectionError(
                            row.get("message", "browser collection failed"),
                            code=row.get("code", "browser_failed"),
                            retryable=bool(row.get("retryable", True)),
                        ),
                    )
                )
                continue
            content = base64.b64decode(row["contentBase64"])
            metadata = {
                **candidate.metadata,
                "fetchMode": "browser",
                "browserContent": candidate.metadata.get("browserContent", self.browser_content),
                "httpStatus": row.get("httpStatus"),
                "finalUrl": row.get("finalUrl"),
                "pageTitle": row.get("pageTitle"),
            }
            outcomes.append(
                FetchOutcome(
                    candidate,
                    document=SourceDocument(
                        provider_slug=self.slug,
                        source_url=candidate.url,
                        source_type=candidate.source_type,
                        content=content,
                        published_at=candidate.published_at,
                        metadata=metadata,
                    ),
                )
            )
        if len(outcomes) < len(candidates):
            error = CollectionError("browser collector returned an incomplete result", code="browser_failed")
            outcomes.extend(FetchOutcome(candidate, error=error) for candidate in candidates[len(outcomes):])
        return outcomes
