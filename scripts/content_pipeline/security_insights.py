"""Price, dividend, cash-flow, liquidity and official NAV observations.

Provider-adjusted returns are labeled estimates. Missing data and unsupported
financial ratios remain explicit; market prices are never substituted for NAV.
"""
from __future__ import annotations

import csv
from datetime import date, datetime, timedelta, timezone
import io
import json
import math
from pathlib import Path
import re
from zoneinfo import ZoneInfo

import requests

from .tax_character import decimal_text, immutable_bytes, now_iso

COLLECTOR_VERSION = "1"


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def metric(value=None, *, status=None, **evidence) -> dict:
    return {"value": value, "status": status or ("available" if value is not None else "not_available"),
            "asOfDate": evidence.pop("asOfDate", None), **evidence}


def year_before(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        return day.replace(year=day.year - 1, day=28)


def chart_observations(data: dict, today: date) -> dict:
    meta = data["meta"]
    zone = ZoneInfo(meta["exchangeTimezoneName"])
    timestamps = data.get("timestamp", [])
    indicators = data.get("indicators", {})
    closes = (indicators.get("quote") or [{}])[0].get("close", [])
    adjusted = (indicators.get("adjclose") or [{}])[0].get("adjclose", [])
    prices = []
    for index, timestamp in enumerate(timestamps):
        day = datetime.fromtimestamp(timestamp, zone).date()
        close = number(closes[index]) if index < len(closes) else None
        adjusted_close = number(adjusted[index]) if index < len(adjusted) else None
        if day <= today and close is not None and close > 0:
            prices.append({"date": day.isoformat(), "close": close,
                           "adjustedClose": adjusted_close if adjusted_close is not None and adjusted_close > 0 else None})
    by_date = {row["date"]: row for row in prices}
    prices = [by_date[key] for key in sorted(by_date)]
    dividends = []
    for event in data.get("events", {}).get("dividends", {}).values():
        day = datetime.fromtimestamp(event["date"], zone).date()
        amount = number(event.get("amount"))
        if day <= today and amount is not None and amount > 0:
            dividends.append({"exDate": day.isoformat(), "amount": amount})
    splits = [dict(event, date=datetime.fromtimestamp(event["date"], zone).date().isoformat())
              for event in data.get("events", {}).get("splits", {}).values()
              if datetime.fromtimestamp(event["date"], zone).date() <= today]
    return {"prices": prices, "dividends": sorted(dividends, key=lambda d: d["exDate"]), "splits": splits}


def calculate_history(history: dict, today: date) -> dict:
    prices = history["prices"]
    if not prices:
        raise ValueError("No actual price observations")
    end = date.fromisoformat(prices[-1]["date"])
    start, previous_start = year_before(end), year_before(year_before(end))
    baseline = [p for p in prices if date.fromisoformat(p["date"]) <= start]
    enough = bool(baseline and (start - date.fromisoformat(baseline[-1]["date"])).days <= 7)
    prior_coverage = date.fromisoformat(prices[0]["date"]) <= previous_start
    recent = [d for d in history["dividends"] if start.isoformat() < d["exDate"] <= end.isoformat()]
    previous = [d for d in history["dividends"] if previous_start.isoformat() < d["exDate"] <= start.isoformat()]
    current_sum, previous_sum = math.fsum(d["amount"] for d in recent), math.fsum(d["amount"] for d in previous)
    split_review = any(previous_start.isoformat() < s["date"] <= end.isoformat() for s in history["splits"])
    common = {"asOfDate": end.isoformat(), "windowStart": start.isoformat(), "dateBasis": "ex-dividend date"}
    reason = "needs_corporate_action_review" if split_review else "insufficient_history"
    ttm = metric(current_sum, **common) if enough and not split_review else metric(status=reason, **common)
    growth_status = "needs_corporate_action_review" if split_review else "insufficient_history" if not (enough and prior_coverage) else "no_prior_dividends"
    growth = metric((current_sum / previous_sum - 1) * 100, unit="percent", **common) if enough and prior_coverage and previous_sum > 0 and not split_review else metric(status=growth_status, **common)
    total_return = metric(status="insufficient_adjusted_history", unit="percent", asOfDate=end.isoformat())
    if enough and baseline[-1]["adjustedClose"] and prices[-1]["adjustedClose"]:
        total_return = metric((prices[-1]["adjustedClose"] / baseline[-1]["adjustedClose"] - 1) * 100,
            status="provider_adjusted_estimate", unit="percent", asOfDate=end.isoformat(),
            actualStartDate=baseline[-1]["date"], basis="provider-adjusted closing-price ratio; dividend/split adjustments",
            startAdjustedClose=baseline[-1]["adjustedClose"], endAdjustedClose=prices[-1]["adjustedClose"])
    return {"totalReturn1Y": total_return, "ttmDividendPerShare": ttm, "ttmDividendGrowth": growth,
            "freshness": "stale" if (today - end).days > 7 else "current",
            "ttmDividendYield": metric(current_sum / prices[-1]["close"] * 100, unit="percent", **common)
                if enough and not split_review else metric(status=reason, **common),
            "price": metric(prices[-1]["close"], asOfDate=end.isoformat()),
            "eventCountTTM": len(recent), "corporateActionReview": split_review,
            "latestDividend": recent[-1] if recent else None}


def cash_flow_metrics(frame, today: date) -> dict:
    missing = {"freeCashFlowTTM": metric(), "cashDividendsPaidTTM": metric(), "fcfPayoutRatio": metric()}
    if frame is None or frame.empty or not {"Free Cash Flow", "Cash Dividends Paid"}.issubset(frame.index):
        return missing
    columns = sorted([c for c in frame.columns if c.date() <= today], reverse=True)[:4]
    if len(columns) != 4 or any(not 60 <= (columns[i].date() - columns[i + 1].date()).days <= 120 for i in range(3)):
        return missing
    free = [number(frame.loc["Free Cash Flow", c]) for c in columns]
    paid = [number(frame.loc["Cash Dividends Paid", c]) for c in columns]
    if any(v is None for v in free + paid):
        return missing
    # Cash outflows are negative. Positive values can represent a different
    # upstream sign convention; don't silently mix conventions across quarters.
    if any(v > 0 for v in paid):
        return missing | {"fcfPayoutRatio": metric(status="needs_cash_flow_sign_review")}
    fcf, dividends = math.fsum(free), -math.fsum(paid)
    evidence = {"periodEnds": [c.date().isoformat() for c in columns], "asOfDate": columns[0].date().isoformat()}
    return {"freeCashFlowTTM": metric(fcf, **evidence), "cashDividendsPaidTTM": metric(dividends, **evidence),
            "fcfPayoutRatio": metric(dividends / fcf * 100, unit="percent", **evidence) if fcf > 0
                else metric(status="nonpositive_free_cash_flow", **evidence),
            "quarterlyObservations": [{"periodEnd": column.date().isoformat(), "freeCashFlow": f,
                                       "cashDividendsPaid": p} for column, f, p in zip(columns, free, paid)]}


def quote_metrics(info: dict, today: date) -> dict:
    bid, ask = number(info.get("bid")), number(info.get("ask"))
    spread = (ask - bid) / ((ask + bid) / 2) * 100 if bid and ask and 0 < bid <= ask else None
    payout = number(info.get("payoutRatio"))
    result = {
        "marketCap": metric(number(info.get("marketCap"))),
        "averageDailyVolume": metric(number(info.get("averageVolume"))),
        "bidAskSpread": metric(spread, unit="percent", basis="current bid/ask snapshot, not a 30-day median"),
        "reportedPayoutRatio": metric(payout * 100 if payout is not None else None, unit="percent", basis="provider-reported earnings payout ratio"),
        "assetsUnderManagement": metric(number(info.get("totalAssets"))),
        "navSnapshot": metric(number(info.get("navPrice")), asOfDate=None, basis="provider latest reported NAV; issuer date not supplied"),
        "sector": info.get("sector"), "industry": info.get("industry"), "calendar": {},
    }
    for field, key in (("exDividendDate", "exDate"), ("dividendDate", "payableDate")):
        timestamp = number(info.get(field))
        day = datetime.fromtimestamp(timestamp, timezone.utc).date() if timestamp and timestamp > 0 else None
        result["calendar"][key] = metric(day.isoformat() if day else None, status="provider_reported" if day else None,
                                        isUpcoming=day > today if day else None)
    return result


def parse_nav(text: str, ticker: str, today: date) -> list[dict]:
    if ticker in {"VYM", "VIG"}:
        payload = json.loads(text)
        if payload.get("fundId") != ticker:
            raise ValueError("NAV response does not match ETF")
        rows = [{"date": item["asOfDate"][:10], "nav": decimal_text(item["price"])}
                for series in payload.get("nav", []) for item in series.get("item", [])]
    elif ticker == "SCHD":
        rows = [{"date": datetime.strptime(row["Date"], "%m/%d/%Y").date().isoformat(),
                 "nav": decimal_text(row["Fund NAV"])} for row in csv.DictReader(io.StringIO(text))
                if row.get("Date") and re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", row["Date"])]
    else:
        raise ValueError("No supported official NAV history adapter")
    by_date = {}
    for row in rows:
        if date.fromisoformat(row["date"]) <= today and float(row["nav"]) > 0:
            by_date[row["date"]] = row
    if not by_date:
        raise ValueError("No valid official NAV observations")
    return [by_date[key] for key in sorted(by_date)]


def collect_nav(ticker: str, today: date, raw_dir: Path) -> dict:
    if ticker in {"VYM", "VIG"}:
        url = f"https://investor.vanguard.com/vmf/api/{ticker}/price-history/1Y"
    elif ticker == "SCHD":
        url = "https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_NAV_History.CSV"
    else:
        return {"status": "not_available", "reason": "No supported official NAV history source"}
    response = requests.get(url, timeout=25)
    response.raise_for_status()
    digest, _ = immutable_bytes(raw_dir, response.content, ".nav")
    rows = parse_nav(response.text, ticker, today)
    return {"status": "available", "sourceUrl": url, "documentSha256": digest, "rows": rows,
            "asOfDate": rows[-1]["date"], "availableStart": rows[0]["date"],
            "availablePeriodPriceChangePercent": (float(rows[-1]["nav"]) / float(rows[0]["nav"]) - 1) * 100,
            "basis": "official NAV level change, excludes distributions"}


def collect_security(ticker: str, today: date, raw_dir: Path) -> dict:
    import yfinance as yf
    from yfinance.data import YfData

    observed = now_iso()
    result = {"symbol": ticker, "collectorVersion": COLLECTOR_VERSION,
              "collectedAt": observed, "source": "Yahoo Finance", "errors": [],
              "sourceUrl": f"https://finance.yahoo.com/quote/{ticker}/", "status": "collected"}
    security = yf.Ticker(ticker)
    try:
        info = security.info
        if not info or str(info.get("symbol", "")).upper().replace(".", "-") != ticker:
            raise ValueError("Quote profile does not identify the requested ticker")
        if info.get("currency") != "USD" or info.get("quoteType") not in {"EQUITY", "ETF"}:
            return result | {"status": "ineligible", "reason": "Not a USD stock or ETF"}
        result.update({"currency": "USD", "financialCurrency": info.get("financialCurrency"),
                       "securityType": "etf" if info["quoteType"] == "ETF" else "stock",
                       "longName": info.get("longName") or info.get("shortName"), "quote": quote_metrics(info, today)})
        profile_fields = ("symbol", "quoteType", "currency", "longName", "shortName", "marketCap", "payoutRatio",
                          "navPrice", "totalAssets", "averageVolume", "bid", "ask", "sector", "industry", "exDividendDate", "dividendDate", "financialCurrency")
        profile_bytes = json.dumps({k: info.get(k) for k in profile_fields}, sort_keys=True, allow_nan=False).encode()
        result["profileObservationSha256"], _ = immutable_bytes(raw_dir, profile_bytes, ".profile.json")
    except Exception as exc:
        result["errors"].append({"section": "profile", "error": str(exc)})
        result["status"] = "partial"
    try:
        start = year_before(year_before(today)) - timedelta(days=10)
        url = "https://query2.finance.yahoo.com/v8/finance/chart/" + ticker
        raw = YfData().get_raw_json(url, params={
            "period1": int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp()),
            "period2": int(datetime.combine(today + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp()),
            "interval": "1d", "events": "div,splits", "includeAdjustedClose": True}, timeout=20)
        chart = raw["chart"]["result"][0]
        meta = chart["meta"]
        if str(meta.get("symbol", "")).upper().replace(".", "-") != ticker or meta.get("currency") != "USD":
            raise ValueError("History symbol/currency mismatch")
        if meta.get("instrumentType") not in {"EQUITY", "ETF"}:
            return result | {"status": "ineligible", "reason": "Not a USD stock or ETF"}
        result.setdefault("securityType", "etf" if meta["instrumentType"] == "ETF" else "stock")
        history = chart_observations(chart, today)
        result["performance"] = calculate_history(history, today)
        result["history"] = history
        content = json.dumps(raw, sort_keys=True, allow_nan=False).encode()
        result["historyObservationSha256"], _ = immutable_bytes(raw_dir, content, ".chart.json")
        result["historySourceUrl"] = url
    except Exception as exc:
        result["errors"].append({"section": "history", "error": str(exc)})
        result["status"] = "partial" if "quote" in result else "unavailable"
    if result.get("securityType") == "stock":
        industry, sector = str(result.get("quote", {}).get("industry") or ""), str(result.get("quote", {}).get("sector") or "")
        if "reit" in industry.lower() or sector == "Financial Services":
            result["dividendCapacity"] = {"status": "issuer_specific_metrics_required",
                "reason": "REITs need FFO/AFFO; financial firms need sector-specific issuer measures"}
        else:
            try:
                result["dividendCapacity"] = cash_flow_metrics(security.quarterly_cashflow, today)
            except Exception as exc:
                result["dividendCapacity"] = {"status": "not_available", "error": str(exc)}
    elif result.get("securityType") == "etf":
        try:
            funds = security.funds_data
            operations = funds.fund_operations
            expense = number(operations.loc["Annual Report Expense Ratio", ticker]) if ticker in operations.columns and "Annual Report Expense Ratio" in operations.index else None
            result["fund"] = {"expenseRatio": metric(expense * 100 if expense is not None else None, unit="percent", asOfDate=None),
                              "sectorWeightsPercent": {k: number(v) * 100 for k, v in funds.sector_weightings.items() if number(v) is not None},
                              "sectorWeightsAsOfDate": None}
        except Exception as exc:
            result["fund"] = {"status": "not_available", "error": str(exc)}
        try:
            result["navHistory"] = collect_nav(ticker, today, raw_dir)
        except Exception as exc:
            result["navHistory"] = {"status": "unavailable", "error": str(exc)}
    return result


def holdings_overlap(discovery: dict) -> list[dict]:
    funds = {}
    for stock in discovery.get("stocks", []):
        for holding in stock.get("etfHoldings", []):
            funds.setdefault(holding["etf"], {})[stock["symbol"]] = holding
    result = []
    tickers = sorted(funds)
    for index, left in enumerate(tickers):
        for right in tickers[index + 1:]:
            common = set(funds[left]) & set(funds[right])
            dates_left = sorted({h.get("asOfDate") for h in funds[left].values() if h.get("asOfDate")})
            dates_right = sorted({h.get("asOfDate") for h in funds[right].values() if h.get("asOfDate")})
            same = len(dates_left) == len(dates_right) == 1 and dates_left == dates_right
            result.append({"left": left, "right": right, "commonSymbols": sorted(common),
                "overlapPercent": math.fsum(min(funds[left][s]["weightPercent"], funds[right][s]["weightPercent"]) for s in common),
                "leftAsOfDates": dates_left, "rightAsOfDates": dates_right,
                "status": "comparable" if same else "mixed_or_unknown_as_of_dates",
                "basis": "sum of minimum shared US-listed equity weights; excludes cash/other assets"})
    return result
