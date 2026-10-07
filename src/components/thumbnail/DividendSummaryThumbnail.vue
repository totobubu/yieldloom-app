<script setup>
import { computed } from 'vue';

const props = defineProps({ data: { type: Object, required: true } });

const formatUsd = (value, digits = 4) =>
    Number.isFinite(Number(value))
        ? `$${Number(value).toFixed(digits).replace(/\.?(0+)$/, '')}`
        : '데이터 없음';

const formatDate = (value) => {
    const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[1].slice(-2)}.${match[2]}.${match[3]}` : '날짜 미정';
};

const change = computed(() => props.data.dividendDifference ?? 0);
const changePercent = computed(() => props.data.dividendChangePercent);
const tone = computed(() => (change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat'));
const chartRows = computed(() => props.data.monthlyTotals ?? []);
const maxTotal = computed(() => Math.max(1, ...chartRows.value.map((row) => row.total)));
</script>

<template>
    <section class="summary-thumbnail thumbnail-container">
        <img :src="data.backgroundImageUrl" class="background" alt="" />
        <div class="scrim" aria-hidden="true" />
        <header><span>최근 배당 정보</span><time>{{ formatDate(data.exDate) }}</time></header>
        <main v-if="data.hasDividend">
            <h1>{{ data.symbol }}</h1>
            <p>이번 세전 배당금</p>
            <strong>{{ formatUsd(data.currentDividendAmount, 6) }}</strong>
            <div class="comparison" :class="tone">
                <span v-if="data.previousDividendAmount > 0">직전 {{ formatUsd(data.previousDividendAmount, 6) }}</span>
                <span v-else>직전 배당 데이터 없음</span>
                <b v-if="data.previousDividendAmount > 0">
                    {{ change >= 0 ? '+' : '' }}{{ formatUsd(change, 6) }}
                    <small v-if="changePercent != null">{{ changePercent >= 0 ? '+' : '' }}{{ Number(changePercent).toFixed(2) }}%</small>
                </b>
            </div>
        </main>
        <p v-else class="unavailable">최근 실제 배당 데이터를 찾지 못했습니다.</p>
        <section v-if="chartRows.length" class="history">
            <p>최근 월별 배당 합계 <small>예정값 제외</small></p>
            <div v-for="row in chartRows" :key="row.month" class="history-row">
                <span>{{ row.month }}</span><b>{{ formatUsd(row.total, 4) }}</b>
                <i><em :style="{ width: `${(row.total / maxTotal) * 100}%` }" /></i>
            </div>
        </section>
        <footer>주당 USD 기준 · 최근 실제 배당 이력</footer>
    </section>
</template>

<style scoped>
.summary-thumbnail { position:relative; isolation:isolate; display:flex; flex-direction:column; width:720px; height:720px; overflow:hidden; padding:52px; color:#fff; font-family:Arial,sans-serif; background:#17212b; box-sizing:border-box; }
.background,.scrim { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:-2; }.scrim { z-index:-1; background:linear-gradient(145deg,rgba(3,12,28,.86),rgba(6,32,68,.64)); }
header { display:flex; justify-content:space-between; font-size:22px; font-weight:700; } main { margin:auto 0 20px; } h1 { margin:0 0 16px; font-size:86px; line-height:1; } main p { margin:0 0 8px; font-size:23px; } main>strong { font-size:58px; }.comparison { display:flex; justify-content:space-between; gap:12px; margin-top:28px; padding:18px; border-radius:12px; background:rgba(255,255,255,.14); font-size:20px; }.comparison b { text-align:right; }.comparison small { display:block; margin-top:4px; }.up b{color:#8cff94}.down b{color:#ff9d9d}.history { padding:18px; border-radius:12px; background:rgba(255,255,255,.95); color:#17212b; }.history>p{margin:0 0 12px;font-weight:800}.history small{font-weight:400}.history-row{display:grid;grid-template-columns:58px 98px 1fr;gap:10px;align-items:center;margin-top:9px}.history-row i{height:12px;border-radius:999px;background:#dce4ed;overflow:hidden}.history-row em{display:block;height:100%;border-radius:inherit;background:#1677ff}.unavailable{margin:auto 0;font-size:28px;text-align:center}footer{margin-top:18px;font-size:15px;text-align:center;opacity:.9}
</style>
