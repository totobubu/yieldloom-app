<script setup>
    import { ref, watch } from 'vue';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import StitchSymbol from './StitchSymbol.vue';
    import GenericImportReviewFields from './GenericImportReviewFields.vue';
    import { reviewRawAmount } from '@/services/importReviewPresentation.js';
    import { transactionTypeLabel } from '@/services/tossImportReview.js';
    const props = defineProps({
        rows: { type: Array, required: true },
        columns: { type: Array, required: true },
        issueIndices: { type: Set, required: true },
        scopeKey: { type: String, default: '' },
        busy: Boolean,
    });
    const emit = defineEmits(['update-row']);
    const first = defineModel('first', { type: Number, default: 0 });
    const pageSize = defineModel('pageSize', { type: Number, default: 50 });
    const expandedRows = ref({});
    watch(
        () => props.scopeKey,
        () => {
            expandedRows.value = {};
        }
    );
    const raw = (value) =>
        value == null || value === '' ? '미제공' : String(value);
    function toggle(index) {
        const next = { ...expandedRows.value };
        if (Object.hasOwn(next, index)) delete next[index];
        else next[index] = true;
        expandedRows.value = next;
    }
</script>
<template>
    <DataTable
        v-model:first="first"
        v-model:rows="pageSize"
        v-model:expanded-rows="expandedRows"
        :value="rows"
        data-key="index"
        class="generic-review-table"
        paginator
        :paginator-template="
            rows.length > 25
                ? 'CurrentPageReport FirstPageLink PrevPageLink NextPageLink LastPageLink RowsPerPageDropdown'
                : 'CurrentPageReport'
        "
        current-page-report-template="페이지: {first}-{last} / 총 {totalRecords}건 ({totalPages}페이지)"
        :rows-per-page-options="[25, 50, 100, 200]"
        scrollable
        scroll-height="600px"
        table-style="min-width:760px;border-collapse:collapse"
        :row-class="
            (item) => (issueIndices.has(item.index) ? 'review-issue-row' : '')
        ">
        <template #empty
            >표시할 자료가 없습니다. 검색어와 필터를 확인하세요.</template
        >
        <Column
            header="No"
            :body-style="{
                fontSize: '12px',
                lineHeight: '16px',
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            }"
            style="width: 40px; text-align: center"
            ><template #body="{ data }"
                ><button
                    type="button"
                    class="review-row-edit"
                    :aria-label="`${data.index + 1}행 수정`"
                    :aria-expanded="!!expandedRows[data.index]"
                    :aria-controls="`generic-table-edit-${data.index}`"
                    :disabled="busy"
                    @click="toggle(data.index)">
                    {{ data.index + 1 }}
                </button></template
            ></Column
        >
        <Column header="상태" style="width: 96px; text-align: center"
            ><template #body="{ data }"
                ><span
                    class="review-row-status"
                    :class="{ 'has-issue': issueIndices.has(data.index) }"
                    >{{
                        issueIndices.has(data.index) ? '확인 필요' : '검증 전'
                    }}</span
                ></template
            ></Column
        >
        <Column
            header="거래일자"
            :body-style="{
                fontSize: '12px',
                lineHeight: '16px',
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            }"
            style="width: 96px"
            ><template #body="{ data }"
                ><time>{{ raw(data.row.date) }}</time></template
            ></Column
        >
        <Column
            header="고유번호"
            :body-style="{
                fontSize: '12px',
                lineHeight: '16px',
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            }"
            style="width: 96px"
            ><template #body="{ data }"
                ><span class="review-raw-id">{{
                    raw(data.row.externalId)
                }}</span></template
            ></Column
        >
        <Column header="종목" style="width: 112px"
            ><template #body="{ data }"
                ><strong>{{ raw(data.row.symbol) }}</strong
                ><small v-if="data.row.securityName">{{
                    data.row.securityName
                }}</small></template
            ></Column
        >
        <Column header="구분" style="width: 80px; text-align: center"
            ><template #body="{ data }"
                ><span class="review-row-type" :data-kind="data.row.type">{{
                    transactionTypeLabel(data.row.type)
                }}</span></template
            ></Column
        >
        <Column
            header="수량"
            :body-style="{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            }"
            style="width: 80px; text-align: right"
            ><template #body="{ data }">{{
                raw(data.row.quantity)
            }}</template></Column
        >
        <Column
            header="추출 금액"
            :body-style="{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            }"
            style="width: 128px; text-align: right"
            ><template #body="{ data }"
                >{{ reviewRawAmount(data.row.amount, data.row.currency) }}
                <span
                    v-if="data.row.amount != null && data.row.amount !== ''"
                    >{{ data.row.currency || '(통화 미지정)' }}</span
                ></template
            ></Column
        >
        <Column header="원문" style="width: 64px; text-align: center"
            ><template #body="{ data }"
                ><span
                    title="행별 파일 원문 미지원 · 업로드 파일을 직접 대조해 주세요."
                    ><button
                        type="button"
                        class="review-original-unavailable"
                        :aria-label="`${data.index + 1}행 원문 보기 (미지원)`"
                        disabled>
                        <StitchSymbol
                            name="visibility" /></button></span></template
        ></Column>
        <template #expansion="{ data }"
            ><section
                :id="`generic-table-edit-${data.index}`"
                class="review-row-editor"
                :aria-label="`${data.index + 1}행 수정 입력`">
                <strong
                    >{{ data.index + 1 }}행 수정 ·
                    {{ raw(data.row.externalId) }}</strong
                ><GenericImportReviewFields
                    :item="data"
                    :columns="columns"
                    :busy="busy"
                    @update-row="emit('update-row', $event)" /></section
        ></template>
    </DataTable>
</template>
<style scoped>
    .generic-review-table {
        font-size: 12px;
        line-height: 18px;
    }
    .generic-review-table :deep(th) {
        padding: 10px 12px;
        background: var(--app-bg);
        color: var(--app-text);
        font-size: 12px;
        line-height: 18px;
        font-weight: 600;
    }
    .generic-review-table :deep(td) {
        padding: 12px;
        border-color: var(--app-border);
        overflow-wrap: anywhere;
        line-height: 18px;
    }
    .generic-review-table time,
    .review-raw-id {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .generic-review-table small {
        display: block;
        font-size: 11px;
        color: var(--app-muted);
    }
    .review-row-edit {
        border: 0;
        background: transparent;
        padding: 0;
        font: inherit;
        color: var(--app-muted);
        cursor: pointer;
    }
    .review-row-edit {
        text-decoration: underline dotted;
        text-underline-offset: 3px;
    }
    .review-row-edit:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    .review-row-status {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        color: var(--app-accent);
        background: var(--app-accent-light);
        font-size: 11px;
        white-space: nowrap;
    }
    .review-row-status.has-issue {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .review-row-type {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        white-space: nowrap;
        font-size: 11px;
        background: var(--app-bg);
    }
    html:not(.p-dark) .review-row-type[data-kind='buy'] {
        color: #1d4ed8;
        background: #eff6ff;
    }
    html:not(.p-dark) .review-row-type[data-kind='sell'],
    html:not(.p-dark) .review-row-type[data-kind='cash_out'] {
        color: #7e22ce;
        background: #faf5ff;
    }
    html:not(.p-dark) .review-row-type[data-kind='dividend'] {
        color: #b45309;
        background: #fffbeb;
    }
    html:not(.p-dark) .review-row-type[data-kind='cash_in'] {
        color: #047857;
        background: #ecfdf5;
    }
    .review-row-editor {
        padding: 4px;
    }
    .generic-review-table :deep(.p-paginator) {
        padding: 10px 12px;
        border: 0;
        background: var(--app-bg);
        justify-content: flex-start;
        gap: 4px;
        font-size: 12px;
    }
    .review-original-unavailable {
        border: 0;
        background: transparent;
        color: var(--app-muted);
        padding: 4px;
        font-size: 16px;
        line-height: 16px;
        opacity: 0.45;
        cursor: not-allowed;
    }
    .generic-review-table {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 1px 2px rgb(23 32 51 / 6%);
        font-size: 13px;
        line-height: 19.5px;
    }
    .generic-review-table :deep(thead tr) {
        height: 44px;
        border-bottom: 1px solid var(--app-border);
    }
    .generic-review-table :deep(th) {
        font-size: 11px;
        line-height: 16px;
    }
    .generic-review-table :deep(td) {
        border: 0;
        line-height: inherit;
        vertical-align: middle;
    }
    .generic-review-table :deep(tbody tr + tr) {
        border-top: 1px solid var(--app-border);
    }
    .review-row-status {
        font-size: 12px;
        line-height: 16px;
        border: 1px solid var(--app-border);
    }
    .generic-review-table :deep(.p-paginator) {
        padding: 8px 16px;
        border: 0;
        border-top: 1px solid var(--app-border);
        font-size: 12px;
        line-height: 16px;
    }
    .generic-review-table :deep(.p-datatable-paginator-bottom) {
        border: 0;
    }
    .generic-review-table :deep(.p-paginator-current) {
        line-height: 16px;
    }
</style>
