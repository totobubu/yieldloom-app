<script setup>
    defineProps({
        name: { type: String, required: true },
        metric: { type: Object, default: undefined },
        suffix: { type: String, default: '' },
        featured: Boolean,
    });
    const labels = {
        available: '확인됨',
        provider_adjusted_estimate: '조정 종가 추정',
        insufficient_history: '이력 부족',
        insufficient_adjusted_history: '조정 이력 부족',
        needs_corporate_action_review: '분할 보정 확인 필요',
        no_prior_dividends: '전년 배당 없음',
        conflicting_sources: '출처 간 차이 확인 필요',
        not_applicable: '해당 없음',
    };
    const hasValue = (value) =>
        value != null && value !== '' && Number.isFinite(Number(value));
</script>
<template>
    <article class="insight-metric" :class="{ featured }">
        <h4>{{ name }}</h4>
        <div class="metric-value">
            <strong>{{
                hasValue(metric?.value)
                    ? Number(metric.value).toLocaleString('ko-KR', {
                          maximumFractionDigits: 4,
                      })
                    : '—'
            }}</strong>
            <span v-if="hasValue(metric?.value)" class="metric-unit">{{
                suffix.trim()
            }}</span>
        </div>
        <div class="metric-meta">
            <span>{{ labels[metric?.status] || '미확인' }}</span>
            <small>{{
                metric?.asOfDate ? `기준 ${metric.asOfDate}` : '기준일 미제공'
            }}</small>
        </div>
    </article>
</template>
<style scoped>
    .insight-metric {
        min-width: 0;
        padding: 20px;
        border: 1px solid var(--app-border-subtle);
        border-radius: 16px;
        background: var(--app-surface);
    }
    h4 {
        margin: 0 0 14px;
        font-size: 13px;
        font-weight: 600;
        color: var(--app-muted);
        line-height: 1.5;
    }
    .metric-value {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 5px;
        font-variant-numeric: tabular-nums;
    }
    strong {
        font-size: 22px;
        line-height: 1.4;
        overflow-wrap: anywhere;
        min-width: 0;
    }
    .metric-unit {
        font-size: 13px;
        color: var(--app-muted);
    }
    .metric-meta {
        display: grid;
        gap: 5px;
        margin-top: 12px;
        font-size: 12px;
        color: var(--app-muted);
    }
    small {
        font-size: 11px;
    }
    .featured {
        padding: 24px;
    }
    .featured strong {
        font-size: 30px;
    }
    .featured .metric-meta {
        border-top: 1px solid var(--app-border-subtle);
        padding-top: 14px;
        margin-top: 18px;
    }
    @media (max-width: 600px) {
        .insight-metric {
            padding: 16px;
        }
        .featured {
            padding: 20px;
        }
        strong {
            font-size: 20px;
        }
        .featured strong {
            font-size: 28px;
        }
    }
</style>
