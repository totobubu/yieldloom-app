"""Discover and preserve regulator-owned evidence for an unmapped US ticker."""
from __future__ import annotations

import json
import os
from pathlib import Path
from io import BytesIO
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.models import SourceDocument


SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
US_MARKETS = {"NYSE", "NASDAQ", "AMEX", "ARCA", "BATS", "US"}
KOREAN_MARKETS = {"KOSPI", "KOSDAQ", "KONEX", "KRX"}
OPENDART_CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
OPENDART_COMPANY_URL = "https://opendart.fss.or.kr/api/company.json"


def _user_agent(value: str | None = None) -> str:
    resolved = (value if value is not None else os.environ.get("SEC_USER_AGENT", "")).strip()
    if not resolved:
        raise ValueError(
            "SEC_USER_AGENT is required and must identify the application and contact"
        )
    return resolved


def fetch_sec_json(url: str, user_agent: str) -> bytes:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return response.read()


def fetch_opendart(url: str, api_key: str, **params: str) -> bytes:
    from urllib.parse import urlencode

    query = urlencode({"crtfc_key": api_key, **params})
    request = Request(f"{url}?{query}", headers={"User-Agent": "YieldLoom official-source discovery"})
    with urlopen(request, timeout=30) as response:
        return response.read()


def resolve_sec_ticker(payload: bytes, ticker: str) -> dict[str, str]:
    target = ticker.strip().upper()
    rows = json.loads(payload)
    matches = [row for row in rows.values() if str(row.get("ticker", "")).upper() == target]
    if len(matches) != 1:
        raise ValueError(f"SEC ticker directory did not uniquely identify {target}")
    row = matches[0]
    return {
        "ticker": target,
        "cik": str(row["cik_str"]).zfill(10),
        "name": str(row["title"]),
    }


def _validate_document(payload: bytes, issuer: dict[str, str], document_type: str) -> None:
    data = json.loads(payload)
    if str(data.get("cik", "")).zfill(10) != issuer["cik"]:
        raise ValueError(f"SEC {document_type} CIK did not match {issuer['ticker']}")
    if document_type == "submissions" and issuer["ticker"] not in data.get("tickers", []):
        raise ValueError(f"SEC submissions did not identify ticker {issuer['ticker']}")
    if document_type == "companyfacts" and "facts" not in data:
        raise ValueError(f"SEC companyfacts contained no facts for {issuer['ticker']}")


def collect_sec_evidence(ticker: str, db: Path = DEFAULT_DB_PATH,
                         user_agent: str | None = None) -> dict:
    """Resolve a ticker and persist official SEC documents without inventing events."""
    agent = _user_agent(user_agent)
    directory = fetch_sec_json(SEC_TICKERS_URL, agent)
    issuer = resolve_sec_ticker(directory, ticker)
    urls = {
        "submissions": SEC_SUBMISSIONS_URL.format(cik=issuer["cik"]),
        "companyfacts": SEC_COMPANYFACTS_URL.format(cik=issuer["cik"]),
    }
    documents = {}
    for document_type, url in urls.items():
        payload = fetch_sec_json(url, agent)
        _validate_document(payload, issuer, document_type)
        documents[document_type] = (url, payload)

    database = ContentDatabase(db)
    database.initialize()
    database.upsert_provider(
        "sec", "U.S. Securities and Exchange Commission", "https://www.sec.gov/"
    )
    database.upsert_provider_fund(
        "sec", issuer["ticker"], urls["submissions"], "regulator_filings"
    )
    before = database.summary()["source_documents"]
    for document_type, (url, payload) in documents.items():
        database.add_source_document(SourceDocument(
            provider_slug="sec",
            source_url=url,
            source_type=f"sec_{document_type}",
            content=payload,
            metadata={"ticker": issuer["ticker"], "cik": issuer["cik"], "name": issuer["name"]},
        ))
    added = database.summary()["source_documents"] - before
    return {
        "source": "sec",
        "ticker": issuer["ticker"],
        "cik": issuer["cik"],
        "issuerName": issuer["name"],
        "documents": len(documents),
        "addedSources": added,
        "canonicalEventsCreated": 0,
        "status": "evidence_collected",
    }


def resolve_opendart_stock(payload: bytes, ticker: str) -> dict[str, str]:
    target = ticker.strip().zfill(6)
    with ZipFile(BytesIO(payload)) as archive:
        names = archive.namelist()
        if len(names) != 1:
            raise ValueError("OpenDART corporation directory archive is ambiguous")
        root = ET.fromstring(archive.read(names[0]))
    matches = []
    for row in root.findall("list"):
        stock_code = (row.findtext("stock_code") or "").strip()
        if stock_code == target:
            matches.append({
                "ticker": target,
                "corpCode": (row.findtext("corp_code") or "").strip(),
                "name": (row.findtext("corp_name") or "").strip(),
                "modifiedAt": (row.findtext("modify_date") or "").strip(),
            })
    if len(matches) != 1 or not matches[0]["corpCode"]:
        raise ValueError(f"OpenDART corporation directory did not uniquely identify {target}")
    return matches[0]


def collect_opendart_evidence(ticker: str, db: Path = DEFAULT_DB_PATH,
                              api_key: str | None = None) -> dict:
    key = (api_key if api_key is not None else os.environ.get("OPENDART_API_KEY", "")).strip()
    if not key:
        raise ValueError("OPENDART_API_KEY is required for Korean official-source discovery")
    directory = fetch_opendart(OPENDART_CORP_CODE_URL, key)
    issuer = resolve_opendart_stock(directory, ticker)
    company = fetch_opendart(OPENDART_COMPANY_URL, key, corp_code=issuer["corpCode"])
    profile = json.loads(company)
    if profile.get("status") != "000" or str(profile.get("corp_code")) != issuer["corpCode"]:
        raise ValueError(f"OpenDART company profile did not match {issuer['ticker']}")
    if str(profile.get("stock_code", "")).zfill(6) != issuer["ticker"]:
        raise ValueError(f"OpenDART company profile did not identify {issuer['ticker']}")

    database = ContentDatabase(db)
    database.initialize()
    database.upsert_provider(
        "opendart", "OpenDART", "https://opendart.fss.or.kr/"
    )
    public_company_url = f"{OPENDART_COMPANY_URL}?corp_code={issuer['corpCode']}"
    database.upsert_provider_fund(
        "opendart", issuer["ticker"], public_company_url, "regulator_company_profile"
    )
    before = database.summary()["source_documents"]
    for source_type, url, content in (
        ("opendart_corporation_directory", OPENDART_CORP_CODE_URL, directory),
        ("opendart_company_profile", public_company_url, company),
    ):
        database.add_source_document(SourceDocument(
            provider_slug="opendart",
            source_url=url,
            source_type=source_type,
            content=content,
            metadata={
                "ticker": issuer["ticker"], "corpCode": issuer["corpCode"],
                "name": issuer["name"], "modifiedAt": issuer["modifiedAt"],
            },
        ))
    added = database.summary()["source_documents"] - before
    return {
        "source": "opendart",
        "ticker": issuer["ticker"],
        "corpCode": issuer["corpCode"],
        "issuerName": issuer["name"],
        "documents": 2,
        "addedSources": added,
        "canonicalEventsCreated": 0,
        "status": "evidence_collected",
    }
def collect_official_evidence(ticker: str, market: str | None,
                              db: Path = DEFAULT_DB_PATH) -> dict:
    normalized_market = (market or "").strip().upper()
    if normalized_market in US_MARKETS:
        return collect_sec_evidence(ticker, db)
    if normalized_market in KOREAN_MARKETS:
        return collect_opendart_evidence(ticker, db)
    raise ValueError(f"official-source discovery is not supported for market {normalized_market or 'unknown'}")
