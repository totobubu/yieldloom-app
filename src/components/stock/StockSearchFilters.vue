<script setup>
    import { computed, ref } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import { productTypeOptions } from '../../../lib/security-filters.js';
    const props = defineProps({
        type: { type: String, default: '' },
        company: { type: String, default: '' },
        companies: { type: Array, default: () => [] },
        providers: { type: Array, default: () => [] },
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
    const expanded = ref(false);
    const shortcutsOpen = ref(false);
    const providerQuery = ref('');
    const orderedCompanies = computed(() => {
        const available = new Set(props.companies ?? []);
        const popular = (props.providers ?? [])
            .map((provider) => provider.name)
            .filter((name) => available.has(name));
        const names = [...new Set([...popular, ...available])];
        // Keep a selected provider visible even when it is outside the shortcuts.
        if (props.company && names.includes(props.company))
            return [
                props.company,
                ...names.filter((name) => name !== props.company),
            ];
        return names;
    });
    const matchingCompanies = computed(() =>
        orderedCompanies.value.filter((name) =>
            name
                .toLocaleLowerCase()
                .includes(providerQuery.value.trim().toLocaleLowerCase())
        )
    );
    function toggleExpanded() {
        expanded.value = !expanded.value;
        if (!expanded.value) providerQuery.value = '';
    }
    defineEmits(['update:type', 'update:company']);
</script>
<template>
    <div class="stock-filters">
        <div class="filter-group product-type-group">
            <div class="filter-label-row">
                <span :id="`${idPrefix}-types`" class="filter-label"
                    >공개 종목 유형 (단일 선택)</span
                ><button
                    v-tooltip.bottom="{
                        value: '배당 이력·주기와 상품 정보를 기준으로 분류하며, 성장주·배당성장주·고배당주는 관련 목록과 ETF 편입 정보를 참고합니다. 유형은 서로 중복될 수 있습니다.',
                        showDelay: 150,
                    }"
                    type="button"
                    class="filter-help-button"
                    aria-label="상품 유형 분류 기준 안내"
                    :aria-describedby="`${idPrefix}-type-help`">
                    <i class="pi pi-question-circle" aria-hidden="true" />
                </button>
                <span v-if="!showHoldingHistory" class="public-type-note"
                    >※ 보유 이력 등 개인 데이터와 무관한 공개 카탈로그
                    분류입니다.</span
                >
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
                    :aria-pressed="type === option.value"
                    @click="$emit('update:type', option.value)" />
            </div>
        </div>
        <div class="provider-panel">
            <div class="provider-heading">
                <div class="provider-title">
                    <span :id="`${idPrefix}-providers`" class="filter-label"
                        >운용사 필터:</span
                    >
                    <Button
                        label="전체 운용사"
                        :outlined="Boolean(company)"
                        :severity="company ? 'secondary' : undefined"
                        :aria-pressed="!company"
                        @click="$emit('update:company', '')" />
                    <Button
                        label="주요 운용사 바로가기"
                        severity="secondary"
                        outlined
                        :aria-expanded="shortcutsOpen"
                        :aria-controls="`${idPrefix}-provider-list`"
                        @click="shortcutsOpen = !shortcutsOpen" />
                    <Button
                        class="provider-expand"
                        :label="expanded ? '접기' : '펼치기'"
                        :icon="
                            expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'
                        "
                        icon-pos="right"
                        severity="secondary"
                        outlined
                        :aria-expanded="expanded"
                        :aria-controls="`${idPrefix}-provider-list`"
                        @click="toggleExpanded" />
                </div>
                <div class="provider-search-actions">
                    <label
                        :for="`${idPrefix}-provider-search`"
                        class="studio-sr-only"
                        >운용사명 검색</label
                    >
                    <InputText
                        :id="`${idPrefix}-provider-search`"
                        v-model="providerQuery"
                        placeholder="운용사명 검색..."
                        type="search"
                        @update:model-value="expanded = true" />
                    <Button
                        label="선택 초기화"
                        severity="secondary"
                        outlined
                        :disabled="!company"
                        @click="$emit('update:company', '')" />
                </div>
            </div>
            <div
                v-if="expanded || shortcutsOpen"
                :id="`${idPrefix}-provider-list`"
                class="provider-chips"
                :class="{ 'is-expanded': expanded }"
                role="group"
                :aria-labelledby="`${idPrefix}-providers`">
                <Button
                    v-for="provider in expanded
                        ? matchingCompanies
                        : matchingCompanies.slice(0, 15)"
                    :key="provider"
                    :label="provider"
                    :icon="company === provider ? 'pi pi-check' : undefined"
                    :severity="company === provider ? undefined : 'secondary'"
                    :outlined="company !== provider"
                    :aria-pressed="company === provider"
                    @click="
                        $emit(
                            'update:company',
                            company === provider ? '' : provider
                        )
                    " />
            </div>
            <p
                v-if="expanded && !matchingCompanies.length"
                class="provider-empty"
                role="status">
                일치하는 운용사가 없습니다.
            </p>
        </div>
    </div>
</template>
<style scoped>
    .stock-filters {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        min-width: 0;
    }
    .product-type-group {
        min-width: 0;
    }
    .filter-label-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
    }
    .filter-label {
        font-size: 14px;
        font-weight: 600;
    }
    .public-type-note {
        margin-left: auto;
        color: var(--app-muted);
        font-size: 12px;
    }
    .filter-help-button {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--app-muted);
        cursor: help;
    }
    .filter-help-button:focus-visible {
        outline: 2px solid var(--app-accent);
        border-radius: 4px;
    }
    .filter-chips {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
        scrollbar-width: thin;
    }
    .filter-chips :deep(.p-button) {
        --p-button-label-font-weight: 500;
        height: 44px;
        min-height: 44px;
        flex-shrink: 0;
        border-radius: 8px;
        padding: 0 16px;
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
    }
    .filter-chips :deep(.p-button[aria-pressed='true']) {
        --p-button-label-font-weight: 600;
        font-weight: 600;
        box-shadow: 0 2px 4px rgb(13 122 110 / 20%);
    }
    .provider-panel {
        display: grid;
        gap: 10px;
        background: var(--app-bg);
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 12px 14px;
    }
    .provider-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
    }
    .provider-title,
    .provider-search-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .provider-title .filter-label {
        font-size: 13px;
    }
    .provider-panel :deep(.p-button) {
        --p-button-label-font-weight: 500;
        height: 36px;
        min-height: 36px;
        border-radius: 8px;
        padding: 0 14px;
        font-size: 13px;
        font-weight: 500;
    }
    .provider-title :deep(.p-button[aria-pressed='true']) {
        --p-button-label-font-weight: 600;
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 10%,
            var(--app-surface)
        );
        border-color: var(--app-accent);
        font-weight: 600;
    }
    .provider-search-actions :deep(.p-inputtext) {
        width: 220px;
        height: 36px;
        min-height: 36px;
        padding: 0 10px;
        font-size: 13px;
        border-radius: 8px;
    }
    .provider-chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .provider-chips.is-expanded {
        max-height: 360px;
        overflow-y: auto;
        padding: 3px;
        scrollbar-gutter: stable;
    }
    .provider-empty {
        margin: 0;
        color: var(--app-muted);
        font-size: 13px;
    }
    @media (max-width: 768px) {
        .filter-chips :deep(.p-button) {
            font-size: 13px;
            padding-inline: 14px;
        }
        .filter-label-row {
            flex-wrap: wrap;
        }
        .public-type-note {
            width: 100%;
            margin-left: 0;
            font-size: 11px;
        }
        .provider-title,
        .provider-search-actions {
            width: 100%;
        }
        .provider-search-actions :deep(.p-inputtext) {
            width: 0;
            min-width: 0;
            flex: 1;
        }
    }
</style>
