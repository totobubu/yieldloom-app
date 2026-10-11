<script setup>
import { computed } from 'vue';
import ThumbnailCardShell from './ThumbnailCardShell.vue';
const props = defineProps({ data: { type: Object, required: true } });
const won = (value) => Number.isFinite(Number(value)) ? `₩${Math.round(Number(value)).toLocaleString('ko-KR')}` : '데이터 없음';
const percent = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '데이터 없음';
const date = computed(() => props.data?.nextExDate?.replaceAll('-', '.') ?? '공시 확인 중');
</script>
<template>
  <ThumbnailCardShell class="holding-card" :title="data.symbol" badge="현재 보유" context-label="내 보유 배당" date-label="다음 배당락" :date-value="date" data-thumbnail-kind="holding-dividend">
    <section v-if="data.supported" class="metrics">
      <p>실제 거래내역 기준 · 가상 재투자 수익률은 포함하지 않습니다.</p>
      <article><small>누적 실수령 배당</small><strong>{{ won(data.dividends) }}</strong><span>거래 원장에 기록된 배당 입금 합계</span></article>
      <article><small>FIFO 잔여 원가</small><strong>{{ won(data.remainingCost) }}</strong><span>부분 매도를 먼저 매수한 수량부터 반영</span></article>
      <article><small>원금회수율</small><strong>{{ percent(data.recoveryRate) }}</strong><span>누적 실수령 배당 ÷ FIFO 잔여 원가</span></article>
      <article><small>다음 배당 예상 현금흐름</small><strong>{{ data.nextCashFlow == null ? '공시 확인 중' : `$${data.nextCashFlow.toFixed(2)}` }}</strong><span>현재 보유 {{ data.shares.toLocaleString() }}주 × 공시 DPS</span></article>
    </section>
    <p v-else class="unavailable">{{ data.reason }}</p>
    <template #footer>ⓘ 실수령 배당은 업로드된 거래 원장만 사용하며, 세금·환전 처리는 증권사 입금 기록 기준입니다.</template>
  </ThumbnailCardShell>
</template>
<style scoped>
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:16px;height:100%;align-content:center}.metrics>p{grid-column:1/-1;margin:0;color:#64748b;font-size:13px}.metrics article{min-height:160px;padding:22px;border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;display:flex;flex-direction:column}.metrics small{color:#64748b;font-size:13px;font-weight:700}.metrics strong{margin:auto 0 10px;color:#1d4ed8;font-size:31px;letter-spacing:-.06em}.metrics span{color:#64748b;font-size:11px;line-height:1.5}.unavailable{padding:80px 20px;text-align:center;color:#64748b}.holding-card{background:linear-gradient(140deg,#f8fbff,#fff)}
</style>
