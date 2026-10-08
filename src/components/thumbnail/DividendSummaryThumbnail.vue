<script setup>
import { computed } from 'vue';
import ThumbnailCardShell from './ThumbnailCardShell.vue';

const props = defineProps({ data: { type: Object, required: true } });
const usd = (value, digits = 4) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(digits).replace(/\.?(0+)$/, '')}` : '데이터 없음';
const date = (value) => value ? String(value).replace(/-/g, '.') : '날짜 미정';
const change = computed(() => Number(props.data.dividendDifference ?? 0));
const changePercent = computed(() => Number(props.data.dividendChangePercent));
const tone = computed(() => change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat');
const chartRows = computed(() => props.data.monthlyTotals ?? []);
const historyRows = computed(() => chartRows.value.slice(-3));
</script>

<template>
	<ThumbnailCardShell class="summary-card" :class="tone" :title="data.symbol" context-label="배당 요약" badge="ETF · 커버드콜"
		date-label="배당락일" :date-value="date(data.exDate)" data-thumbnail-kind="summary">
		<template v-if="data.hasDividend">
			<section class="hero">
				<p>주당 지급 배당금 <small>세전</small></p><strong>{{ usd(data.currentDividendAmount, 6) }}</strong><span
					:class="tone"><i>{{ change >= 0 ? '▲' : '▼' }}</i>{{ Number.isFinite(changePercent) ?
						`${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%` : '변동 없음' }} <b>({{ change >= 0 ? '+'
						: '' }}{{ usd(change, 6) }})</b></span>
			</section>
			<section class="metrics">
				<div><small>예상 세후 실수령</small><b>{{ usd(data.afterTaxDividendAmount, 6) }}</b><em>15% 원천징수</em></div>
				<div><small>배당락일 종가</small><b>{{ usd(data.exDividendClose, 2) }}</b><em>USD 기준</em></div>
				<div><small>세전 배당률</small><b>{{ data.exDividendYield != null ?
					`${Number(data.exDividendYield).toFixed(2)}%` : '—' }}</b><em>배당락일 종가 기준</em></div>
			</section>
		</template>
		<p v-else class="unavailable">최근 실제 배당 데이터를 찾지 못했습니다.</p>
		<section v-if="historyRows.length" class="history">
			<header><b>최근 3회차 배당금 추이</b><small class="history-legend"><i />과거 <i />이번회차</small></header>
			<div class="history-cells">
				<article v-for="(row, index) in historyRows" :key="row.month"
					:class="{ latest: index === historyRows.length - 1 }"><span>{{ row.month }}</span><b>{{
						usd(row.total, 4)
					}}</b><em v-if="index === historyRows.length - 1">최신</em></article>
			</div>
		</section>
		<template #footer>주당 USD 기준 · 세후 금액은 15% 원천징수 단순 가정</template>
	</ThumbnailCardShell>
</template>

<style scoped lang="scss">
.metrics small {
	display: block;
	color: #94a3b8;
	font-size: 14px;
	font-weight: 600
}

.hero {
	display: flex;
	height: 100%;
	padding: 24px;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	border: 1.5px solid #a7f3d0;
	border-radius: 24px;
	background: #ecfdf5;
	text-align: center
}

.hero p {
	margin: 0;
	color: #64748b;
	font-size: 16px;
	font-weight: 600;
	letter-spacing: .02em
}

.hero p small {
	font-size: 12px
}

.hero strong {
	display: block;
	margin: 12px 0;
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
	font-weight: 900;
	color: #047857;
	font-size: 52px;
	letter-spacing: -.05em
}

.hero span {
	display: inline-block;
	padding: 8px 14px;
	border: 1px solid #a7f3d0;
	border-radius: 999px;
	background: #d1fae5;
	color: #047857;
	font-size: 14px;
	font-weight: 800;

	i {
		font-style: normal;
	}
}

.hero span.down {
	border-color: #fca5a5;
	background: #fee2e2;
	color: #dc2626
}

.hero span.flat {
	border-color: #e2e8f0;
	background: #f8fafc;
	color: #475569
}


.summary-card.down :deep(.thumbnail-card-header p) {
	color: #dc2626
}

.summary-card.down .hero {
	border-color: #fee2e2;
	background: #fef2f2
}

.summary-card.down .hero strong {
	color: #dc2626
}


.summary-card.flat :deep(.thumbnail-card-header p) {
	color: #475569
}

.summary-card.flat .hero {
	border-color: #e2e8f0;
	background: #f8fafc
}

.summary-card.flat .hero strong {
	color: #475569
}

.metrics {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	padding: 20px 20px;
	border: 1px solid #e2e8f0;
	border-radius: 24px;
	background: #f8fafce6
}

.metrics>div {
	padding: 0 8px;
	text-align: center;
	border-left: 1px solid #e2e8f0
}

.metrics>div:first-child {
	border-left: 0
}

.metrics b {
	display: block;
	margin: 7px 0 3px;
	color: #0f172a;
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
	font-size: 24px;
	font-weight: 800;
}

.metrics em {
	color: #94a3b8;
	font-size: 12px;
	font-style: normal;
	font-weight: 500
}

.history {
	padding: 16px;
	border: 1px solid #e2e8f0;
	border-radius: 24px;
	background: #f8fafccc
}

.history header {
	display: flex;
	justify-content: space-between;
	margin-bottom: 10px;
	padding: 0 4px
}

.history header small {
	color: #94a3b8
}

.history header b {
	color: #94a3b8;
	font-size: 14px;
	font-weight: 600;
}

.history-legend {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	font-weight: 500;
}

.history-legend i {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #cbd5e1;
}

.history-legend i:last-child {
	background: #057a55;
}

.summary-card.down .history-legend i:last-child {
	background: #dc2626;
}

.summary-card.flat .history-legend i:last-child {
	background: #2563eb;
}

.history-cells {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 10px
}

.history-cells article {
	position: relative;
	min-height: 48px;
	padding: 11px 12px;
	border: 1px solid #e2e8f0;
	border-radius: 14px;
	background: #fff
}

.history-cells span {
	display: block;
	color: #94a3b8;
	font-size: 12px;
	font-weight: 700
}

.history-cells b {
	display: block;
	margin-top: 6px;
	color: #334155;
	font-size: 18px;
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
	font-weight: 800;
}

.history-cells .latest {
	border-color: #059669;
	background: #057a55;
	color: #fff
}

.summary-card.down .history-cells .latest {
	border-color: #dc2626;
	background: #dc2626
}

.history-cells .latest span {
	color: #d1fae5
}

.history-cells .latest b {
	color: #fff
}

.history-cells em {
	position: absolute;
	right: 9px;
	top: 9px;
	padding: 3px 5px;
	border-radius: 4px;
	background: #0003;
	color: #fff;
	font-size: 10px;
	font-style: normal
}

.unavailable {
	margin: auto;
	text-align: center;
	font-size: 25px
}
</style>
