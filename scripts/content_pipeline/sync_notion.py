from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2026-03-11"


def rich_text(value: str) -> list[dict]:
    return [{"type": "text", "text": {"content": value[:2000]}}]


def build_properties(record: dict, *, include_editable: bool = True) -> dict:
    properties = {
        "Name": {"title": rich_text(record["title"])},
        "Event Key": {"rich_text": rich_text(record["eventKey"])},
        "Provider": {"select": {"name": record["provider"]}},
        "Ticker": {"rich_text": rich_text(record["ticker"])},
        "Publish Date": {"date": {"start": record["plannedPublishDate"]}},
        "Ex-Date": {"date": {"start": record["exDate"]}},
        "Verification": {"select": {"name": record["verificationStatus"]}},
        "Official URL": {"url": record["officialUrl"]},
        "Bundle Path": {"rich_text": rich_text(record["bundlePath"])},
    }
    if include_editable:
        properties["Status"] = {"select": {"name": record["status"]}}
        properties["Channels"] = {"multi_select": [{"name": item} for item in record["channels"]]}
    return properties


class NotionClient:
    def __init__(self, token: str, data_source_id: str):
        self.token = token
        self.data_source_id = data_source_id

    def request(self, method: str, endpoint: str, body: dict) -> dict:
        request = Request(
            f"{NOTION_API}{endpoint}",
            method=method,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Notion API {error.code}: {detail}") from error

    def find_page(self, event_key: str) -> dict | None:
        result = self.request(
            "POST",
            f"/data_sources/{self.data_source_id}/query",
            {
                "filter": {
                    "property": "Event Key",
                    "rich_text": {"equals": event_key},
                },
                "page_size": 1,
            },
        )
        return result["results"][0] if result.get("results") else None

    def upsert(self, record: dict) -> str:
        page = self.find_page(record["eventKey"])
        if page:
            # Preserve editorial fields (Name, Status, Channels and page body) in Notion.
            properties = build_properties(record, include_editable=False)
            properties.pop("Name")
            self.request("PATCH", f"/pages/{page['id']}", {"properties": properties})
            return "updated"
        properties = build_properties(record)
        self.request(
            "POST",
            "/pages",
            {
                "parent": {"type": "data_source_id", "data_source_id": self.data_source_id},
                "properties": properties,
            },
        )
        return "created"


def main() -> int:
    parser = argparse.ArgumentParser(description="Upsert local content calendar into Notion")
    parser.add_argument(
        "--calendar", type=Path, default=Path("var/content-studio/content-calendar.json")
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Allow Notion writes after token configuration")
    args = parser.parse_args()
    records = json.loads(args.calendar.read_text(encoding="utf-8"))["records"]
    if args.dry_run or not args.apply:
        print(json.dumps([build_properties(record) for record in records], ensure_ascii=False, indent=2))
        return 0
    token = os.environ.get("NOTION_TOKEN")
    data_source_id = os.environ.get("NOTION_DATA_SOURCE_ID")
    if not token or not data_source_id:
        raise SystemExit("Set NOTION_TOKEN and NOTION_DATA_SOURCE_ID before syncing.")
    client = NotionClient(token, data_source_id)
    counts = {"created": 0, "updated": 0}
    for record in records:
        counts[client.upsert(record)] += 1
    print(json.dumps(counts, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
