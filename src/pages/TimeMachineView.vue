<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useHead } from '@vueuse/head';
import html2canvas from 'html2canvas';

import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Dropdown from 'primevue/dropdown';
import InputNumber from 'primevue/inputnumber';
import Checkbox from 'primevue/checkbox';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import AutoComplete from 'primevue/autocomplete';

import TimeMachineResultCard from '@/components/time-machine/TimeMachineResultCard.vue';
import { useBacktestData } from '@/composables/data/useBacktestData';
import { useBacktestPortfolio } from '@/composables/portfolio/useBacktestPortfolio';

useHead({ title: 'Time Machine | Div Grow' });

const route = useRoute();
const router = useRouter();
const { fetchDataForBacktest, adjustedDateMessage } = useBacktestData();
const { allSymbols, loadNavData } = useBacktestPortfolio('US');

const ticker = ref(route.params.ticker || route.query.ticker || '');
const amount = ref(Number(route.query.amount) || 10000);
const years = ref(Number(route.query.years) || 5);
const includeDrip = ref(route.query.drip === 'true' || false);

const periodOptions = ref([
    { label: '1 Year Ago', value: 1 },
    { label: '3 Years Ago', value: 3 },
    { label: '5 Years Ago', value: 5 },
    { label: '10 Years Ago', value: 10 },
]);

const isLoading = ref(false);
const errorMsg = ref('');
const resultData = ref(null);
const isDownloading = ref(false);

const filteredSymbols = ref([]);

onMounted(async () => {
    await loadNavData();
    if (ticker.value) {
        calculate();
    }
});

const searchSymbol = (event) => {
    if (!allSymbols.value) {
        filteredSymbols.value = [];
        return;
    }
    setTimeout(() => {
        if (!event.query.trim().length) {
            filteredSymbols.value = [...allSymbols.value];
        } else {
            const queryLower = event.query.toLowerCase();
            filteredSymbols.value = allSymbols.value.filter((symbol) => {
                return symbol.toLowerCase().startsWith(queryLower);
            });
        }
    }, 250);
};

const updateUrlParams = () => {
    router.replace({
        query: {
            ticker: ticker.value,
            amount: amount.value,
            years: years.value,
            drip: includeDrip.value,
        }
    });
};

const calculate = async () => {
    if (!ticker.value) {
        errorMsg.value = 'Please enter a ticker symbol.';
        return;
    }
    
    errorMsg.value = '';
    isLoading.value = true;
    resultData.value = null;
    updateUrlParams();

    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - years.value);

        const result = await fetchDataForBacktest(
            [{ symbol: ticker.value, value: 100 }],
            'NONE',
            startDate,
            endDate
        );

        const tData = result.apiData.tickerData.find(d => d.symbol.toUpperCase() === ticker.value.toUpperCase());
        
        if (!tData || !tData.prices || tData.prices.length === 0) {
            throw new Error(`Could not find historical data for ${ticker.value}`);
        }

        const prices = tData.prices;
        const effectiveStartDateStr = result.effectiveStartDate;
        
        let startIndex = prices.findIndex(p => p.date >= effectiveStartDateStr);
        if (startIndex === -1) startIndex = 0; // fallback

        const startPriceObj = prices[startIndex];
        const endPriceObj = prices[prices.length - 1];

        const startPrice = startPriceObj.close;
        const endPrice = endPriceObj.close;

        let currentAmount = 0;

        if (includeDrip.value) {
            let currentShares = amount.value / startPrice;
            const dividends = tData.dividends || [];
            
            for (const div of dividends) {
                if (new Date(div.date) >= new Date(startPriceObj.date) && new Date(div.date) <= new Date(endPriceObj.date)) {
                    const priceObj = prices.find(p => new Date(p.date) >= new Date(div.date));
                    if (priceObj) {
                        const divCash = currentShares * div.amount;
                        currentShares += divCash / priceObj.close;
                    }
                }
            }
            currentAmount = currentShares * endPrice;
        } else {
            const shares = amount.value / startPrice;
            currentAmount = shares * endPrice;
        }

        const roi = (currentAmount - amount.value) / amount.value;

        const formatDate = (dateStr) => {
            const d = new Date(dateStr);
            return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        };

        resultData.value = {
            ticker: ticker.value.toUpperCase(),
            initialAmount: amount.value,
            currentAmount: currentAmount,
            years: years.value,
            roi: roi,
            dateRange: `${formatDate(startPriceObj.date)} ~ ${formatDate(endPriceObj.date)}`,
        };

    } catch (err) {
        console.error(err);
        errorMsg.value = err.message || 'An error occurred during calculation.';
    } finally {
        isLoading.value = false;
    }
};

const copyLink = async () => {
    const url = window.location.href;
    try {
        await navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
    } catch (err) {
        alert('Failed to copy link.');
    }
};

const downloadImage = async () => {
    const el = document.getElementById('time-machine-share-card');
    if (!el) return;

    isDownloading.value = true;
    try {
        const canvas = await html2canvas(el, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#1e1e2f', // Match card bg
            scale: 2, // High quality
        });
        
        const link = document.createElement('a');
        link.download = `timemachine_${resultData.value.ticker}_${resultData.value.years}Y.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        console.error('Failed to capture image:', error);
        alert('Failed to generate image.');
    } finally {
        isDownloading.value = false;
    }
};
</script>

<template>
    <div class="time-machine-page max-w-screen-md mx-auto p-4">
        <div class="text-center mb-6">
            <h1 class="text-4xl font-bold mb-2 font-bungee text-primary">TIME MACHINE</h1>
            <p class="text-gray-500 text-lg">If I had bought this stock...</p>
        </div>

        <div class="surface-card p-4 border-round-xl shadow-2 mb-5">
            <div class="grid formgrid p-fluid">
                <div class="field col-12 md:col-6">
                    <label for="ticker" class="font-bold">Ticker Symbol</label>
                    <AutoComplete
                        v-model="ticker"
                        :suggestions="filteredSymbols"
                        @complete="searchSymbol"
                        placeholder="e.g. AAPL"
                        class="w-full"
                        @keyup.enter="calculate"
                    />
                </div>
                
                <div class="field col-12 md:col-6">
                    <label for="amount" class="font-bold">Investment Amount ($)</label>
                    <InputNumber
                        id="amount"
                        v-model="amount"
                        mode="currency"
                        currency="USD"
                        locale="en-US"
                        class="w-full"
                        @keyup.enter="calculate"
                    />
                </div>

                <div class="field col-12 md:col-6">
                    <label for="years" class="font-bold">Time Period</label>
                    <Dropdown
                        id="years"
                        v-model="years"
                        :options="periodOptions"
                        optionLabel="label"
                        optionValue="value"
                        class="w-full"
                    />
                </div>

                <div class="field col-12 md:col-6 flex align-items-center mt-4 md:mt-5">
                    <Checkbox v-model="includeDrip" :binary="true" inputId="drip" />
                    <label for="drip" class="ml-2 cursor-pointer">Include Dividend Reinvestment (DRIP)</label>
                </div>
            </div>

            <div class="mt-4 flex justify-content-center">
                <Button label="Calculate" icon="pi pi-calculator" class="w-full md:w-auto px-6" size="large" @click="calculate" :loading="isLoading" />
            </div>
            
            <Message v-if="errorMsg" severity="error" class="mt-3">{{ errorMsg }}</Message>
            <Message v-if="adjustedDateMessage" severity="info" class="mt-3">{{ adjustedDateMessage }}</Message>
        </div>

        <div v-if="isLoading" class="flex justify-content-center my-6">
            <ProgressSpinner />
        </div>

        <div v-else-if="resultData" class="result-section animation-fadein">
            <TimeMachineResultCard
                :ticker="resultData.ticker"
                :initialAmount="resultData.initialAmount"
                :currentAmount="resultData.currentAmount"
                :years="resultData.years"
                :roi="resultData.roi"
                :dateRange="resultData.dateRange"
            />
            
            <div class="flex justify-content-center gap-3 mt-5">
                <Button label="Copy Link" icon="pi pi-link" severity="secondary" outlined @click="copyLink" />
                <Button label="Download Image" icon="pi pi-download" severity="success" @click="downloadImage" :loading="isDownloading" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.font-bungee {
    font-family: 'Bungee', cursive;
}
.animation-fadein {
    animation: fadein 0.5s;
}
@keyframes fadein {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
}
</style>
