from __future__ import annotations

from abc import abstractmethod
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from ..models import SourceDocument
from .base import ProviderAdapter, SourceCandidate


class OfficialHTTPAdapter(ProviderAdapter):
    allowed_hosts: tuple[str, ...] = ()
    timeout_seconds = 25

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
        with urlopen(request, timeout=self.timeout_seconds) as response:
            return response.read()

    def fetch(self, candidate: SourceCandidate) -> SourceDocument:
        content = self.request_bytes(candidate.url)
        return SourceDocument(
            provider_slug=self.slug,
            source_url=candidate.url,
            source_type=candidate.source_type,
            content=content,
            published_at=candidate.published_at,
            metadata=candidate.metadata,
        )
