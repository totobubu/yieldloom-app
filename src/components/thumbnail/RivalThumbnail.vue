<script setup>
import { computed } from 'vue';
import ThumbnailCardShell from './ThumbnailCardShell.vue';
const props = defineProps({ data: { type: Object, default: null } });
const usd = (value) => Number.isFinite(Number(value)) ? `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—';
const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(1)}%` : '—';
const date = (value) => value?.replace(/-/g, '.');
const shortDate = (value) => value ? String(value).slice(2).replace(/-/g, '.') : '상장일 미정';
const crown = (symbol, metric) => props.data?.comparison?.crowns?.[metric]?.has(symbol);
const price = (value) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2).replace(/\.00$/, '')}` : '—';
const periodMonths = computed(() => {
	const comparison = props.data?.comparison;
	if (!comparison?.startDate || !comparison?.endDate) return null;
	return Math.max(1, Math.round((new Date(`${comparison.endDate}T12:00:00Z`) - new Date(`${comparison.startDate}T12:00:00Z`)) / (30.4375 * 24 * 60 * 60 * 1000)));
});
const frequencyLabel = (frequency) => ({ 매주: '주배당', 매월: '월배당', 분기: '분기배당', 반기: '반기배당', 매년: '연배당' }[frequency] ?? '배당 ETF');
</script>
<template>
	<ThumbnailCardShell class="rival-card" title="RIVAL" context-label="라이벌 비교"
		:badge="data?.underlying ? `${data.underlying} ETF 비교` : 'ETF 비교'"
		:date-label="`비교 기간 · 약 ${periodMonths ?? '—'}개월`"
		:date-value="data?.comparison ? `${date(data.comparison.startDate)} — ${date(data.comparison.endDate)}` : ''"
		data-thumbnail-kind="rival">
		<template v-if="data?.comparison">
			<section class="base"><span>기준 {{ data.underlying }}</span><b>{{
				price(data.comparison.underlying.startPrice) }} → {{ price(data.comparison.underlying.endPrice)
					}}</b><b>{{ pct(data.comparison.underlying.priceReturn)
					}}</b><i /> <small>$10K 투자 시</small><strong>{{ usd(data.comparison.underlying.finalValue)
					}}</strong></section>
			<section class="matrix">
				<div class="labels"><span>구분</span><span>10K 최종 평가</span><span>총수익률 (TR)</span><span>주가
						수익률</span><span>누적
						배당금</span><span>주가(시작→종료)</span><span>주식정보</span><span>VS {{ data.underlying }}</span></div>
				<div v-for="item in data.comparison.metrics" :key="item.symbol" class="metric"
					:class="{ selected: item.symbol === data.selectedTicker }"><b>{{ item.symbol }}<small
							v-if="item.symbol === data.selectedTicker">선택</small></b><strong
						:class="{ negative: Number(item.finalValue) < 10000 }">{{ crown(item.symbol,
							'totalReturn') ? '👑 ' : '' }}{{ usd(item.finalValue) }}</strong><strong
						:class="{ negative: Number(item.totalReturn) < 0 }">{{ crown(item.symbol,
							'totalReturn') ? '👑 ' : '' }}{{ pct(item.totalReturn) }}</strong><span
						:class="{ negative: Number(item.priceReturn) < 0 }">{{ crown(item.symbol,
							'priceReturn') ? '👑 ' : '' }}{{ pct(item.priceReturn) }}</span><span>{{ crown(item.symbol,
							'cumulativeDividends') ? '👑 ' : '' }}{{ usd(item.cumulativeDividends) }}</span><span>{{
							price(item.startPrice) }}→{{ price(item.endPrice) }}</span><span class="stock-info"><small>{{
							shortDate(item.ipoDate) }}</small><b>{{ frequencyLabel(item.frequency) }}</b><em>{{
								item.actualPayments }}회 누적</em></span><span><em class="status"
							:class="item.vsUnderlying >= 0 ? 'win' : 'lose'">{{ item.vsUnderlying >= 0 ? 'WIN' : 'LOSE'
							}}</em></span></div>
			</section>
		</template>
		<p v-else class="unavailable">라이벌을 선택하면 공통 가격 이력 기준 비교를 만들 수 있습니다.</p>
		<template #footer>동일 기초자산 ETF · 초기 투자금 $10,000 · 배당 재투자 기준</template>
	</ThumbnailCardShell>
</template>
<style scoped lang="scss">
.rival-card {
	:deep(.thumbnail-card-header) {
		align-items: center;
		margin-bottom: 0;
	}

}

.range {
	position: absolute;
	top: 43px;
	right: 45px;
	display: flex;
	align-items: center;
	gap: 8px
}

.range b {
	padding: 8px 10px;
	border: 1px solid #e2e8f0;
	border-radius: 8px;
	background: #fff;
	font-size: 13px
}

.range small {
	color: #94a3b8;
	font-size: 11px
}

.base {
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 11px 13px;
	border: 1px solid #e2e8f0;
	border-radius: 12px;
	background: #f8fafcb3;
	color: #475569;
	font-family: 'Pretendard', sans-serif;
}

.base span {
	padding: 5px 7px;
	border: 1px solid #fecaca;
	border-radius: 6px;
	background: #fff1f2;
	color: #dc2626;
	font-size: 12px;
	font-weight: 800
}

.base>b {
	color: #dc2626;
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
}

.base>b:first-of-type {
	color: #475569;
	font-weight: 600;
}

.base i {
	height: 18px;
	border-left: 1px solid #cbd5e1
}

.base small {
	margin-left: auto;
	font-size: 14px;
	font-weight: 500
}

.base strong {
	padding: 6px 9px;
	border: 1px solid #c7d2fe;
	border-radius: 6px;
	background: #fff;
	color: #312e81;
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
	font-size: 16px;
	font-weight: 800
}

.matrix {
	display: flex;
	flex: 1;
	overflow: hidden;
	border: 1px solid #e2e8f0;
	border-radius: 16px;
	background: #fff;
	box-shadow: none
}

.labels,
.metric {
	display: grid;
	grid-template-rows: repeat(8, 1fr);
	min-width: 0;
	flex: 1
}

.labels {
	flex: 0 0 25%;
	max-width: none;
	background: #f8fafce6;
	color: #64748b
}

.labels span,
.metric>* {
	display: flex;
	align-items: center;
	padding: 0 12px;
	border-bottom: 1px solid #f1f5f9;
	font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
	font-size: 15px
}

.labels span:first-child,
.metric>*:first-child {
	background: #f1f5f9cc;
	color: #0f172a;
	font-size: 16px;
	font-weight: 800
}

.labels span:nth-child(2),
.metric>*:nth-child(2) {
	background: #eef2ff66;
	color: #312e81
}

.labels span:nth-child(3),
.metric>*:nth-child(3) {
	border-top: 1px solid #fecaca;
	border-bottom: 1px solid #fecaca;
	background: #fff1f2aa;
	font-weight: 800
}

.metric {
	// border-left: 1px solid #e2e8f0
}

.metric>* {
	justify-content: center;
	text-align: center
}

.metric.selected {
	background: transparent
}

.metric.selected>b {
	color: #4338ca;
	background: #eef2ff;
}

.metric.selected>b:before {
	content: '';
	position: absolute
}

.metric small {
	margin-left: 5px;
	padding: 3px 6px;
	border-radius: 999px;
	background: #4338ca;
	color: #fff;
	font-family: 'Pretendard', sans-serif;
	font-size: 10px;
	font-weight: 800
}

.metric strong {
	color: #0f172a;
	font-weight: 700
}

.stock-info {
	flex-direction: column;
	justify-content: center;
	gap: 2px;
	line-height: 1.1;

	small {
		color: #64748b;
		font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
		font-size: 12px;
		font-weight: 500;
	}

	b {
		color: #0f172a;
		font-family: 'Pretendard', sans-serif;
		font-size: 14px;
		font-weight: 800;
	}

	em {
		color: #4338ca;
		font-family: 'Pretendard', sans-serif;
		font-size: 12px;
		font-style: normal;
		font-weight: 800;
	}
}

.metric>span:last-child .status {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 4px 12px;
	border-radius: 999px;
	font-size: 12px;
	font-style: normal;
	font-weight: 800;
	line-height: 1;

	&.win {
		border: 1px solid #86efac;
		background: #f0fdf4;
		color: #15803d;
	}

	&.lose {
		border: 1px solid #fecaca;
		background: #fff1f2;
		color: #dc2626;
	}
}

.metric> :nth-child(2).negative,
.metric> :nth-child(3).negative,
.metric> :nth-child(4).negative {
	color: #dc2626;
	font-weight: 800;
}

.unavailable {
	margin: auto;
	text-align: center;
	font-size: 25px
}
</style>
