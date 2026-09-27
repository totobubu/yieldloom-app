<!-- stock\src\pages\CalendarView.vue -->
<script setup>
    import { ref, onMounted, watch } from 'vue';
    import { useHead } from '@vueuse/head';
    import { useRouter } from 'vue-router';
    import { useCalendarData } from '@/composables/data/useCalendarData';
    import { useFilterState } from '@/composables/portfolio/useFilterState';
    import { getRouteParamsFromSymbol } from '@/utils/tickerRoute';

    import LoadingOverlay from '@/components/common/LoadingOverlay.vue';
    import CalendarGrid from '@/components/CalendarGrid.vue';

    useHead({ title: '배당달력' });

    const holidays = ref([]);
    // [핵심 수정] 임시 데이터를 제거하고, useCalendarData를 다시 활성화합니다.
    const { dividendsByDate, isLoading, error, ensureDataLoaded } =
        useCalendarData();
    const { mainFilterTab, isBookmarksLoading } = useFilterState();
    const router = useRouter();

    const goToTickerPage = (tickerSymbol) => {
        if (!tickerSymbol || typeof tickerSymbol !== 'string') return;
        const params = getRouteParamsFromSymbol(tickerSymbol);
        if (params) router.push({ name: 'stock-detail', params });
    };

    const loadHolidays = async () => {
        const fileName = 'us_holidays.json';
        try {
            const response = await fetch(`/holidays/${fileName}`);
            if (!response.ok) throw new Error(`Failed to fetch ${fileName}`);
            holidays.value = await response.json();
        } catch (e) {
            console.error(`Could not load or parse ${fileName}:`, e);
            holidays.value = [];
        }
    };

    // [핵심 수정] onMounted와 watch를 다시 활성화합니다.
    onMounted(() => {
        ensureDataLoaded();
        loadHolidays();
    });

    watch(mainFilterTab, () => {
        loadHolidays();
    });
</script>

<template>
    <LoadingOverlay
        :visible="
            (isLoading && Object.keys(dividendsByDate).length === 0) ||
            (mainFilterTab === '북마크' && isBookmarksLoading)
        "
        :message="
            mainFilterTab === '북마크'
                ? '북마크 데이터를 불러오는 중...'
                : '달력 데이터를 불러오는 중...'
        " />

    <div v-if="error" class="text-center mt-8">
        <p>{{ error }}</p>
    </div>
    <div v-else id="p-calendar">
        <CalendarGrid
            :dividendsByDate="dividendsByDate"
            :holidays="holidays"
            @view-ticker="goToTickerPage" />
    </div>
</template>
