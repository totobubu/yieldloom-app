<script setup>
import { computed } from 'vue';
import ThumbnailCardShell from './ThumbnailCardShell.vue';
const props = defineProps({ data: { type: Object, required: true } });
const hasPrevious = computed(
	() => Number(props.data.previousDividendAmount) > 0
);
const difference = computed(() =>
	Number(props.data.dividendDifference ?? 0)
);
const tone = computed(() =>
	difference.value > 0 ? 'up' : difference.value < 0 ? 'down' : 'flat'
);
const usd = (value, digits = 6) =>
	value != null && Number.isFinite(Number(value))
		? `$${Number(value)
			.toFixed(digits)
			.replace(/\.?(0+)$/, '')}`
		: '—';
const pct = (value) =>
	value != null && Number.isFinite(Number(value))
		? `${Number(value).toFixed(2)}%`
		: '—';
const date = (value) => (value ? String(value).replace(/-/g, '.') : '—');
const directionLabel = computed(() =>
	difference.value > 0
		? '인상'
		: difference.value < 0
			? '인하'
			: '변동 없음'
);
const rows = computed(() => [
	{
		label: '배당락일',
		icon: 'calendar',
		previous: date(props.data.previousExDate),
		current: date(props.data.exDate),
	},
	{
		label: '배당락일 종가',
		icon: 'trend',
		previous: usd(props.data.previousExDividendClose, 2),
		current: usd(props.data.exDividendClose, 2),
	},
	{
		label: '세전 배당금',
		icon: 'coin',
		previous: usd(props.data.previousDividendAmount),
		current: usd(props.data.currentDividendAmount),
		key: true,
	},
	{
		label: '예상 세후 배당금',
		icon: 'receipt',
		previous: usd(props.data.previousAfterTaxDividendAmount),
		current: usd(props.data.afterTaxDividendAmount),
	},
	{
		label: '세전 배당률',
		icon: 'percent',
		previous: pct(props.data.previousExDividendYield),
		current: pct(props.data.exDividendYield),
	},
	{
		label: '세후 배당률',
		icon: 'clock',
		previous: pct(props.data.previousAfterTaxDividendYield),
		current: pct(props.data.afterTaxDividendYield),
	},
]);
</script>
<template>
	<ThumbnailCardShell class="comparison-card" :class="tone" :title="data.symbol" badge="ETF · 배당 비교"
		context-label="배당 비교" date-label="배당락일" :date-value="date(data.exDate)" data-thumbnail-kind="comparison">
		<template v-if="data.hasDividend">
			<section class="kpis">
				<article>
					<p>세전 배당금 {{ directionLabel }}률</p>
					<strong>{{
						hasPrevious
							? `${difference >= 0 ? '+' : ''
							}${pct(data.dividendChangePercent)}`
							: '비교 불가'
					}}</strong><small>직전 확정 회차 대비</small><span class="kpi-icon" aria-hidden="true">

						<svg class="kpi-trend-icon" :class="{ 'is-down': tone === 'down' }" fill="none"
							stroke="currentColor" stroke-width="2.8" viewBox="0 0 24 24">
							<path d="M13 7h8m0 0v8m0-8-8 8-4-4-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg></span>
				</article>
				<article>
					<p>주당 배당 {{ directionLabel }}액</p>
					<strong>{{ difference >= 0 ? '+' : '−'
					}}{{ usd(Math.abs(difference)) }}</strong><small>직전 확정 회차 대비</small><span class="kpi-icon"
						aria-hidden="true"><svg v-if="tone === 'down'" fill="none" stroke="currentColor"
							stroke-width="2.8" viewBox="0 0 24 24">
							<path d="M5 14l7 7m0 0 7-7m-7 7V3" stroke-linecap="round" stroke-linejoin="round" />
						</svg><svg v-else fill="none" stroke="currentColor" stroke-width="2.8" viewBox="0 0 24 24">
							<path d="M12 19V5m0 0 6 6m-6-6-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg></span>
				</article>
			</section>
			<section class="table">
				<div class="head">
					<span>비교 항목</span><b>직전 배당</b><b>이번 배당 <i aria-hidden="true" /></b>
				</div>
				<div v-for="row in rows" :key="row.label" :class="{
					key: row.key,
					[`key-${tone}`]: row.key,
				}">
					<span class="row-label"><svg v-if="row.icon === 'calendar'" class="row-icon" fill="none"
							stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								stroke-linecap="round" stroke-linejoin="round" />
						</svg><svg v-else-if="row.icon === 'trend'" class="row-icon" fill="none" stroke="currentColor"
							stroke-width="2" viewBox="0 0 24 24">
							<path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg><svg v-else-if="row.icon === 'coin'" class="row-icon key-icon" fill="none"
							stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path
								d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								stroke-linecap="round" stroke-linejoin="round" />
						</svg><svg v-else-if="row.icon === 'receipt'" class="row-icon" fill="none" stroke="currentColor"
							stroke-width="2" viewBox="0 0 24 24">
							<path
								d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 002 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
								stroke-linecap="round" stroke-linejoin="round" />
						</svg><svg v-else-if="row.icon === 'percent'" class="row-icon" fill="none" stroke="currentColor"
							stroke-width="2" viewBox="0 0 24 24">
							<path d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								stroke-linecap="round" stroke-linejoin="round" />
						</svg><svg v-else class="row-icon" fill="none" stroke="currentColor" stroke-width="2"
							viewBox="0 0 24 24">
							<circle cx="12" cy="12" r="9" />
							<path d="M12 7v5l3 3" stroke-linecap="round" stroke-linejoin="round" />
						</svg>{{ row.label }}<em v-if="row.key">핵심</em></span><b :class="{ strike: row.key }">{{
							row.previous }}</b><strong :class="{
							highlight:
								row.key ||
								row.icon === 'percent' ||
								row.icon === 'clock',
						}">{{ row.current
						}}<em v-if="row.key">{{ directionLabel }}</em></strong>
				</div>
			</section>
		</template>
		<p v-else class="unavailable">
			최근 실제 배당 데이터를 찾지 못했습니다.
		</p>
		<template #footer>주당 USD 기준 · 수익률은 해당 1회 배당금의 배당락일 종가
			대비</template>
	</ThumbnailCardShell>
</template>
<style scoped>
.comparison-card {
	color: #0f172a;
}

.kpis {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
	margin: 0;
}

.kpis article {
	position: relative;
	min-height: 82px;
	padding: 18px 20px;
	border: 1px solid #a7f3d0;
	border-radius: 16px;
	background: #057a55;
	color: #fff;
}

.kpi-icon {
	position: absolute;
	right: 20px;
	top: 50%;
	display: grid;
	width: 48px;
	height: 48px;
	place-items: center;
	border: 1px solid #ffffff33;
	border-radius: 50%;
	background: #ffffff20;
	transform: translateY(-50%);
}

.kpi-icon svg {
	width: 24px;
	height: 24px;
}

.kpi-trend-icon.is-down {
	transform: scaleY(-1);
}

.kpis article:last-child {
	background: #eefbf4;
	border-color: #a7f3d0;
	color: #046c4e;
}

.kpis article:last-child .kpi-icon {
	background: #057a55;
	color: #fff;
}

.down .kpis article:first-child {
	border-color: #fecaca;
	background: #dc2626;
}

.down .kpis article:last-child {
	border-color: #fecaca;
	background: #fef2f2;
	color: #dc2626;
}

.down .kpis article:last-child .kpi-icon {
	background: #dc2626;
}

.flat .kpis article:first-child {
	border-color: #bfdbfe;
	background: #2563eb;
}

.flat .kpis article:last-child {
	border-color: #bfdbfe;
	background: #eff6ff;
	color: #1d4ed8;
}

.flat .kpis article:last-child .kpi-icon {
	background: #2563eb;
}

.kpis p {
	margin: 0;
	font-size: 14px;
	font-weight: 700;
	opacity: 0.9;
}

.kpis strong {
	display: block;
	margin-top: 8px;
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
	font-size: 29px;
}

.kpis small {
	display: none;
}

.table {
	display: flex;
	flex: 1;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid #e2e8f0;
	border-radius: 16px;
	background: #fff;
}

.table>div {
	display: grid;
	grid-template-columns: 5fr 3fr 4fr;
	align-items: center;
	gap: 8px;
	min-height: 0;
	padding: 0 20px;
	border-bottom: 1px solid #f1f5f9;
	font-size: 15px;
}

.table>div:not(.head) {
	flex: 1;
}

.table>div:last-child {
	border: 0;
}

.table .head {
	min-height: 48px;
	padding: 0 20px;
	background: #f8fafccc;
	color: #64748b;
	font-size: 14px;
	font-weight: 800;
}

.table .head b {
	text-align: right;
}

.table .head b:last-child {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 6px;
	color: #065f46;
}

.table .head i {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #059669;
}

.table>div:not(.head)>b,
.table>div:not(.head)>strong {
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
	text-align: right;
}

.table .row-label {
	display: flex;
	align-items: center;
	gap: 8px;
	color: #334155;
	font-weight: 500;
}

.row-icon {
	width: 20px;
	height: 20px;
	flex: 0 0 auto;
	color: #94a3b8;
}

.table .row-label em,
.table strong em {
	margin-left: 2px;
	padding: 3px 6px;
	border-radius: 4px;
	background: #057a55;
	color: #fff;
	font-size: 12px;
	font-style: normal;
	font-weight: 700;
	line-height: 1;
}

.table b.strike {
	color: #94a3b8;
	text-decoration: line-through;
}

.table>div.key {
	border-top: 1px solid #6ee7b7;
	border-bottom: 1px solid #6ee7b7;
	background: #f0fdf6;
}

.table>div.key .row-label {
	font-weight: 800;
}

.table>div.key .key-icon,
.table>div.key strong.highlight {
	color: #047857;
}

.table>div.key-down {
	border-color: #fecaca;
	background: #fef2f2;
}

.table>div.key-down .key-icon,
.table>div.key-down strong.highlight {
	color: #dc2626;
}

.comparison-card.down .table .head b:last-child {
	color: #b91c1c;
}

.comparison-card.down .table .head i {
	background: #dc2626;
}

.comparison-card.down .table .row-label em,
.comparison-card.down .table strong em {
	background: #dc2626;
}

.table>div.key-flat {
	border-color: #bfdbfe;
	background: #eff6ff;
}

.table>div.key-flat .key-icon,
.table>div.key-flat strong.highlight {
	color: #2563eb;
}

.comparison-card.flat .table .head b:last-child {
	color: #1d4ed8;
}

.comparison-card.flat .table .head i,
.comparison-card.flat .table .row-label em,
.comparison-card.flat .table strong em {
	background: #2563eb;
}

.comparison-card.flat .table strong.highlight {
	color: #2563eb;
}

.table strong {
	color: #0f172a;
}

.unavailable {
	margin: auto;
	text-align: center;
	font-size: 25px;
}
</style>
