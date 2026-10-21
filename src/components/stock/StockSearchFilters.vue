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
            <span class="filter-label" :id="`${idPrefix}-types`"
                >상품 유형</span
            >
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
        <details class="filter-help">
            <summary>상품 유형 분류 기준</summary>
            <p>
                배당 이력·주기와 상품 정보를 기준으로 분류합니다. 성장주는 대표
                성장 종목 목록, 배당성장주·고배당주는 관련 ETF 편입 정보를
                참고합니다. 유형은 서로 중복될 수 있습니다.
            </p>
        </details>
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
    .filter-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .filter-chips :deep(.p-button) {
        font-size: 13px;
        padding: 8px 14px;
    }
    .filter-help {
        color: var(--app-muted);
        font-size: 13px;
    }
    .filter-help summary {
        cursor: pointer;
        min-height: 32px;
    }
    .filter-help p {
        margin: 8px 0 0;
        line-height: 1.7;
    }
</style>
