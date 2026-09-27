from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean_text(value).lower()).strip()


@dataclass
class ParsedHTML:
    text: str = ""
    tables: list[list[list[str]]] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)


class TableHTMLParser(HTMLParser):
    def __init__(self, base_url: str = ""):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.result = ParsedHTML()
        self._all_text: list[str] = []
        self._current_table: list[list[str]] | None = None
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None
        self._current_link: list[str] | None = None
        self._current_href: str | None = None
        self._current_heading: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "meta":
            key = attributes.get("property") or attributes.get("name")
            value = attributes.get("content")
            if key and value:
                self.result.metadata[key.lower()] = value
        elif tag == "table":
            self._current_table = []
        elif tag == "tr" and self._current_table is not None:
            self._current_row = []
        elif tag in {"th", "td"} and self._current_row is not None:
            self._current_cell = []
        elif tag == "a":
            self._current_href = attributes.get("href")
            self._current_link = []
        elif tag in {"h1", "h2", "h3"}:
            self._current_heading = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"th", "td"} and self._current_cell is not None:
            self._current_row.append(clean_text(" ".join(self._current_cell)))
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None:
            if any(self._current_row):
                self._current_table.append(self._current_row)
            self._current_row = None
        elif tag == "table" and self._current_table is not None:
            if self._current_table:
                self.result.tables.append(self._current_table)
            self._current_table = None
        elif tag == "a" and self._current_link is not None:
            if self._current_href:
                self.result.links.append(
                    (urljoin(self.base_url, self._current_href), clean_text(" ".join(self._current_link)))
                )
            self._current_href = None
            self._current_link = None
        elif tag in {"h1", "h2", "h3"} and self._current_heading is not None:
            heading = clean_text(" ".join(self._current_heading))
            if heading:
                self.result.headings.append(heading)
            self._current_heading = None

    def handle_data(self, data: str) -> None:
        value = clean_text(data)
        if not value:
            return
        self._all_text.append(value)
        if self._current_cell is not None:
            self._current_cell.append(value)
        if self._current_link is not None:
            self._current_link.append(value)
        if self._current_heading is not None:
            self._current_heading.append(value)

    def close(self) -> None:
        super().close()
        self.result.text = clean_text(" ".join(self._all_text))


def parse_html(content: bytes, base_url: str = "") -> ParsedHTML:
    parser = TableHTMLParser(base_url=base_url)
    parser.feed(content.decode("utf-8", errors="replace"))
    parser.close()
    return parser.result


def find_table(
    parsed: ParsedHTML, required_headers: tuple[str, ...]
) -> tuple[list[str], list[list[str]]]:
    normalized_required = tuple(normalize_header(item) for item in required_headers)
    for table in parsed.tables:
        for index, row in enumerate(table):
            normalized = [normalize_header(cell) for cell in row]
            if all(any(required in cell for cell in normalized) for required in normalized_required):
                return normalized, table[index + 1 :]
    raise ValueError(f"required HTML table not found: {required_headers}")


def column_index(headers: list[str], *aliases: str) -> int:
    normalized_aliases = [normalize_header(alias) for alias in aliases]
    for index, header in enumerate(headers):
        if any(alias == header or alias in header for alias in normalized_aliases):
            return index
    raise ValueError(f"column not found: {aliases}")
