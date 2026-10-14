"""Discover US dividend stocks and official dividend ETF equity holdings.

Writes a separate evidence report; failed dividend requests remain unverified.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import io
import json
import math
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
FUNDS = {
    "SCHD": "https://www.schwabassetmanagement.com/products/schd",
    "DGRO": "https://www.ishares.com/us/products/264623/ishares-core-dividend-growth-etf/latest-holdings.csv",
    "HDV": "https://www.ishares.com/us/products/239563/ishares-high-dividend-etf/latest-holdings.csv",
    "VYM": "https://investor.vanguard.com/investment-products/etfs/profile/vym",
    "VIG": "https://investor.vanguard.com/investment-products/etfs/profile/vig",
}
EXCHANGES = {"NASDAQ": "NASDAQ", "XNGS": "NASDAQ", "XNMS": "NASDAQ", "XNCM": "NASDAQ",
             "NYSE": "NYSE", "XNYS": "NYSE", "NYSE ARCA": "NYSEARCA", "ARCX": "NYSEARCA",
             "NYSE AMERICAN": "AMEX", "XASE": "AMEX", "BATS": "BATS"}


def symbol(value: str) -> str:
    return value.strip().upper().replace(".", "-")


def non_stock_security(name: str) -> bool:
    if re.search(r"\b(?:warrants?|rights)\b", name, re.I):
        return True
    # Listed partnership and depositary units can pay income; SPAC units bundle
    # shares with warrants and are not standalone dividend stocks.
    if re.search(r"\b(?:common|partnership|depositary) units\b|\blimited partnership\b|\bdepositary shares\b|\bunits?\b.{0,30}\bbeneficial interests?\b", name, re.I):
        return False
    return bool(re.search(r"\bunits\b|\bunit\b(?=\s*(?:,|each|consisting|representing))", name, re.I))


def parse_holdings(text: str) -> list[dict]:
    """Parse official Schwab/iShares CSVs and compatible local exports."""
    rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))
    as_of = None
    for index, row in enumerate(rows):
        if row and row[0].strip().lower() == "fund holdings as of" and len(row) > 1:
            as_of = datetime.strptime(row[1], "%b %d, %Y").date().isoformat()
        headers = [v.strip() for v in row]
        if ("Ticker" in headers or "Symbol" in headers) and "Name" in headers:
            break
    else:
        raise ValueError("No holdings CSV header found (HTML/error pages are not holdings)")
    result = []
    for row in rows[index + 1:]:
        if len(row) != len(headers):
            continue
        entry = dict(zip(headers, row))
        ticker = symbol(entry.get("Ticker", entry.get("Symbol", "")))
        market = EXCHANGES.get(entry.get("Exchange", "").strip().upper())
        if not re.fullmatch(r"[A-Z]{1,5}(?:-[A-Z])?", ticker) or not market:
            continue
        if entry.get("Asset Class", "Equity") != "Equity":
            continue
        if entry.get("Market Currency", entry.get("Currency", "USD")) != "USD":
            continue
        weight = entry.get("Weight (%)", entry.get("Percent of Assets", ""))
        try:
            weight = float(weight.replace(",", "").rstrip("%"))
        except ValueError:
            raise ValueError(f"Invalid holding weight for {ticker}: {weight}")
        if not math.isfinite(weight) or not 0 <= weight <= 100:
            raise ValueError(f"Invalid holding weight for {ticker}: {weight}")
        result.append({"symbol": ticker, "name": entry["Name"], "market": market,
                       "weightPercent": weight, "asOfDate": entry.get("As-Of-Date", as_of)})
    if not result:
        raise ValueError("No US-listed USD equity holdings found")
    return result


def fetch_text(url: str) -> str:
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.content.decode("utf-8-sig")


def collect_fund(ticker: str, local: Path | None) -> tuple[list[dict], str]:
    if local:
        return parse_holdings(local.read_text(encoding="utf-8-sig")), str(local.resolve())
    url = FUNDS[ticker]
    if ticker in {"VYM", "VIG"}:
        return collect_vanguard(ticker)
    text = fetch_text(url)
    if ticker == "SCHD":
        soup = BeautifulSoup(text, "html.parser")
        links = [a["href"] for a in soup.select("a[href]")
                 if re.search(r"SCHD_FundHoldings_.*\.CSV$", a["href"], re.I)]
        if not links:
            raise ValueError("Official SCHD holdings download link not found")
        url = urljoin(url, sorted(links)[-1])
        text = fetch_text(url)
    return parse_holdings(text), url


def collect_vanguard(ticker: str) -> tuple[list[dict], str]:
    """Read all pages of Vanguard's official holdings, then resolve US listings."""
    base_url = f"https://investor.vanguard.com/vmf/api/{ticker}/portfolio-holding/stock.json"
    url, start, entities, total, as_of = base_url, 1, [], None, None
    for _ in range(100):
        page = json.loads(fetch_text(url))
        rows = page["fund"]["entity"]
        if not isinstance(rows, list) or not rows:
            raise ValueError("Vanguard holdings page contained no rows")
        if total is None:
            total, as_of = int(page["size"]), page["asOfDate"][:10]
        elif total != int(page["size"]) or as_of != page["asOfDate"][:10]:
            raise ValueError("Vanguard holdings changed during pagination")
        entities.extend(rows)
        next_link = page.get("next", {}).get("href")
        if not next_link:
            break
        next_url = urlparse(next_link)
        query = parse_qs(next_url.query)
        next_start = int(query["start"][0])
        if next_url.hostname != "api.vanguard.com" or not next_url.path.endswith(f"/fund/{ticker}/portfolio-holding/stock"):
            raise ValueError("Unexpected Vanguard pagination link")
        if next_start != start + len(rows):
            raise ValueError("Vanguard holdings pagination stalled or skipped rows")
        start = next_start
        # Preserve HTTPS and the same official public endpoint, not the HTTP self link.
        url = f"{base_url}?start={start}&count=500"
    else:
        raise ValueError("Vanguard holdings exceeded the page limit")
    if len(entities) != total:
        raise ValueError("Incomplete Vanguard holdings response")
    markets = {row["symbol"]: row["market"] for row in listed_stocks()}
    result, seen = [], set()
    for row in entities:
        key = symbol(row.get("ticker", ""))
        if key not in markets:
            continue
        if key in seen:
            raise ValueError("Duplicate Vanguard equity holding: " + key)
        seen.add(key)
        weight = float(row["percentWeight"])
        if not math.isfinite(weight) or not 0 <= weight <= 100:
            raise ValueError("Invalid Vanguard holding weight: " + key)
        result.append({"symbol": key, "name": row["longName"], "market": markets[key],
                       "weightPercent": weight, "asOfDate": row.get("asOfDate", as_of)[:10]})
    if not result:
        raise ValueError("No US-listed Vanguard equity holdings found")
    return result, base_url


def listed_stocks() -> list[dict]:
    """Use Nasdaq Trader directories; exclude ETFs and test securities."""
    result = []
    for filename in ("nasdaqlisted.txt", "otherlisted.txt"):
        url = "https://www.nasdaqtrader.com/dynamic/SymDir/" + filename
        rows = csv.DictReader(io.StringIO(fetch_text(url)), delimiter="|")
        for row in rows:
            ticker = symbol(row.get("Symbol") or row.get("ACT Symbol") or "")
            market = "NASDAQ" if filename == "nasdaqlisted.txt" else {
                "N": "NYSE", "A": "AMEX", "P": "NYSEARCA", "Z": "BATS", "V": "BATS"
            }.get(row.get("Exchange"))
            if row.get("ETF") != "N" or row.get("Test Issue") != "N" or not market:
                continue
            if non_stock_security(row.get("Security Name", "")):
                continue
            if re.fullmatch(r"[A-Z]{1,5}(?:-[A-Z])?", ticker):
                result.append({"symbol": ticker, "name": row["Security Name"],
                               "market": market, "sourceUrl": url})
    if not result:
        raise ValueError("US stock directories contained no eligible stocks")
    return result


def verify_dividends(ticker: str, today: date) -> dict:
    """Yahoo chart dividends use ex-dates, not confirmed cash payment dates."""
    from yfinance.data import YfData

    start = today - timedelta(days=365)
    source_url = "https://query2.finance.yahoo.com/v8/finance/chart/" + ticker
    result = YfData().get_raw_json(source_url, params={
        "period1": int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp()),
        "period2": int(datetime.combine(today + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp()),
        "interval": "1mo", "events": "div", "includeAdjustedClose": False,
    }, timeout=20)
    chart = result.get("chart", {})
    if chart.get("error") or not chart.get("result"):
        raise ValueError("Dividend history unavailable")
    data = chart["result"][0]
    meta = data.get("meta", {})
    if symbol(meta.get("symbol", "")) != symbol(ticker):
        raise ValueError("Chart symbol does not match requested stock")
    if not data.get("timestamp"):
        raise ValueError("Dividend history unavailable")
    if meta.get("instrumentType") != "EQUITY" or meta.get("currency") != "USD":
        return {"status": "ineligible", "reason": "Not a USD equity",
                "instrumentType": meta.get("instrumentType"), "currency": meta.get("currency")}
    events = []
    zone = ZoneInfo(meta["exchangeTimezoneName"])
    for event in data.get("events", {}).get("dividends", {}).values():
        ex_date = datetime.fromtimestamp(event["date"], zone).date()
        amount = float(event["amount"])
        if not math.isfinite(amount):
            raise ValueError("Invalid dividend amount")
        if start <= ex_date <= today and amount > 0:
            events.append({"exDate": ex_date.isoformat(), "amount": amount})
    events.sort(key=lambda event: event["exDate"])
    return {"status": "verified" if events else "no_recent_dividends",
            "source": "Yahoo Finance", "sourceUrl": source_url,
            "dateBasis": "ex-dividend date", "asOfDate": today.isoformat(),
            "lookbackStart": start.isoformat(), "currency": meta["currency"],
            "longName": meta.get("longName") or meta.get("shortName"),
            "instrumentType": meta["instrumentType"],
            "classification": "regular_vs_special_unclassified", "events": events}


def existing_symbols(nav_dir: Path) -> set[str]:
    result = set()
    for path in nav_dir.rglob("*.json"):
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, list):
            result.update(symbol(row["symbol"]) for row in value if row.get("symbol"))
    return result


def save_report(report: dict, output: Path, existing: set[str]) -> None:
    stocks = report["stocks"]
    verified = [s["symbol"] for s in stocks if s["dividendVerification"]["status"] == "verified"]
    report["newVerifiedSymbols"] = [s for s in verified if s not in existing]
    statuses = [s["dividendVerification"]["status"] for s in stocks]
    report["summary"] = {"candidates": len(stocks),
        "newCandidates": sum(s["symbol"] not in existing for s in stocks),
        "verifiedDividendStocks": len(verified),
        "newVerifiedDividendStocks": len(report["newVerifiedSymbols"]),
        "verificationErrors": statuses.count("unavailable"),
        "notChecked": statuses.count("not_checked"),
        "noRecentDividends": statuses.count("no_recent_dividends"),
        "ineligible": statuses.count("ineligible")}
    report["updatedAt"] = datetime.now(timezone.utc).isoformat()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)


def archive_report(report: dict, directory: Path) -> Path:
    """Preserve immutable dated observations, including individual dividend events."""
    as_of = report.get("verificationAsOfDate") or report.get("collectedAt", "")[:10]
    date.fromisoformat(as_of)
    content = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    digest = hashlib.sha256(content).hexdigest()
    destination = directory / as_of / f"{digest}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.read_bytes() != content:
            raise ValueError("Discovery archive content mismatch")
    else:
        # An interrupted archive write never exposes a partial JSON snapshot.
        temporary = destination.with_suffix(".tmp")
        temporary.write_bytes(content)
        temporary.replace(destination)
    return destination


def refresh_etfs(report: dict, tickers: list[str], local: dict[str, Path], existing: set[str]) -> None:
    """Refresh ETF membership while retaining the completed stock verification."""
    stocks = {stock["symbol"]: stock for stock in report["stocks"]}
    sources = {source["source"]: source for source in report["sources"]}
    for ticker in dict.fromkeys(tickers):
        try:
            holdings, source_url = collect_fund(ticker, local.get(ticker))
            # A successfully fetched full file replaces only this ETF's old membership.
            for stock in stocks.values():
                stock["etfHoldings"] = [h for h in stock.get("etfHoldings", []) if h["etf"] != ticker]
            for holding in holdings:
                key = holding["symbol"]
                stock = stocks.setdefault(key, {"symbol": key, "name": holding["name"],
                    "market": holding["market"], "etfHoldings": [], "stockDirectorySources": [],
                    "alreadyTracked": key in existing, "dividendVerification": {"status": "not_checked"}})
                stock["etfHoldings"].append({"etf": ticker, "sourceUrl": source_url,
                    "weightPercent": holding["weightPercent"], "asOfDate": holding["asOfDate"]})
            sources[ticker] = {"source": ticker, "status": "collected", "count": len(holdings),
                              "sourceUrl": source_url, "coverage": "full_official_holdings"}
        except (requests.RequestException, ValueError, KeyError, OSError) as exc:
            sources[ticker] = {"source": ticker, "status": "failed", "error": str(exc)}
    report["sources"] = list(sources.values())
    report["stocks"] = sorted(stocks.values(), key=lambda s: (s["symbol"] in existing,
                               not bool(s["etfHoldings"]), s["symbol"]))


def verify_report(report: dict, output: Path, existing: set[str], today: date,
                  limit: int, workers: int, delay: float) -> None:
    pending = [s for s in report["stocks"]
               if s["dividendVerification"]["status"] in {"not_checked", "unavailable"}]
    if limit != -1:
        pending = pending[:limit]
    report["runState"] = "in_progress"
    save_report(report, output, existing)
    completed = 0
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            # Bounded batches allow checkpointing and avoid an unbounded request queue.
            for offset in range(0, len(pending), workers):
                futures = {pool.submit(verify_dividends, s["symbol"], today): s
                           for s in pending[offset:offset + workers]}
                for future in as_completed(futures):
                    stock = futures[future]
                    try:
                        verification = future.result()
                    except Exception as exc:
                        verification = {"status": "unavailable", "error": str(exc),
                                        "asOfDate": today.isoformat()}
                    verification["checkedAt"] = datetime.now(timezone.utc).isoformat()
                    stock["dividendVerification"] = verification
                    completed += 1
                save_report(report, output, existing)
                if completed % 100 < workers or completed == len(pending):
                    print(f"검증 {completed}/{len(pending)}: " + json.dumps(report["summary"]), flush=True)
                if delay and offset + workers < len(pending):
                    time.sleep(delay)
        report["runState"] = "complete"
    except KeyboardInterrupt:
        report["runState"] = "interrupted"
        save_report(report, output, existing)
        raise
    save_report(report, output, existing)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="미국 배당주 및 배당 ETF 편입 종목 수집")
    parser.add_argument("--etf", action="append", choices=FUNDS)
    parser.add_argument("--holdings-csv", action="append", default=[], metavar="ETF=PATH")
    parser.add_argument("--all-us", action="store_true", help="미국 상장 주식 전체를 후보에 추가")
    parser.add_argument("--verify-limit", type=int, default=0,
                        help="배당 검증 종목 수 (기본 0: 후보 수집만, -1: 전체)")
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--workers", type=int, default=4, help="동시 조회 수 (1~8)")
    parser.add_argument("--resume", action="store_true", help="기존 보고서의 미검증·실패 종목부터 재개")
    parser.add_argument("--refresh-etfs", action="store_true", help="재개 시 ETF 편입 자료 갱신")
    parser.add_argument("--output", type=Path, default=ROOT / "var/data-management/us-dividend-discovery.json")
    parser.add_argument("--archive-dir", type=Path, default=ROOT / "var/data-management/us-dividend-discovery-archive",
                        help="날짜별 검증 관측 자료 누적 위치")
    args = parser.parse_args(argv)
    if args.verify_limit < -1 or args.delay < 0 or not 1 <= args.workers <= 8:
        parser.error("verify-limit must be >= -1, delay >= 0, and workers 1~8")
    if args.refresh_etfs and not args.resume:
        parser.error("--refresh-etfs requires --resume")
    if args.resume and (args.all_us or ((args.etf or args.holdings_csv) and not args.refresh_etfs)):
        parser.error("Source options require --refresh-etfs when resuming; --all-us cannot be resumed")
    local = {}
    for item in args.holdings_csv:
        ticker, separator, path = item.partition("=")
        if not separator or ticker.upper() not in FUNDS or not path:
            parser.error("holdings-csv must be ETF=PATH")
        local[ticker.upper()] = Path(path)
    now = datetime.now(timezone.utc)
    candidates, sources = {}, []
    existing = existing_symbols(ROOT / "public/nav")
    previous = None
    if args.output.exists():
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        if previous.get("schemaVersion") == 1 and previous.get("lookbackDays") == 365:
            archive_report(previous, args.archive_dir)
    if args.resume:
        if previous is None:
            parser.error("No discovery report to resume")
        report = previous
        if report.get("schemaVersion") != 1 or report.get("lookbackDays") != 365:
            parser.error("Unsupported discovery report")
        if args.refresh_etfs:
            refresh_etfs(report, args.etf or list(FUNDS), local, existing)
        for stock in report["stocks"]:
            stock["alreadyTracked"] = stock["symbol"] in existing
            verification = stock.get("dividendVerification", {"status": "not_checked"})
            as_of = verification.get("asOfDate") or report.get("collectedAt", "")[:10]
            # A previous window must not become evidence for today's registration.
            stock["dividendVerification"] = verification if as_of == now.date().isoformat() else {"status": "not_checked"}
            if (verification.get("status") == "verified" and verification.get("source") == "Yahoo Finance"
                    and not verification.get("instrumentType")):
                # Upgrade reports made before chart currency/type validation was added.
                stock["dividendVerification"] = {"status": "not_checked"}
            if non_stock_security(stock.get("name", "")):
                stock["dividendVerification"] = {"status": "ineligible", "reason": "Warrant, right, or unit",
                                                 "asOfDate": now.date().isoformat()}
            elif verification.get("status") == "ineligible" and verification.get("reason") == "Warrant, right, or unit":
                stock["dividendVerification"] = {"status": "not_checked"}
        report["verificationAsOfDate"] = now.date().isoformat()
        verify_report(report, args.output, existing, now.date(), args.verify_limit, args.workers, args.delay)
        archive_report(report, args.archive_dir)
        print(json.dumps(report["summary"], ensure_ascii=False))
        print(f"Report: {args.output}")
        return 2 if any(s["status"] == "failed" for s in report["sources"]) or report["summary"]["verificationErrors"] else 0
    for ticker in dict.fromkeys(args.etf or list(FUNDS)):
        try:
            holdings, source_url = collect_fund(ticker, local.get(ticker))
            for holding in holdings:
                key = holding["symbol"]
                stock = candidates.setdefault(key, {"symbol": key, "name": holding["name"],
                    "market": holding["market"], "etfHoldings": [], "stockDirectorySources": []})
                stock["etfHoldings"].append({"etf": ticker, "sourceUrl": source_url,
                    "weightPercent": holding["weightPercent"], "asOfDate": holding["asOfDate"]})
            sources.append({"source": ticker, "status": "collected", "count": len(holdings),
                            "sourceUrl": source_url, "coverage": "full_official_holdings"})
        except (requests.RequestException, ValueError, KeyError, OSError) as exc:
            sources.append({"source": ticker, "status": "failed", "error": str(exc)})
    if args.all_us:
        try:
            rows = listed_stocks()
            for row in rows:
                key = row["symbol"]
                stock = candidates.setdefault(key, {"symbol": key, "name": row["name"],
                    "market": row["market"], "etfHoldings": [], "stockDirectorySources": []})
                stock["stockDirectorySources"].append(row["sourceUrl"])
            sources.append({"source": "US stock directories", "status": "collected", "count": len(rows)})
        except (requests.RequestException, ValueError) as exc:
            sources.append({"source": "US stock directories", "status": "failed", "error": str(exc)})
    # Verify new ETF holdings first; all candidates are retained even on failure.
    stocks = sorted(candidates.values(), key=lambda s: (s["symbol"] in existing,
                                                       not bool(s["etfHoldings"]), s["symbol"]))
    for stock in stocks:
        stock["alreadyTracked"] = stock["symbol"] in existing
        stock["dividendVerification"] = {"status": "not_checked"}
    report = {"schemaVersion": 1, "collectedAt": now.isoformat(), "lookbackDays": 365,
              "verificationAsOfDate": now.date().isoformat(), "sources": sources, "stocks": stocks}
    verify_report(report, args.output, existing, now.date(), args.verify_limit, args.workers, args.delay)
    archive_report(report, args.archive_dir)
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"Report: {args.output}")
    return 2 if any(s["status"] == "failed" for s in sources) or report["summary"]["verificationErrors"] else 0


if __name__ == "__main__":
    sys.exit(main())
