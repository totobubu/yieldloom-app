from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.content_pipeline.database import DEFAULT_DB_PATH
from scripts.content_pipeline.models import utc_now_iso


def load_week(database_path: Path, start: date, end: date) -> list[dict]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT e.*,
                (
                    SELECT p.distribution_per_share
                    FROM distribution_events p
                    WHERE p.ticker = e.ticker
                      AND p.ex_date < e.ex_date
                      AND p.verification_status IN ('official', 'cross_checked')
                    ORDER BY p.ex_date DESC LIMIT 1
                ) AS previous_distribution
            FROM distribution_events e
            WHERE e.declared_date BETWEEN ? AND ?
              AND e.verification_status IN ('official', 'cross_checked')
            ORDER BY e.declared_date, e.provider_slug, e.ticker
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()
    finally:
        connection.close()
    events = []
    for row in rows:
        item = dict(row)
        previous = item.pop("previous_distribution")
        change = None
        if previous and Decimal(previous) != 0:
            change = float(
                ((Decimal(item["distribution_per_share"]) - Decimal(previous)) / Decimal(previous) * 100).quantize(
                    Decimal("0.1")
                )
            )
        item["changePercent"] = change
        events.append(item)
    return events


def change_text(event: dict) -> str:
    change = event["changePercent"]
    if change is None:
        return "직전 비교 자료 없음"
    if change > 0:
        return f"직전 대비 {change:.1f}% 증가"
    if change < 0:
        return f"직전 대비 {abs(change):.1f}% 감소"
    return "직전과 동일"


def build_newsletter(events: list[dict], start: date, end: date) -> str:
    lines = [
        f"# 미국 배당주 주간 브리핑 ({start.isoformat()} ~ {end.isoformat()})",
        "",
        f"이번 주 공식 발표로 확인된 배당 이벤트는 **{len(events)}건**입니다.",
        "",
        "## 이번 주 핵심 발표",
        "",
    ]
    if not events:
        lines.append("검증 완료된 신규 발표가 없습니다.")
    for event in sorted(events, key=lambda item: abs(item["changePercent"] or 0), reverse=True):
        lines.extend(
            [
                f"### {event['ticker']} · 주당 ${event['distribution_per_share']}",
                "",
                f"- 변화: {change_text(event)}",
                f"- 배당락일: {event['ex_date']}",
                f"- 지급일: {event['payable_date'] or '공식 원문 확인'}",
                f"- 공식 출처: {event['official_url']}",
                "",
            ]
        )
    lines.extend(
        [
            "## 확인할 점",
            "",
            "배당금 증감만으로 총수익률을 판단할 수 없습니다. 기준가 변동, ROC 여부, 세금과 운용 전략을 함께 확인하세요.",
            "",
            "> 본 브리핑은 공식 발표를 정리한 정보성 콘텐츠이며 투자 권유가 아닙니다.",
        ]
    )
    return "\n".join(lines) + "\n"


def build_youtube_script(events: list[dict], start: date, end: date) -> str:
    intro = [
        "# 유튜브 대본",
        "",
        "## 오프닝",
        "",
        f"안녕하세요. {start.isoformat()}부터 {end.isoformat()}까지 공식 발표된 미국 배당 ETF 소식을 빠르게 정리합니다.",
        f"이번 주 검증 완료된 발표는 모두 {len(events)}건입니다.",
        "",
        "## 본문",
        "",
    ]
    body = []
    for index, event in enumerate(
        sorted(events, key=lambda item: abs(item["changePercent"] or 0), reverse=True), start=1
    ):
        body.extend(
            [
                f"### {index}. {event['ticker']}",
                "",
                f"{event['ticker']}의 이번 주당 배당금은 {event['distribution_per_share']}달러입니다. {change_text(event)}이며, 배당락일은 {event['ex_date']}, 지급일은 {event['payable_date'] or '공식 원문 확인'}입니다.",
                "",
                f"화면 출처: {event['official_url']}",
                "",
            ]
        )
    outro = [
        "## 클로징",
        "",
        "배당금이 높다는 이유만으로 투자 결정을 내리기보다 총수익률과 원금 변동, ROC 가능성을 함께 확인하시기 바랍니다.",
        "이 영상은 투자 권유가 아닌 공식 발표 정보 정리입니다.",
    ]
    return "\n".join(intro + body + outro) + "\n"


def build_shorts_script(events: list[dict], start: date, end: date) -> str:
    highlights = sorted(events, key=lambda item: abs(item["changePercent"] or 0), reverse=True)[:3]
    lines = ["# 유튜브 쇼츠 대본 (30~60초)", "", "## 사실 데이터"]
    for event in highlights:
        lines.append(f"- {event['ticker']}: 주당 ${event['distribution_per_share']}, {change_text(event)}, 공식 원문 {event['official_url']}")
    lines += ["", "## 내레이션", f"이번 주 공식 배당 발표 {len(events)}건 중 핵심만 짚어보겠습니다."]
    lines += [f"{event['ticker']}는 {change_text(event)}입니다. 배당락일은 {event['ex_date']}입니다." for event in highlights]
    lines += ["배당금만으로 판단하지 말고 기준가와 ROC, 총수익률을 함께 확인하세요. 이 콘텐츠는 투자 권유가 아닙니다."]
    return "\n".join(lines) + "\n"


def generate_weekly_digest(database_path: Path, week_ending: date, output_root: Path) -> Path:
    start = week_ending - timedelta(days=6)
    events = load_week(database_path, start, week_ending)
    output = output_root / f"{start.isoformat()}_{week_ending.isoformat()}"
    output.mkdir(parents=True, exist_ok=True)
    (output / "facts.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": utc_now_iso(),
                "period": {"start": start.isoformat(), "end": week_ending.isoformat()},
                "events": events,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (output / "newsletter.md").write_text(
        build_newsletter(events, start, week_ending), encoding="utf-8"
    )
    (output / "youtube-script.md").write_text(
        build_youtube_script(events, start, week_ending), encoding="utf-8"
    )
    (output / "youtube-shorts-script.md").write_text(
        build_shorts_script(events, start, week_ending), encoding="utf-8"
    )
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate weekly newsletter and YouTube script")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--week-ending", type=date.fromisoformat, default=date.today())
    parser.add_argument("--output", type=Path, default=Path("var/content-studio/weekly"))
    args = parser.parse_args()
    print(generate_weekly_digest(args.db, args.week_ending, args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
