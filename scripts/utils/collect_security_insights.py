"""Collect and accumulate ROC and useful US stock/ETF data.

This is an observation pipeline. It cannot publish or overwrite the official
core dividend ledger, and it never turns missing fields into zero values.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.content_pipeline.security_insights import COLLECTOR_VERSION, collect_security, holdings_overlap
from scripts.content_pipeline.tax_character import (
    collect_pdf, discover_tax_documents, immutable_bytes, legacy_roc, now_iso, persist_observations,
)

DEFAULT_OUTPUT = ROOT / "var/data-management/security-insights/latest.json"


def load_universe(stock_catalog: Path, core_catalog: Path) -> list[str]:
    tickers = set()
    for path in (stock_catalog, core_catalog):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for row in payload.get("instruments", []):
            key = str(row.get("symbol") or "").upper().replace(".", "-")
            if row.get("currency") == "USD" and row.get("active") is not False and re.fullmatch(r"[A-Z0-9][A-Z0-9-]{0,11}", key):
                tickers.add(key)
    return sorted(tickers)


def update_summary(report: dict) -> None:
    rows = list(report["securities"].values())
    roc = report["rocObservations"]
    report["summary"] = {
        "targetSecurities": len(report["universeSymbols"]), "observedSecurities": len(rows),
        "collected": sum(row["status"] == "collected" for row in rows),
        "partial": sum(row["status"] == "partial" for row in rows),
        "unavailable": sum(row["status"] == "unavailable" for row in rows),
        "ineligible": sum(row["status"] == "ineligible" for row in rows),
        "rocObservations": len(roc), "estimatedRoc": sum(r["classificationStatus"] == "estimated" for r in roc),
        "finalRoc": sum(r["classificationStatus"] == "final" for r in roc),
        "unclassifiedRoc": sum(r["classificationStatus"] == "unclassified" for r in roc),
        "withTotalReturn": sum(row.get("performance", {}).get("totalReturn1Y", {}).get("value") is not None for row in rows),
        "withTTMDividends": sum(row.get("performance", {}).get("ttmDividendPerShare", {}).get("value") is not None for row in rows),
        "withCashFlowCoverage": sum(row.get("dividendCapacity", {}).get("fcfPayoutRatio", {}).get("value") is not None for row in rows),
        "withExpenseRatio": sum(row.get("fund", {}).get("expenseRatio", {}).get("value") is not None for row in rows),
        "withOfficialNavHistory": sum(row.get("navHistory", {}).get("status") == "available" for row in rows),
    }


def save(report: dict, output: Path) -> None:
    update_summary(report)
    report["updatedAt"] = now_iso()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(output)


def archive(report: dict, root: Path) -> None:
    content = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
    immutable_bytes(root / "snapshots" / report["asOfDate"], content, ".json")


def compact_row(row: dict) -> dict:
    """Keep full series in the immutable per-ticker observation, not every checkpoint."""
    result = dict(row)
    for section in ("quote", "fund", "performance", "dividendCapacity"):
        if isinstance(result.get(section), dict):
            result[section] = {key: (dict(value, asOfDate=value.get("asOfDate"))
                                    if isinstance(value, dict) and "value" in value else value)
                               for key, value in result[section].items()}
    for section in ("fund", "navHistory", "dividendCapacity"):
        if result.get(section, {}).get("error") and result.get("status") == "collected":
            result["status"] = "partial"
    history = result.pop("history", None)
    if history is not None:
        result["historyRowCounts"] = {key: len(value) for key, value in history.items()}
    nav = result.get("navHistory")
    if nav and "rows" in nav:
        result["navHistory"] = {key: value for key, value in nav.items() if key != "rows"}
        result["navHistory"]["rowCount"] = len(nav["rows"])
    performance = result.get("performance", {})
    price_date = performance.get("price", {}).get("asOfDate")
    if price_date:
        observed_date = datetime.fromisoformat(result["collectedAt"]).date()
        quoted_date = datetime.fromisoformat(price_date).date()
        performance["freshness"] = "stale" if (observed_date - quoted_date).days > 7 else "current"
    return result


def add_tax_observations(report: dict, selected: set[str], content_dir: Path,
                         extra_documents: dict[str, list[str]], root: Path) -> None:
    rows = legacy_roc(content_dir, selected)
    for ticker in sorted((selected & {"SPYI", "QQQI", "IWMI"}) | set(extra_documents)):
        links, warning = discover_tax_documents(ticker)
        if warning:
            report["taxSources"].append({"ticker": ticker, "status": "index_unavailable", "warning": warning})
        for url in dict.fromkeys(links + extra_documents.get(ticker, [])):
            try:
                parsed = collect_pdf(ticker, url, root / "raw")
                rows.extend(parsed)
                report["taxSources"].append({"ticker": ticker, "sourceUrl": url, "status": "collected", "observations": len(parsed)})
            except Exception as exc:
                report["taxSources"].append({"ticker": ticker, "sourceUrl": url, "status": "unavailable", "error": str(exc)})
    current = {row["observationId"]: row for row in report["rocObservations"]}
    for row in persist_observations(rows, root / "roc"):
        previous = current.get(row["observationId"])
        row["firstObservedAt"] = previous.get("firstObservedAt", previous["observedAt"]) if previous else row.get("firstObservedAt", row["observedAt"])
        current[row["observationId"]] = row
    report["rocObservations"] = sorted(current.values(), key=lambda row: (
        row["ticker"], row.get("payableDate") or row.get("throughPaymentDate") or row.get("exDate") or "", row["classificationStatus"]))


def attach_context(row: dict, roc: list[dict], discovery: dict, content_dir: Path) -> None:
    ticker = row["symbol"]
    tax = [observation for observation in roc if observation["ticker"] == ticker]
    row["roc"] = {"status": "available" if tax else "not_disclosed",
                  "observationIds": [observation["observationId"] for observation in tax]}
    if ticker in discovery.get("_by_symbol", {}):
        row["dividendEtfs"] = discovery["_by_symbol"][ticker].get("etfHoldings", [])
    path = content_dir / f"distribution-ticker-{ticker.lower()}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        # Only explicitly approved, issuer-originated records feed this calendar.
        records = [r for r in payload.get("history", [])
                   if r.get("verification_status") in {"official", "cross_checked"}
                   and r.get("source_class") == "issuer_official" and not r.get("forecasted")]
        row["officialDistributionCalendar"] = [{
            "exDate": r.get("ex_date"), "payableDate": r.get("payable_date"),
            "declaredDate": r.get("declared_date"), "sourceUrl": r.get("official_url"),
            "status": "official", "sourceSnapshotDate": payload.get("generatedAt"),
        } for r in records]
        performance = row.get("performance", {})
        ttm = performance.get("ttmDividendPerShare", {})
        if ttm.get("value") == 0 and any(
            r.get("ex_date") and ttm.get("windowStart", "") < r["ex_date"] <= ttm.get("asOfDate", "")
            and float(r.get("distribution_per_share") or 0) > 0 for r in records
        ):
            performance["ttmDividendPerShare"] = {**ttm, "value": None, "status": "conflicting_sources"}
            performance["ttmDividendYield"] = {"value": None, "status": "conflicting_sources"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="ROC·총수익률·배당 증감·현금흐름·NAV·ETF 비용/유동성 수집")
    parser.add_argument("--symbol", action="append", default=[])
    parser.add_argument("--limit", type=int, default=0, help="0은 전체")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--stock-catalog", type=Path, default=ROOT / "public/us-dividend-stocks.json")
    parser.add_argument("--core-catalog", type=Path, default=ROOT / "data-v2/catalog-seed.json")
    parser.add_argument("--discovery", type=Path, default=ROOT / "var/data-management/us-dividend-discovery.json")
    parser.add_argument("--content-dir", type=Path, default=ROOT / "public/content-studio")
    parser.add_argument("--tax-document", action="append", default=[], metavar="ETF=HTTPS_PDF_URL")
    args = parser.parse_args(argv)
    if args.limit < 0 or not 1 <= args.workers <= 8 or args.delay < 0:
        parser.error("limit >= 0, workers 1~8, delay >= 0 required")
    selected = sorted({s.upper().replace(".", "-") for s in args.symbol}) if args.symbol else load_universe(args.stock_catalog, args.core_catalog)
    if any(not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{0,11}", ticker) for ticker in selected):
        parser.error("Invalid ticker")
    if args.limit:
        selected = selected[:args.limit]
    documents = {}
    for document in args.tax_document:
        ticker, separator, url = document.partition("=")
        ticker = ticker.upper()
        if not separator or not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{0,11}", ticker):
            parser.error("tax-document must be ETF=HTTPS_PDF_URL")
        if ticker not in selected:
            selected.append(ticker)
        documents.setdefault(ticker, []).append(url)
    root, today = args.output.parent, datetime.now(timezone.utc).date()
    report = {"schemaVersion": 1, "collectorVersion": COLLECTOR_VERSION,
              "asOfDate": today.isoformat(), "runState": "in_progress",
              "securities": {}, "rocObservations": [], "taxSources": [], "universeSymbols": selected}
    if args.output.exists():
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        if previous.get("schemaVersion") != 1:
            parser.error("Unsupported security insights report")
        archive(previous, root)
        report["rocObservations"] = previous.get("rocObservations", [])
        # Partial reruns retain other instruments instead of erasing accumulated data.
        report["securities"] = {key: compact_row(row) for key, row in previous.get("securities", {}).items()}
    discovery = json.loads(args.discovery.read_text(encoding="utf-8")) if args.discovery.exists() else {}
    discovery["_by_symbol"] = {s["symbol"]: s for s in discovery.get("stocks", [])}
    report["holdingsOverlap"] = holdings_overlap(discovery)
    add_tax_observations(report, set(selected), args.content_dir, documents, root)
    save(report, args.output)
    pending = [ticker for ticker in selected if not (args.resume and
        report["securities"].get(ticker, {}).get("collectorVersion") == COLLECTOR_VERSION and
        report["securities"].get(ticker, {}).get("collectedAt", "")[:10] == today.isoformat() and
        report["securities"][ticker].get("status") in {"collected", "ineligible"})]
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for offset in range(0, len(pending), args.workers):
                futures = {pool.submit(collect_security, ticker, today, root / "raw"): ticker
                           for ticker in pending[offset:offset + args.workers]}
                for future in as_completed(futures):
                    ticker = futures[future]
                    try:
                        row = future.result()
                        attach_context(row, report["rocObservations"], discovery, args.content_dir)
                    except Exception as exc:
                        row = {"symbol": ticker, "status": "unavailable", "collectedAt": now_iso(), "error": str(exc)}
                    content = (json.dumps(row, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
                    digest, path = immutable_bytes(root / "observations" / ticker, content, ".json")
                    row["observationId"], row["observationPath"] = digest, str(path)
                    report["securities"][ticker] = compact_row(row)
                completed = min(offset + args.workers, len(pending))
                if completed % 100 < args.workers or completed == len(pending):
                    save(report, args.output)
                    print(f"수집 {completed}/{len(pending)}: " + json.dumps(report["summary"]), flush=True)
                if args.delay and completed < len(pending):
                    time.sleep(args.delay)
        report["runState"] = "complete"
    except KeyboardInterrupt:
        report["runState"] = "interrupted"
        save(report, args.output)
        archive(report, root)
        return 130
    save(report, args.output)
    archive(report, root)
    print(f"Report: {args.output}")
    return 2 if report["summary"]["partial"] or report["summary"]["unavailable"] or any(
        row["status"] == "unavailable" for row in report["taxSources"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
