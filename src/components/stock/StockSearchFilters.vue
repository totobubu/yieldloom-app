<script setup>
    import { computed } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import { productTypeOptions } from '../../../lib/security-filters.js';
    const props = defineProps({
        type: String,
        company: String,
        companies: Array,
        providers: Array,
        idPrefix: { type: String, default: 'search' },
        showHoldingHistory: Boolean,
    });
    const visibleProductTypes = computed(() =>
        props.showHoldingHistory
            ? productTypeOptions
            : productTypeOptions.filter(
                  (option) => option.value !== 'holding-history'
              )
    );
    defineEmits(['update:type', 'update:company']);
</script>
<template>
    <div class="stock-filters">
        <div class="filter-group">
            <div class="filter-label-row">
                <span class="filter-label" :id="`${idPrefix}-types`"
                    >상품 유형</span
                ><button
                    type="button"
                    class="filter-help-button"
                    aria-label="상품 유형 분류 기준 안내"
                    :aria-describedby="`${idPrefix}-type-help`"
                    v-tooltip.bottom="{
                        value: '배당 이력·주기와 상품 정보를 기준으로 분류하며, 성장주·배당성장주·고배당주는 관련 목록과 ETF 편입 정보를 참고합니다. 유형은 서로 중복될 수 있습니다.',
                        showDelay: 150,
                    }">
                    <i class="pi pi-question-circle" aria-hidden="true" />
                </button>
                <span :id="`${idPrefix}-type-help`" class="studio-sr-only"
                    >배당 이력과 상품 정보를 기준으로 분류하며 유형은 서로
                    중복될 수 있습니다.</span
                >
            </div>
            <div
                class="filter-chips"
                role="group"
                :aria-labelledby="`${idPrefix}-types`">
                <Button
                    v-for="option in visibleProductTypes"
                    :key="option.value"
                    :label="option.label"
                    :severity="type === option.value ? undefined : 'secondary'"
                    :outlined="type !== option.value"
                    rounded
                    :aria-pressed="type === option.value"
                    @click="$emit('update:type', option.value)" />
            </div>
        </div>
        <div class="filter-group">
            <label class="filter-label" :for="`${idPrefix}-company`"
                >운용사</label
            >
            <Select
                :input-id="`${idPrefix}-company`"
                :model-value="company || null"
                :options="companies"
                placeholder="전체 운용사"
                filter
                show-clear
                fluid
                @update:model-value="$emit('update:company', $event || '')" />
            <div
                class="filter-chips"
                role="group"
                aria-label="운용사 빠른 선택">
                <Button
                    v-for="provider in providers"
                    :key="provider.name"
                    :label="provider.name"
                    :severity="
                        company === provider.name ? undefined : 'secondary'
                    "
                    :text="company !== provider.name"
                    size="small"
                    :aria-pressed="company === provider.name"
                    @click="
                        $emit(
                            'update:company',
                            company === provider.name ? '' : provider.name
                        )
                    " />
            </div>
        </div>
    </div>
</template>
<style scoped>
    .stock-filters {
        display: grid;
        gap: 20px;
    }
    .filter-group {
        display: grid;
        gap: 10px;
    }
    .filter-label {
        font-size: 14px;
        font-weight: 650;
    }
    .filter-label-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .filter-help-button {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        color: var(--app-muted);
        border: 0;
        border-radius: 50%;
        background: transparent;
        cursor: help;
    }
    .filter-help-button:hover,
    .filter-help-button:focus-visible {
        color: var(--app-accent);
        background: var(--app-surface-muted);
        outline: none;
    }
    .filter-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .filter-chips :deep(.p-button) {
        font-size: 13px;
        padding: 8px 14px;
    }
</style>
