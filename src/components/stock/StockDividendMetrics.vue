<script setup>
    import { computed } from 'vue';
    import InsightMetricCard from '@/components/thumbnail/InsightMetricCard.vue';
    const props = defineProps({
        sectionNumber: { type: Number, default: 0 },
        metrics: { type: Array, default: () => [] },
        trailing: { type: Object, required: true },
        currency: { type: String, default: '' },
    });
    const trailingMetric = (value) => ({
        value,
        status:
            props.trailing.complete && value != null
                ? 'available'
                : 'insufficient_history',
        asOfDate: props.trailing.end,
    });
    // Reuse the existing public metric objects, without a second data request.
    // The two TTM values use the same explicit coverage contract as the header/card.
    const rows = computed(() => [
        ['1년 총수익률', props.metrics[0]?.[1], '%'],
        [
            '최근 12개월 주당 배당금',
            trailingMetric(props.trailing.amount),
            props.currency,
        ],
        [
            '최근 12개월 배당률 · 세전',
            trailingMetric(props.trailing.yieldPercent),
            '%',
        ],
        ['운용 보수 (운용수수료)', props.metrics[6]?.[1], '%'],
        ['순자산가치 (NAV)', props.metrics[11]?.[1], 'USD'],
        ['총 운용자산 (AUM)', props.metrics[7]?.[1], 'USD'],
        ['매수·매도 스프레드', props.metrics[10]?.[1], '%'],
        ['평균 거래량', props.metrics[9]?.[1], '주'],
        ['시가총액', props.metrics[8]?.[1], 'USD'],
    ]);
</script>
<template>
    <section
        class="dividend-core-metrics"
        aria-labelledby="dividend-core-heading">
        <header>
            <h2 id="dividend-core-heading">
                <span v-if="sectionNumber" aria-hidden="true"
                    >{{ sectionNumber }}. </span
                >핵심 재무 &amp; 배당 지표
            </h2>
            <span>9개 지표</span>
        </header>
        <div class="dividend-core-grid">
            <InsightMetricCard
                v-for="([name, metric, suffix], index) in rows"
                :key="name"
                :class="{ 'ttm-metric': index === 1 || index === 2 }"
                :name="`${index + 1}. ${name}`"
                :metric="metric"
                :suffix="suffix" />
        </div>
        <p>
            미확인 항목은 연결된 자료가 없거나 확인이 필요한 상태이며 0이
            아닙니다. 지표별 기준일·기간·수집 출처가 다를 수 있습니다. 12개월
            지표는 전체 기간의 완전성이 확인된 경우에만 표시합니다.
        </p>
    </section>
</template>
<style scoped>
    .dividend-core-metrics {
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
    }
    h2 {
        margin: 0;
        font-size: 20px;
    }
    header > span {
        font-size: 11px;
        color: var(--app-muted);
        background: var(--app-surface-muted);
        padding: 4px 8px;
        border-radius: 4px;
    }
    .dividend-core-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
    }
    .dividend-core-grid :deep(.insight-metric) {
        padding: 16px;
        border-radius: 8px;
        background: var(--app-bg);
    }
    .dividend-core-grid :deep(h4) {
        margin-bottom: 8px;
        font-size: 14px;
    }
    .dividend-core-grid :deep(strong) {
        font-size: 18px;
    }
    .dividend-core-grid :deep(.metric-meta) {
        margin-top: 8px;
        gap: 4px;
        font-size: 11px;
    }
    .dividend-core-grid :deep(.ttm-metric) {
        background: var(--app-accent-light);
    }
    .dividend-core-grid :deep(.ttm-metric strong) {
        color: var(--app-accent);
    }
    p {
        margin: 16px 0 0;
        font-size: 12px;
        color: var(--app-muted);
    }
    @media (max-width: 1023px) {
        .dividend-core-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 767px) {
        .dividend-core-metrics {
            padding: 20px;
        }
    }
    @media (max-width: 639px) {
        .dividend-core-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
