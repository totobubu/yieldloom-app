<script setup>
    import { computed, ref, watch } from 'vue';
    import Tabs from 'primevue/tabs';
    import TabList from 'primevue/tablist';
    import Tab from 'primevue/tab';
    import TabPanels from 'primevue/tabpanels';
    import TabPanel from 'primevue/tabpanel';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    import {
        importReviewGroups,
        transactionTypeLabel,
        transactionTypeOptions,
    } from '@/services/tossImportReview.js';

    const props = defineProps({
        rows: { type: Array, required: true },
        errors: { type: Array, default: () => [] },
        mappingWarning: { type: String, default: '' },
        visibleIndices: { type: Array, default: null },
        busy: Boolean,
        filterKey: { type: String, default: '' },
    });
    const emit = defineEmits(['update-row']);
    const active = ref('summary');
    const first = ref(0);
    watch([active, () => props.filterKey], () => {
        first.value = 0;
    });
    const groups = computed(() => importReviewGroups(props.rows, props.errors));
    const issueIndices = computed(
        () => new Set(groups.value.unresolved.map((item) => item.index))
    );
    const tabs = computed(() => {
        const visible =
            props.visibleIndices === null
                ? null
                : new Set(props.visibleIndices);
        return [
            { value: 'summary', label: '전체 요약', items: groups.value.all },
            { value: 'cash', label: '현금·환전', items: groups.value.cash },
            {
                value: 'unresolved',
                label: '미확인',
                items: groups.value.unresolved,
            },
            ...groups.value.symbols.map((group) => ({
                value: `symbol:${group.symbol}`,
                label: group.symbol,
                items: group.items,
            })),
        ].map((tab) => ({
            ...tab,
            items: visible
                ? tab.items.filter((item) => visible.has(item.index))
                : tab.items,
        }));
    });
    watch(tabs, (value) => {
        if (!value.some((tab) => tab.value === active.value))
            active.value = 'summary';
    });
    const update = (index, field, value) =>
        emit('update-row', { index, field, value });
</script>

<template>
    <div class="toss-review" aria-label="토스 PDF 추출 검토">
        <Message v-if="mappingWarning" severity="warn" :closable="false">
            {{ mappingWarning }}
        </Message>
        <Tabs v-model:value="active" scrollable>
            <TabList>
                <Tab v-for="tab in tabs" :key="tab.value" :value="tab.value">
                    {{ tab.label }}
                    <Tag
                        :value="String(tab.items.length)"
                        :severity="
                            tab.value === 'unresolved' && tab.items.length
                                ? 'warn'
                                : 'secondary'
                        " />
                </Tab>
            </TabList>
            <TabPanels>
                <TabPanel
                    v-for="tab in tabs"
                    :key="tab.value"
                    :value="tab.value">
                    <DataTable
                        v-if="tab.value === active"
                        v-model:first="first"
                        :value="tab.items"
                        data-key="index"
                        :row-class="
                            (data) =>
                                issueIndices.has(data.index)
                                    ? 'toss-issue-row'
                                    : ''
                        "
                        paginator
                        :rows="50"
                        :rows-per-page-options="[25, 50, 100]"
                        scrollable
                        scroll-height="600px"
                        table-style="min-width: 1050px"
                        striped-rows>
                        <template #empty
                            >표시할 자료가 없습니다. 검색어와 필터를
                            확인하세요.</template
                        >
                        <Column
                            field="row.date"
                            header="거래일"
                            style="min-width: 100px" />
                        <Column header="종목">
                            <template #body="{ data }">
                                <InputText
                                    :disabled="busy"
                                    :model-value="data.row.symbol"
                                    :aria-label="`${data.index + 1}행 종목`"
                                    @update:model-value="
                                        update(data.index, 'symbol', $event)
                                    " />
                                <small v-if="data.row._mappingIsin">
                                    원문 ISIN {{ data.row._mappingIsin }}
                                </small>
                                <small v-if="data.row.securityName">
                                    {{ data.row.securityName }}
                                </small>
                                <Select
                                    v-if="
                                        ['unresolved', 'unavailable'].includes(
                                            data.row._mappingStatus
                                        ) && data.row._mappingCandidates?.length
                                    "
                                    :disabled="busy"
                                    :model-value="null"
                                    :options="data.row._mappingCandidates"
                                    option-label="symbol"
                                    option-value="symbol"
                                    placeholder="검색 후보 선택"
                                    :aria-label="`${data.index + 1}행 종목 검색 후보`"
                                    @update:model-value="
                                        update(data.index, 'symbol', $event)
                                    " />
                                <template
                                    v-for="candidate in data.row
                                        ._mappingCandidates || []"
                                    :key="candidate.symbol">
                                    <a
                                        v-for="source in candidate.sources ||
                                        []"
                                        :key="source.url"
                                        :href="source.url"
                                        target="_blank"
                                        rel="noopener noreferrer">
                                        {{ candidate.symbol }} ·
                                        {{ source.name }}
                                    </a>
                                </template>
                            </template>
                        </Column>
                        <Column header="유형">
                            <template #body="{ data }">
                                <Select
                                    :disabled="busy"
                                    :model-value="data.row.type"
                                    :options="transactionTypeOptions"
                                    option-label="label"
                                    option-value="value"
                                    :aria-label="`${data.index + 1}행 거래 유형`"
                                    @update:model-value="
                                        update(data.index, 'type', $event)
                                    " />
                                <small
                                    >원문 {{ data.row.rawType || '-' }}</small
                                >
                            </template>
                        </Column>
                        <Column header="수량">
                            <template #body="{ data }">
                                <InputText
                                    :disabled="busy"
                                    :model-value="data.row.quantity"
                                    :aria-label="`${data.index + 1}행 수량`"
                                    @update:model-value="
                                        update(data.index, 'quantity', $event)
                                    " />
                            </template>
                        </Column>
                        <Column header="체결 금액">
                            <template #body="{ data }">
                                <InputText
                                    :disabled="busy"
                                    :model-value="data.row.amount"
                                    :aria-label="`${data.index + 1}행 금액`"
                                    @update:model-value="
                                        update(data.index, 'amount', $event)
                                    " />
                                <small>
                                    {{ data.row.currency }} · 원화 환산
                                    {{ data.row.convertedAmount ?? '-' }}원 ·
                                    원화 정산
                                    {{ data.row.settlementAmount ?? '-' }}원
                                </small>
                            </template>
                        </Column>
                        <Column header="통화">
                            <template #body="{ data }">
                                <Select
                                    :disabled="busy"
                                    :model-value="data.row.currency"
                                    :options="['USD', 'KRW']"
                                    :aria-label="`${data.index + 1}행 통화`"
                                    @update:model-value="
                                        update(data.index, 'currency', $event)
                                    " />
                            </template>
                        </Column>
                        <Column header="인식 상태">
                            <template #body="{ data }">
                                <Tag
                                    :value="
                                        data.row._mappingStatus === 'verified'
                                            ? '웹 교차 확인'
                                            : data.row._mappingStatus ===
                                                'manual'
                                              ? '직접 연결'
                                              : data.row._mappingStatus ===
                                                  'saved'
                                                ? '저장된 연결'
                                                : data.row._mappingStatus
                                                  ? '종목 확인 필요'
                                                  : transactionTypeLabel(
                                                        data.row.type
                                                    )
                                    "
                                    :severity="
                                        issueIndices.has(data.index)
                                            ? 'warn'
                                            : 'success'
                                    " />
                                <small
                                    v-if="
                                        data.row._fundingStatus ===
                                        'matched_exchange'
                                    ">
                                    원화 환전 결제 자동 일치
                                </small>
                                <small
                                    v-else-if="
                                        data.row._fundingStatus ===
                                        'needs_review'
                                    ">
                                    결제 구성 확인 필요
                                </small>
                            </template>
                        </Column>
                    </DataTable>
                </TabPanel>
            </TabPanels>
        </Tabs>
    </div>
</template>

<style scoped>
    .toss-review {
        min-width: 0;
    }
    :deep(.p-tabpanels) {
        padding: 0;
    }
    :deep(.p-tablist-tab-list) {
        background: var(--app-surface);
    }
    :deep(.p-tab) {
        gap: 6px;
        font-size: 12px;
        padding: 12px;
    }
    :deep(.toss-issue-row > td) {
        background: color-mix(
            in srgb,
            var(--p-orange-500) 7%,
            var(--app-surface)
        );
    }
    small {
        display: block;
        margin-top: 0.25rem;
        color: var(--p-text-muted-color);
    }
    :deep(.p-tablist-tab-list) {
        overflow-x: auto;
    }
    :deep(.p-inputtext),
    :deep(.p-datatable-tbody .p-select) {
        min-width: 7rem;
        width: 100%;
    }
</style>
