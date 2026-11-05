<script setup>
    import { computed, watch } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import { reviewRawAmount } from '@/services/importReviewPresentation.js';
    import { transactionTypeLabel } from '@/services/tossImportReview.js';
    const props = defineProps({
        rows: { type: Array, required: true },
        columns: { type: Array, required: true },
        issueIndices: { type: Set, required: true },
        isHoldings: Boolean,
        busy: Boolean,
    });
    const first = defineModel('first', { type: Number, default: 0 });
    const pageSize = defineModel('pageSize', { type: Number, default: 50 });
    const emit = defineEmits(['update-row']);
    const pageRows = computed(() =>
        props.rows.slice(first.value, first.value + pageSize.value)
    );
    watch(
        () => [props.rows.length, pageSize.value],
        () => {
            if (first.value >= props.rows.length)
                first.value = Math.max(
                    0,
                    (Math.ceil(props.rows.length / pageSize.value) - 1) *
                        pageSize.value
                );
        }
    );
    const raw = (value) =>
        value == null || value === '' ? '미제공' : String(value);
    const amount = (row) => reviewRawAmount(row.amount, row.currency);
    function amountLabel(row) {
        if (props.isHoldings) return '기준일 평가액';
        if (['dividend', 'dividend_reversal'].includes(row.type))
            return '추출 배당 금액';
        if (row.type === 'cash_in') return '입금 기록 금액';
        if (row.type === 'cash_out') return '출금 기록 금액';
        return '추출 거래 금액';
    }
</script>
<template>
    <section class="generic-review-cards" aria-label="모바일 추출 거래 카드">
        <header class="generic-cards-heading">
            <h3>
                {{ isHoldings ? '보유 잔고 카드' : '파싱 완료 거래 카드' }} ({{
                    rows.length
                }}건)
            </h3>
            <span>저장 전 전체 검증</span>
        </header>
        <article
            v-for="item in pageRows"
            :key="item.index"
            class="generic-review-card"
            :class="{ 'has-issue': issueIndices.has(item.index) }"
            :aria-label="`${item.index + 1}행 추출 자료`">
            <div class="generic-card-top">
                <span class="generic-review-status">{{
                    issueIndices.has(item.index) ? '확인 필요' : '검증 전'
                }}</span
                ><span class="generic-row-number">No. {{ item.index + 1 }}</span
                ><time>{{ raw(item.row.date) }}</time>
            </div>
            <div class="generic-card-identity">
                <div>
                    <strong>{{ raw(item.row.symbol) }}</strong
                    ><small v-if="item.row.securityName">{{ item.row.securityName }}</small
                    ><small>고유번호: {{ raw(item.row.externalId) }}</small>
                </div>
                <span
                    v-if="!isHoldings"
                    class="generic-type"
                    :data-kind="item.row.type"
                    >{{ transactionTypeLabel(item.row.type) }}</span
                >
            </div>
            <div class="generic-card-values">
                <div>
                    <span>{{ isHoldings ? '보유 수량' : '추출 수량' }}</span
                    ><strong>{{ raw(item.row.quantity) }}</strong>
                </div>
                <div>
                    <span>{{ amountLabel(item.row) }}</span
                    ><strong
                        >{{ amount(item.row) }}
                        <span
                            v-if="
                                item.row.amount != null &&
                                item.row.amount !== ''
                            "
                            >{{ item.row.currency || '(통화 미지정)' }}</span
                        ></strong
                    >
                </div>
            </div>
            <details
                :id="`generic-row-edit-${item.index}`"
                class="generic-card-editor"
                :open="issueIndices.has(item.index)">
                <summary>{{ item.index + 1 }}행 수정</summary>
                <div class="generic-card-fields">
                    <div
                        v-for="column in columns"
                        :key="column.field"
                        class="generic-card-field"
                        role="group"
                        :aria-label="`${item.index + 1}행 ${column.label}`">
                        <span>{{ column.label }}</span
                        ><template v-if="column.field === 'amount'"
                            ><Select
                                :model-value="item.row.currency"
                                :options="[
                                    { label: 'USD', value: 'USD' },
                                    { label: 'KRW', value: 'KRW' },
                                ]"
                                option-label="label"
                                option-value="value"
                                placeholder="통화 선택"
                                :aria-label="`${item.index + 1}행 currency`"
                                :disabled="busy"
                                @update:model-value="
                                    emit('update-row', {
                                        index: item.index,
                                        field: 'currency',
                                        value: $event,
                                    })
                                " /><InputText
                                :model-value="item.row.amount"
                                :aria-label="`${item.index + 1}행 amount`"
                                :disabled="busy"
                                @update:model-value="
                                    emit('update-row', {
                                        index: item.index,
                                        field: 'amount',
                                        value: $event,
                                    })
                                " /></template
                        ><InputText
                            v-else
                            :model-value="item.row[column.field]"
                            :aria-label="`${item.index + 1}행 ${column.field}`"
                            :disabled="busy"
                            @update:model-value="
                                emit('update-row', {
                                    index: item.index,
                                    field: column.field,
                                    value: $event,
                                })
                            " />
                    </div>
                </div>
            </details>
        </article>
        <p v-if="!rows.length" class="generic-empty">
            표시할 자료가 없습니다. 검색어와 필터를 확인하세요.
        </p>
        <footer class="generic-cards-pagination">
            <span
                >페이지: {{ rows.length ? first + 1 : 0 }}–{{
                    Math.min(first + pageSize, rows.length)
                }}
                / 총 {{ rows.length }}건</span
            >
            <div v-if="rows.length > 25">
                <Select
                    v-model="pageSize"
                    :options="[25, 50, 100, 200]"
                    aria-label="카드 페이지당 행 수"
                    :disabled="busy" /><Button
                    type="button"
                    label="이전 페이지"
                    outlined
                    :disabled="busy || first === 0"
                    @click="first = Math.max(0, first - pageSize)" /><Button
                    type="button"
                    label="다음 페이지"
                    outlined
                    :disabled="busy || first + pageSize >= rows.length"
                    @click="first += pageSize" />
            </div>
        </footer>
    </section>
</template>
<style scoped>
    .generic-review-cards {
        display: grid;
        gap: 12px;
        min-width: 0;
    }
    .generic-cards-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .generic-cards-heading h3 {
        font-size: 13px;
        line-height: 20px;
        color: var(--app-brand-brown);
        margin: 0;
    }
    .generic-cards-heading > span {
        font-size: 11px;
        color: var(--app-muted);
        white-space: nowrap;
    }
    .generic-review-card {
        padding: 14px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 2px rgb(23 32 51 / 6%);
        min-width: 0;
    }
    .generic-card-top {
        display: flex;
        align-items: center;
        gap: 6px;
        border-bottom: 1px solid var(--app-border);
        padding-bottom: 8px;
        font-size: 11px;
        line-height: 16px;
    }
    .generic-card-top time {
        margin-left: auto;
        color: var(--app-muted);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
    }
    .generic-review-status {
        padding: 2px 8px;
        border-radius: 999px;
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 10%,
            var(--app-surface)
        );
        white-space: nowrap;
    }
    .has-issue .generic-review-status {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .generic-row-number {
        color: var(--app-muted);
        font-size: 11px;
        white-space: nowrap;
    }
    .generic-card-identity {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
        margin: 10px 0;
    }
    .generic-card-identity > div {
        min-width: 0;
    }
    .generic-card-identity strong {
        display: block;
        font-size: 14px;
        line-height: 20px;
        color: var(--app-brand-brown);
        overflow-wrap: anywhere;
    }
    .generic-card-identity small {
        display: block;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .generic-type {
        padding: 2px 8px;
        font-size: 11px;
        line-height: 16px;
        border-radius: 4px;
        background: var(--app-bg);
        color: var(--app-text);
        white-space: nowrap;
    }
    .generic-card-values {
        padding: 10px;
        border-radius: 8px;
        background: var(--app-bg);
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
    }
    .generic-card-values > div > span {
        display: block;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .generic-card-values strong {
        font-size: 12px;
        line-height: 20px;
        overflow-wrap: anywhere;
    }
    .generic-card-editor {
        margin-top: 10px;
        font-size: 11px;
        line-height: 18px;
    }
    .generic-card-editor summary {
        cursor: pointer;
        color: var(--app-accent);
        font-weight: 600;
    }
    .generic-card-fields {
        display: grid;
        gap: 10px;
        margin-top: 10px;
    }
    .generic-card-fields .generic-card-field {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 4px;
    }
    .generic-card-fields :deep(.p-inputtext),
    .generic-card-fields :deep(.p-select) {
        width: 100%;
        min-width: 0;
        font-size: 12px;
    }
    .generic-cards-pagination {
        font-size: 11px;
        line-height: 18px;
        color: var(--app-muted);
        text-align: center;
    }
    .generic-cards-pagination > div {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin-top: 8px;
    }
    .generic-cards-pagination :deep(.p-button),
    .generic-cards-pagination :deep(.p-select) {
        font-size: 11px;
    }
    html:not(.p-dark) .generic-review-card {
        border-color: #e2e8f0;
    }
    html:not(.p-dark) .generic-card-top {
        border-color: #f1f5f9;
    }
    html:not(.p-dark) .generic-card-values {
        background: #f8fafc;
    }
    html:not(.p-dark) .generic-type[data-kind='buy'] {
        color: #1d4ed8;
        background: #eff6ff;
    }
    html:not(.p-dark) .generic-type[data-kind='sell'] {
        color: #be123c;
        background: #fff1f2;
    }
    html:not(.p-dark) .generic-type[data-kind='dividend'] {
        color: #047857;
        background: #ecfdf5;
    }
    .p-dark .generic-cards-heading h3,
    .p-dark .generic-card-identity strong {
        color: var(--app-text);
    }
</style>
