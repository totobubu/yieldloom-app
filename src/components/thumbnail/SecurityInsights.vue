<script setup>
import { computed, ref, watch } from 'vue';
import { getAssetUrl } from '@/utils/dataUrl';

const props = defineProps({ symbol: { type: String, required: true } });
const data = ref(null), loading = ref(false), failed = ref(false), asOf = ref('');
let sequence = 0;
const safeUrl = (value) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
const labels = { available: '확인됨', provider_adjusted_estimate: '조정 종가 추정', not_available: '미확인', insufficient_history: '이력 부족', insufficient_adjusted_history: '조정 이력 부족', needs_corporate_action_review: '분할 보정 확인 필요', no_prior_dividends: '전년 배당 없음', conflicting_sources: '출처 간 차이 확인 필요', estimated: '추정', final: '확정', unclassified: '미분류', fiscal_year_to_date: '회계연도 누적', payment: '지급 건', collected: '수집 완료', partial: '일부 항목 누락', unavailable: '조회 불가', ineligible: '수집 대상 아님' };
const label = (value) => labels[value] ?? '미확인';
const number = (value, suffix = '') => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${suffix}`;
const metrics = computed(() => {
    const d = data.value ?? {}, p = d.performance ?? {}, q = d.quote ?? {}, c = d.dividendCapacity ?? {};
    return [
        ['1년 총수익률', p.totalReturn1Y, '%'], ['최근 12개월 주당 배당', p.ttmDividendPerShare, ' USD'],
        ['최근 12개월 배당수익률', p.ttmDividendYield, '%'], ['전년 대비 배당 증감', p.ttmDividendGrowth, '%'],
        ['이익 배당성향', q.reportedPayoutRatio, '%'], ['FCF 배당성향', c.fcfPayoutRatio, '%'],
        ['운용 보수', d.fund?.expenseRatio, '%'], ['운용자산', q.assetsUnderManagement, ' USD'],
        ['시가총액', q.marketCap, ' USD'], ['평균 거래량', q.averageDailyVolume, '주'],
        ['현재 호가 스프레드', q.bidAskSpread, '%'], ['NAV 관측값', q.navSnapshot, ' USD'],
    ];
});
const rocRows = computed(() => [...(data.value?.rocObservations ?? [])].sort((a, b) => String(b.payableDate ?? b.throughPaymentDate ?? b.exDate ?? '').localeCompare(String(a.payableDate ?? a.throughPaymentDate ?? a.exDate ?? ''))));
watch(() => props.symbol, async (value) => {
    const current = ++sequence, symbol = String(value).trim().toUpperCase().replaceAll('.', '-');
    data.value = null; failed.value = false; loading.value = true;
    try {
        const bucket = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 64;
        const response = await fetch(getAssetUrl(`security-insights/${bucket}.json`));
        if (!response.ok) throw new Error('Could not load insights');
        const payload = await response.json();
        if (current === sequence) { data.value = payload.securities[symbol] ?? null; asOf.value = payload.asOfDate; }
    } catch { if (current === sequence) failed.value = true; }
    finally { if (current === sequence) loading.value = false; }
}, { immediate: true });
</script>

<template>
    <section class="security-insights" aria-labelledby="insights-heading" :aria-busy="loading">
        <header><h2 id="insights-heading">{{ symbol }} 누적 데이터</h2><p v-if="data">수집 {{ data.collectedAt?.slice(0, 10) || asOf }} · {{ label(data.status) }}</p></header>
        <p v-if="loading" role="status">누적 데이터를 불러오는 중…</p>
        <p v-else-if="failed" role="status">누적 데이터를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.</p>
        <p v-else-if="!data">아직 이 종목의 누적 데이터가 없습니다.</p>
        <template v-else>
            <p v-if="data.performance?.freshness === 'stale'" class="notice">가격 갱신이 지연된 데이터입니다. 각 지표의 기준일을 확인해 주세요.</p>
            <div class="metric-grid"><article v-for="[name, metric, suffix] in metrics" :key="name"><h3>{{ name }}</h3><strong>{{ number(metric?.value, suffix) }}</strong><small>{{ label(metric?.status) }} · {{ metric?.asOfDate ? `기준 ${metric.asOfDate}` : '기준일 미제공' }}</small></article></div>
            <p class="basis">최근 12개월 지표는 배당락일 기준입니다. 총수익률은 Yahoo 조정 종가로 계산한 추정치이며, 호가 스프레드는 수집 시점의 값입니다. 미확인은 0을 뜻하지 않습니다.</p>
            <p v-if="safeUrl(data.sourceUrl)">지표 출처: <a :href="safeUrl(data.sourceUrl)" target="_blank" rel="noopener noreferrer">{{ data.source || 'Yahoo Finance' }}</a></p>
            <h3>ROC 이력 <small>{{ rocRows.length }}건</small></h3>
            <p class="basis">추정치는 확정 세무 분류와 다를 수 있습니다. 회계연도 누적치와 지급 건을 따로 표시하며, 개인의 달력연도 세무 결과를 뜻하지 않습니다. 표를 가로로 밀어 금액과 원문을 확인할 수 있습니다.</p>
            <p v-if="!rocRows.length">공개된 ROC 근거를 수집하지 못했습니다. ROC 0%를 의미하지 않습니다.</p>
            <div v-else class="table-scroll" tabindex="0" role="region" aria-label="ROC 누적 이력"><table><thead><tr><th>상태 · 범위</th><th>지급일 / 누적 종료일</th><th>배당락일</th><th>분배금 (USD)</th><th>ROC (USD)</th><th>ROC 비율</th><th>원문</th></tr></thead><tbody><tr v-for="row in rocRows" :key="row.observationId"><td><span class="badge" :class="row.classificationStatus">{{ label(row.classificationStatus) }}</span><small>{{ label(row.scope) }}</small></td><td>{{ row.payableDate || row.throughPaymentDate || '미확인' }}<small v-if="row.fiscalYearEnd">회계연도 종료 {{ row.fiscalYearEnd }}</small></td><td>{{ row.exDate || '미확인' }}</td><td>{{ row.distributionAmount ?? '—' }}</td><td>{{ row.rocAmount ?? '—' }}</td><td>{{ row.rocPercent == null ? '—' : `${row.rocPercent}%` }}</td><td><a v-if="safeUrl(row.sourceUrl)" :href="safeUrl(row.sourceUrl)" target="_blank" rel="noopener noreferrer">출처</a><span v-else>미확인</span></td></tr></tbody></table></div>
            <details v-if="data.navHistory?.status === 'available'"><summary>공식 NAV 기록 요약</summary><p>{{ data.navHistory.availableStart }} ~ {{ data.navHistory.asOfDate }} · {{ data.navHistory.rowCount }}개 관측</p><p>분배금 제외 NAV 변화 {{ number(data.navHistory.availablePeriodPriceChangePercent, '%') }} (가용 기간 기준)</p><a v-if="safeUrl(data.navHistory.sourceUrl)" :href="safeUrl(data.navHistory.sourceUrl)" target="_blank" rel="noopener noreferrer">운용사 원문</a></details>
            <details v-if="data.dividendCapacity?.quarterlyObservations?.length"><summary>배당 지급 여력의 분기별 근거</summary><p>보고 통화: {{ data.financialCurrency || '미확인' }} · 현금배당은 제공처의 지출 부호를 유지합니다.</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>분기 종료일</th><th>잉여현금흐름</th><th>현금배당</th></tr></thead><tbody><tr v-for="row in data.dividendCapacity.quarterlyObservations" :key="row.periodEnd"><td>{{ row.periodEnd }}</td><td>{{ number(row.freeCashFlow) }}</td><td>{{ number(row.cashDividendsPaid) }}</td></tr></tbody></table></div></details>
            <details v-if="data.officialDistributionCalendar?.length"><summary>공식 배당 일정 이력</summary><div class="table-scroll" tabindex="0"><table><thead><tr><th>배당락일</th><th>지급일</th><th>출처</th></tr></thead><tbody><tr v-for="row in data.officialDistributionCalendar" :key="`${row.exDate}-${row.payableDate}`"><td>{{ row.exDate || '미확인' }}</td><td>{{ row.payableDate || '미확인' }}</td><td><a v-if="safeUrl(row.sourceUrl)" :href="safeUrl(row.sourceUrl)" target="_blank" rel="noopener noreferrer">운용사</a></td></tr></tbody></table></div></details>
            <details v-if="data.dividendEtfs?.length"><summary>배당 ETF 편입 근거</summary><ul><li v-for="row in data.dividendEtfs" :key="row.etf || row.ticker">{{ row.etf || row.ticker }} · 편입 비중 {{ number(row.weightPercent, '%') }} · {{ row.asOfDate || '기준일 미제공' }} <a v-if="safeUrl(row.sourceUrl)" :href="safeUrl(row.sourceUrl)" target="_blank" rel="noopener noreferrer">출처</a></li></ul></details>
        </template>
    </section>
</template>

<style scoped>
.security-insights{margin:2rem 0;padding:1.5rem;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:16px;background:var(--p-content-background,#fff);color:var(--p-text-color,#172033)}header{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}h2{margin:0 0 1rem;font-size:1.3rem}h3{font-size:1rem}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:.8rem}.metric-grid article{padding:1rem;background:var(--p-surface-50,#f8fafc);border-radius:10px}.metric-grid h3{font-size:.85rem;margin:0 0 .6rem}.metric-grid strong{display:block;font-size:1.25rem;overflow-wrap:anywhere}small{display:block;font-size:.75rem;margin-top:.4rem;color:var(--p-text-muted-color,#5b6575)}.basis{font-size:.85rem;line-height:1.7;color:var(--p-text-muted-color,#5b6575)}.table-scroll{overflow:auto;max-height:420px}table{width:100%;border-collapse:collapse;font-size:.85rem;white-space:nowrap}th,td{padding:.75rem;text-align:left;border-bottom:1px solid var(--p-content-border-color,#dbe3ee)}th{position:sticky;top:0;background:var(--p-content-background,#fff)}a{color:#1d4ed8;text-decoration:underline}.badge{padding:.2rem .4rem;border-radius:4px;background:#eef2ff;color:#3730a3}.badge.estimated{background:#fff7ed;color:#9a3412}.badge.final{background:#ecfdf5;color:#065f46}details{margin-top:1rem;padding:1rem;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:8px}summary{cursor:pointer;font-weight:600}.notice{color:#9a3412}@media(max-width:600px){.security-insights{padding:1rem}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-grid strong{font-size:1rem}}
</style>
