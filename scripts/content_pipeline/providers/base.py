from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Iterable

from ..models import DistributionEvent, SourceDocument


class NoDataError(ValueError):
    """The official source responded normally but had no matching announcement."""


@dataclass(frozen=True)
class SourceCandidate:
    url: str
    source_type: str = "html"
    published_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class ProviderAdapter(ABC):
    """Contract implemented by each official distribution source."""

    slug: str
    display_name: str
    official_homepage: str
    parser_version: str = "1"

    @abstractmethod
    def discover(self) -> Iterable[SourceCandidate]:
        """Return newly discoverable official source candidates."""

    @abstractmethod
    def fetch(self, candidate: SourceCandidate) -> SourceDocument:
        """Fetch and preserve an immutable representation of the official source."""

    @abstractmethod
    def parse(self, document: SourceDocument) -> list[DistributionEvent]:
        """Parse one source document into provider-neutral distribution events."""
