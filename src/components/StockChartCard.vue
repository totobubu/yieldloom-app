<!-- stock\src\components\StockChartCard.vue -->
<script setup>
    import { ref, computed } from 'vue';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';
    import { useAdmin } from '@/composables/asset/useAdmin';
    import {
        getGroupSeverity,
        extractWeekdayLabels,
    } from '@/utils/uiHelpers.js';
    import Card from 'primevue/card';
    import SelectButton from 'primevue/selectbutton';
    import Dropdown from 'primevue/dropdown';
    import Tag from 'primevue/tag';
    import Button from 'primevue/button';
    import AddAssetModal from '@/components/asset/AddAssetModal.vue';
    import StockTimelineModal from '@/components/StockTimelineModal.vue';
    // import StockCalculators from '@/components/StockCalculators.vue';

    const { isAdmin } = useAdmin();

    const props = defineProps({
        tickerInfo: Object,
        dividendHistory: Array,
        userBookmark: Object,
        viewOptions: Array,
        timeRangeOptions: Array,
        currentView: String,
        selectedTimeRange: String,
    });

    const emit = defineEmits([
        'update:currentView',
        'update:selectedTimeRange',
    ]);
    const { isDesktop, isMobile } = useBreakpoint();
    const buttonSize = computed(() => (isMobile.value ? 'small' : null));

    // Asset Modal
    const showAddAssetModal = ref(false);

    const handleAssetSaved = async (data) => {
        console.log('Asset saved:', data);
        // 여기서 Firestore에 저장하는 로직 추가
    };

    const currentPrice = computed(() => {
        return props.tickerInfo?.price || 0;
    });

    const localCurrentView = computed({
        get: () => props.currentView,
        set: (value) => emit('update:currentView', value),
    });
    const localSelectedTimeRange = computed({
        get: () => props.selectedTimeRange,
        set: (value) =>
            emit(
                'update:selectedTimeRange',
                typeof value === 'object' ? value.value : value
            ),
    });
    const dropdownTimeRangeOptions = computed(() =>
        props.timeRangeOptions?.map((opt) => ({
            name: opt.label,
            code: opt.value,
        }))
    );

    const weekdayTags = computed(() =>
        extractWeekdayLabels(
            props.tickerInfo?.group,
            props.tickerInfo?.group2 || null
        )
    );
    const primaryWeekday = computed(
        () => weekdayTags.value[0] || props.tickerInfo?.group || null
    );

    const normalizeSplitType = (value) => {
        if (!value) return null;
        const normalized = value
            .toString()
            .trim()
            .replace(/[_\s]+/g, '-')
            .toLowerCase();
        if (normalized.includes('reverse')) return 'reverse-split';
        if (normalized.includes('split')) return 'split';
        return null;
    };

    const parseSplitRatio = (ratio) => {
        if (!ratio) return null;
        const match = ratio
            .toString()
            .replace(/\s+/g, '')
            .match(/^(\d+(?:\.\d+)?)[/:](\d+(?:\.\d+)?)/i);
        if (!match) return null;
        return {
            numerator: Number(match[1]),
            denominator: Number(match[2]),
        };
    };

    const inferSplitEventType = (event) => {
        // 비율을 먼저 확인해서 합병/분할 판단
        const parsedRatio = parseSplitRatio(event?.ratio);
        if (parsedRatio) {
            // numerator < denominator이면 합병 (예: 1:2 = 2주를 1주로 합침)
            // numerator > denominator이면 분할 (예: 2:1 = 1주를 2주로 분할)
            if (parsedRatio.numerator === parsedRatio.denominator)
                return 'split';
            return parsedRatio.numerator < parsedRatio.denominator
                ? 'reverse-split'
                : 'split';
        }
        // 비율이 없으면 type 필드 확인
        const normalizedType = normalizeSplitType(event?.type);
        return normalizedType || 'split';
    };

    const timelineRawEvents = computed(() => {
        const events = [];
        const frequencyEvents =
            props.tickerInfo?.events?.frequencyChanges || [];
        frequencyEvents.forEach((event) => {
            const hasGroupChange =
                event.fromGroup &&
                event.toGroup &&
                event.fromGroup !== event.toGroup;
            events.push({
                icon: 'pi pi-refresh',
                color: '#6366F1',
                eventType: hasGroupChange ? 'frequency-group' : 'frequency',
                ...event,
            });
        });

        const weekdayEvents = props.tickerInfo?.events?.weekdayChanges || [];
        if (weekdayEvents.length > 0) {
            const weeklyLabel =
                props.tickerInfo?.frequency &&
                props.tickerInfo.frequency.includes('주')
                    ? props.tickerInfo.frequency
                    : '매주';
            weekdayEvents.forEach((event) => {
                events.push({
                    date: event.date,
                    from: event.fromFrequency || weeklyLabel,
                    to: event.toFrequency || weeklyLabel,
                    fromGroup: event.from,
                    toGroup: event.to,
                    icon: 'pi pi-calendar',
                    color: '#22c55e',
                    eventType: 'weekday',
                });
            });
        }

        const splitEvents = props.tickerInfo?.events?.splits || [];
        splitEvents.forEach((event) => {
            const eventType = inferSplitEventType(event);
            events.push({
                date: event.date,
                ratio: event.ratio,
                type: event.type,
                icon: 'pi pi-chart-line',
                color: eventType === 'reverse-split' ? '#f97316' : '#0ea5e9',
                eventType,
            });
        });

        return events;
    });
    const hasTimelineEvents = computed(
        () => timelineRawEvents.value.length > 0
    );
</script>

<template>
    <Card class="t-chart">
        <template #content>
            <div
                class="t-chart-header"
                :class="isMobile ? 'flex-column gap-2' : 'flex-grow-1'">
                <div class="flex gap-2">
                    <SelectButton
                        v-if="viewOptions && viewOptions.length > 1"
                        v-model="localCurrentView"
                        :options="viewOptions"
                        :size="buttonSize" />
                    <template
                        v-if="
                            timeRangeOptions &&
                            timeRangeOptions.length > 0 &&
                            currentView !== '주가'
                        ">
                        <SelectButton
                            v-if="isDesktop"
                            v-model="localSelectedTimeRange"
                            :options="timeRangeOptions"
                            optionLabel="label"
                            optionValue="value" />
                        <Dropdown
                            v-else
                            v-model="localSelectedTimeRange"
                            :options="dropdownTimeRangeOptions"
                            optionLabel="name"
                            optionValue="code"
                            placeholder="기간"
                            :size="buttonSize" />
                    </template>
                </div>
                <div class="flex align-items-center gap-2" v-if="tickerInfo">
                    <StockTimelineModal
                        v-if="hasTimelineEvents"
                        :events="timelineRawEvents"
                        :fallback-group="primaryWeekday">
                        <template #trigger="{ open }">
                            <Button
                                icon="pi pi-calendar"
                                text
                                v-tooltip="'이벤트 타임라인'"
                                @click="open()" />
                        </template>
                    </StockTimelineModal>
                    <Tag v-if="tickerInfo.frequency" severity="secondary">{{
                        tickerInfo.frequency
                    }}</Tag>
                    <template v-if="weekdayTags.length > 0">
                        <Tag
                            v-for="weekday in weekdayTags"
                            :key="weekday"
                            :severity="getGroupSeverity(weekday)"
                            >{{ weekday }}</Tag
                        >
                    </template>
                    <Tag
                        v-else-if="tickerInfo.group"
                        :severity="getGroupSeverity(tickerInfo.group)"
                        >{{ tickerInfo.group }}</Tag
                    >
                    <slot name="calculators"></slot>
                    <!--자산관리에 저장-->
                    <Button
                        v-if="isAdmin"
                        icon="pi pi-wallet"
                        text
                        @click="showAddAssetModal = true"
                        v-tooltip="'자산관리에 저장'" />
                    <!--// 자산관리에 저장-->
                </div>
            </div>
        </template>
    </Card>

    <!-- Add Asset Modal -->
    <AddAssetModal
        :visible="showAddAssetModal"
        :ticker="tickerInfo?.symbol || ''"
        :price="currentPrice"
        @update:visible="showAddAssetModal = $event"
        @saved="handleAssetSaved" />
</template>

<style scoped></style>
