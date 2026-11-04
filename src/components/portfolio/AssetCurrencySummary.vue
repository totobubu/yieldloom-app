<script setup>
    import { computed } from 'vue';
    import { formatStoredAmount } from '@/utils/formatStoredAmount.js';
    const props = defineProps({
        summary: { type: Object, default: null },
        accountCount: { type: Number, default: 0 },
        scopeName: { type: String, default: '' },
        compact: Boolean,
    });
    const currencies = computed(() => [
        ...new Set([
            'KRW',
            'USD',
            ...Object.keys(props.summary?.knownValueByCurrency || {}),
        ]),
    ]);
    const amount = (currency) => {
        const values = props.summary?.knownValueByCurrency || {};
        return Object.hasOwn(values, currency)
            ? formatStoredAmount(values[currency], currency)
            : '미확인';
    };
    const hasEstimated = (currency) =>
        (props.summary?.positions || []).some(
            (row) =>
                row.currency === currency &&
                (row.estimated || row.calculationMode === 'estimated')
        );
    const status = (currency) =>
        amount(currency) === '미확인'
            ? '해당 통화 평가액 미확인'
            : !props.summary?.valueComplete
              ? '일부 자료 미확인 · 확인된 금액만 포함'
              : hasEstimated(currency)
                ? '추정 평가액 포함 · 저장 자료 기준'
                : '확인된 저장 평가액';
    const count = (currency) =>
        new Set(
            (props.summary?.positions || [])
                .filter((row) => row.currency === currency)
                .map((row) => row.accountId)
        ).size;
</script>
<template>
    <div
        class="asset-currency-summary"
        :class="{ 'currency-summary-compact': compact }"
        :aria-label="
            compact
                ? '권한 있는 전체 계좌 통화별 자료 평가액'
                : '선택 명의자 통화별 자료 평가액'
        ">
        <p class="currency-scope sr-only">
            {{ scopeName || '선택 명의자' }} · {{ accountCount }}개 계좌 · 저장
            자료 평가액
        </p>
        <template v-if="compact">
            <div class="compact-currency-title">
                <h3>통화별 자료평가액 독립 합계</h3>
                <small>전체 계좌 기준 · 환산·합산 없음</small>
            </div>
            <div class="compact-currency-values">
                <article
                    v-for="currency in currencies"
                    :key="currency"
                    :data-currency="currency">
                    <span>{{ currency }} 합계</span
                    ><strong>{{ amount(currency) }}</strong
                    ><small
                        >{{ count(currency) }}개 계좌{{
                            hasEstimated(currency) ? ' · 추정 포함' : ''
                        }}</small
                    >
                    <p
                        v-if="
                            amount(currency) === '미확인' ||
                            !summary?.valueComplete
                        ">
                        {{ status(currency) }}
                    </p>
                </article>
            </div>
        </template>
        <template v-else>
            <article
                v-for="currency in currencies"
                :key="currency"
                :data-currency="currency">
                <header>
                    <div>
                        <span class="currency-code">{{ currency }}</span
                        ><span
                            >{{
                                currency === 'KRW' ? '원화' : '외화'
                            }}
                            자료평가액 독립 집계</span
                        >
                    </div>
                    <small>{{ count(currency) }}개 계좌</small>
                </header>
                <div class="currency-amount-row">
                    <strong>{{ amount(currency) }}</strong>
                    <p>{{ status(currency) }}</p>
                </div>
                <footer>환산·합산 없음 · 통화별 독립 보존</footer>
            </article>
        </template>
    </div>
</template>
<style scoped>
    .asset-currency-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin: 0 0 32px;
    }
    .currency-scope {
        grid-column: 1/-1;
        margin: 0;
        font-size: 12px;
        color: var(--app-muted);
    }
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }
    .currency-amount-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }
    .currency-amount-row p {
        max-width: 180px;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-accent);
    }
    article {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 16px;
        min-width: 0;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 20px;
    }
    header,
    header > div {
        display: flex;
        gap: 8px;
        align-items: center;
    }
    header {
        justify-content: space-between;
    }
    header > div {
        flex-wrap: wrap;
    }
    header span,
    small {
        font-size: 12px;
        color: var(--app-muted);
    }
    small {
        white-space: nowrap;
    }
    .currency-code {
        padding: 3px 7px;
        border-radius: 4px;
        background: var(--app-surface-muted);
        font-weight: 600;
    }
    article[data-currency='USD'] .currency-code {
        background: var(--app-warning-light);
        color: var(--app-warning-text);
    }
    strong {
        display: block;
        margin: 0;
        font-family: 'JetBrains Mono', monospace;
        font-size: 36px;
        line-height: 44px;
        font-weight: 600;
        letter-spacing: -0.025em;
        overflow-wrap: anywhere;
    }
    article p {
        margin: 0;
        font-size: 12px;
        color: var(--app-muted);
    }
    footer {
        padding: 8px 12px;
        background: var(--app-bg);
        border-radius: 8px;
        font-size: 12px;
        color: var(--app-muted);
    }
    .currency-summary-compact {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        margin: 0 0 20px;
    }
    .compact-currency-title {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
    }
    .currency-summary-compact .compact-currency-title h3 {
        margin: 0;
        font-size: 16px;
        line-height: 24px;
    }
    .compact-currency-title small {
        font-size: 11px;
        color: var(--app-muted);
    }
    .compact-currency-values {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        min-width: 0;
    }
    .compact-currency-values article {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 12px;
        padding: 8px 12px;
        border: 0;
        border-radius: 8px;
        background: var(--app-bg);
    }
    .compact-currency-values article > span {
        font-size: 13px;
        color: var(--app-muted);
    }
    .compact-currency-values strong {
        font-size: 16px;
        line-height: 24px;
        letter-spacing: normal;
    }
    .compact-currency-values article p {
        flex-basis: 100%;
    }
    @media (max-width: 639px) {
        .currency-summary-compact {
            padding: 16px;
        }
        .compact-currency-values {
            flex-direction: column;
            width: 100%;
        }
        .compact-currency-values article {
            justify-content: space-between;
        }
    }
    @media (max-width: 767px) {
        .asset-currency-summary {
            grid-template-columns: 1fr;
        }
        strong {
            font-size: 36px;
        }
    }
</style>
