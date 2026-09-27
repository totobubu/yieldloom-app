<!-- src\pages\BacktesterView.vue -->
<script setup>
    import { ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import BacktesterControls from '@/components/backtester/BacktesterControls.vue';
    import BacktesterResults from '@/components/backtester/BacktesterResults.vue';
    import { runBacktest } from '@/services/backtester/engine.js';
    import { useToast } from 'primevue/usetoast';
    import Message from 'primevue/message';
    import Skeleton from 'primevue/skeleton'; // [신규] Skeleton import
    import { useBacktestData } from '@/composables/data/useBacktestData';

    useHead({ title: '백테스팅' });

    const toast = useToast();
    const { fetchDataForBacktest, adjustedDateMessage } = useBacktestData();
    const backtestResult = ref(null);
    const isLoading = ref(false);

    const handleRun = async (options) => {
        isLoading.value = true;
        backtestResult.value = null;

        try {
            const { effectiveStartDate, apiData, holidays } =
                await fetchDataForBacktest(
                    options.portfolio,
                    options.comparisonSymbol,
                    options.startDate,
                    options.endDate
                );

            const result = runBacktest({
                ...options,
                startDate: effectiveStartDate,
                apiData,
                holidays,
            });

            backtestResult.value = { ...result, applyTax: options.applyTax };
        } catch (error) {
            console.error('Backtest Run Failed:', error);
            toast.add({
                severity: 'error',
                summary: '백테스팅 오류',
                detail: error.message,
                life: 5000,
            });
            backtestResult.value = { error: error.message };
        } finally {
            isLoading.value = false;
        }
    };
</script>

<template>
    <div id="t-backtester">
        <BacktesterControls
            @run="handleRun"
            :is-loading="isLoading"
            country="US" />
        <Message
            v-if="adjustedDateMessage"
            severity="info"
            :closable="false"
            class="mt-4">
            {{ adjustedDateMessage }}
        </Message>

        <!-- [핵심 수정] 로딩 상태 UI 변경 -->
        <div v-if="isLoading" class="mt-4 surface-card p-4 border-round">
            <div class="flex justify-content-end align-items-center mb-2">
                <Skeleton shape="circle" size="2rem"></Skeleton>
            </div>
            <Skeleton height="500px" class="mb-4"></Skeleton>
            <Skeleton height="15rem"></Skeleton>
        </div>
        <BacktesterResults v-else :result="backtestResult" />
    </div>
</template>
