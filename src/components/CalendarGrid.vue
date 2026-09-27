<!-- src\components\CalendarGrid.vue -->
<script setup>
    import { ref, computed, watch } from 'vue';
    import FullCalendar from '@fullcalendar/vue3';
    import dayGridPlugin from '@fullcalendar/daygrid';
    import listPlugin from '@fullcalendar/list';
    import interactionPlugin from '@fullcalendar/interaction';
    import koLocale from '@fullcalendar/core/locales/ko';
    import { useFilterState } from '@/composables/portfolio/useFilterState';
    import { useCalendarData } from '@/composables/data/useCalendarData';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';
    import Button from 'primevue/button';
    import SelectButton from 'primevue/selectbutton';
    import Card from 'primevue/card';
    import Panel from 'primevue/panel';
    import { extractWeekdayLabels } from '@/utils/uiHelpers.js';
    import {
        resolveInstrumentByIsin,
        resolveInstrumentBySymbol,
    } from '@/store/instruments';

    const props = defineProps({
        dividendsByDate: Object,
        holidays: Array,
    });

    const emit = defineEmits(['view-ticker']);
    const { toggleMyStock, myBookmarks } = useFilterState();
    const { loadVisibleMonth } = useCalendarData();
    const { isMobile } = useBreakpoint();
    const fullCalendar = ref(null);
    const currentTitle = ref('');
    const currentView = ref(isMobile.value ? 'listWeek' : 'dayGridMonth');

    // 달력 표시 범위 계산 (-6개월 ~ +4개월)
    const getValidRange = () => {
        const now = new Date();

        // -6개월
        const startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 6);
        startDate.setDate(1);

        // +4개월 (다음 달 1일)
        const endDate = new Date(now);
        endDate.setMonth(now.getMonth() + 5);
        endDate.setDate(1);

        return {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
        };
    };

    const validRange = getValidRange();
    const canGoPrev = ref(true);
    const canGoNext = ref(true);

    // 현재 표시 중인 날짜가 범위의 경계에 있는지 확인
    const updateNavigationState = () => {
        if (!fullCalendar.value) return;

        const calendarApi = fullCalendar.value.getApi();
        const currentDate = calendarApi.getDate();

        // validRange 경계 날짜
        const minDate = new Date(validRange.start);
        const maxDate = new Date(validRange.end);

        // 현재 뷰의 시작/끝 날짜
        const viewStart = calendarApi.view.currentStart;
        const viewEnd = calendarApi.view.currentEnd;

        // 이전 버튼: 현재 뷰가 최소 날짜 이전으로 갈 수 없으면 비활성화
        const prevMonthStart = new Date(currentDate);
        prevMonthStart.setMonth(currentDate.getMonth() - 1);
        canGoPrev.value = prevMonthStart >= minDate;

        // 다음 버튼: 현재 뷰가 최대 날짜 이후로 갈 수 없으면 비활성화
        const nextMonthStart = new Date(currentDate);
        nextMonthStart.setMonth(currentDate.getMonth() + 1);
        canGoNext.value = nextMonthStart < maxDate;
    };

    const bookmarkEntries = computed(() =>
        Object.values(myBookmarks.value || {})
    );
    const bookmarkedIsins = computed(() => {
        const set = new Set();
        bookmarkEntries.value.forEach((entry) => {
            if (entry?.isin) set.add(entry.isin.toUpperCase());
        });
        return set;
    });
    const bookmarkedSymbols = computed(() => {
        const set = new Set();
        bookmarkEntries.value.forEach((entry) => {
            if (entry?.symbol) set.add(entry.symbol.toUpperCase());
        });
        return set;
    });
    const isEntryBookmarked = (entry) => {
        if (!entry) return false;
        if (entry.isin && bookmarkedIsins.value.has(entry.isin.toUpperCase()))
            return true;
        const symbol = entry.ticker || entry.symbol;
        if (symbol) {
            return bookmarkedSymbols.value.has(symbol.toUpperCase());
        }
        return false;
    };
    const resolveEventInstrument = (entry) => {
        if (!entry) return null;
        const isin = entry.isin ? entry.isin.toUpperCase() : null;
        const symbol = entry.ticker || entry.symbol;
        const normalizedSymbol = symbol ? symbol.toUpperCase() : null;

        const instrument =
            (isin && resolveInstrumentByIsin(isin)) ||
            (normalizedSymbol && resolveInstrumentBySymbol(normalizedSymbol));

        if (instrument) return instrument;

        if (!isin && !normalizedSymbol) return null;

        return {
            isin,
            symbol: normalizedSymbol,
            market: entry.market || null,
            currency: entry.currency || null,
        };
    };

    const viewOptions = computed(() =>
        isMobile.value
            ? [{ label: '목록', value: 'listWeek' }]
            : [
                  { label: '월', value: 'dayGridMonth' },
                  { label: '주', value: 'dayGridWeek' },
              ]
    );

    const getEventClass = (entry) => {
        if (!entry) return 'freq-default';
        const { frequency, group } = entry;
        if (frequency === '매월') return 'freq-monthly';
        if (frequency === '분기') return 'freq-quarterly';
        if (frequency && frequency.includes('주')) {
            const groupMap = {
                월: 'mon',
                화: 'tue',
                수: 'wed',
                목: 'thu',
                금: 'fri',
            };
            const weekdayLabels = extractWeekdayLabels(
                group,
                entry.group2 || null
            );
            const primaryGroup = weekdayLabels[0];
            if (!primaryGroup) return 'freq-default';
            return `freq-${groupMap[primaryGroup] || 'default'}`;
        }
        return 'freq-default';
    };

    // [핵심 수정] computed 대신 일반 함수로 변경하여 eventSources 내부에서 호출
    const getCalendarEvents = () => {
        // ComputedRef인 경우 .value로 접근
        const dividends = props.dividendsByDate;

        if (!dividends || typeof dividends !== 'object') {
            return [];
        }

        const entries = Object.entries(dividends);

        return entries.flatMap(([date, dividendArray]) => {
            if (!Array.isArray(dividendArray)) {
                return [];
            }
            return dividendArray.map((entry) => ({
                title: `${entry.koName || entry.ticker}`,
                start: date,
                extendedProps: {
                    ...entry,
                    eventClass: getEventClass(entry),
                },
            }));
        });
    };

    const getHolidayEvents = () => {
        if (!props.holidays) return [];
        return props.holidays.map((holiday) => ({
            id: `holiday-${holiday.date}`,
            title: holiday.name,
            start: holiday.date,
            display: 'background',
            color: 'rgba(255, 0, 0, 0.3)',
            extendedProps: { isHoliday: true },
        }));
    };

    const calendarOptions = computed(() => ({
        plugins: [dayGridPlugin, listPlugin, interactionPlugin],
        initialView: isMobile.value ? 'listWeek' : 'dayGridMonth',
        locale: koLocale,
        headerToolbar: false,
        showNonCurrentDates: false,
        validRange,
        datesSet: (info) => {
            currentTitle.value = info.view.title;
            if (info.view.type !== currentView.value)
                currentView.value = info.view.type;
            updateNavigationState();

            // 현재 보이는 월의 데이터 로드
            const viewDate = info.view.currentStart;
            const year = viewDate.getFullYear();
            const month = viewDate.getMonth() + 1;
            loadVisibleMonth(year, month);
        },
        // [핵심 수정] eventSources를 사용하여 데이터를 동적으로 로드
        eventSources: [
            {
                id: 'dividends',
                events: (fetchInfo, successCallback) => {
                    successCallback(getCalendarEvents());
                },
            },
            {
                id: 'holidays',
                events: (fetchInfo, successCallback) => {
                    successCallback(getHolidayEvents());
                },
            },
        ],
        weekends: false,
        eventClassNames: (arg) =>
            arg.event.extendedProps.eventClass || 'freq-default',
        eventClick: (info) => {
            const actionElement = info.jsEvent.target.closest('[data-action]');
            if (actionElement) {
                const { action } = actionElement.dataset;
                const eventData = info.event.extendedProps;
                const { ticker } = eventData;
                if (action === 'view') emit('view-ticker', ticker);
                else if (action === 'bookmark-add') {
                    if (!isEntryBookmarked(eventData)) {
                        const instrument = resolveEventInstrument(eventData);
                        if (instrument?.isin || instrument?.symbol) {
                            toggleMyStock(instrument);
                        }
                        fullCalendar.value?.getApi().refetchEvents();
                    }
                }
            }
        },
        eventContent: (arg) => {
            if (arg.event.extendedProps.isHoliday)
                return {
                    html: `<div class="fc-holiday-name"><span>${arg.event.title}</span></div>`,
                };
            const {
                ticker,
                amount,
                eventClass,
                koName,
                currency,
                isExpected,
                isForecast,
            } = arg.event.extendedProps;
            const currencySymbol = currency === 'KRW' ? '₩' : '$';
            const displayName = currency === 'KRW' ? koName : ticker;
            const amountStr =
                amount != null
                    ? currency === 'KRW'
                        ? Math.round(amount)
                        : amount.toFixed(4)
                    : '';

            // [수정] amountHtml 로직 변경
            let amountHtml;
            if (amount != null) {
                amountHtml = `<span>${currencySymbol}${amountStr}</span>`;
            } else if (isForecast) {
                amountHtml = '<span class="no-amount forecasted">예상</span>';
            } else if (isExpected) {
                amountHtml = '<span class="no-amount scheduled">예정</span>';
            } else {
                // 혹시 모를 예외 케이스
                amountHtml = '<span class="no-amount">정보없음</span>';
            }

            const viewButtonHtml = `<button class="p-button p-component p-button-icon-only p-button-text p-button-sm" data-action="view" title="상세 보기"><span class="pi pi-link"></span></button>`;

            if (arg.view.type === 'listWeek') {
                return {
                    html: `<div class="stock-item-list ${eventClass}"><span class="data"><span class="ticker-name">${displayName}</span> <span class="amount-text">${amountHtml}</span></span><span class="actions">${viewButtonHtml}</span></div>`,
                };
            } else if (arg.view.type === 'dayGridWeek') {
                const isBookmarked = isEntryBookmarked(arg.event.extendedProps);
                const bookmarkButtonHtml = `<button class="p-button p-component p-button-text p-button-sm bookmark-action" data-action="bookmark-add" title="${
                    isBookmarked
                        ? '이미 북마크에 추가되었습니다.'
                        : '북마크 추가'
                }" ${isBookmarked ? 'disabled' : ''}><span class="pi ${
                    isBookmarked ? 'pi-check' : 'pi-bookmark'
                }"></span><span class="bookmark-label hidden">${
                    isBookmarked ? '추가됨' : '북마크 추가'
                }</span></button>`;
                return {
                    html: `<div class="stock-item-week ${eventClass}"><span class="ticker-name">${displayName}</span><span class="amount-text">${amountHtml}</span><span class="actions">${viewButtonHtml}${bookmarkButtonHtml}</span></div>`,
                };
            } else {
                return {
                    html: `<div class="stock-item-month ${eventClass}" data-action="view" title="상세 보기"><div class="fc-event-title"><span>${displayName}</span> ${amountHtml}</div></div>`,
                };
            }
        },
    }));

    watch(currentView, (newView) => {
        if (fullCalendar.value) fullCalendar.value.getApi().changeView(newView);
    });
    watch(isMobile, (isNowMobile) => {
        if (fullCalendar.value)
            fullCalendar.value
                .getApi()
                .changeView(isNowMobile ? 'listWeek' : 'dayGridMonth');
    });

    // [핵심 수정] props가 변경되면 refetchEvents를 호출하여 캘린더를 다시 그림
    watch(
        [() => props.dividendsByDate, () => props.holidays],
        () => {
            fullCalendar.value?.getApi().refetchEvents();
        },
        { deep: true }
    );

    watch(
        myBookmarks,
        () => {
            fullCalendar.value?.getApi().refetchEvents();
        },
        { deep: true }
    );

    const prevMonth = () => {
        if (canGoPrev.value) {
            fullCalendar.value?.getApi().prev();
        }
    };
    const nextMonth = () => {
        if (canGoNext.value) {
            fullCalendar.value?.getApi().next();
        }
    };
    const goToToday = () => fullCalendar.value?.getApi().today();
</script>

<template>
    <Card v-if="isMobile" id="t-calendar-list">
        <template #header>{{ currentTitle }}</template>
        <template #title>
            <Button
                icon="pi pi-chevron-left"
                text
                :disabled="!canGoPrev"
                @click="prevMonth" />
            <Button
                label="오늘"
                severity="primary"
                class="p-button-sm"
                @click="goToToday"
                variant="text" />
            <Button
                icon="pi pi-chevron-right"
                text
                :disabled="!canGoNext"
                @click="nextMonth" />
        </template>
        <template #content>
            <FullCalendar ref="fullCalendar" :options="calendarOptions" />
        </template>
    </Card>
    <Panel v-else id="t-calendar-grid">
        <template #header>
            <div class="header-left">
                <Button
                    label="오늘"
                    class="p-button-sm"
                    severity="primary"
                    @click="goToToday" />
            </div>
            <div class="header-center">
                <Button
                    icon="pi pi-chevron-left"
                    text
                    :disabled="!canGoPrev"
                    @click="prevMonth" />
                <h2>{{ currentTitle }}</h2>
                <Button
                    icon="pi pi-chevron-right"
                    text
                    :disabled="!canGoNext"
                    @click="nextMonth" />
            </div>
            <div class="header-right">
                <SelectButton
                    v-model="currentView"
                    :options="viewOptions"
                    optionLabel="label"
                    optionValue="value"
                    aria-labelledby="basic" />
            </div>
        </template>
        <FullCalendar ref="fullCalendar" :options="calendarOptions" />
    </Panel>
</template>
