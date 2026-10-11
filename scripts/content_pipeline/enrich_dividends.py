"""Accumulate external evidence and audit dividends without overwriting the ledger.

Search results are discovery candidates, never financial facts. Provider-specific
parsers supply official observations; Yahoo supplies independent amount evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.models import SourceDocument, utc_now_iso
from scripts.content_pipeline.providers import PROVIDERS, SourceCandidate
from scripts.content_pipeline.investing_evidence import parse_investing
from scripts.content_pipeline.seekingalpha_evidence import parse_seekingalpha

RULE_VERSION = "dividend-evidence-v1"
USER_AGENT = "YieldloomDividendAudit/1.0"


def read_url(url, headers=None):
    request = Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urlopen(request, timeout=25) as response:
        return response.read()


def positive_decimal(value):
    try:
        number = Decimal(str(value))
        return number if number.is_finite() and number > 0 else None
    except (InvalidOperation, ValueError):
        return None


def parse_yahoo(payload, ticker, expected_symbol, expected_currency):
    results = payload.get("chart", {}).get("result") or []
    if not results:
        raise ValueError("Yahoo returned no chart result")
    chart = results[0]
    meta = chart.get("meta", {})
    if str(meta.get("symbol", "")).upper() != expected_symbol.upper():
        raise ValueError("Yahoo symbol does not match requested security")
    currency = meta.get("currency")
    if not currency or (expected_currency and currency != expected_currency):
        raise ValueError("Yahoo currency does not match security metadata")
    exchange_zone = ZoneInfo(meta["exchangeTimezoneName"])
    observations = []
    for row in (chart.get("events", {}).get("dividends") or {}).values():
        amount = positive_decimal(row.get("amount"))
        if amount is None:
            continue
        ex_date = datetime.fromtimestamp(int(row["date"]), exchange_zone).date().isoformat()
        observations.append({"ticker": ticker, "ex_date": ex_date,
                             "amount_raw": str(amount), "currency": currency, "raw": row})
    return observations, list((chart.get("events", {}).get("splits") or {}).values())


def compare_event(event, observations, splits=()):
    """Compare one exact ex-date; never shift dates or silently adjust splits."""
    candidates = [row for row in observations if row["ex_date"] == event["ex_date"]]
    if not candidates:
        return {"status": "missing_external", "fields": {"ex_date": "missing"}}
    if len(candidates) != 1:
        return {"status": "ambiguous", "fields": {"ex_date": "duplicate"}}
    row = candidates[0]
    fields = {"ex_date": "matched", "currency": "matched" if event["currency"] == row["currency"] else "mismatch"}
    official, external = positive_decimal(event["distribution_per_share"]), positive_decimal(row["amount_raw"])
    if official is None or external is None:
        return {"status": "invalid_amount", "fields": fields}
    # Half of the less precise source's last decimal digit, bounded to avoid
    # accepting coarse values (e.g. 1 vs 1.4) as a match.
    precision = min(-official.as_tuple().exponent, -external.as_tuple().exponent)
    tolerance = min(Decimal("0.00005"), Decimal(5).scaleb(-precision - 1))
    delta = abs(official - external)
    fields["amount"] = "matched" if delta <= tolerance else "mismatch"
    for field in ("record_date", "payable_date"):
        fields[field] = ("matched" if row[field] == event.get(field) else "mismatch") if row.get(field) and event.get(field) else "not_available"
    split_after = any(datetime.fromtimestamp(int(split["date"]), timezone.utc).date().isoformat() >= event["ex_date"] for split in splits)
    status = "matched" if all(value != "mismatch" for value in fields.values()) else "mismatch"
    if split_after and fields["amount"] == "mismatch":
        status = "split_basis_unresolved"
    return {"status": status, "fields": fields, "amountDelta": str(delta), "tolerance": str(tolerance),
            "coverage": "amount_and_ex_date_only" if row.get("source_provider") == "yahoo" else "official_document"}


def search_candidates(ticker, adapter, fetch=read_url):
    key = os.environ.get("BRAVE_SEARCH_API_KEY", "").strip()
    if not key:
        return [], "not_configured"
    host = urlparse(adapter.official_homepage).hostname
    query = f'site:{host} "{ticker}" dividend distribution'
    url = "https://api.search.brave.com/res/v1/web/search?" + urlencode({"q": query, "count": 5})
    payload = json.loads(fetch(url, {"X-Subscription-Token": key, "Accept": "application/json"}))
    urls = []
    for row in payload.get("web", {}).get("results", []):
        candidate = row.get("url", "")
        try:
            adapter.validate_url(candidate)
        except (ValueError, AttributeError):
            continue
        if candidate not in urls:
            urls.append(candidate)
    return urls, "searched"


def store_document(database, provider, url, content, raw_dir, source_type, metadata=None):
    digest = hashlib.sha256(content).hexdigest()
    target = raw_dir / "verification" / provider / digest
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(content)
    document = SourceDocument(provider, url, source_type, content, local_path=str(target), metadata=metadata or {})
    return document, database.add_source_document(document)


def record_audit(database, ticker, event, source_id, result, observation_id=None):
    with database.connect() as connection:
        connection.execute("""INSERT OR IGNORE INTO dividend_verification_results
            (ticker, event_id, observation_id, source_document_id, rule_version, status, details_json, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", (
            ticker, event.get("id"), observation_id, source_id, RULE_VERSION, result["status"],
            json.dumps({"event": event, **result}, ensure_ascii=False, sort_keys=True), utc_now_iso(),
        ))


def enrich(database, nav_path, raw_dir, *, tickers=None, provider=None, limit=50, search_limit=5, fetch=read_url,
           sources_path=Path("data-v2/verification-sources.json"), reference_limit=5):
    database.initialize()
    nav = json.loads(nav_path.read_text(encoding="utf-8"))["nav"]
    metadata = {row["symbol"].upper(): row for row in nav}
    sources = json.loads(sources_path.read_text(encoding="utf-8")) if sources_path.exists() else {}
    with database.connect() as connection:
        events = [dict(row) for row in connection.execute("SELECT * FROM distribution_events WHERE verification_status != 'rejected'")]
        last = {row["ticker"]: row["last_checked_at"] for row in connection.execute("SELECT * FROM dividend_verification_targets")}
    by_ticker = {}
    for event in events:
        by_ticker.setdefault(event["ticker"], []).append(event)
    universe = set(metadata) | set(by_ticker)
    if provider:
        universe &= {row["ticker"] for row in events if row["provider_slug"] == provider}
    if tickers:
        universe &= {ticker.upper() for ticker in tickers}
    selected = sorted(universe, key=lambda ticker: (last.get(ticker, ""), ticker))[:limit]
    report = {"ruleVersion": RULE_VERSION, "checkedAt": utc_now_iso(), "universeCount": len(universe),
              "selectedCount": len(selected), "searchConfigured": bool(os.environ.get("BRAVE_SEARCH_API_KEY")), "tickers": []}
    searches = 0
    reference_fetches = 0
    for ticker in selected:
        row = metadata.get(ticker, {})
        canonical = by_ticker.get(ticker, [])
        result = {"ticker": ticker, "comparisons": [], "officialCandidates": [], "errors": []}
        try:
            symbol = row.get("yfSymbol", ticker)
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}?" + urlencode({"range": "5y", "interval": "1d", "events": "div,splits"})
            content = fetch(url)
            observations, splits = parse_yahoo(json.loads(content), ticker, symbol, row.get("currency"))
            # Keep evidence even when no matching official event exists.
            database.upsert_provider("yahoo-evidence", "Yahoo comparison evidence", "https://finance.yahoo.com")
            _, source_id = store_document(database, "yahoo-evidence", url, content, raw_dir, "yahoo_chart")
            ids = {}
            for observation in observations:
                observation.update(source_provider="yahoo", source_class="public_aggregator", source_url=url,
                                   content_sha256=hashlib.sha256(content).hexdigest(), verification_status="third_party_only")
                ids[observation["ex_date"]] = database.add_distribution_observation(observation)
            for event in canonical:
                result_row = compare_event(event, observations, splits)
                result["comparisons"].append({"eventId": event["id"], **result_row})
                record_audit(database, ticker, event, source_id, result_row, ids.get(event["ex_date"]))
            official_dates = {event["ex_date"] for event in canonical}
            for observation in observations:
                if observation["ex_date"] not in official_dates:
                    record_audit(database, ticker, {"ex_date": observation["ex_date"]}, source_id,
                                 {"status": "missing_official", "observation": observation}, ids[observation["ex_date"]])
            result["observationCount"] = len(observations)
            result["missingOfficialCount"] = len({ob["ex_date"] for ob in observations} - official_dates)
            # Yahoo is evidence, not a replacement for a missing official ledger.
        except Exception as error:
            result["errors"].append({"source": "yahoo", "type": type(error).__name__})

        investing = sources.get("investing", {}).get(ticker)
        if investing:
            try:
                if row.get("currency") and row["currency"] != investing["currency"]:
                    raise ValueError("Registry currency mismatch")
                content = fetch(investing["url"])
                investing_rows = parse_investing(content, ticker, investing)
                database.upsert_provider("investing-evidence", "Investing comparison evidence", "https://kr.investing.com")
                _, source_id = store_document(database, "investing-evidence", investing["url"], content, raw_dir, "investing_dividends")
                for observation in investing_rows:
                    if positive_decimal(observation["amount_raw"]) is None: continue
                    observation.update(source_provider="investing", source_class="public_aggregator", source_url=investing["url"],
                                       content_sha256=hashlib.sha256(content).hexdigest(), verification_status="third_party_only")
                    observation_id = database.add_distribution_observation(observation)
                    matching = [event for event in canonical if event["ex_date"] == observation["ex_date"]]
                    if not matching:
                        record_audit(database, ticker, {"ex_date": observation["ex_date"]}, source_id,
                                     {"status": "missing_official", "observation": observation}, observation_id)
                    for event in matching:
                        compared = compare_event(event, [observation])
                        compared["coverage"] = "amount_ex_date_and_payable_date"
                        result["comparisons"].append({"source": "investing", "eventId": event["id"], **compared})
                        record_audit(database, ticker, event, source_id, compared, observation_id)
                result["investingObservationCount"] = len(investing_rows)
            except Exception as error:
                result["errors"].append({"source": "investing", "type": type(error).__name__})
        else:
            result["investingStatus"] = "unmapped_security"

        # Seeking Alpha has stable ticker URLs, but only map known US/USD
        # securities; never infer identity for overseas listings from a ticker.
        seeking_url = f"https://seekingalpha.com/symbol/{quote(ticker, safe='')}/dividends/history"
        if row.get('currency') == 'USD' and row.get('market') in {'NYSE', 'NASDAQ', 'NYSEARCA', 'NYSEAMERICAN', 'AMEX'} and reference_fetches < reference_limit:
            reference_fetches += 1
            result['seekingAlphaUrl'] = seeking_url
            try:
                content = fetch(seeking_url)
                seeking_rows = parse_seekingalpha(content, ticker, seeking_url, row['currency'])
                database.upsert_provider('seekingalpha-evidence', 'Seeking Alpha comparison evidence', 'https://seekingalpha.com')
                _, source_id = store_document(database, 'seekingalpha-evidence', seeking_url, content, raw_dir, 'seekingalpha_dividends')
                for observation in seeking_rows:
                    if positive_decimal(observation['amount_raw']) is None: continue
                    observation.update(source_provider='seekingalpha', source_class='public_aggregator', source_url=seeking_url,
                                       content_sha256=hashlib.sha256(content).hexdigest(), verification_status='third_party_only')
                    observation_id = database.add_distribution_observation(observation)
                    matching = [event for event in canonical if event['ex_date'] == observation['ex_date']]
                    if not matching:
                        record_audit(database, ticker, {'ex_date': observation['ex_date']}, source_id,
                                     {'status': 'missing_official', 'observation': observation}, observation_id)
                    for event in matching:
                        compared = compare_event(event, [observation])
                        compared['coverage'] = 'available_table_fields'
                        result['comparisons'].append({'source': 'seekingalpha', 'eventId': event['id'], **compared})
                        record_audit(database, ticker, event, source_id, compared, observation_id)
                result['seekingAlphaObservationCount'] = len(seeking_rows)
            except Exception as error:
                result['errors'].append({'source': 'seekingalpha', 'type': type(error).__name__})
        else:
            result['seekingAlphaStatus'] = 'ineligible_or_budget_exhausted'

        needs_supplement = bool(result["errors"] or result.get("missingOfficialCount") or any(item["status"] != "matched" for item in result["comparisons"]) or any(event["verification_status"] == "needs_review" for event in canonical))
        adapters = {event["provider_slug"] for event in canonical} & set(PROVIDERS)
        for slug in sorted(adapters):
            if not needs_supplement or searches >= search_limit:
                break
            adapter = PROVIDERS[slug]()
            try:
                urls, status = search_candidates(ticker, adapter, fetch)
                result["searchStatus"] = status
                if status == "searched":
                    searches += 1
                for url in urls[:2]:
                    candidate = {"url": url, "status": "discovered"}
                    result["officialCandidates"].append(candidate)
                    if urlparse(url).path.lower().endswith(".pdf"):
                        # No generic PDF table guessing; preserve for a typed adapter.
                        content = fetch(url)
                        _, source_id = store_document(database, slug, url, content, raw_dir, "discovered_official_pdf")
                        candidate.update(status="parser_required", sourceDocumentId=source_id)
                        continue
                    document = adapter.fetch(SourceCandidate(url, "search_official", metadata={"ticker": ticker}))
                    document, source_id = store_document(database, slug, url, document.content, raw_dir, "search_official", document.metadata)
                    parsed = [event for event in adapter.parse(document) if event.ticker == ticker]
                    candidate["status"] = "parsed" if parsed else "no_matching_security"
                    for event in parsed:
                        observation = {"ticker": ticker, "ex_date": event.ex_date, "amount_raw": event.distribution_per_share,
                                       "currency": event.currency, "record_date": event.record_date, "payable_date": event.payable_date,
                                       "source_provider": slug + "-supplement", "source_class": "issuer_official", "source_url": url,
                                       "content_sha256": document.content_sha256, "verification_status": "needs_review"}
                        observation_id = database.add_distribution_observation(observation)
                        for target in canonical:
                            if target["ex_date"] == event.ex_date:
                                compared = compare_event(target, [observation])
                                compared["independentSource"] = url != target["official_url"]
                                record_audit(database, ticker, target, source_id, compared, observation_id)
            except Exception as error:
                result["errors"].append({"source": slug, "type": type(error).__name__})
        result["officialDiscoveryStatus"] = result.get("searchStatus", "no_official_adapter" if not adapters else "not_needed_or_budget_exhausted")
        with database.connect() as connection:
            connection.execute("""INSERT INTO dividend_verification_targets(ticker, last_checked_at, report_json)
                VALUES (?, ?, ?) ON CONFLICT(ticker) DO UPDATE SET last_checked_at=excluded.last_checked_at, report_json=excluded.report_json""",
                (ticker, utc_now_iso(), json.dumps(result, ensure_ascii=False)))
        report["tickers"].append(result)
        time.sleep(0.2)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--nav", type=Path, default=Path("public/nav.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("var/content-studio/raw"))
    parser.add_argument("--output", type=Path, default=Path("var/content-studio/dividend-verification.json"))
    parser.add_argument("--ticker", action="append")
    parser.add_argument("--provider", choices=sorted(PROVIDERS))
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--search-limit", type=int, default=5)
    parser.add_argument("--sources", type=Path, default=Path("data-v2/verification-sources.json"))
    parser.add_argument("--reference-limit", type=int, default=5)
    args = parser.parse_args()
    if args.limit < 1 or args.search_limit < 0 or args.reference_limit < 0:
        parser.error("limit must be positive and search-limit nonnegative")
    report = enrich(ContentDatabase(args.db), args.nav, args.raw_dir, tickers=args.ticker, provider=args.provider,
                    limit=args.limit, search_limit=args.search_limit, sources_path=args.sources, reference_limit=args.reference_limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"selected": report["selectedCount"], "universe": report["universeCount"],
                      "errors": sum(len(row["errors"]) for row in report["tickers"]), "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
