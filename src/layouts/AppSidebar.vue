<!-- src/layouts/AppSidebar.vue -->

<script setup>
    import { computed, ref, watch } from 'vue';
    import { useSidebar } from '@/composables/portfolio/useSidebar';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';
    import { user } from '../store/auth';

    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Skeleton from 'primevue/skeleton';
    import Button from 'primevue/button';
    import CompanyLogo from '@/components/CompanyLogo.vue';
    import FilterInput from '@/components/FilterInput.vue';
    import WeekdayRotatingTag from '@/components/WeekdayRotatingTag.vue';

    const {
        isLoading,
        hasInitialLoadCompleted,
        error,
        selectedTicker,
        globalSearchQuery,
        mainFilterTab,
        isSearchActive,
        isSearchLoading,
        subFilterTab,
        myBookmarks,
        filteredTickers,
        handleStockBookmarkClick,
        isTickerBookmarked,
        onRowSelect,
        handleTickerRequest,
    } = useSidebar();

    const { isMobile } = useBreakpoint();
    const skeletonItems = ref(new Array(50));
    const tableSize = computed(() => (isMobile.value ? 'small' : null));
    const forceSearchSkeleton = ref(false);
    const isTableLoading = computed(
        () =>
            isLoading.value ||
            isSearchLoading.value ||
            forceSearchSkeleton.value
    );

    const groupedMarketOptions = [
        {
            label: '미국',
            code: 'US',
            flagSrc: '/flags/us.svg',
            items: [
                {
                    label: '미국 ETF',
                    shortLabel: 'ETF',
                    value: { main: '미국', sub: 'ETF' },
                },
                {
                    label: '미국 개별 주식',
                    shortLabel: '개별주',
                    value: { main: '미국', sub: '주식' },
                },
            ],
        },
    ];

    const isBookmarkActive = computed(
        () => mainFilterTab.value === '북마크' && !!user.value
    );

    const isSelected = (item) => {
        return (
            mainFilterTab.value === item.value.main &&
            subFilterTab.value === item.value.sub
        );
    };

    const selectOption = (item) => {
        mainFilterTab.value = item.value.main;
        subFilterTab.value = item.value.sub;
    };

    const handleBookmarkClick = () => {
        if (!user.value) {
            return;
        }
        mainFilterTab.value = '북마크';
        subFilterTab.value = groupedMarketOptions[0].items[0].value.sub;
    };

    // 로그아웃 시 북마크 탭에 있으면 미국 탭으로 전환
    watch(user, (newUser) => {
        if (!newUser && mainFilterTab.value === '북마크') {
            mainFilterTab.value = '미국';
        }
    });

    watch(
        () => (globalSearchQuery.value || '').trim(),
        (value) => {
            forceSearchSkeleton.value = !!value;
        }
    );

    watch(
        filteredTickers,
        () => {
            if (
                forceSearchSkeleton.value &&
                !isSearchLoading.value &&
                (filteredTickers.value?.length || 0) > 0
            ) {
                forceSearchSkeleton.value = false;
            }
        },
        { flush: 'post' }
    );
</script>

<template>
    <div class="h-full flex flex-column gap-2">
        <div class="flex flex-column gap-2 p-0">
            <div class="filter-button-group">
                <template v-if="isSearchActive">
                    <Message
                        severity="contrast"
                        class="w-full flex justify-content-center"
                        >전체 검색 중입니다.</Message
                    >
                </template>
                <template v-else>
                    <Button
                        v-if="user"
                        :label="isMobile ? undefined : '북마크'"
                        icon="pi pi-bookmark"
                        size="small"
                        :outlined="!isBookmarkActive"
                        :severity="isBookmarkActive ? 'primary' : 'secondary'"
                        class="bookmark-toggle mb-2"
                        v-tooltip.bottom="isMobile ? '북마크' : undefined"
                        @click="handleBookmarkClick" />

                    <div class="market-selector flex gap-1">
                        <div
                            v-for="group in groupedMarketOptions"
                            :key="group.code"
                            class="market-row flex align-items-center gap-1 p-1 border-round surface-ground">
                            <div class="market-flag flex-shrink-0">
                                <img
                                    :src="group.flagSrc"
                                    :alt="group.label"
                                    width="24"
                                    height="18"
                                    class="block" />
                            </div>
                            <div
                                class="market-options flex gap-1 flex-grow-1 justify-content-around">
                                <div
                                    v-for="item in group.items"
                                    :key="item.label"
                                    class="market-option cursor-pointer px-2 py-1 border-round text-sm transition-colors"
                                    :class="{
                                        'bg-primary text-primary-inverse font-bold':
                                            isSelected(item),
                                        'text-color-secondary hover:surface-hover':
                                            !isSelected(item),
                                    }"
                                    @click="selectOption(item)">
                                    {{ item.shortLabel }}
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            <FilterInput v-model="globalSearchQuery" title="전체 주식 검색" />
        </div>

        <div v-if="error" class="text-red-500 p-4">{{ error }}</div>

        <div class="flex-grow-1 overflow-hidden">
            <DataTable
                v-if="!error"
                id="t-search-datatable"
                :value="isTableLoading ? skeletonItems : filteredTickers"
                v-model:selection="selectedTicker"
                dataKey="symbol"
                selectionMode="single"
                @rowSelect="onRowSelect"
                stripedRows
                scrollable
                scrollHeight="flex"
                :size="tableSize"
                :class="{ 'p-datatable-loading': isTableLoading }"
                class="h-full">
                <template #empty>
                    <div
                        v-if="!hasInitialLoadCompleted || isTableLoading"
                        class="p-4">
                        <div class="flex flex-column gap-3">
                            <Skeleton height="1.5rem" />
                            <Skeleton height="1.5rem" />
                            <Skeleton height="1.5rem" />
                        </div>
                    </div>
                    <template v-else>
                        <div
                            v-if="mainFilterTab === '북마크'"
                            class="text-center p-4">
                            <p v-if="!user" class="mb-2">
                                로그인 후 종목을 북마크에 추가해 보세요.
                            </p>
                            <p
                                class="mb-2"
                                v-else-if="
                                    Object.keys(myBookmarks).length === 0
                                ">
                                아직 추가된 북마크가 없습니다.<br />종목 왼쪽의
                                아이콘을 클릭하여 추가하세요.
                            </p>
                            <p v-else>검색 결과가 없습니다.</p>
                        </div>
                        <div v-else class="text-center p-4">
                            검색 결과가 없습니다.
                        </div>
                    </template>
                </template>
                <Column frozen class="t-column-bookmark">
                    <template #body="{ data }">
                        <Skeleton
                            v-if="isTableLoading"
                            shape="circle"
                            size="1rem"></Skeleton>
                        <i
                            v-else
                            class="pi pi-bookmark"
                            :class="{
                                'is-active': user && isTickerBookmarked(data),
                            }"
                            @click.stop="handleStockBookmarkClick(data)"></i>
                    </template>
                </Column>
                <Column
                    field="symbol"
                    sortable
                    frozen
                    class="font-bold t-column-ticker">
                    <template #header
                        ><span>{{ isMobile ? '' : '티커' }}</span></template
                    >
                    <template #body="{ data }">
                        <Skeleton v-if="isTableLoading"></Skeleton>
                        <span v-else>{{
                            data.currency === 'USD'
                                ? data.symbol
                                : data.koName || data.symbol
                        }}</span>
                    </template>
                </Column>
                <Column field="company" sortable class="t-column-company">
                    <template #header
                        ><span v-if="!isMobile">회사</span></template
                    >
                    <template #body="{ data }">
                        <Skeleton
                            v-if="isTableLoading"
                            width="3rem"
                            height="3rem"></Skeleton>
                        <CompanyLogo
                            v-else
                            :logo-src="data.logo"
                            :company-name="data.company" />
                    </template>
                </Column>
                <Column field="frequency" sortable class="t-column-frequency">
                    <template #header
                        ><span v-if="!isMobile">지급</span></template
                    >
                    <template #body="{ data }">
                        <Skeleton v-if="isTableLoading"></Skeleton>
                        <span v-else>{{ data.frequency }}</span>
                    </template>
                </Column>
                <Column
                    field="group"
                    sortable
                    class="t-column-group"
                    sortField="groupOrder">
                    <template #header
                        ><span v-if="!isMobile">그룹</span></template
                    >
                    <template #body="{ data }">
                        <Skeleton v-if="isTableLoading"></Skeleton>
                        <WeekdayRotatingTag
                            v-else
                            :labels="data.groupLabels"
                            :fallback="data.group"
                            :interval="1600" />
                    </template>
                </Column>
            </DataTable>
        </div>
    </div>
</template>
