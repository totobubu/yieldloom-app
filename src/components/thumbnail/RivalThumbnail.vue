<script setup>
const props = defineProps({ data: { type: Object, default: null } });
const usd = (value) => Number.isFinite(Number(value)) ? `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—';
const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(1)}%` : '—';
const date = (value) => value?.replaceAll('-', '.');
const crown = (symbol, metric) => props.data?.comparison?.crowns?.[metric]?.has(symbol);
</script>

<template>
    <section class="thumbnail-artboard rival-artboard" data-thumbnail-kind="rival">
        <template v-if="data?.comparison"><header><div><p>RIVAL</p><h1>{{ data.underlying }} ETF 비교</h1></div><small>{{ date(data.comparison.startDate) }} — {{ date(data.comparison.endDate) }}<br /><em v-if="!data.comparison.usesFullYear">공통 이력 기준</em></small></header><p class="base">기준 {{ data.underlying }} · {{ pct(data.comparison.underlying.priceReturn) }} · $10K → {{ usd(data.comparison.underlying.finalValue) }}</p><div class="matrix"><div class="labels"><span>구분</span><span>최종 평가액</span><span>총수익률</span><span>주가 수익률</span><span>누적 배당금</span><span>VS 기초자산</span></div><div v-for="item in data.comparison.metrics" :key="item.symbol" class="metric" :class="{ selected: item.symbol === data.selectedTicker }"><b>{{ item.symbol }}<small v-if="item.symbol === data.selectedTicker">선택</small></b><strong>{{ crown(item.symbol, 'totalReturn') ? '👑 ' : '' }}{{ usd(item.finalValue) }}</strong><strong>{{ crown(item.symbol, 'totalReturn') ? '👑 ' : '' }}{{ pct(item.totalReturn) }}</strong><span>{{ crown(item.symbol, 'priceReturn') ? '👑 ' : '' }}{{ pct(item.priceReturn) }}</span><span>{{ crown(item.symbol, 'cumulativeDividends') ? '👑 ' : '' }}{{ usd(item.cumulativeDividends) }}</span><span>{{ pct(item.vsUnderlying) }}</span></div></div></template>
        <p v-else class="unavailable">라이벌을 선택하면 공통 가격 이력 기준 비교를 만들 수 있습니다.</p>
        <footer>비교 대상은 같은 기초자산으로 등록된 ETF입니다.</footer>
    </section>
</template>

<style scoped>
.thumbnail-artboard{box-sizing:border-box;width:720px;height:720px;padding:46px;background:#0d1728;color:#f8fafc;font-family:Arial,sans-serif;display:flex;flex-direction:column}.thumbnail-artboard header{display:flex;justify-content:space-between;gap:12px}.thumbnail-artboard header p{margin:0;color:#75b4ff;font-size:16px;font-weight:800;letter-spacing:.14em}.thumbnail-artboard h1{margin:9px 0 0;font-size:35px}.thumbnail-artboard header small{text-align:right;color:#c0cede;line-height:1.6}.thumbnail-artboard header em{font-style:normal;color:#f3be5f}.base{margin:30px 0 20px;padding:16px;border-radius:12px;background:#ffffff12;font-weight:700}.matrix{display:flex;flex:1;min-width:0;border-top:1px solid #ffffff2d;overflow:hidden}.labels,.metric{display:grid;grid-template-rows:repeat(6,1fr);min-width:0;flex:1}.labels{max-width:112px;color:#bdcadd}.labels span,.metric>*{display:flex;align-items:center;padding:0 9px;border-bottom:1px solid #ffffff20;font-size:14px}.metric{border-left:1px solid #ffffff20}.metric.selected{background:#1677ff2e}.metric small{margin-left:4px;color:#7cbdff}.metric strong{color:#fff}.unavailable{margin:auto 0;font-size:26px;text-align:center;line-height:1.45}footer{margin-top:20px;text-align:center;color:#bdcadd;font-size:14px}
</style>
