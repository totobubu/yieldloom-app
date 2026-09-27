from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from html import escape


def _short_date(value: str) -> str:
    """Format ISO dates compactly without silently inventing a missing date."""
    if len(value) == 10 and value[4] == "-" and value[7] == "-":
        return value[2:4] + value[5:7] + value[8:10]
    return value


@dataclass(frozen=True)
class MonthlyDistribution:
    month: str
    total: str
    amounts: tuple[str, ...]


@dataclass(frozen=True)
class ContentEvent:
    id: int
    provider_slug: str
    ticker: str
    fund_name: str | None
    distribution_per_share: str
    currency: str
    declared_date: str
    ex_date: str
    payable_date: str | None
    official_url: str
    verification_status: str
    previous_distribution: str | None = None
    previous_distribution_source: str | None = None
    monthly_distributions: tuple[MonthlyDistribution, ...] = ()

    @property
    def amount_display(self) -> str:
        value = Decimal(self.distribution_per_share)
        return format(value.normalize(), "f")

    @property
    def change_percent(self) -> Decimal | None:
        if not self.previous_distribution:
            return None
        previous = Decimal(self.previous_distribution)
        if previous == 0:
            return None
        return ((Decimal(self.distribution_per_share) - previous) / previous * 100).quantize(
            Decimal("0.1")
        )

    @property
    def change_label(self) -> str:
        change = self.change_percent
        if change is None:
            return "이전 기록 없음"
        if change > 0:
            return f"직전 대비 +{change}%"
        if change < 0:
            return f"직전 대비 {change}%"
        return "직전과 동일"

    @property
    def amount_change_label(self) -> str:
        if not self.previous_distribution:
            return "직전 실제 배당 기록 없음"
        previous = format(Decimal(self.previous_distribution).normalize(), "f")
        return f"직전 ${previous} → 이번 ${self.amount_display}"

    @property
    def change_detail_label(self) -> str:
        """Keep the rate and the per-share dollar change together on visual cards."""
        if not self.previous_distribution:
            return "직전 실제 배당 기록 없음"
        delta = Decimal(self.distribution_per_share) - \
            Decimal(self.previous_distribution)
        sign = "+" if delta >= 0 else "-"
        return f"{self.change_label} | {sign} ${format(abs(delta).normalize(), 'f')}"


def toss_text(event: ContentEvent) -> str:
    payable = event.payable_date or "공식 원문 확인"
    return "\n".join(
        [
            f"📢 {event.ticker} 배당 발표",
            f"주당 ${event.amount_display} · {event.amount_change_label} · {event.change_label}",
            f"배당락 {event.ex_date} · 지급 {payable}",
            "",
            f"{event.provider_slug.upper()} 공식 발표를 기준으로 정리했습니다.",
            "투자 판단과 세금 적용은 개인 상황에 따라 달라질 수 있습니다.",
            f"원문: {event.official_url}",
        ]
    )


def naver_markdown(event: ContentEvent) -> str:
    name = event.fund_name or event.ticker
    payable = event.payable_date or "공식 원문에서 확인 필요"
    return f"""# {event.ticker} 배당 발표: 주당 ${event.amount_display}

{event.provider_slug.upper()}가 **{name}({event.ticker})**의 배당 정보를 공식 발표했습니다.

## 핵심 일정

- 주당 배당금: **${event.amount_display} {event.currency}**
- 직전 실제 배당금: **{event.amount_change_label}**
- 직전 배당 대비: **{event.change_label}**
- 선언일: **{event.declared_date}**
- 배당락일: **{event.ex_date}**
- 지급일: **{payable}**
- 검증 상태: **{event.verification_status}**

## 한 줄 해석

이번 발표는 직전 지급 기록과 비교해 `{event.change_label}`입니다. 배당금만으로 수익성을 판단하지 말고 기준가 변동, 총수익률, ROC 여부와 세금을 함께 확인하는 편이 좋습니다.

## 공식 출처

{event.official_url}

> 이 글은 공식 발표를 빠르게 정리한 정보성 콘텐츠이며 투자 권유가 아닙니다. 실제 매매 전 운용사 원문을 다시 확인하세요.
"""


def _weekly_table(event: ContentEvent) -> str:
    if not event.monthly_distributions:
        return ""
    colors = ("blue", "red", "yellow", "green", "orange")
    rows = []
    for item in event.monthly_distributions:
        pills = "".join(
            f'<span class="pill {colors[index % len(colors)]}">${escape(amount)}</span>'
            for index, amount in enumerate(item.amounts)
        )
        rows.append(
            f'<div class="month-row"><strong>{escape(item.month)}</strong><b>${escape(item.total)}</b><div class="pills">{pills}</div></div>')
    return '<section class="monthly">' + "".join(rows) + "</section>"


def _card_html(event: ContentEvent, *, width: int, height: int, variant: str) -> str:
    amount = escape(event.amount_display)
    ticker = escape(event.ticker)
    provider = escape(event.provider_slug.upper())
    change = escape(event.change_detail_label)
    amount_change = escape(event.amount_change_label)
    declared_date = escape(_short_date(event.declared_date))
    ex_date = escape(_short_date(event.ex_date))
    payable = escape(_short_date(event.payable_date)
                     if event.payable_date else "확인 필요")
    compact = variant == "blog"
    eyebrow = "OFFICIAL DISTRIBUTION" if not compact else "DIVIDEND BRIEF"
    monthly = _weekly_table(event) if not compact else ""
    has_monthly = bool(monthly)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{ticker} 배당 카드</title>
<style>
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; width: {width}px; height: {height}px; overflow: hidden; }}
body {{ font-family: Pretendard, "Noto Sans KR", Arial, sans-serif; background: #081321; color: #f7f9fc; }}
.card {{ position: relative; display: flex; flex-direction: column; justify-content: space-between; width: 100%; height: 100%; padding: {round(width * (.04 if has_monthly else .055))}px; background: radial-gradient(circle at 90% 4%, #244b68 0, transparent 34%), linear-gradient(145deg, #081321 0%, #10283b 100%); }}
.card::after {{ content: ""; position: absolute; right: -9%; bottom: -20%; width: 48%; aspect-ratio: 1; border: {max(3, round(width * .006))}px solid rgba(255,190,82,.22); border-radius: 50%; }}
.top {{ display: flex; justify-content: space-between; align-items: center; font-size: {round(width * .022)}px; font-weight: 800; letter-spacing: .08em; color: #ffbd52; }}
.provider {{ color: #ffbd52; letter-spacing: .04em; }} .byline {{ color: #b9c8d7; letter-spacing: .02em; font-size: .9em; }}
.main {{ width:100%; align-self:stretch; padding-top: {round(height * (.006 if has_monthly else .0))}px; }}
.headline {{ display:flex; align-items:end; justify-content:space-between; gap:{round(width*.025)}px; }}
.ticker {{ margin: 0; font-size: {round(width * (.150 if has_monthly else (.13 if not compact else .095)))}px; line-height: .9; letter-spacing: -.05em; }}
.amount-block {{ text-align:right; }}
.label {{ margin: 0 0 {round(height * .007)}px; font-size: {round(width * .022)}px; color: #b9c8d7; }}
.amount {{ margin: 0; color: #fff; font-size: {round(width * (.120 if has_monthly else (.10 if not compact else .082)))}px; font-weight: 900; letter-spacing: -.055em; white-space:nowrap; }}
.change {{ display: inline-block; margin-top: {round(height * .010)}px; padding: {round(width * .008)}px {round(width * .014)}px; border: 1px solid rgba(255,189,82,.45); border-radius: 999px; color: #ffd78f; font-size: {round(width * .018)}px; font-weight: 800; }}
.amount-change {{ margin: {round(height * .010)}px 0 0; color: #dce7f2; font-size: {round(width * .018)}px; font-weight: 700; }}
.monthly {{ margin-top: {round(height * .035)}px; padding: {round(width * .015)}px; border-radius: {round(width * .014)}px; background: rgba(255,255,255,.94); color: #172033; }}
.month-row {{ display:grid; grid-template-columns: {round(width * .082)}px {round(width * .108)}px 1fr; gap: {round(width * .009)}px; align-items:center; min-height:{round(height * .030)}px; border-top:1px solid #e8ecf1; font-size:{round(width * .016)}px; }}
.month-row strong {{ color:#344054; }} .month-row b {{ color:#101828; }} .pills {{ display:flex; gap:{round(width * .006)}px; }} .pill {{ flex:1; padding:{round(height * .007)}px {round(width * .006)}px; border-radius:{round(width * .006)}px; color:#fff; text-align:center; font-weight:900; font-size:{round(width * .016)}px; }}
.blue{{background:#4386ed}}.red{{background:#e3483f}}.yellow{{background:#eab308;color:#172033}}.green{{background:#22a45d}}.orange{{background:#e87918}}
.bottom {{ width:100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: {round(width * .015)}px; padding-top: {round(height * (.018 if has_monthly else .035))}px; border-top: 1px solid rgba(255,255,255,.16); }}
.date span {{ display: block; margin-bottom: {round(height * .005)}px; color: #8fa5b7; font-size: {round(width * .018)}px; }}
.date strong {{ font-size: {round(width * .040)}px; }}
</style>
</head>
<body>
<main class="card" data-content-card>
  <header class="top">
	<span class="provider">{ex_date} {provider}</span>
	<span class="byline">Made by 토또부부</span>
  </header>
  <section class="main">
	<div class="headline">
		<h1 class="ticker">{ticker}</h1>
	</div>
	<div class="amount-block">
		<p class="amount">${amount}</p>
		<p class="amount-change">{amount_change}</p>
		<span class="change">{change}</span>
	</div>
  </section>
	{monthly}
	<footer class="bottom">
		<div class="date"><span>배당공시일</span><strong>{declared_date}</strong></div>
		<div class="date"><span>배당락일</span><strong>{ex_date}</strong></div>
		<div class="date"><span>지급일</span><strong>{payable}</strong></div>
	</footer>
</main>
</body>
</html>"""


def social_square_html(event: ContentEvent) -> str:
    return _card_html(event, width=1080, height=1080, variant="social")


def blog_cover_html(event: ContentEvent) -> str:
    return _card_html(event, width=1200, height=630, variant="blog")
