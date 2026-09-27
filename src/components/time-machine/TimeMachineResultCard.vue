<script setup>
import { computed } from 'vue';

const props = defineProps({
    ticker: { type: String, required: true },
    initialAmount: { type: Number, required: true },
    currentAmount: { type: Number, required: true },
    years: { type: Number, required: true },
    roi: { type: Number, required: true },
    companyName: { type: String, default: '' },
    dateRange: { type: String, default: '' },
});

const formattedInitial = computed(() => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(props.initialAmount);
});

const formattedCurrent = computed(() => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(props.currentAmount);
});

const formattedRoi = computed(() => {
    const sign = props.roi >= 0 ? '+' : '';
    return `${sign}${(props.roi * 100).toFixed(2)}%`;
});

const roiClass = computed(() => {
    return props.roi >= 0 ? 'text-green-400' : 'text-red-400';
});
</script>

<template>
    <div class="time-machine-card p-6 border-round-2xl shadow-6 text-white" id="time-machine-share-card">
        <div class="flex justify-content-between align-items-start mb-4">
            <div>
                <h2 class="m-0 text-4xl font-bold font-bungee">{{ ticker.toUpperCase() }}</h2>
                <p class="m-0 text-gray-300 text-lg" v-if="companyName">{{ companyName }}</p>
            </div>
            <div class="text-right">
                <p class="m-0 text-gray-300 font-semibold uppercase tracking-widest text-sm">Time Machine</p>
                <p class="m-0 text-gray-400 text-xs">{{ dateRange }}</p>
            </div>
        </div>

        <div class="mb-5">
            <p class="m-0 text-xl text-gray-200 mb-2">If I had invested <span class="font-bold text-white">{{ formattedInitial }}</span></p>
            <p class="m-0 text-lg text-gray-300">{{ years }} years ago...</p>
        </div>

        <div class="result-box p-4 border-round-xl surface-ground flex align-items-center justify-content-between mb-4">
            <div>
                <p class="m-0 text-gray-400 text-sm font-semibold uppercase mb-1">It would now be worth</p>
                <p class="m-0 text-4xl font-bold text-white">{{ formattedCurrent }}</p>
            </div>
            <div class="text-right">
                <p class="m-0 text-2xl font-bold" :class="roiClass">{{ formattedRoi }}</p>
            </div>
        </div>

    </div>
</template>

<style scoped>
.time-machine-card {
    background: linear-gradient(135deg, #1e1e2f 0%, #2a2a40 100%);
    position: relative;
    overflow: hidden;
    max-width: 500px;
    margin: 0 auto;
}

.time-machine-card::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 60%);
    pointer-events: none;
}

.font-bungee {
    font-family: 'Bungee', cursive;
}

.result-box {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
}
</style>
