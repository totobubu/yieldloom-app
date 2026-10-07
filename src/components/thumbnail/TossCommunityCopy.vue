<script setup>
import { computed, ref } from 'vue';
const props = defineProps({ data: { type: Object, required: true } });
const copied = ref(false);
const usd = (v, n = 4) => Number.isFinite(Number(v)) ? `$${Number(v).toFixed(n).replace(/\.?(0+)$/, '')}` : '데이터 없음';
const pct = (v) => Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)}%` : null;
const text = computed(() => {
    const d = props.data;
    if (!d.hasDividend) return `${d.symbol} 최근 배당 정보\n\n최근 실제 배당 데이터를 찾지 못했습니다.`;
    const lines = [`${d.symbol} | ${d.exDate} 주당 ${usd(d.currentDividendAmount, 6)} 배당 정보`, '', `• 배당락일: ${d.exDate}`, `• 배당락일 종가: ${usd(d.exDividendClose, 2)}`, `• 세전 배당금: ${usd(d.currentDividendAmount, 6)}`, `• 세후 배당금(15% 원천징수 가정): ${usd(d.afterTaxDividendAmount, 6)}`];
    if (pct(d.exDividendYield)) lines.push(`• 주가 대비 세전 배당률: ${pct(d.exDividendYield)}`, `• 주가 대비 세후 배당률: ${pct(d.afterTaxDividendYield)}`);
    if (d.previousDividendAmount > 0) lines.push('', `직전 배당 대비 ${d.dividendDifference >= 0 ? '+' : ''}${usd(d.dividendDifference, 6)} (${d.dividendChangePercent >= 0 ? '+' : ''}${pct(d.dividendChangePercent)})`);
    lines.push('', '배당금은 운용사의 향후 공시에 따라 달라질 수 있습니다.', '* 주가 대비 배당률은 연환산 수익률이 아닌 해당 1회 배당금의 배당락일 종가 대비 비율입니다.', '* 투자 판단은 본인의 확인과 책임하에 진행해 주세요.');
    return lines.join('\n');
});
const copy = async () => { if (!navigator.clipboard || !props.data.hasDividend) return; await navigator.clipboard.writeText(text.value); copied.value = true; window.setTimeout(() => (copied.value = false), 2000); };
</script>
<template><aside class="toss-copy"><p>TOSS COMMUNITY</p><h2>{{ data.symbol }} 게시 문구</h2><pre>{{ text }}</pre><button type="button" :disabled="!data.hasDividend" @click="copy">{{ copied ? '복사 완료' : '토스 게시 문구 복사' }}</button></aside></template>
<style scoped>.toss-copy{display:flex;flex-direction:column;padding:24px;border-radius:16px;background:#fff;color:#17212b;box-shadow:0 8px 24px #15212b1a}.toss-copy>p{margin:0;color:#0064ff;font-size:.75rem;font-weight:800;letter-spacing:.1em}.toss-copy h2{margin:10px 0 16px}.toss-copy pre{flex:1;white-space:pre-wrap;font:inherit;line-height:1.6;color:#475569}.toss-copy button{padding:12px;border:0;border-radius:8px;background:#0064ff;color:#fff;font:inherit;font-weight:700;cursor:pointer}.toss-copy button:disabled{opacity:.5;cursor:not-allowed}</style>
