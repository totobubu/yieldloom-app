<script setup>
const props = defineProps({ comparison: { type: Object, default: null }, focalSymbol: { type: String, required: true }, underlying: { type: String, default: '' } });
const usd = (v) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (v) => `${(Number(v) * 100).toFixed(2)}%`;
const crowned = (symbol, metric) => props.comparison?.crowns?.[metric]?.has(symbol);
</script>
<template>
    <section class="rival-card">
        <template v-if="comparison">
            <header><div><p>RIVAL</p><h2>{{ underlying }} 기반 ETF 비교</h2></div><small>{{ comparison.startDate }} — {{ comparison.endDate }}<br /><em v-if="!comparison.usesFullYear">공통 이력 기준</em></small></header>
            <p class="base">기준 {{ underlying }}: {{ pct(comparison.underlying.priceReturn) }} · $10K → {{ usd(comparison.underlying.finalValue) }}</p>
            <div class="matrix"><div class="labels"><span>구분</span><span>최종 평가액</span><span>총수익률</span><span>주가 수익률</span><span>누적 배당금</span><span>VS {{ underlying }}</span></div><div v-for="item in comparison.metrics" :key="item.symbol" class="metric" :class="{ focal: item.symbol === focalSymbol }"><b>{{ item.symbol }}<small v-if="item.symbol === focalSymbol">선택</small></b><strong>{{ crowned(item.symbol, 'totalReturn') ? '👑 ' : '' }}{{ usd(item.finalValue) }}</strong><strong>{{ crowned(item.symbol, 'totalReturn') ? '👑 ' : '' }}{{ pct(item.totalReturn) }}</strong><span>{{ crowned(item.symbol, 'priceReturn') ? '👑 ' : '' }}{{ pct(item.priceReturn) }}</span><span>{{ crowned(item.symbol, 'cumulativeDividends') ? '👑 ' : '' }}{{ usd(item.cumulativeDividends) }}</span><span>{{ pct(item.vsUnderlying) }}</span></div></div>
        </template>
        <p v-else class="empty">선택 종목들과 기초자산의 공통 가격 이력이 부족해 비교를 만들 수 없습니다.</p>
    </section>
</template>
<style scoped>
.rival-card{padding:24px;border-radius:16px;background:#101b2b;color:#f8fafc;overflow-x:auto}.rival-card header{display:flex;justify-content:space-between;gap:16px}.rival-card header p{margin:0;color:#75b4ff;font-size:.75rem;font-weight:800;letter-spacing:.12em}.rival-card h2{margin:4px 0}.rival-card header small{text-align:right;color:#b6c3d4}.rival-card em{font-style:normal;color:#f5bf60}.base{padding:12px;border-radius:8px;background:#ffffff12}.matrix{display:flex;min-width:max-content;border-top:1px solid #ffffff24}.labels,.metric{display:grid;grid-template-rows:repeat(6,42px);min-width:145px}.labels{min-width:118px;color:#b6c3d4}.labels span,.metric>*{display:flex;align-items:center;padding:0 10px;border-bottom:1px solid #ffffff18}.metric{border-left:1px solid #ffffff18}.metric.focal{background:#1677ff24}.metric small{margin-left:5px;color:#75b4ff}.empty{margin:0;color:#b6c3d4}</style>
