<script setup>
import { computed } from 'vue';
import ThumbnailCardShell from './ThumbnailCardShell.vue';

const props = defineProps({ data: { type: Object, required: true } });
const number = (value, digits = 2) => value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '?';
const usd = value => value != null ? '$' + number(value) : '?';
const pct = value => value != null ? number(value) + '%' : '?';
const date = value => value ? String(value).replace(/-/g, '.') : '?';
const difference = computed(() => Number(props.data.best?.afterTaxYield ?? 0) - Number(props.data.latest?.afterTaxYield ?? 0));
const samples = computed(() => props.data.samples ?? []);
const ceiling = computed(() => Math.max(1, ...samples.value.map(row => row.afterTaxYield)) * 1.15);
const points = computed(() => samples.value.map((row, index) => ({ ...row,
    x: 46 + index * 550 / Math.max(1, samples.value.length - 1),
    y: 158 - row.afterTaxYield / ceiling.value * 130,
    best: row.date === props.data.best?.date,
    latest: row.date === props.data.latest?.date,
})));
const line = computed(() => points.value.map(row => row.x + ',' + row.y).join(' '));
const ticks = computed(() => [0, 0.5, 1].map(ratio => ({ y: 158 - ratio * 130, label: number(ceiling.value * ratio, 1) + '%' })));
const labels = computed(() => points.value.filter((row, index) => index === 0 || index === points.value.length - 1 || index % 6 === 0));
</script>

<template>
    <ThumbnailCardShell class="entry-efficiency-card" :title="data.symbol" context-label="과거 진입 시점 비교" badge="배당 효율" date-label="분석 기준일" :date-value="date(data.asOfDate)" data-thumbnail-kind="entry-efficiency">
        <template v-if="data.available">
            <section class="intro">
                <h2>언제 샀을 때 배당 효율이 높았을까?</h2>
                <p>각 매수일 직전 12개월 배당금과 당시 종가로 비교합니다.</p>
            </section>
            <section class="comparison" aria-label="최고 시점과 최근 표본 비교">
                <article class="best">
                    <header><span>표본 중 최고 배당률</span><b>{{ date(data.best.date) }}</b></header>
                    <strong>{{ pct(data.best.afterTaxYield) }}</strong>
                    <p>당시 매수가 <b>{{ usd(data.best.price) }}</b></p>
                    <small>직전 12개월 세후 배당 {{ usd(data.best.afterTaxAnnualDividend) }}</small>
                </article>
                <article class="latest">
                    <header><span>최근 표본</span><b>{{ date(data.latest.date) }}</b></header>
                    <strong>{{ pct(data.latest.afterTaxYield) }}</strong>
                    <p>당시 매수가 <b>{{ usd(data.latest.price) }}</b></p>
                    <small>직전 12개월 세후 배당 {{ usd(data.latest.afterTaxAnnualDividend) }}</small>
                </article>
            </section>
            <p class="takeaway"><b>{{ difference < 0.005 ? '최고 시점과 최근 표본의 배당률이 같습니다.' : '최고 시점이 최근 표본보다 ' + number(difference) + '%p 높았습니다.' }}</b><span>세후 배당률 비교</span></p>
            <section class="chart">
                <header><h3>매수 시점별 배당률 흐름</h3><span>{{ samples.length }}개 월별 표본 · 세후</span></header>
                <svg viewBox="0 0 620 194" role="img" aria-label="매수 시점별 직전 12개월 세후 배당률 차트">
                    <g v-for="tick in ticks" :key="tick.y"><line x1="46" x2="596" :y1="tick.y" :y2="tick.y" class="grid-line" /><text x="0" :y="tick.y + 4" class="axis">{{ tick.label }}</text></g>
                    <polyline :points="line" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linejoin="round" />
                    <g v-for="point in points" :key="point.date"><circle :cx="point.x" :cy="point.y" :r="point.best || point.latest ? 5 : 2.5" :fill="point.best ? '#d97706' : point.latest ? '#2563eb' : '#94a3b8'"><title>{{ date(point.date) }} · {{ pct(point.afterTaxYield) }}</title></circle><text v-if="point.best" :x="point.x" :y="point.y - 12" :text-anchor="point.x > 550 ? 'end' : point.x < 90 ? 'start' : 'middle'" class="best-label">최고 {{ pct(point.afterTaxYield) }}</text></g>
                    <text v-for="point in labels" :key="point.date" :x="point.x" y="183" :text-anchor="point.latest ? 'end' : 'start'" class="axis">{{ point.month }}</text>
                </svg>
                <div class="legend"><span><i class="gold" />최고 시점</span><span><i class="blue" />최근 표본</span><span>매월 첫 유효 종가 기준</span></div>
            </section>
            <section class="definition"><b>배당 효율을 어떻게 비교하나요?</b><p>매수일 직전 12개월 배당금 × 0.85 ÷ 당시 종가 × 100</p><span>매수 이후 실제 받은 배당이나 주가 수익률을 비교하는 지표는 아닙니다.</span></section>
        </template>
        <p v-else class="unavailable">{{ data.reason }}</p>
        <template #footer>과거 표본 비교 · 15% 원천징수 단순 가정 · 매수 후 배당·주가 변동·재투자 제외</template>
    </ThumbnailCardShell>
</template>

<style scoped>
.entry-efficiency-card { color: #17212b; }
.entry-efficiency-card :deep(.thumbnail-card-content) { gap: 8px; }
.entry-efficiency-card :deep(.thumbnail-card-footer) { font-size: 10px; }
.intro h2 { margin: 0; font-size: 24px; line-height: 1.35; letter-spacing: -.04em; }
.intro p { margin: 7px 0 0; color: #64748b; font-size: 13px; }
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.comparison article { padding: 12px 18px; border: 1px solid #dbe3ec; border-radius: 16px; background: #f8fafc; }
.comparison .best { border-color: #fcd34d; background: #fffbeb; }
.comparison header { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #64748b; }
.comparison header span { font-weight: 800; }
.best header span { color: #92400e; }
.comparison header b { color: #334155; font-weight: 600; }
.comparison strong { display: block; margin: 8px 0; font-size: 40px; line-height: 1; letter-spacing: -.04em; color: #2563eb; }
.best strong { color: #b45309; }
.comparison p { margin: 0 0 5px; font-size: 12px; color: #475569; }
.comparison small { font-size: 11px; color: #64748b; }
.takeaway { display: flex; justify-content: space-between; align-items: center; margin: 0; padding: 10px 12px; border-radius: 9px; background: #f1f5f9; }
.takeaway b { font-size: 13px; color: #334155; }
.takeaway span { font-size: 10px; color: #64748b; }
.chart { margin: 0; }
.chart header { display: flex; justify-content: space-between; align-items: baseline; }
.chart h3 { margin: 0; font-size: 15px; }
.chart header span { color: #64748b; font-size: 11px; }
.chart svg { display: block; width: 100%; height: 135px; margin-top: 4px; }
.grid-line { stroke: #e2e8f0; stroke-dasharray: 3 4; }
.axis { font-size: 10px; fill: #64748b; }
.best-label { font-size: 11px; fill: #92400e; font-weight: 800; }
.legend { display: flex; align-items: center; gap: 16px; font-size: 10px; color: #64748b; }
.legend span { display: flex; align-items: center; gap: 5px; }
.legend span:last-child { margin-left: auto; }
.legend i { width: 7px; height: 7px; border-radius: 50%; }
.gold { background: #d97706; }.blue { background: #2563eb; }
.definition { margin-top: auto; padding: 11px 14px; border: 1px solid #e2e8f0; border-radius: 10px; }
.definition b { font-size: 11px; color: #475569; }
.definition p { margin: 5px 0; font-size: 13px; font-weight: 700; color: #334155; }
.definition span { font-size: 10px; color: #64748b; }
.unavailable { margin: auto; text-align: center; color: #64748b; font-size: 20px; }
</style>
