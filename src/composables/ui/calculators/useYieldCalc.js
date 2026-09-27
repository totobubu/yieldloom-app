// src\composables\calculators\useYieldCalc.js
import { ref, computed, watch } from 'vue';

export function useYieldCalc(dependencies) {
    const {
        quantity,
        dividendStats,
        payoutsPerYear,
        isUSD,
        exchangeRate,
        currentPrice,
    } = dependencies;

    const yieldCalcMode = ref('quantity');
    const inputAmount = ref(isUSD.value ? 10000 : 10000000);

    const inputAmountUSD = computed(() =>
        isUSD.value
            ? inputAmount.value
            : exchangeRate.value
              ? inputAmount.value / exchangeRate.value
              : 0
    );

    const expectedDividends = computed(() => {
        const calculate = (dividendPerShare, taxRate) => {
            if (!quantity.value || !dividendPerShare || !payoutsPerYear.value)
                return { perPayout: 0, monthly: 0, annual: 0 };
            const total = quantity.value * dividendPerShare * taxRate;
            const annual = total * payoutsPerYear.value;
            return { perPayout: total, monthly: annual / 12, annual };
        };
        const scenarios = (tax) => ({
            hope: calculate(dividendStats.value.max, tax),
            avg: calculate(dividendStats.value.avg, tax),
            despair: calculate(dividendStats.value.min, tax),
        });
        return { preTax: scenarios(1.0), postTax: scenarios(0.85) };
    });

    watch(inputAmount, () => {
        if (
            yieldCalcMode.value === 'amount' &&
            currentPrice.value > 0 &&
            inputAmountUSD.value > 0
        ) {
            quantity.value = Math.floor(
                inputAmountUSD.value / currentPrice.value
            );
        }
    });

    watch(quantity, () => {
        if (yieldCalcMode.value === 'quantity' && currentPrice.value > 0) {
            const totalValue = quantity.value * currentPrice.value;
            inputAmount.value = isUSD.value
                ? totalValue
                : totalValue * exchangeRate.value;
        }
    });

    return {
        yieldCalcMode,
        inputAmount,
        expectedDividends,
    };
}
