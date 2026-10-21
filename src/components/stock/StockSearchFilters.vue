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
                    >상품 유형</span
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
        <div class="provider-panel">
            <div class="provider-heading">
                <div class="provider-title">
                    <span :id="`${idPrefix}-providers`" class="filter-label"
                        >운용사
                        <span class="desktop-label">바로가기</span></span
                    >
                    <span class="provider-count">{{
                        company
                            ? '1개 선택'
                            : `전체 ${companies?.length ?? 0}개사`
                    }}</span>
                </div>
                <Button
                    label="선택 초기화"
                    icon="pi pi-refresh"
                    size="small"
                    text
                    severity="secondary"
                    :disabled="!company"
                    @click="$emit('update:company', '')" />
            </div>
            <div v-if="expanded" class="provider-search">
                <label
                    :for="`${idPrefix}-provider-search`"
                    class="studio-sr-only"
                    >운용사명 검색</label
                >
                <InputText
                    :id="`${idPrefix}-provider-search`"
                    v-model="providerQuery"
                    placeholder="운용사명 빠른 검색"
                    type="search"
                    fluid />
            </div>
            <div
                :id="`${idPrefix}-provider-list`"
                class="provider-chips"
                :class="{ 'is-expanded': expanded }"
                role="group"
                :aria-labelledby="`${idPrefix}-providers`">
                <Button
                    label="전체 운용사"
                    :severity="company ? 'secondary' : undefined"
                    :aria-pressed="!company"
                    size="small"
                    @click="$emit('update:company', '')" />
                <Button
                    v-for="provider in matchingCompanies"
                    :key="provider"
                    :label="provider"
                    :icon="company === provider ? 'pi pi-check' : undefined"
                    :severity="company === provider ? undefined : 'secondary'"
                    size="small"
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
            <Button
                v-if="orderedCompanies.length > 8 || expanded"
                class="provider-expand"
                :label="
                    expanded
                        ? '운용사 접기'
                        : `운용사 전체보기 (${orderedCompanies.length})`
                "
                :icon="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                icon-pos="right"
                severity="secondary"
                size="small"
                :aria-expanded="expanded"
                :aria-controls="`${idPrefix}-provider-list`"
                @click="toggleExpanded" />
        </div>
    </div>
</template>
<style scoped>
    .stock-filters {
        display: grid;
        gap: 24px;
    }
    .filter-group {
        display: flex;
        align-items: center;
        gap: 24px;
    }
    .filter-label-row {
        flex-shrink: 0;
    }
    .company-select {
        width: min(100%, 420px);
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
        min-height: 44px;
    }
    .provider-panel {
        background: color-mix(
            in srgb,
            var(--app-accent) 5%,
            var(--app-surface)
        );
        border-radius: 12px;
        padding: 18px;
    }
    .provider-heading,
    .provider-title {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }
    .provider-heading {
        justify-content: space-between;
        margin-bottom: 12px;
    }
    .provider-heading > .p-button {
        min-height: 44px;
    }
    .provider-count {
        font-size: 11px;
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 9%,
            var(--app-surface)
        );
        padding: 3px 8px;
        border-radius: 999px;
    }
    .provider-search {
        margin-bottom: 12px;
    }
    .provider-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .provider-chips.is-expanded {
        max-height: 360px;
        overflow-y: auto;
        padding: 3px;
        scrollbar-gutter: stable;
    }
    .provider-chips > .p-button {
        min-height: 44px;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 500;
        padding: 8px 14px;
        max-width: 100%;
        overflow-wrap: anywhere;
    }
    .provider-chips > .p-button[aria-pressed='false'] {
        background: var(--app-surface);
        border-color: transparent;
        color: var(--app-text);
    }
    .provider-chips > .p-button[aria-pressed='false']:hover {
        border-color: var(--app-accent);
        color: var(--app-accent);
    }
    .provider-chips:not(.is-expanded) > :nth-child(n + 17) {
        display: none;
    }
    .provider-expand {
        display: flex;
        margin: 12px 0 0 auto;
        min-height: 44px;
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 9%,
            var(--app-surface)
        );
        border-color: transparent;
    }
    .provider-empty {
        color: var(--app-muted);
        font-size: 13px;
    }
    @media (max-width: 767px) {
        .stock-filters {
            gap: 16px;
        }
        .product-type-group {
            display: block;
            min-width: 0;
        }
        .product-type-group .filter-label-row {
            display: none;
        }
        .filter-chips {
            flex-wrap: nowrap;
            overflow-x: auto;
            padding: 2px 2px 6px;
        }
        .filter-chips > .p-button {
            flex-shrink: 0;
        }
        .provider-panel {
            padding: 16px;
            background: var(--app-surface);
            border: 1px solid var(--app-border-subtle);
            border-radius: 16px;
        }
        .provider-heading {
            gap: 4px;
        }
        .provider-title {
            gap: 6px;
        }
        .provider-title .filter-label {
            font-size: 18px;
        }
        .desktop-label {
            display: none;
        }
        .provider-heading > .p-button {
            padding-inline: 4px;
            font-size: 12px;
        }
        .provider-chips > .p-button {
            border-radius: 16px;
            padding: 10px 12px;
        }
        .provider-chips > .p-button[aria-pressed='false'] {
            background: color-mix(
                in srgb,
                var(--app-accent) 6%,
                var(--app-surface)
            );
        }
        .provider-chips:not(.is-expanded) > :nth-child(n + 10) {
            display: none;
        }
        .provider-expand {
            width: 100%;
            justify-content: center;
        }
    }
</style>
