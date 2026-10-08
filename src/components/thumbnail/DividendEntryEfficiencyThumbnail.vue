<script setup>
import { computed } from 'vue';
import ThumbnailCardShell from './ThumbnailCardShell.vue';

const props = defineProps({ data: { type: Object, required: true } });
const usd = (value) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—';
const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
const years = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}년` : '—';
const date = (value) => value ? String(value).replace(/-/g, '.') : '—';
const bars = computed(() => {
    const samples = props.data?.samples ?? [];
    const max = Math.max(...samples.map((sample) => sample.afterTaxYield), 1);
    return samples.map((sample) => ({
        ...sample,
        height: `${Math.max(10, (sample.afterTaxYield / max) * 100)}%`,
        best: sample.date === props.data?.best?.date,
        latest: sample.date === props.data?.latest?.date,
    }));
});
</script>

<template>
    <ThumbnailCardShell class="entry-efficiency-card" data-thumbnail-kind="entry-efficiency">
        <template #header>
            <div><p>INCOME ENTRY MAP</p><h1>{{ data.symbol }}</h1></div>
            <div class="as-of"><small>분석 기준일</small><b>{{ date(data.asOfDate) }}</b></div>
        </template>
        <template v-if="data.available">
            <section class="intro"><div><p>매수 시점별 세후 TTM 배당률</p><strong>언제 샀을 때 배당 효율이 높았나</strong></div><span>최근 24개월 중 {{ data.samples.length }}개 표본</span></section>
            <section class="highlights">
                <article class="best"><header><span>★ 최고 효율 매수</span><b>{{ date(data.best.date) }}</b></header><strong>{{ pct(data.best.afterTaxYield) }}</strong><p>매수가 {{ usd(data.best.price) }} · 배당 회수 {{ years(data.best.paybackYears) }}</p></article>
                <article><header><span>● 최근 매수 기준</span><b>{{ date(data.latest.date) }}</b></header><strong>{{ pct(data.latest.afterTaxYield) }}</strong><p>매수가 {{ usd(data.latest.price) }} · 배당 회수 {{ years(data.latest.paybackYears) }}</p></article>
            </section>
            <section class="chart"><header><div><b>월별 진입 배당률</b><small>세후 TTM</small></div><span>높을수록 배당 회수기간 단축</span></header><div class="bar-area"><article v-for="sample in bars" :key="sample.date" :class="{ best: sample.best, latest: sample.latest }" :title="`${date(sample.date)} · ${pct(sample.afterTaxYield)} · ${years(sample.paybackYears)}`"><i :style="{ height: sample.height }" /><small v-if="sample.best">BEST</small><em>{{ sample.month }}</em></article></div></section>
            <section class="formula"><div><span>세후 TTM 배당금</span><b>{{ usd(data.latest.afterTaxAnnualDividend) }}</b></div><i>÷</i><div><span>최근 매수가</span><b>{{ usd(data.latest.price) }}</b></div><i>=</i><div><span>예상 배당 회수</span><b>{{ years(data.latest.paybackYears) }}</b></div></section>
        </template>
        <p v-else class="unavailable">{{ data.reason }}</p>
        <template #footer>매수일 이전 12개월 실제 배당 기준 · 세후 15% 원천징수 단순 가정 · 배당 유지 가정이며 주가 변동·매도차익·재투자는 제외</template>
    </ThumbnailCardShell>
</template>

<style scoped>
.entry-efficiency-card{box-sizing:border-box;width:720px;height:720px;padding:32px;background:radial-gradient(circle at 96% 3%,#fef3c7aa,transparent 31%),radial-gradient(circle at 0 98%,#dbeafe99,transparent 33%),#fff;color:#17212b;}.entry-efficiency-card :deep(.thumbnail-card-header){align-items:center;margin-bottom:16px}.entry-efficiency-card :deep(.thumbnail-card-header p){margin:0;color:#b45309;font-size:12px;font-weight:900;letter-spacing:.14em}.entry-efficiency-card h1{margin:5px 0 0;font-weight:800;font-size:40px;line-height:1;letter-spacing:-.08em}.as-of{padding:9px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffffc9;text-align:right}.as-of small{display:block;color:#94a3b8;font-size:10px;font-weight:700}.as-of b{font-weight:800;font-size:14px}.intro{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:14px 16px;border:1px solid #fde68a;border-radius:16px;background:#fffbeb}.intro p,.intro strong{display:block;margin:0}.intro p{color:#92400e;font-size:13px;font-weight:800}.intro strong{margin-top:5px;font-size:18px}.intro>span{padding:7px 9px;border-radius:7px;background:#fff;color:#92400e;font-size:11px;font-weight:800}.highlights{display:grid;grid-template-columns:1fr 1fr;gap:12px}.highlights article{padding:15px;border:1px solid #dbe3ec;border-radius:16px;background:#ffffffd9}.highlights article.best{border-color:#f59e0b;background:#fffaf0}.highlights header{display:flex;justify-content:space-between;gap:6px;color:#64748b;font-size:11px;font-weight:800}.highlights .best header span{color:#b45309}.highlights header b{}.highlights strong{display:block;margin:11px 0 6px;color:#1d4ed8;font-size:33px;letter-spacing:-.04em}.highlights .best strong{color:#b45309}.highlights p{margin:0;color:#64748b;font-size:11px;font-weight:700}.chart{flex:1;min-height:0;margin-top:14px;padding:15px;border:1px solid #dbe3ec;border-radius:18px;background:#ffffffd9}.chart>header{display:flex;justify-content:space-between;align-items:center}.chart header b{font-size:15px}.chart header small,.chart header>span{margin-left:8px;color:#94a3b8;font-size:11px;font-weight:700}.bar-area{display:flex;align-items:flex-end;gap:5px;height:184px;margin-top:12px;padding:10px 5px 0;border-bottom:1px solid #cbd5e1;background:linear-gradient(#e2e8f080 1px,transparent 1px);background-size:100% 46px}.bar-area article{position:relative;display:flex;flex:1;min-width:0;height:100%;flex-direction:column;justify-content:flex-end;align-items:center}.bar-area i{display:block;width:100%;max-width:19px;border-radius:5px 5px 1px 1px;background:#93c5fd}.bar-area .best i{background:#f59e0b;box-shadow:0 0 0 2px #fef3c7}.bar-area .latest i{background:#2563eb}.bar-area small{position:absolute;top:-2px;color:#b45309;font-weight:800;font-size:8px;transform:rotate(-45deg)}.bar-area em{position:absolute;bottom:-19px;color:#94a3b8;font-weight:700;font-size:8px;font-style:normal;transform:rotate(-45deg)}.formula{display:flex;align-items:center;justify-content:center;gap:11px;margin-top:22px;padding:12px;border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc}.formula div{text-align:center}.formula span{display:block;color:#64748b;font-size:10px;font-weight:700}.formula b{display:block;margin-top:4px;color:#0f172a;font-weight:800;font-size:14px}.formula i{color:#94a3b8;font-size:16px;font-style:normal}.unavailable{margin:auto;text-align:center;color:#64748b;font-size:22px;font-weight:700}.entry-efficiency-card :deep(.thumbnail-card-footer){padding-top:12px;color:#64748b;font-size:10px;line-height:1.45}
</style>
