<script setup>
import { computed } from 'vue';

const props = defineProps({ data: { type: Object, required: true } });
const usd = (value, digits = 4) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(digits).replace(/\.?(0+)$/, '')}` : '데이터 없음';
const date = (value) => value ? String(value).replace(/-/g, '.') : '날짜 미정';
const change = computed(() => Number(props.data.dividendDifference ?? 0));
const changePercent = computed(() => Number(props.data.dividendChangePercent));
const tone = computed(() => change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat');
const chartRows = computed(() => props.data.monthlyTotals ?? []);
const maxTotal = computed(() => Math.max(1, ...chartRows.value.map((row) => row.total)));
</script>

<template>
    <section class="summary-card" :class="tone" data-thumbnail-kind="summary">
        <header><div><p>DIVIDEND UPDATE</p><h1>{{ data.symbol }}</h1></div><div class="date"><small>배당락일</small><b>{{ date(data.exDate) }}</b></div></header>
        <template v-if="data.hasDividend"><section class="hero"><p>주당 지급 배당금 <small>세전</small></p><strong>{{ usd(data.currentDividendAmount, 6) }}</strong><span :class="tone"><i>{{ change >= 0 ? '▲' : '▼' }}</i> 직전 대비 {{ change >= 0 ? '+' : '' }}{{ usd(change, 6) }} <b v-if="Number.isFinite(changePercent)">({{ changePercent >= 0 ? '+' : '' }}{{ changePercent.toFixed(2) }}%)</b></span></section><section class="metrics"><div><small>직전 배당금</small><b>{{ usd(data.previousDividendAmount, 6) }}</b></div><div><small>세후 배당금</small><b>{{ usd(data.afterTaxDividendAmount, 6) }}</b><em>15% 가정</em></div><div><small>이번 배당률</small><b>{{ data.exDividendYield != null ? `${Number(data.exDividendYield).toFixed(2)}%` : '—' }}</b><em>배당락 종가 기준</em></div></section></template>
        <p v-else class="unavailable">최근 실제 배당 데이터를 찾지 못했습니다.</p>
        <section v-if="chartRows.length" class="history"><header><b>최근 월별 배당 합계</b><small>예정값 제외</small></header><div v-for="row in chartRows" :key="row.month"><span>{{ row.month }}</span><i><em :style="{ width: `${(row.total / maxTotal) * 100}%` }" /></i><b>{{ usd(row.total, 4) }}</b></div></section>
        <footer>주당 USD 기준 · 세후 금액은 15% 원천징수 단순 가정</footer>
    </section>
</template>

<style scoped>
.summary-card{box-sizing:border-box;width:720px;height:720px;padding:48px;background:radial-gradient(circle at 90% 0,#d1fae599,transparent 29%),radial-gradient(circle at 0 100%,#ccfbf155,transparent 36%),#fff;color:#0f172a;font-family:Arial,sans-serif;display:flex;flex-direction:column}.summary-card>header{display:flex;align-items:start;justify-content:space-between}.summary-card>header p{margin:0;color:#059669;font-size:15px;font-weight:800;letter-spacing:.14em}.summary-card h1{margin:9px 0 0;font-size:70px;line-height:1}.date{padding:10px 13px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffffcc;text-align:right}.date small,.metrics small{display:block;color:#94a3b8;font-size:13px}.date b{font-family:monospace;font-size:17px}.hero{margin:34px 0 18px;padding:34px;border:1.5px solid #d1fae5;border-radius:26px;background:#ecfdf5;text-align:center}.hero p{margin:0;color:#64748b;font-size:19px;font-weight:700}.hero p small{font-size:14px}.hero strong{display:block;margin:14px 0;color:#047857;font-size:62px;letter-spacing:-.05em}.hero span{display:inline-block;padding:9px 15px;border:1px solid #a7f3d0;border-radius:999px;background:#d1fae5;color:#047857;font-size:16px;font-weight:800}.hero span.down{border-color:#fecaca;background:#fef2f2;color:#dc2626}.hero span.flat{border-color:#e2e8f0;background:#f8fafc;color:#475569}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.metrics>div{padding:16px;border:1px solid #e2e8f0;border-radius:16px;background:#ffffffdc}.metrics b{display:block;margin:7px 0 3px;font-size:20px}.metrics em{color:#94a3b8;font-size:11px;font-style:normal}.history{margin-top:auto;padding:17px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc}.history header{display:flex;justify-content:space-between;margin-bottom:9px}.history header small{color:#94a3b8}.history>div{display:grid;grid-template-columns:52px 1fr 92px;gap:10px;align-items:center;margin-top:9px;font-size:13px}.history i{height:9px;border-radius:9px;background:#e2e8f0;overflow:hidden}.history em{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#10b981,#2563eb)}.history>div>b{text-align:right}footer{padding-top:17px;text-align:center;color:#94a3b8;font-size:12px}.unavailable{margin:auto;text-align:center;font-size:25px}
</style>
