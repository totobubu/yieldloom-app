"""Export a read-only Yahoo EOD price snapshot for Content Studio ETF screens."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def _latest_price(payload: dict) -> tuple[float | None, str | None]:
    rows = payload.get("backtestData")
    if not isinstance(rows, list):
        return None, None
    candidates = [
        row for row in rows
        if isinstance(row, dict)
        and not row.get("forecasted")
        and isinstance(row.get("date"), str)
        and isinstance(row.get("close"), (int, float))
        and row["close"] > 0
    ]
    if not candidates:
        return None, None
    latest = max(candidates, key=lambda row: row["date"])
    return float(latest["close"]), latest["date"]


def export_price_snapshot(nav_path: Path, distributions_path: Path, data_root: Path, output: Path, quality_output: Path | None = None, *, as_of: date | None = None) -> dict:
    as_of = as_of or date.today()
    nav = _read(nav_path).get("nav", [])
    distribution_index = _read(distributions_path)
    tickers = {row.get("ticker") for row in distribution_index.get("tickers", []) if isinstance(row, dict)}
    nav_by_ticker = {str(row.get("symbol", "")).upper(): row for row in nav if isinstance(row, dict)}
    prices: dict[str, dict] = {}
    findings: list[dict] = []
    for ticker in sorted(ticker for ticker in tickers if isinstance(ticker, str)):
        item = nav_by_ticker.get(ticker.upper())
        if not item:
            findings.append({"ticker": ticker, "status": "missing_nav", "message": "nav.json에 종목 등록이 없습니다."})
            continue
        paths = item.get("dataPaths", []) if isinstance(item, dict) else []
        if not isinstance(paths, list) or not paths:
            findings.append({"ticker": ticker, "status": "missing_data_path", "message": "가격 데이터 경로가 없습니다."})
            continue
        found = False
        readable_path = False
        for relative in paths if isinstance(paths, list) else []:
            path = data_root / relative
            payload = _read(data_root / relative)
            readable_path = readable_path or path.is_file()
            payload = _read(data_root / relative)
            close, price_date = _latest_price(payload)
            if close is None:
                continue
            prices[ticker] = {
                "close": close,
                "priceDate": price_date,
                "stale": (as_of - date.fromisoformat(price_date)).days > 14,
                "currency": payload.get("tickerInfo", {}).get("currency") or item.get("currency"),
                "source": "yahoo_eod",
                "dataPath": relative,
            }
            if prices[ticker]["stale"]:
                findings.append({"ticker": ticker, "status": "stale", "priceDate": price_date, "dataPath": relative, "message": "최신 실제 종가가 14일을 초과했습니다."})
            found = True
            break
        if not found:
            findings.append({"ticker": ticker, "status": "missing_actual_close" if readable_path else "missing_data_path", "message": "실제 종가가 있는 가격 데이터를 찾지 못했습니다."})
    missing = [row["ticker"] for row in findings if row["status"] != "stale"]
    snapshot = {
        "generatedAt": as_of.isoformat(),
        "source": "yahoo_eod",
        "prices": prices,
        "coverage": {"requested": len(tickers), "priced": len(prices), "missing": len(missing), "missingTickers": missing},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    quality_output = quality_output or output.with_name("price-quality.json")
    quality_output.write_text(json.dumps({"generatedAt": as_of.isoformat(), "source": "yahoo_eod", "summary": {"priced": len(prices), "missing": len(missing), "stale": sum(row["status"] == "stale" for row in findings)}, "findings": findings}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    distribution_index["marketData"] = {
        "source": "yahoo_eod",
        "priceSnapshot": "/content-studio/price-index.json",
        "qualitySnapshot": "/content-studio/price-quality.json",
        "generatedAt": snapshot["generatedAt"],
        "coverage": snapshot["coverage"],
    }
    distributions_path.write_text(json.dumps(distribution_index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return snapshot["coverage"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Content Studio Yahoo EOD prices")
    parser.add_argument("--nav", type=Path, default=Path("public/nav.json"))
    parser.add_argument("--distributions", type=Path, default=Path("public/content-studio/distribution-index.json"))
    parser.add_argument("--data-root", type=Path, default=Path("public"))
    parser.add_argument("--output", type=Path, default=Path("public/content-studio/price-index.json"))
    args = parser.parse_args()
    print(json.dumps(export_price_snapshot(args.nav, args.distributions, args.data_root, args.output), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
