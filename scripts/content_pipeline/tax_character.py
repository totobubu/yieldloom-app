"""Auditable ROC observations, separate from the official dividend ledger.

19a estimates, fiscal-year totals and issuer Form 8937 payments never overwrite
one another. Missing disclosure is not zero. Decimal text preserves precision.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlparse

import pdfplumber
import requests
from bs4 import BeautifulSoup

ALLOWED_HOSTS = ("neosfunds.com", "yieldmaxetfs.com", "defianceetfs.com",
                 "graniteshares.com", "proshares.com", "ishares.com", "schwabassetmanagement.com")
# Official links reviewed 2026-10-14. Used when the issuer index cannot be read;
# these are dated documents, never presented as a newly published notice.
REVIEWED_DOCUMENTS = {
    "SPYI": [
        "https://neosfunds.com/wp-content/uploads/SPYI-19a-1-Notice-9.16.26-Confidential.pdf",
        "https://neosfunds.com/wp-content/uploads/NEOS-SP-500-R-High-Income-ETF-Form-8937-12.31.25.pdf",
    ],
    "QQQI": [
        "https://neosfunds.com/wp-content/uploads/QQQI-19a-1-Notice-9.16.26-Confidential.pdf",
        "https://neosfunds.com/wp-content/uploads/NEOS-Nasdaq-100-High-Income-ETF-Form-8937-12.31.25.pdf",
    ],
    "IWMI": [
        "https://neosfunds.com/wp-content/uploads/IWMI-19a-1-Notice-9.16.26-Confidential.pdf",
        "https://neosfunds.com/wp-content/uploads/NEOS-Russell-2000-High-Income-ETF-Form-8937-12.31.25.pdf",
    ],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def decimal_text(value) -> str:
    if isinstance(value, bool):
        raise ValueError("Boolean is not a tax amount")
    text = str(value).strip().replace("$", "").replace("%", "").replace(",", "")
    number = Decimal(text)
    if not number.is_finite():
        raise ValueError("Tax amount must be finite")
    return format(number, "f")


def validate_observation(row: dict) -> dict:
    total, percent = Decimal(row["distributionAmount"]), Decimal(row["rocPercent"])
    if not total.is_finite() or not percent.is_finite() or total <= 0 or not 0 <= percent <= 100:
        raise ValueError("Invalid ROC distribution or percentage")
    if row.get("rocAmount") is not None:
        amount = Decimal(row["rocAmount"])
        if not amount.is_finite() or not 0 <= amount <= total:
            raise ValueError("ROC amount is outside the distribution")
    return row


def immutable_bytes(root: Path, content: bytes, suffix: str) -> tuple[str, Path]:
    digest = hashlib.sha256(content).hexdigest()
    path = root / (digest + suffix)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != content:
            raise ValueError("Immutable observation hash mismatch")
    else:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(content)
        temporary.replace(path)
    return digest, path


def validate_source_url(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or not any(
        host == domain or host.endswith("." + domain) for domain in ALLOWED_HOSTS
    ):
        raise ValueError("ROC source must be an allowed HTTPS issuer URL")


def fetch_document(url: str) -> bytes:
    validate_source_url(url)
    with requests.get(url, timeout=30, stream=True, allow_redirects=False) as response:
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_content(64 * 1024):
            size += len(chunk)
            if size > 8 * 1024 * 1024:
                raise ValueError("Tax document exceeds 8 MiB")
            chunks.append(chunk)
        return b"".join(chunks)


def _date(text: str) -> str:
    for pattern in ("%B %d, %Y", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text.strip(), pattern).date().isoformat()
        except ValueError:
            pass
    raise ValueError("Unsupported tax document date")


def parse_roc_text(text: str, ticker: str, url: str, digest: str) -> list[dict]:
    validate_source_url(url)
    if not re.search(r"\b" + re.escape(ticker) + r"\b", text):
        raise ValueError("Tax document does not identify the requested ticker")
    common = {"ticker": ticker, "currency": "USD", "sourceUrl": url,
              "documentSha256": digest, "observedAt": now_iso(), "publishedAt": None}
    if re.search(r"19a[- ]?1", text, re.I):
        payable = re.search(r"payable\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})", text, re.I)
        record = re.search(r"record\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})", text, re.I)
        roc = re.search(r"Estimated\s+Return\s+of\s+Capital\s+\$?([\d.]+)\s+([\d.]+)%\s+\$?([\d.]+)\s+([\d.]+)%", text, re.I)
        total = re.search(r"Total\s*\(per\s+common\s+share\)\s+\$?([\d.]+)\s+100%\s+\$?([\d.]+)\s+100%", text, re.I)
        if not all((payable, roc, total)):
            raise ValueError("Unsupported 19a format; refusing to guess current/YTD columns")
        payment_date = _date(payable.group(1))
        observations = []
        for scope, amount, percent, distribution in (
            ("payment", roc[1], roc[2], total[1]),
            ("fiscal_year_to_date", roc[3], roc[4], total[2]),
        ):
            observations.append(validate_observation(common | {
                "classificationStatus": "estimated", "sourceType": "issuer_19a_notice", "scope": scope,
                "payableDate": payment_date if scope == "payment" else None,
                "throughPaymentDate": payment_date, "exDate": None,
                "recordDate": _date(record[1]) if record and scope == "payment" else None,
                "fiscalYearEnd": None, "taxYear": None,
                "distributionAmount": decimal_text(distribution), "rocAmount": decimal_text(amount),
                "rocPercent": decimal_text(percent), "rocAmountBasis": "issuer_published",
            }))
        return observations
    if re.search(r"(?:Form\s+8937|8937[\s\S]{0,80}Form)", text, re.I) and "Return of Capital" in text:
        fiscal = re.search(r"FYE\s+(\d{1,2}/\d{1,2}/\d{4})", text)
        if not fiscal or not re.search(r"Payable\s+Date\s+Total\s+Dividend\s+Return\s+of\s+Capital", text, re.I):
            raise ValueError("Form 8937 has no supported per-payment ROC attachment")
        # Some PDF fonts insert a space before the decimal point; do not round it.
        normalized = re.sub(r"(?<=\d)\s+(?=\.\d)", "", text)
        rows = re.findall(r"(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}/\d{1,2}/\d{4})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)%", normalized)
        if not rows:
            raise ValueError("Form 8937 per-payment rows were not found")
        return [validate_observation(common | {
            "classificationStatus": "final", "finalizationBasis": "issuer_form_8937",
            "sourceType": "issuer_form_8937", "scope": "payment",
            "recordDate": _date(record), "exDate": _date(ex_date), "payableDate": _date(payable),
            "fiscalYearEnd": _date(fiscal[1]), "taxYear": None,
            "distributionAmount": decimal_text(total), "rocAmount": decimal_text(amount),
            "rocPercent": decimal_text(percent), "rocAmountBasis": "issuer_published",
        }) for record, ex_date, payable, total, amount, percent in rows]
    raise ValueError("Unsupported ROC disclosure; no tax classification inferred")


def collect_pdf(ticker: str, url: str, raw_dir: Path) -> list[dict]:
    content = fetch_document(url)
    if not content.startswith(b"%PDF"):
        raise ValueError("Issuer document is not a PDF")
    digest, _ = immutable_bytes(raw_dir, content, ".pdf")
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    return parse_roc_text(text, ticker, url, digest)


def discover_tax_documents(ticker: str) -> tuple[list[str], str | None]:
    if ticker not in {"SPYI", "QQQI", "IWMI"}:
        return [], None
    url = f"https://neosfunds.com/{ticker.lower()}/"
    try:
        text = fetch_document(url).decode("utf-8")
        soup = BeautifulSoup(text, "html.parser")
        links = {urljoin(url, anchor["href"]) for anchor in soup.select("a[href]")
                 if re.search(r"(?:19a|8937).*\.pdf$", anchor["href"], re.I)}
        links = sorted(links | set(REVIEWED_DOCUMENTS.get(ticker, [])))
        for link in links:
            validate_source_url(link)
        return links, None
    except (requests.RequestException, ValueError, UnicodeError) as exc:
        return list(REVIEWED_DOCUMENTS.get(ticker, [])), f"Issuer index unavailable: {type(exc).__name__}"


def legacy_roc(directory: Path, selected: set[str]) -> list[dict]:
    observations = []
    for path in sorted(directory.glob("distribution-ticker-*.json")):
        content = path.read_bytes()
        payload = json.loads(content)
        for row in payload.get("history", []):
            ticker = str(row.get("ticker", payload.get("ticker", ""))).upper()
            if ticker not in selected or row.get("roc_percent") is None:
                continue
            url = row.get("official_url", "")
            try:
                validate_source_url(url)
                observation = validate_observation({
                    "ticker": ticker, "currency": row.get("currency", "USD"),
                    "classificationStatus": "unclassified", "scope": "payment",
                    "sourceType": "cached_issuer_distribution_table", "sourceUrl": url,
                    "projectionSha256": hashlib.sha256(content).hexdigest(), "documentSha256": None,
                    "observedAt": now_iso(), "publishedAt": None,
                    "payableDate": row.get("payable_date"), "exDate": row.get("ex_date"),
                    "recordDate": row.get("record_date"), "fiscalYearEnd": None, "taxYear": None,
                    "distributionAmount": decimal_text(row["distribution_per_share"]),
                    "rocPercent": decimal_text(row["roc_percent"]), "rocAmount": None,
                    "rocAmountBasis": "not_published", "legacyVerificationStatus": row.get("verification_status"),
                })
                observations.append(observation)
            except (ValueError, ArithmeticError, KeyError):
                continue
    return observations


def persist_observations(rows: list[dict], directory: Path) -> list[dict]:
    result = []
    for row in rows:
        # Observation time is not identity: repeat collection is idempotent,
        # changed source bytes or a corrected amount create a new revision.
        identity = {key: value for key, value in row.items() if key != "observedAt"}
        content = (json.dumps(identity, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
        digest = hashlib.sha256(content).hexdigest()
        path = directory / (digest + ".json")
        directory.mkdir(parents=True, exist_ok=True)
        if path.exists():
            stored = json.loads(path.read_text(encoding="utf-8"))
            if {key: value for key, value in stored.items() if key != "firstObservedAt"} != identity:
                raise ValueError("ROC observation identity mismatch")
            first_seen = stored.get("firstObservedAt", row["observedAt"])
        else:
            first_seen = row["observedAt"]
        # New records retain first-observation time; prior files stay intact.
        if not path.exists():
            stored = identity | {"firstObservedAt": first_seen}
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(stored, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            temporary.replace(path)
        result.append(row | {"firstObservedAt": first_seen, "observationId": digest, "observationPath": str(path)})
    return result
