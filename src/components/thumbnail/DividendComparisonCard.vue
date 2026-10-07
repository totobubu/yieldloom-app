<script setup>
const props = defineProps({ data: { type: Object, required: true } });
const usd = (v, n = 4) => Number.isFinite(Number(v)) ? `$${Number(v).toFixed(n)}` : '데이터 없음';
const pct = (v) => Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)}%` : '데이터 없음';
const date = (v) => v || '데이터 없음';
const rows = () => [
    ['배당락일', date(props.data.previousExDate), date(props.data.exDate)],
    ['배당락일 종가', usd(props.data.previousExDividendClose, 2), usd(props.data.exDividendClose, 2)],
    ['세전 배당금', usd(props.data.previousDividendAmount, 6), usd(props.data.currentDividendAmount, 6)],
    ['세후 배당금 (15%)', usd(props.data.previousAfterTaxDividendAmount, 6), usd(props.data.afterTaxDividendAmount, 6)],
    ['세전 배당률', pct(props.data.previousExDividendYield), pct(props.data.exDividendYield)],
    ['세후 배당률', pct(props.data.previousAfterTaxDividendYield), pct(props.data.afterTaxDividendYield)],
];
</script>
<template>
    <section class="comparison-card"><h2>{{ data.symbol }} 직전 배당 비교</h2><p v-if="!data.previousDividendAmount">직전 배당 데이터가 부족합니다.</p><div v-else class="table"><div class="head"><span>항목</span><b>직전</b><b>이번</b></div><div v-for="row in rows()" :key="row[0]"><span>{{ row[0] }}</span><b>{{ row[1] }}</b><strong>{{ row[2] }}</strong></div></div><small>세후 값은 15% 원천징수 가정입니다.</small></section>
</template>
<style scoped>
.comparison-card{padding:24px;border-radius:16px;background:#fff;color:#17212b;box-shadow:0 8px 24px #15212b1a}.comparison-card h2{margin:0 0 18px}.table>div{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:12px;padding:12px 0;border-bottom:1px solid #e8edf3}.table .head{font-size:.82rem;color:#64748b}.table strong{color:#0064ff}.comparison-card>small{display:block;margin-top:16px;color:#64748b}
</style>
