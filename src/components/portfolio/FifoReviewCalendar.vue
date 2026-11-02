<script setup>
    import { computed, nextTick, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import {
        filterReviewEvents,
        recordedReviewDate,
        reviewCalendarCounts,
        reviewMonthDays,
        shiftReviewMonth,
    } from '@/services/fifoReviewCalendar.js';

    const props = defineProps({ events: { type: Array, required: true } });
    const search = ref(''),
        symbol = ref(''),
        selected = ref(''),
        month = ref('');
    const calendarElement = ref(null);
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const symbols = computed(() => [
        { label: '전체 종목', value: '' },
        ...[
            ...new Set(
                [
                    ...props.events.map((event) => event.symbol),
                    symbol.value,
                ].filter(Boolean)
            ),
        ]
            .sort()
            .map((value) => ({ label: value, value })),
    ]);
    // Upstream account/family selection is applied before these review-only filters.
    const matching = computed(() =>
        filterReviewEvents(props.events, {
            search: search.value,
            symbol: symbol.value,
        })
    );
    const counts = computed(() => reviewCalendarCounts(matching.value));
    const days = computed(() => reviewMonthDays(month.value));
    const visible = computed(() =>
        filterReviewEvents(matching.value, { date: selected.value })
    );
    const label = computed(() =>
        selected.value === 'unknown'
            ? '날짜 미상'
            : selected.value || '전체 날짜'
    );
    const monthLabel = computed(
        () => `${month.value.slice(0, 4)}년 ${Number(month.value.slice(5))}월`
    );
    watch(
        () => props.events,
        (events) => {
            if (!month.value) {
                const latest = events
                    .map((event) => recordedReviewDate(event.at))
                    .filter(Boolean)
                    .sort()
                    .at(-1);
                const today = new Date();
                month.value =
                    latest?.slice(0, 7) ||
                    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            }
        },
        { immediate: true }
    );

    function moveMonth(amount) {
        month.value = shiftReviewMonth(month.value, amount);
        // Browsing another month does not silently change the selected review date.
    }
    async function keyboardDate(event, date) {
        const index = days.value.indexOf(date);
        let target;
        if (event.key === 'PageUp' || event.key === 'PageDown') {
            const nextMonth = shiftReviewMonth(
                month.value,
                event.key === 'PageUp' ? -1 : 1
            );
            const valid = reviewMonthDays(nextMonth).filter(Boolean);
            target = valid[Math.min(Number(date.slice(8)), valid.length) - 1];
        } else {
            const offsets = {
                ArrowLeft: -1,
                ArrowRight: 1,
                ArrowUp: -7,
                ArrowDown: 7,
                Home: -(index % 7),
                End: 6 - (index % 7),
            };
            if (!(event.key in offsets)) return;
            const day = new Date(0);
            day.setUTCFullYear(
                Number(date.slice(0, 4)),
                Number(date.slice(5, 7)) - 1,
                Number(date.slice(8)) + offsets[event.key]
            );
            target = day.toISOString().slice(0, 10);
            if (!recordedReviewDate(target)) return;
        }
        event.preventDefault();
        month.value = target.slice(0, 7);
        await nextTick();
        calendarElement.value
            ?.querySelector(`[data-review-date="${target}"]`)
            ?.focus();
    }
</script>

<template>
    <section aria-label="일별 장부 검토">
        <h2>날짜별 내역 검토</h2>
        <p>
            가족·계좌 조회 범위와 아래 검색·종목 조건을 함께 적용합니다. 날짜는
            장부에 기록된 기준일이며 시간대를 변환하지 않습니다. 날짜·검색·종목
            선택은 거래·배당 표에만 적용되고, 위 자산 요약과 FIFO 계산은 전체
            이력을 유지합니다.
        </p>
        <div class="review-filters">
            <label
                >내역 검색<InputText
                    v-model="search"
                    aria-label="내역 검색"
                    placeholder="종목·출처·통화"
            /></label>
            <label
                >검토 종목<Select
                    v-model="symbol"
                    :options="symbols"
                    option-label="label"
                    option-value="value"
                    placeholder="전체 종목"
                    aria-label="검토 종목"
            /></label>
        </div>
        <div
            ref="calendarElement"
            class="review-calendar"
            role="group"
            aria-label="거래일 달력">
            <div class="month-toolbar">
                <Button
                    label="이전 달"
                    icon="pi pi-chevron-left"
                    text
                    :disabled="month === '0001-01'"
                    @click="moveMonth(-1)" />
                <h3 aria-live="polite">{{ monthLabel }}</h3>
                <Button
                    label="다음 달"
                    icon="pi pi-chevron-right"
                    icon-pos="right"
                    text
                    :disabled="month === '9999-12'"
                    @click="moveMonth(1)" />
            </div>
            <p class="calendar-help">
                날짜의 건수는 거래 표 기준입니다. 배당·세금 환급도 포함하며,
                아래 배당 표와 중복해서 세지 않습니다. 방향키로 날짜 이동,
                Enter·Space로 선택할 수 있습니다.
            </p>
            <div class="calendar-days">
                <span
                    v-for="day in weekdays"
                    :key="day"
                    class="weekday"
                    aria-hidden="true"
                    >{{ day }}</span
                >
                <template
                    v-for="(date, index) in days"
                    :key="date || `blank-${index}`">
                    <button
                        v-if="date"
                        type="button"
                        class="calendar-day"
                        :class="{ selected: selected === date }"
                        :data-review-date="date"
                        :aria-label="`${date}, ${counts.byDate.get(date) || 0}건`"
                        :aria-pressed="selected === date"
                        @click="selected = date"
                        @keydown="keyboardDate($event, date)">
                        <span>{{ Number(date.slice(8)) }}</span
                        ><small v-if="counts.byDate.has(date)"
                            >{{ counts.byDate.get(date) }}건</small
                        >
                    </button>
                    <span v-else aria-hidden="true" />
                </template>
            </div>
        </div>
        <div class="review-actions">
            <Button
                label="전체 날짜 보기"
                :aria-pressed="selected === ''"
                outlined
                @click="selected = ''" />
            <Button
                :label="`날짜 미상 ${counts.unknown}건`"
                :aria-pressed="selected === 'unknown'"
                outlined
                @click="selected = 'unknown'" />
        </div>
        <p role="status" class="review-status">
            검토 범위: {{ label }} · {{ visible.length }}건 (가족·계좌·검색·종목
            조건 적용)
        </p>
        <p v-if="!visible.length">
            {{
                selected
                    ? `${label}에 해당하는 내역이 없습니다.`
                    : '현재 조회 조건에 해당하는 내역이 없습니다.'
            }}
        </p>
        <slot :events="visible" :selection-label="label" />
    </section>
</template>

<style scoped>
    section {
        margin-top: 2rem;
    }
    p {
        color: var(--app-text-muted);
        line-height: 1.6;
    }
    .review-filters,
    .review-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin: 1rem 0;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-width: 0;
        flex: 1 1 14rem;
    }
    .review-calendar {
        max-width: 42rem;
        border: 1px solid var(--app-border);
        padding: 1rem;
        background: var(--app-surface);
    }
    .month-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }
    h3 {
        margin: 0;
        font-size: 1rem;
        white-space: nowrap;
    }
    .calendar-help {
        font-size: 0.85rem;
    }
    .calendar-days {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 0.25rem;
    }
    .weekday {
        text-align: center;
        font-size: 0.85rem;
        padding: 0.5rem 0;
        color: var(--app-text-muted);
    }
    .calendar-day {
        min-height: 3.5rem;
        padding: 0.25rem;
        border: 1px solid var(--app-border);
        border-radius: 4px;
        background: var(--app-surface);
        color: var(--app-text);
        font: inherit;
        cursor: pointer;
    }
    .calendar-day small {
        display: block;
        font-size: 0.75rem;
    }
    .calendar-day:hover {
        background: var(--app-surface-muted);
    }
    .calendar-day.selected {
        border: 2px solid var(--p-primary-color);
        background: var(--app-surface-muted);
        color: var(--app-text);
    }
    .calendar-day:focus-visible {
        outline: 2px solid var(--p-primary-color);
        outline-offset: 2px;
    }
    .review-status {
        font-weight: 600;
    }
    @media (max-width: 600px) {
        .review-calendar {
            padding: 0.5rem;
        }
        .month-toolbar {
            flex-wrap: wrap;
        }
        .calendar-day {
            min-height: 3rem;
            font-size: 0.85rem;
        }
    }
</style>
