<script setup>
import { computed } from 'vue';

const props = defineProps({ data: { type: Object, required: true } });
const hasPrevious = computed(() => Number(props.data.previousDividendAmount) > 0);
const difference = computed(() => Number(props.data.dividendDifference ?? 0));
const tone = computed(() => !hasPrevious.value || difference.value === 0 ? 'neutral' : difference.value > 0 ? 'up' : 'down');
const usd = (value, digits = 6) => value != null && Number.isFinite(Number(value)) ? `$${Number(value).toFixed(digits).replace(/\.?(0+)$/, '')}` : '데이터 없음';
const pct = (value) => value != null && Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : '데이터 없음';
const date = (value) => value ? String(value).replaceAll('-', '.') : '데이터 없음';
const rows = computed(() => [
    ['배당락일', date(props.data.previousExDate), date(props.data.exDate)],
    ['배당락일 종가', usd(props.data.previousExDividendClose, 2), usd(props.data.exDividendClose, 2)],
    ['세전 배당금', usd(props.data.previousDividendAmount), usd(props.data.currentDividendAmount)],
    ['세후 배당금 (15%)', usd(props.data.previousAfterTaxDividendAmount), usd(props.data.afterTaxDividendAmount)],
    ['세전 배당률', pct(props.data.previousExDividendYield), pct(props.data.exDividendYield)],
    ['세후 배당률', pct(props.data.previousAfterTaxDividendYield), pct(props.data.afterTaxDividendYield)],
]);
</script>

<template>
    <section class="thumbnail-artboard comparison-artboard" :class="tone" data-thumbnail-kind="comparison">
        <header><div><p>DIVIDEND COMPARISON</p><h1>{{ data.symbol }}</h1></div><time>{{ date(data.exDate) }}</time></header>
        <template v-if="data.hasDividend"><section class="headline"><span>직전 배당 대비</span><strong>{{ hasPrevious ? `${difference >= 0 ? '+' : ''}${usd(difference)}` : '비교 불가' }}</strong><b v-if="hasPrevious">{{ data.dividendChangePercent >= 0 ? '+' : '' }}{{ pct(data.dividendChangePercent) }}</b></section><div class="table"><div class="head"><span>항목</span><b>직전</b><b>이번</b></div><div v-for="row in rows" :key="row[0]"><span>{{ row[0] }}</span><b>{{ row[1] }}</b><strong>{{ row[2] }}</strong></div></div></template>
        <p v-else class="unavailable">최근 실제 배당 데이터를 찾지 못했습니다.</p>
        <footer>주당 USD 기준 · 세후 금액은 15% 원천징수 단순 가정</footer>
    </section>
</template>

<style scoped>
.thumbnail-artboard{box-sizing:border-box;width:720px;height:720px;padding:48px;display:flex;flex-direction:column;border-radius:2px;background:#111c2d;color:#f8fafc;font-family:Arial,sans-serif}.thumbnail-artboard header{display:flex;justify-content:space-between;align-items:flex-start}.thumbnail-artboard header p{margin:0;color:#90bfff;font-size:15px;font-weight:800;letter-spacing:.13em}.thumbnail-artboard h1{margin:10px 0 0;font-size:70px;line-height:1}.thumbnail-artboard time{font-weight:700;font-size:19px}.headline{display:grid;grid-template-columns:1fr auto;gap:8px;margin:46px 0 28px;padding:24px;border-radius:16px;background:#ffffff12}.headline span{font-size:20px}.headline strong{font-size:37px}.headline b{grid-column:1 / -1;font-size:22px}.up .headline b{color:#8cff94}.down .headline b{color:#ff9d9d}.table{border-top:1px solid #ffffff36}.table>div{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:12px;padding:17px 0;border-bottom:1px solid #ffffff24;font-size:17px}.table .head{font-size:14px;color:#bdcadd}.table strong{color:#94c5ff}.unavailable{margin:auto 0;font-size:28px;text-align:center}footer{margin-top:auto;padding-top:22px;color:#bdcadd;font-size:14px;text-align:center}
</style>
