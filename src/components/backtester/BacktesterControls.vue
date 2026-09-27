<!-- REFACTORED: src/components/backtester/BacktesterControls.vue -->
<script setup>
    import { onMounted } from 'vue';
    import MeterGroup from 'primevue/metergroup';
    import Button from 'primevue/button';
    import PortfolioInput from './controls/PortfolioInput.vue';
    import DateAndInvestment from './controls/DateAndInvestment.vue';
    import { useBacktestPortfolio } from '@/composables/portfolio/useBacktestPortfolio';

    const props = defineProps({
        isLoading: Boolean,
        country: {
            type: String,
            default: 'US', // 기본값은 미국
        },
    });

    const emit = defineEmits(['run']);

    const {
        portfolio,
        allSymbols,
        displayPortfolio,
        totalValue,
        loadNavData,
        balanceWeights,
        addItem,
        removeItem,
        updatePortfolioItem,
        getMaxValueForSlider,
    } = useBacktestPortfolio(props.country);

    onMounted(loadNavData);

    const handleRun = (dateAndInvestmentOptions) => {
        const validPortfolio = portfolio.value.filter(
            (p) => p.symbol && p.value > 0
        );
        if (validPortfolio.length === 0) return;

        const totalWeight = validPortfolio.reduce(
            (sum, item) => sum + item.value,
            0
        );
        if (Math.round(totalWeight) !== 100) {
            alert('비중의 총 합계가 100%가 되어야 합니다.');
            return;
        }

        emit('run', {
            ...dateAndInvestmentOptions,
            portfolio: validPortfolio.map((p) => ({
                ...p,
                symbol: p.symbol.toUpperCase(),
            })),
        });
    };
</script>

<template>
    <div class="border-round surface-card" id="t-backtester-controls">
        <div
            class="flex justify-content-between align-items-center flex-wrap gap-2">
            <span class="p-button p-component p-button-secondary"
                >총 합계:
                <span
                    :class="{
                        'text-red-500 font-bold':
                            Math.round(totalValue) !== 100,
                    }"
                    >{{ totalValue }}%</span
                ></span
            >
            <Button
                label="비중 균등 분배"
                icon="pi pi-chart-pie"
                @click="balanceWeights"
                severity="secondary" />
        </div>
        <MeterGroup :value="portfolio.filter((p) => p.value > 0)">
            <template #label>
                <PortfolioInput
                    :modelValue="displayPortfolio"
                    :all-symbols="allSymbols"
                    :get-max-value="getMaxValueForSlider"
                    @addItem="addItem"
                    @removeItem="removeItem"
                    @update:portfolioItem="updatePortfolioItem" />
            </template>
            <template #meter="slotProps">
                <span
                    :class="slotProps.class"
                    :style="{
                        background: slotProps.value.color,
                        width: slotProps.size,
                    }" />
            </template>
        </MeterGroup>

        <DateAndInvestment
            :is-loading="isLoading"
            :portfolio="portfolio"
            :country="country"
            @run-backtest="handleRun" />
    </div>
</template>
