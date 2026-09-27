<!-- src\components\calculators\CalculatorLayout.vue -->
<script setup>
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';

    const { deviceType } = useBreakpoint();
</script>

<template>
    <div class="grid">
        <!-- 옵션 영역: 각 입력 필드를 위한 세분화된 슬롯 -->
        <div class="calculator-option flex flex-column gap-3">
            <slot name="avgPriceAndQuantity"></slot>
            <slot name="investmentPrincipalAndCurrentValue"></slot>
            <div class="flex flex-col gap-3">
                <slot name="periodSelect"></slot>
                <slot name="taxSelect"></slot>
            </div>
            <slot name="accumulatedDividend"></slot>
            <slot name="targetAsset"></slot>
            <slot name="annualGrowthRate"></slot>
            <slot name="priceInfo"></slot>
            <slot name="investmentAmount"></slot>
            <slot name="resultsDividend"></slot>
        </div>

        <!-- 결과 영역: 테이블과 차트를 위한 분리된 슬롯 -->
        <div class="calculator-result">
            <slot name="resultsRecovery"></slot>
            <slot name="resultsReinvestment"></slot>
            <slot name="resultsYield"></slot>
            <slot name="resultsChart"></slot>
        </div>
    </div>
</template>
