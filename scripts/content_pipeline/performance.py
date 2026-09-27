from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import ContentDatabase, DEFAULT_DB_PATH
from scripts.content_pipeline.models import utc_now_iso


NUMERIC_FIELDS = (
    "views",
    "likes",
    "comments",
    "clicks",
    "subscribers",
    "watch_minutes",
    "production_minutes",
)


def import_csv(database_path: Path, csv_path: Path) -> int:
    database = ContentDatabase(database_path)
    database.initialize()
    count = 0
    with csv_path.open(encoding="utf-8-sig", newline="") as stream, database.connect() as connection:
        for row in csv.DictReader(stream):
            if not row.get("platform") or not row.get("content_key") or not row.get("topic"):
                raise ValueError("platform, content_key and topic are required")
            values = {field: float(row.get(field) or 0) for field in NUMERIC_FIELDS}
            connection.execute(
                """
                INSERT INTO content_performance (
                    platform, content_key, ticker, topic, published_at,
                    views, likes, comments, clicks, subscribers,
                    watch_minutes, production_minutes, imported_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, content_key) DO UPDATE SET
                    ticker = excluded.ticker,
                    topic = excluded.topic,
                    published_at = excluded.published_at,
                    views = excluded.views,
                    likes = excluded.likes,
                    comments = excluded.comments,
                    clicks = excluded.clicks,
                    subscribers = excluded.subscribers,
                    watch_minutes = excluded.watch_minutes,
                    production_minutes = excluded.production_minutes,
                    imported_at = excluded.imported_at
                """,
                (
                    row["platform"].strip(),
                    row["content_key"].strip(),
                    (row.get("ticker") or "").strip().upper() or None,
                    row["topic"].strip(),
                    date.fromisoformat(row["published_at"]).isoformat(),
                    int(values["views"]),
                    int(values["likes"]),
                    int(values["comments"]),
                    int(values["clicks"]),
                    int(values["subscribers"]),
                    values["watch_minutes"],
                    values["production_minutes"],
                    utc_now_iso(),
                ),
            )
            count += 1
    return count


def score_row(row: dict, today: date) -> dict:
    views = max(int(row["views"]), 1)
    age = max((today - date.fromisoformat(row["published_at"])).days, 0)
    reach = min(math.log10(views + 1) / 5, 1)
    engagement = min((row["likes"] + row["comments"] * 2 + row["clicks"]) / views / 0.10, 1)
    conversion = min(row["subscribers"] / views / 0.02, 1)
    retention = min((row["watch_minutes"] / views) / 8, 1)
    freshness = math.exp(-age / 45)
    raw = reach * 25 + engagement * 30 + conversion * 20 + retention * 15 + freshness * 10
    confidence = 0.5 + 0.5 * views / (views + 500)
    return {
        **row,
        "score": round(raw * confidence, 2),
        "components": {
            "reach": round(reach * 25, 2),
            "engagement": round(engagement * 30, 2),
            "conversion": round(conversion * 20, 2),
            "retention": round(retention * 15, 2),
            "freshness": round(freshness * 10, 2),
            "confidence": round(confidence, 3),
        },
    }


def recommend(database_path: Path, today: date, limit: int = 10) -> list[dict]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = [dict(row) for row in connection.execute("SELECT * FROM content_performance")]
    finally:
        connection.close()
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["topic"], []).append(score_row(row, today))
    recommendations = []
    for topic, items in grouped.items():
        total_weight = sum(math.sqrt(max(item["views"], 1)) for item in items)
        score = sum(item["score"] * math.sqrt(max(item["views"], 1)) for item in items) / total_weight
        best = max(items, key=lambda item: item["score"])
        tickers = sorted({item["ticker"] for item in items if item["ticker"]})
        recommendations.append(
            {
                "topic": topic,
                "score": round(score, 2),
                "sampleSize": len(items),
                "totalViews": sum(item["views"] for item in items),
                "tickers": tickers,
                "bestPlatform": best["platform"],
                "reason": f"{best['platform']}에서 최고 {best['score']:.1f}점, 누적 조회 {sum(item['views'] for item in items):,}회",
            }
        )
    return sorted(recommendations, key=lambda item: item["score"], reverse=True)[:limit]


def export_recommendations(database_path: Path, output_path: Path, today: date) -> list[dict]:
    recommendations = recommend(database_path, today)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": utc_now_iso(),
                "scoreVersion": "reach25-engagement30-conversion20-retention15-freshness10-confidence",
                "recommendations": recommendations,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return recommendations


def main() -> int:
    parser = argparse.ArgumentParser(description="Import content performance or recommend topics")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    subparsers = parser.add_subparsers(dest="command", required=True)
    importer = subparsers.add_parser("import")
    importer.add_argument("csv", type=Path)
    recommender = subparsers.add_parser("recommend")
    recommender.add_argument("--today", type=date.fromisoformat, default=date.today())
    recommender.add_argument(
        "--output", type=Path, default=Path("public/content-studio/recommendations.json")
    )
    args = parser.parse_args()
    if args.command == "import":
        print(f"Imported {import_csv(args.db, args.csv)} performance rows")
    else:
        database = ContentDatabase(args.db)
        database.initialize()
        results = export_recommendations(args.db, args.output, args.today)
        print(f"Exported {len(results)} topic recommendations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
