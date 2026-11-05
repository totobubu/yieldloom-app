<script setup>
    import { reviewRawAmount } from '@/services/importReviewPresentation.js';
    defineProps({ summary: { type: Object, required: true } });
</script>
<template>
    <section class="import-currency-summary" aria-label="통화별 추출 금액 합계">
        <header>
            <h3>통화별 합계</h3>
            <details class="import-currency-explanation">
                <summary>교차합산 금지</summary>
                <p class="import-currency-note">
                    필터와 관계없이 전체 추출 자료의 거래 금액을 집계합니다.
                    원문과 최종 저장 결과를 확인하세요. 입출금 차액과 외부 투자
                    원금은 별도 기준입니다.
                </p>
            </details>
        </header>
        <article
            v-for="group in summary.currencies"
            :key="group.currency"
            class="import-currency-group"
            :aria-label="`${group.currency} 추출 금액 합계`">
            <h4>
                <span>{{ group.currency }} 거래 내역</span
                ><small>{{ group.count }}건 집계</small>
            </h4>
            <dl>
                <div
                    v-for="line in group.lines"
                    :key="line.type"
                    class="import-currency-line">
                    <dt>{{ line.label }}</dt>
                    <dd :data-type="line.type">
                        {{
                            line.amount === null
                                ? `금액 확인 ${line.unknown}건 · 합계 보류`
                                : `${reviewRawAmount(line.amount, group.currency)} ${group.currency}`
                        }}
                    </dd>
                </div>
            </dl>
            <div v-if="group.netCash" class="import-currency-net">
                <span>순입출금 (검토 합계)</span
                ><strong>{{
                    group.netCash.amount === null
                        ? '금액 확인 후 집계'
                        : `${reviewRawAmount(group.netCash.amount, group.currency)} ${group.currency}`
                }}</strong>
            </div>
            <p v-if="group.otherCount" class="import-currency-note">
                입출고·분할·기타 유형 {{ group.otherCount }}건은 위 금액 합계와
                별도로 검토하세요.
            </p>
        </article>
        <p v-if="!summary.currencies.length" class="import-currency-note">
            통화를 확인한 뒤 금액을 집계합니다.
        </p>
        <p v-if="summary.unknownCurrencyCount" class="import-currency-missing">
            통화 확인 필요 {{ summary.unknownCurrencyCount }}건 · 통화별 합계에
            포함하지 않습니다.
        </p>
    </section>
</template>
<style scoped>
    .import-currency-summary {
        padding: 14px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 2px rgb(23 32 51 / 6%);
        min-width: 0;
    }
    .import-currency-summary header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }
    .import-currency-summary h3 {
        font-size: 11px;
        line-height: 16px;
        margin: 0;
    }
    .import-currency-summary header > span {
        font-size: 10px;
        line-height: 16px;
        color: var(--app-muted);
        white-space: nowrap;
    }
    .import-currency-group {
        padding: 10px;
        margin-top: 8px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
    }
    .import-currency-group h4 {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        line-height: 16px;
        margin: 0 0 4px;
    }
    .import-currency-group h4 small {
        font-size: 11px;
        font-weight: 400;
        color: var(--app-muted);
        white-space: nowrap;
    }
    .import-currency-group dl {
        display: grid;
        gap: 4px;
        border-top: 1px solid rgb(255 255 255 / 80%);
        padding-top: 4px;
        margin: 0;
        font-size: 12px;
        line-height: 16px;
    }
    .import-currency-line {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
    }
    @media (max-width: 640px) {
        .import-currency-group dl {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .import-currency-line {
            display: block;
        }
        .import-currency-group .import-currency-line dd {
            margin-top: 0;
            text-align: left;
            font-size: 12px;
            line-height: 18px;
        }
    }
    .import-currency-group dt {
        color: var(--app-muted);
    }
    @media (max-width: 640px) {
        .import-currency-group dt {
            font-size: 11px;
            line-height: 16px;
        }
    }
    @media (min-width: 641px) {
        .import-currency-group dd,
        .import-currency-net strong {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        html:not(.p-dark) .import-currency-group {
            background: #f2f4f6;
        }
        html:not(.p-dark) .import-currency-group dt {
            color: #3e4947;
        }
        html:not(.p-dark) .import-currency-group dd {
            color: #382418;
        }
    }
    .import-currency-explanation {
        margin-top: 8px;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .import-currency-explanation summary {
        cursor: pointer;
    }
    .import-currency-group dd {
        margin: 0;
        text-align: right;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
        font-weight: 600;
    }
    .import-currency-net {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding-top: 4px;
        border-top: 1px solid var(--app-border);
        margin-top: 4px;
        font-size: 12px;
        line-height: 16px;
    }
    .import-currency-net strong {
        text-align: right;
        overflow-wrap: anywhere;
        color: var(--app-accent);
    }
    .import-currency-note {
        font-size: 11px;
        line-height: 18px;
        margin: 10px 0 0;
        color: var(--app-muted);
    }
    .import-currency-missing {
        font-size: 11px;
        line-height: 18px;
        border: 1px solid var(--app-warning-text);
        border-radius: 8px;
        padding: 10px;
        background: var(--app-warning-light);
        color: var(--app-warning-text);
    }
    html:not(.p-dark) .import-currency-group {
        background: #f8fafc;
        border-color: #e2e8f0;
    }
    @media (min-width: 641px) {
        html:not(.p-dark) .import-currency-group {
            background: #f2f4f6;
        }
    }
    header {
        flex-wrap: wrap;
        align-items: center;
        margin-bottom: 0;
    }
    .import-currency-explanation {
        margin: 0;
    }
    .import-currency-explanation[open] {
        flex-basis: 100%;
    }
    .import-currency-explanation summary {
        padding: 0;
        font-size: 10px;
        line-height: 16px;
    }
    @media (max-width: 640px) {
        .import-currency-summary h3 {
            font-size: 12px;
            line-height: 20px;
        }
        .import-currency-explanation summary {
            font-size: 11px;
            line-height: 20px;
            padding: 2px 8px;
            border-radius: 999px;
            background: var(--app-accent-light);
            color: var(--app-accent);
        }
        .import-currency-group {
            margin-top: 12px;
        }
        .import-currency-group h4 {
            line-height: 20px;
            margin-bottom: 6px;
        }
        .import-currency-group dl {
            border-top-color: var(--app-border);
        }
        .import-currency-group dt,
        .import-currency-group .import-currency-line dd {
            line-height: 20px;
        }
        .import-currency-net {
            margin-top: 8px;
            line-height: 20px;
        }
    }
</style>
