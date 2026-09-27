// src/composables/data/useExchangeRates.ts
import { ref } from 'vue';
import { joinURL } from 'ufo';

/**
 * 환율 정보
 */
interface ExchangeRate {
    date: string;
    rate: number;
}

const exchangeRates = ref<ExchangeRate[]>([]);
let isLoaded = false;
let isLoadingPromise: Promise<void> | null = null;

async function loadRates(): Promise<void> {
    if (isLoaded) return;
    if (isLoadingPromise) return isLoadingPromise;

    isLoadingPromise = (async () => {
        try {
            const response = await fetch(
                joinURL(import.meta.env.BASE_URL, 'exchange-rates.json')
            );
            if (!response.ok)
                throw new Error('Failed to load exchange rates file');
            exchangeRates.value = await response.json();
            isLoaded = true;
        } catch (e) {
            console.error('Error loading exchange rates:', e);
        } finally {
            isLoadingPromise = null;
        }
    })();
    return isLoadingPromise;
}

export interface UseExchangeRatesReturn {
    findRateForDate: (date: Date) => Promise<number | null>;
}

export function useExchangeRates(): UseExchangeRatesReturn {
    const findRateForDate = async (date: Date): Promise<number | null> => {
        await loadRates();
        if (!date || isNaN(date.getTime()) || exchangeRates.value.length === 0)
            return null;

        let targetDate = new Date(date);
        for (let i = 0; i < 7; i++) {
            const dateStr = targetDate.toISOString().split('T')[0];
            const found = exchangeRates.value.find((r) => r.date === dateStr);
            if (found) return found.rate;
            const pastDate = new Date(date);
            pastDate.setDate(pastDate.getDate() - i);
            const pastDateStr = pastDate.toISOString().split('T')[0];
            const foundPast = exchangeRates.value.find(
                (r) => r.date === pastDateStr
            );
            if (foundPast) return foundPast.rate;
        }
        return null;
    };

    return { findRateForDate };
}
