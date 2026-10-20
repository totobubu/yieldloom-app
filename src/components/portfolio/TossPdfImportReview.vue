<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Dialog from 'primevue/dialog';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import Message from 'primevue/message';
    import PortfolioImportFunding from './PortfolioImportFunding.vue';
    import {
        importReviewGroups,
        transactionTypeLabel,
        transactionTypeOptions,
    } from '@/services/tossImportReview.js';
    import {
        reviewMoney,
        reviewNumber,
        reviewSecurityLabel,
    } from '@/services/importReviewPresentation.js';

    const props = defineProps({
        rows: { type: Array, required: true },
        errors: { type: Array, default: () => [] },
        mappingWarning: { type: String, default: '' },
        visibleIndices: { type: Array, default: null },
        busy: Boolean,
        selectedSymbol: { type: String, default: '' },
        cashOnly: Boolean,
        filterKey: { type: String, default: '' },
    });
    const emit = defineEmits(['update-row']);
    const first = ref(0);
    const pageSize = ref(7);
    const selected = ref([]);
    const bulkType = ref(null);
    const editingIndex = ref(null);
    const draft = ref({});
    const editVisible = ref(false);
    const fundingIndex = ref(null);
    const selectedCode = computed(() =>
        props.cashOnly ? 'CASH' : props.selectedSymbol
    );
    const selectedSecurity = computed(() =>
        props.rows.find((row) => row.symbol === selectedCode.value)
    );
    const fundingLinks = computed(() => {
        const links = new Map();
        props.rows.forEach((row, index) => {
            if (row._fundingStatus !== 'matched_exchange') return;
            for (const cashIndex of [
                row._fundingSuggestion.krwIndex,
                row._fundingSuggestion.usdIndex,
            ]) {
                if (!links.has(cashIndex)) links.set(cashIndex, []);
                links.get(cashIndex).push(index);
            }
        });
        return links;
    });
    const groups = computed(() => importReviewGroups(props.rows, props.errors));
    const issueIndices = computed(
        () => new Set(groups.value.unresolved.map((item) => item.index))
    );
    const items = computed(() => {
        const visible =
            props.visibleIndices === null
                ? null
                : new Set(props.visibleIndices);
        return groups.value.all.filter(
            (item) => !visible || visible.has(item.index)
        );
    });
    const pageItems = computed(() =>
        items.value.slice(first.value, first.value + pageSize.value)
    );
    const displayedCurrencies = computed(() =>
        [
            ...new Set(
                items.value.map((item) => item.row.currency).filter(Boolean)
            ),
        ].join(' · ')
    );
    const allSelected = computed(
        () =>
            pageItems.value.length > 0 &&
            pageItems.value.every((item) => selected.value.includes(item.index))
    );
    watch(
        () => props.filterKey,
        () => {
            first.value = 0;
        }
    );
    watch(
        () => items.value.length,
        (length) => {
            if (first.value >= length) first.value = 0;
        }
    );
    function toggle(index, checked) {
        selected.value = checked
            ? [...new Set([...selected.value, index])]
            : selected.value.filter((value) => value !== index);
    }
    function togglePage(checked) {
        pageItems.value.forEach((item) => toggle(item.index, checked));
    }
    function openEdit(index) {
        editingIndex.value = index;
        draft.value = { ...props.rows[index] };
        editVisible.value = true;
    }
    const editableFields = [
        'date',
        'symbol',
        'quantity',
        'amount',
        'currency',
        'type',
    ];
    function applyEdit() {
        for (const field of editableFields)
            if (draft.value[field] !== props.rows[editingIndex.value][field])
                emit('update-row', {
                    index: editingIndex.value,
                    field,
                    value: draft.value[field],
                });
        editVisible.value = false;
    }
    function applyBulk() {
        if (!bulkType.value) return;
        selected.value.forEach((index) =>
            emit('update-row', { index, field: 'type', value: bulkType.value })
        );
        selected.value = [];
        bulkType.value = null;
        first.value = 0;
    }
    function tone(row) {
        return row.type === 'buy'
            ? 'buy'
            : row.type === 'sell'
              ? 'sell'
              : row.type === 'dividend'
                ? 'dividend'
                : 'other';
    }
    function direction(row) {
        return ['buy', 'cash_out', 'dividend_reversal'].includes(row.type)
            ? -1
            : ['sell', 'dividend', 'cash_in'].includes(row.type)
              ? 1
              : 0;
    }
    function settlement(row) {
        return row.currency === 'USD'
            ? (row.nativeSettlementAmount ?? row.amount)
            : (row.settlementAmount ?? row.amount);
    }
    function status(item) {
        if (issueIndices.value.has(item.index)) return '확인 필요';
        if (item.row._mappingStatus === 'verified') return '종목 교차 확인';
        if (item.row._mappingStatus === 'saved') return '저장된 연결';
        if (item.row._mappingStatus === 'manual') return '직접 연결';
        return '추출 완료';
    }
    function problems(index) {
        return props.errors
            .filter((problem) => Number(problem.row) === index + 1)
            .map((problem) => problem.error)
            .join(' · ');
    }
    function unitPrice(row) {
        return Number(row.quantity) > 0 && reviewNumber(row.amount) !== '—'
            ? Number(row.amount) / Number(row.quantity)
            : null;
    }
    function tax(row) {
        return row.currency === 'USD' ? row.nativeTax : row.tax;
    }
</script>

<template>
    <div class="toss-review" aria-label="토스 PDF 추출 검토">
        <Message v-if="mappingWarning" severity="warn" :closable="false">{{
            mappingWarning
        }}</Message>
        <div
            v-if="selectedSecurity"
            class="selected-security"
            aria-label="선택 종목 정보">
            <div>
                <strong>{{
                    selectedSecurity.securityName ||
                    reviewSecurityLabel(selectedSecurity)
                }}</strong
                ><span>{{
                    selectedCode === 'CASH'
                        ? '현금·환전 거래'
                        : selectedSecurity.symbol
                }}</span>
            </div>
            <span
                v-if="
                    selectedSecurity._mappingIsin ||
                    /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(
                        selectedSecurity.originalCode || ''
                    )
                "
                >ISIN
                {{
                    selectedSecurity._mappingIsin ||
                    selectedSecurity.originalCode
                }}</span
            >
            <span>{{ items.length }}건 · {{ displayedCurrencies }}</span>
        </div>
        <PortfolioImportFunding
            v-model:selected-index="fundingIndex"
            :rows="rows"
            :cash-indices="cashOnly ? items.map((item) => item.index) : null"
            :busy="busy"
            :show-summary="cashOnly" />
        <div class="review-selection-bar">
            <label
                ><input
                    type="checkbox"
                    :checked="allSelected"
                    :disabled="busy || !pageItems.length"
                    aria-label="현재 페이지 전체 선택"
                    @change="togglePage($event.target.checked)" />선택 항목:
                <strong>{{ selected.length }}건</strong></label
            >
            <span class="selection-hint"
                >선택한 거래의 유형을 한 번에 변경할 수 있습니다.</span
            >
            <Button
                type="button"
                label="선택 해제"
                size="small"
                text
                severity="secondary"
                :disabled="busy || !selected.length"
                @click="selected = []" />
            <Select
                v-model="bulkType"
                :options="transactionTypeOptions"
                option-label="label"
                option-value="value"
                placeholder="유형 일괄 변경"
                aria-label="일괄 변경할 거래 유형"
                :disabled="busy || !selected.length"
                size="small" />
            <Button
                v-if="bulkType"
                type="button"
                label="적용"
                size="small"
                :disabled="busy || !selected.length"
                @click="applyBulk" />
        </div>
        <DataTable
            v-model:first="first"
            :value="items"
            data-key="index"
            paginator
            :rows="pageSize"
            :rows-per-page-options="[7, 15, 25, 50]"
            :row-class="
                (data) => (issueIndices.has(data.index) ? 'toss-issue-row' : '')
            "
            table-style="width: 100%; table-layout: fixed"
            paginator-template="CurrentPageReport FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
            current-page-report-template="총 {totalRecords}건 중 {first}–{last}건"
            :page-link-size="3"
            @page="pageSize = $event.rows">
            <template #empty
                >표시할 자료가 없습니다. 검색어와 필터를 확인하세요.</template
            >
            <Column header="선택" style="width: 4%"
                ><template #body="{ data }"
                    ><input
                        type="checkbox"
                        :checked="selected.includes(data.index)"
                        :disabled="busy"
                        :aria-label="`${data.index + 1}행 선택`"
                        @change="
                            toggle(data.index, $event.target.checked)
                        " /></template
            ></Column>
            <Column header="거래일" style="width: 11%"
                ><template #body="{ data }"
                    ><time :datetime="data.row.date" class="trade-date">{{
                        String(data.row.date || '—').replaceAll('-', '.')
                    }}</time
                    ><small class="trade-original"
                        >{{ data.index + 1 }}행</small
                    ></template
                ></Column
            >
            <Column header="유형" style="width: 11%"
                ><template #body="{ data }"
                    ><span :class="['type-pill', tone(data.row)]">{{
                        transactionTypeLabel(data.row.type)
                    }}</span></template
                ></Column
            >
            <Column
                v-if="!selectedCode"
                header="종목명 / 티커"
                style="width: 20%"
                ><template #body="{ data }"
                    ><div class="security-title">
                        <strong>{{ reviewSecurityLabel(data.row) }}</strong
                        ><span class="currency-chip">{{
                            data.row.currency
                        }}</span>
                    </div>
                    <small class="security-name">{{
                        reviewSecurityLabel(data.row) !== data.row.symbol
                            ? data.row.symbol
                            : data.row.securityName ||
                              (data.row.symbol === 'CASH'
                                  ? '현금·환전 거래'
                                  : '종목명 미확인')
                    }}</small>
                    <div
                        v-if="issueIndices.has(data.index)"
                        class="inline-issue">
                        <i
                            class="pi pi-exclamation-circle"
                            aria-hidden="true" /><span>{{
                            problems(data.index) ||
                            '종목 코드와 거래 유형을 확인하세요.'
                        }}</span
                        ><button
                            type="button"
                            :disabled="busy"
                            @click="openEdit(data.index)">
                            {{
                                ['unresolved', 'unavailable'].includes(
                                    data.row._mappingStatus
                                )
                                    ? '종목 연결'
                                    : '수정하기'
                            }}
                        </button>
                    </div></template
                ></Column
            >
            <Column
                v-if="!cashOnly"
                header="수량"
                style="width: 10%"
                body-class="numeric-cell quantity-cell"
                ><template #body="{ data }"
                    ><span :title="String(data.row.quantity ?? '')">{{
                        reviewNumber(data.row.quantity)
                    }}</span></template
                ></Column
            >
            <Column v-if="cashOnly" header="연결 종목" style="width: 18%"
                ><template #body="{ data }"
                    ><template v-if="fundingLinks.get(data.index)?.length"
                        ><button
                            v-for="buyIndex in fundingLinks.get(data.index)"
                            :key="buyIndex"
                            class="funding-link"
                            type="button"
                            :disabled="busy"
                            @click="fundingIndex = buyIndex">
                            {{ reviewSecurityLabel(rows[buyIndex]) }} 매수<i
                                class="pi pi-link"
                                aria-hidden="true" /></button></template
                    ><small v-else>{{
                        data.row.cashKind === 'exchange'
                            ? '결제 연결 확인 필요'
                            : '매수 연결 대상 아님'
                    }}</small></template
                ></Column
            >
            <Column
                header="단가 / 환율"
                style="width: 10%"
                body-class="numeric-cell"
                ><template #body="{ data }"
                    ><span
                        v-if="unitPrice(data.row) !== null"
                        :title="`거래금액 ÷ 수량: ${unitPrice(data.row)}`"
                        >{{
                            reviewMoney(unitPrice(data.row), data.row.currency)
                        }}</span
                    ><span v-else>{{
                        reviewNumber(data.row.exchangeRate, 2)
                    }}</span
                    ><small v-if="data.row.exchangeRate"
                        >환율
                        {{ reviewNumber(data.row.exchangeRate, 2) }}</small
                    ><small v-else-if="unitPrice(data.row) !== null"
                        >거래금액 기준</small
                    ></template
                ></Column
            >
            <Column
                header="정산금액"
                style="width: 13%"
                body-class="numeric-cell"
                ><template #body="{ data }"
                    ><strong
                        :class="[
                            'trade-money',
                            direction(data.row) > 0
                                ? 'positive'
                                : direction(data.row) < 0
                                  ? 'negative'
                                  : '',
                        ]"
                        :title="String(settlement(data.row) ?? '')"
                        >{{
                            reviewMoney(
                                settlement(data.row),
                                data.row.currency,
                                direction(data.row)
                            )
                        }}</strong
                    ><small
                        v-if="
                            data.row.currency === 'USD' &&
                            data.row.settlementAmount != null
                        "
                        >{{
                            reviewMoney(data.row.settlementAmount, 'KRW')
                        }}</small
                    ><small
                        v-else-if="
                            data.row.nativeSettlementAmount == null &&
                            data.row.settlementAmount == null
                        "
                        >원문 거래금액</small
                    ></template
                ></Column
            >
            <Column
                header="세금 / 비용"
                style="width: 9%"
                body-class="numeric-cell"
                ><template #body="{ data }"
                    ><span class="fee-value">{{
                        reviewMoney(tax(data.row), data.row.currency, -1)
                    }}</span
                    ><small
                        v-if="
                            data.row.nativeCommission != null &&
                            Number(data.row.nativeCommission) !== 0
                        "
                        >수수료
                        {{
                            reviewMoney(data.row.nativeCommission, 'USD')
                        }}</small
                    ><small v-else>{{
                        tax(data.row) == null ? '원문 미제공' : '세금'
                    }}</small></template
                ></Column
            >
            <Column header="확인 상태" style="width: 8%"
                ><template #body="{ data }"
                    ><span
                        :class="[
                            'recognition-state',
                            { warning: issueIndices.has(data.index) },
                        ]"
                        ><i
                            :class="
                                issueIndices.has(data.index)
                                    ? 'pi pi-exclamation-triangle'
                                    : 'pi pi-check-circle'
                            "
                            aria-hidden="true" />{{ status(data) }}</span
                    ><button
                        v-if="data.row._fundingStatus"
                        type="button"
                        class="funding-link"
                        :disabled="busy"
                        @click="fundingIndex = data.index">
                        {{
                            data.row._fundingStatus === 'matched_exchange'
                                ? '결제 구성'
                                : '결제 확인 필요'
                        }}
                    </button></template
                ></Column
            >
            <Column header="관리" style="width: 4%"
                ><template #body="{ data }"
                    ><Button
                        type="button"
                        icon="pi pi-pencil"
                        :aria-label="`${data.index + 1}행 수정`"
                        :disabled="busy"
                        text
                        severity="secondary"
                        size="small"
                        @click="openEdit(data.index)" /></template
            ></Column>
        </DataTable>
        <Dialog
            v-model:visible="editVisible"
            append-to="self"
            modal
            :header="`${editingIndex === null ? '' : editingIndex + 1}행 거래 수정`"
            :style="{ width: 'min(540px, 94vw)' }"
            :closable="!busy"
            :close-on-escape="!busy"
            class="transaction-edit-dialog">
            <form class="transaction-editor" @submit.prevent="applyEdit">
                <p class="editor-original">
                    원문: {{ draft.rawType || '—'
                    }}<span v-if="draft._mappingIsin">
                        · ISIN {{ draft._mappingIsin }}</span
                    >
                </p>
                <label
                    >거래일<InputText
                        v-model="draft.date"
                        type="date"
                        :disabled="busy"
                        :aria-label="`${editingIndex + 1}행 거래일`"
                /></label>
                <label
                    >종목 코드<InputText
                        v-model="draft.symbol"
                        :disabled="busy"
                        :aria-label="`${editingIndex + 1}행 종목`"
                /></label>
                <Select
                    v-if="draft._mappingCandidates?.length"
                    v-model="draft.symbol"
                    :options="draft._mappingCandidates"
                    option-label="symbol"
                    option-value="symbol"
                    placeholder="검색 후보 선택"
                    aria-label="종목 검색 후보"
                    :disabled="busy" />
                <div
                    v-for="candidate in draft._mappingCandidates || []"
                    :key="candidate.symbol"
                    class="mapping-sources">
                    <a
                        v-for="source in candidate.sources || []"
                        :key="source.url"
                        :href="source.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ candidate.symbol }} · {{ source.name }}</a
                    >
                </div>
                <label
                    >거래 유형<Select
                        v-model="draft.type"
                        :options="transactionTypeOptions"
                        option-label="label"
                        option-value="value"
                        :disabled="busy"
                        :aria-label="`${editingIndex + 1}행 거래 유형`"
                /></label>
                <div class="editor-two-columns">
                    <label
                        >수량<InputText
                            v-model="draft.quantity"
                            :disabled="busy"
                            :aria-label="`${editingIndex + 1}행 수량`" /></label
                    ><label
                        >거래 금액
                        <div class="money-input">
                            <span>{{
                                draft.currency === 'USD' ? '$' : '₩'
                            }}</span
                            ><InputText
                                v-model="draft.amount"
                                :disabled="busy"
                                :aria-label="`${editingIndex + 1}행 금액`" /></div
                    ></label>
                </div>
                <label
                    >금액 단위<Select
                        v-model="draft.currency"
                        :options="['USD', 'KRW']"
                        :disabled="busy"
                        :aria-label="`${editingIndex + 1}행 통화`"
                /></label>
                <p class="editor-original">
                    원화 정산 {{ reviewMoney(draft.settlementAmount, 'KRW') }} ·
                    달러 정산
                    {{ reviewMoney(draft.nativeSettlementAmount, 'USD') }}
                </p>
                <div class="editor-actions">
                    <Button
                        type="button"
                        label="닫기"
                        severity="secondary"
                        :disabled="busy"
                        @click="editVisible = false" /><Button
                        type="submit"
                        label="수정 적용"
                        :disabled="busy" />
                </div>
            </form>
        </Dialog>
    </div>
</template>

<style scoped>
    .selected-security {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 14px;
        padding: 12px 14px;
        margin-bottom: 14px;
        border-radius: 10px;
        background: var(--app-surface);
        border: 1px solid var(--review-line, var(--app-border));
    }
    .selected-security > div {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
    }
    .selected-security strong {
        font-size: 15px;
    }
    .selected-security span {
        font-size: 11px;
        color: var(--app-muted);
    }
    .selected-security > span:last-child {
        margin-left: auto;
    }
    .funding-link {
        display: flex;
        align-items: center;
        gap: 4px;
        font: inherit;
        font-size: 10px;
        padding: 0;
        margin-top: 5px;
        border: 0;
        background: transparent;
        color: var(--app-accent);
        cursor: pointer;
    }
    .money-input {
        display: flex;
        align-items: center;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface);
    }
    .money-input > span {
        padding-left: 12px;
        color: var(--app-muted);
        font-weight: 600;
    }
    .money-input .p-inputtext {
        width: 100%;
        border: 0;
        box-shadow: none;
        background: transparent;
    }
    .toss-review {
        min-width: 0;
        font-size: 12px;
    }
    .review-selection-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 8px 12px;
        margin-bottom: 16px;
        background: var(--review-strong-tint, var(--app-surface-muted));
        border-radius: 8px;
        font-size: 11px;
    }
    .review-selection-bar label {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
    }
    .selection-hint {
        flex: 1;
        color: var(--app-muted);
        font-size: 11px;
    }
    .review-selection-bar .p-button {
        padding: 5px 8px;
        font-size: 11px;
    }
    :deep(.review-selection-bar .p-select-label) {
        padding: 4px 8px;
        font-size: 11px;
    }
    :deep(.review-selection-bar .p-select-dropdown) {
        width: 24px;
    }
    .review-selection-bar .p-select {
        max-width: 140px;
        font-size: 11px;
        min-height: 28px;
    }
    input[type='checkbox'] {
        width: 14px;
        height: 14px;
        accent-color: var(--app-accent);
        cursor: pointer;
    }
    :deep(.p-datatable-table-container) {
        overflow: visible;
    }
    :deep(.p-datatable-table) {
        font-size: 12px;
    }
    :deep(.p-datatable-thead > tr > th) {
        padding: 16px 7px;
        background: var(--review-tint, var(--app-surface-muted));
        color: var(--app-muted);
        font-size: 11px;
        font-weight: 650;
        border: 0;
        line-height: 1.4;
    }
    :deep(.p-datatable-tbody > tr > td) {
        padding: 15px 7px;
        background: var(--app-surface);
        vertical-align: top;
        border-color: var(--review-line, var(--app-border));
        font-size: 12px;
        line-height: 1.5;
        overflow-wrap: anywhere;
    }
    :deep(.p-datatable-tbody > tr:hover > td) {
        background: var(--review-tint, var(--app-surface-muted));
    }
    :deep(.p-datatable-thead > tr > th:first-child) {
        border-radius: 12px 0 0 0;
    }
    :deep(.p-datatable-thead > tr > th:last-child) {
        border-radius: 0 12px 0 0;
    }
    .toss-review :deep(.p-datatable-tbody > tr.toss-issue-row > td) {
        background: color-mix(
            in srgb,
            var(--p-orange-400) 7%,
            var(--app-surface)
        );
    }
    .trade-date {
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }
    small {
        display: block;
        margin-top: 4px;
        font-size: 10px;
        color: var(--app-muted);
        line-height: 1.45;
    }
    :deep(.p-datatable-thead > tr > th:first-child),
    :deep(.p-datatable-thead > tr > th:last-child),
    :deep(.p-datatable-tbody > tr > td:first-child),
    :deep(.p-datatable-tbody > tr > td:last-child) {
        padding-inline: 3px;
    }
    .type-pill {
        display: inline-block;
        max-width: 100%;
        padding: 2px 6px;
        border-radius: 12px;
        background: var(--review-strong-tint, var(--app-surface-muted));
        color: var(--app-muted);
        font-size: 10px;
        font-weight: 650;
        line-height: 1.5;
        white-space: normal;
    }
    .type-pill.buy {
        color: #be123c;
        background: #fff1f2;
    }
    .type-pill.sell {
        color: #1d4ed8;
        background: #eff6ff;
    }
    .type-pill.dividend {
        color: #047857;
        background: #ecfdf5;
    }
    .security-title {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
    }
    .security-title strong {
        font-size: 13px;
        color: var(--app-text);
    }
    .currency-chip {
        padding: 0 4px;
        border-radius: 3px;
        color: var(--app-muted);
        background: var(--review-tint, var(--app-surface-muted));
        font-size: 9px;
    }
    .security-name {
        margin-top: 2px;
        font-size: 11px;
    }
    .toss-review :deep(.numeric-cell) {
        text-align: right;
        font-size: 11px;
    }
    .toss-review :deep(.quantity-cell) {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        font-size: 11px;
    }
    .trade-money {
        font-variant-numeric: tabular-nums;
        font-size: 12px;
        font-weight: 650;
        white-space: nowrap;
    }
    .positive {
        color: #059669;
    }
    .negative,
    .fee-value {
        color: #e11d48;
    }
    .recognition-state {
        display: flex;
        align-items: center;
        gap: 3px;
        flex-wrap: wrap;
        color: #047857;
        font-size: 9px;
        font-weight: 600;
    }
    .recognition-state.warning {
        color: #b45309;
    }
    :deep(.p-datatable-tbody .p-button) {
        width: 24px;
        height: 24px;
        min-width: 24px;
        padding: 0;
    }
    :deep(.p-datatable-tbody .p-button .p-button-icon) {
        font-size: 11px;
    }
    .inline-issue {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
        padding: 9px;
        margin-top: 8px;
        border-radius: 8px;
        background: var(--app-surface);
        color: #a16207;
        font-size: 10px;
    }
    .inline-issue button {
        border: 0;
        padding: 4px 7px;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        font: inherit;
        border-radius: 4px;
        cursor: pointer;
    }
    :deep(.p-paginator) {
        justify-content: flex-end;
        gap: 2px;
        padding: 10px 12px;
        border: 0;
        background: var(--review-tint, var(--app-surface-muted));
        border-radius: 0 0 12px 12px;
    }
    :deep(.p-paginator-current) {
        margin-right: auto;
        font-size: 11px;
        color: var(--app-muted);
    }
    :deep(.p-paginator-page),
    :deep(.p-paginator-first),
    :deep(.p-paginator-prev),
    :deep(.p-paginator-next),
    :deep(.p-paginator-last) {
        min-width: 28px;
        height: 28px;
        border-radius: 5px;
        font-size: 11px;
    }
    .transaction-editor {
        display: grid;
        gap: 14px;
        font-size: 13px;
    }
    .transaction-editor label {
        display: grid;
        gap: 5px;
    }
    .editor-two-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }
    .editor-original {
        color: var(--app-muted);
        margin: 0;
        font-size: 12px;
    }
    .editor-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .mapping-sources a {
        display: block;
        color: var(--app-accent);
        font-size: 12px;
    }
    :global(.p-dark) .type-pill.buy {
        background: #4c1d32;
        color: #fda4af;
    }
    :global(.p-dark) .type-pill.sell {
        background: #172e57;
        color: #93c5fd;
    }
    :global(.p-dark) .type-pill.dividend {
        background: #123b34;
        color: #6ee7b7;
    }
    :global(.p-dark) .positive,
    :global(.p-dark) .recognition-state {
        color: #6ee7b7;
    }
    :global(.p-dark) .negative,
    :global(.p-dark) .fee-value {
        color: #fda4af;
    }
    :global(.p-dark) .recognition-state.warning {
        color: #fcd34d;
    }
    @media (max-width: 1000px) {
        .selection-hint {
            display: none;
        }
    }
    @media (max-width: 600px) {
        .review-selection-bar {
            flex-wrap: wrap;
        }
        :deep(.p-datatable-table-container) {
            overflow-x: auto;
        }
        :deep(.p-datatable-table) {
            min-width: 760px;
        }
        :deep(.p-paginator-current) {
            width: 100%;
            margin: 0 0 8px;
        }
        .editor-two-columns {
            grid-template-columns: 1fr;
        }
    }
</style>
