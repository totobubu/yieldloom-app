<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import SelectButton from 'primevue/selectbutton';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import { monthDays } from '@/services/portfolioCalendar.js';
    const props = defineProps({
        symbol: { type: String, required: true },
        rows: { type: Array, default: () => [] },
        currency: { type: String, default: 'USD' },
        adjustmentBasis: { type: String, default: '' },
    });
    const view = ref('calendar'),
        period = ref('');
    const options = [
        { label: '달력', value: 'calendar' },
        { label: '표', value: 'table' },
    ];
    // The page has already filtered actual prices. Sorting a copy avoids changing its chart input.
    const prices = computed(() =>
        [...props.rows]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 120)
    );
    const byDate = computed(
        () => new Map(prices.value.map((row) => [row.date, row]))
    );
    const latestMonth = computed(() => prices.value[0]?.date.slice(0, 7) || '');
    const firstMonth = computed(
        () => prices.value.at(-1)?.date.slice(0, 7) || ''
    );
    watch(
        [() => props.symbol, latestMonth, firstMonth],
        ([symbol], [previousSymbol] = []) => {
            if (
                symbol !== previousSymbol ||
                !period.value ||
                period.value < firstMonth.value ||
                period.value > latestMonth.value
            )
                period.value = latestMonth.value;
        },
        { immediate: true }
    );
    const days = computed(() => monthDays(period.value));
    const weeks = computed(() =>
        Array.from({ length: days.value.length / 7 }, (_, i) =>
            days.value.slice(i * 7, i * 7 + 7)
        )
    );
    const monthLabel = computed(() =>
        period.value
            ? `${period.value.slice(0, 4)}년 ${Number(period.value.slice(5))}월`
            : '시세 없음'
    );
    const basisLabel = computed(
        () =>
            ({
                upstream_unverified: '가격 보정 미확인',
                raw: '보정 전 종가',
                unadjusted: '보정 전 종가',
                split_adjusted: '분할 보정 종가',
                adjusted: '보정 종가',
            })[props.adjustmentBasis] || '가격 보정 미확인'
    );
    const number = (value) =>
        Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
    function moveMonth(offset) {
        const date = new Date(`${period.value}-01T12:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() + offset);
        period.value = date.toISOString().slice(0, 7);
    }
</script>
<template>
    <section class="stock-price-history" aria-label="일별 종가 이력">
        <header class="history-header">
            <div>
                <h2>시세 이력</h2>
                <p>
                    최근 {{ prices.length }}개 실제 종가 · {{ currency }} ·
                    {{ basisLabel }}
                </p>
            </div>
            <SelectButton
                v-model="view"
                :options="options"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                aria-label="시세 이력 표시 방식" />
        </header>
        <p v-if="!prices.length" class="empty" role="status">
            확인 가능한 실제 종가가 없습니다.
        </p>
        <template v-else-if="view === 'calendar'">
            <div class="month-navigation">
                <Button
                    icon="pi pi-chevron-left"
                    aria-label="이전 달 시세"
                    text
                    severity="secondary"
                    :disabled="period <= firstMonth"
                    @click="moveMonth(-1)" />
                <strong aria-live="polite">{{ monthLabel }}</strong>
                <Button
                    icon="pi pi-chevron-right"
                    aria-label="다음 달 시세"
                    text
                    severity="secondary"
                    :disabled="period >= latestMonth"
                    @click="moveMonth(1)" />
                <Button
                    label="최근 시세 월"
                    text
                    size="small"
                    severity="secondary"
                    :disabled="period === latestMonth"
                    @click="period = latestMonth" />
            </div>
            <div
                class="calendar-scroll"
                tabindex="0"
                role="region"
                aria-label="일별 종가 달력, 좁은 화면에서 좌우로 이동">
                <table class="price-calendar">
                    <caption class="studio-sr-only">
                        {{
                            symbol
                        }}
                        {{
                            monthLabel
                        }}
                        일별 종가 ·
                        {{
                            currency
                        }}
                    </caption>
                    <thead>
                        <tr>
                            <th
                                v-for="day in [
                                    '일',
                                    '월',
                                    '화',
                                    '수',
                                    '목',
                                    '금',
                                    '토',
                                ]"
                                :key="day"
                                scope="col">
                                {{ day }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(week, index) in weeks" :key="index">
                            <td
                                v-for="day in week"
                                :key="day.date"
                                :data-date="day.date"
                                :class="{
                                    outside: !day.inMonth,
                                    quoted: day.inMonth && byDate.has(day.date),
                                }">
                                <template v-if="day.inMonth"
                                    ><time :datetime="day.date">{{
                                        day.day
                                    }}</time>
                                    <strong v-if="byDate.has(day.date)">{{
                                        number(byDate.get(day.date).close)
                                    }}</strong>
                                    <span
                                        v-else
                                        class="no-price"
                                        aria-label="시세 없음"
                                        >—</span
                                    ></template
                                >
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="calendar-note">
                {{ currency }} 기준 · ‘—’는 시세 미제공입니다. 휴장일 또는
                수집되지 않은 날짜에 가격을 채우지 않습니다.
            </p>
        </template>
        <DataTable
            v-else
            :value="prices"
            striped-rows
            scrollable
            scroll-height="420px"
            :table-props="{ 'aria-label': '일별 종가 표' }">
            <Column field="date" header="기준일" />
            <Column header="종가"
                ><template #body="{ data }"
                    >{{ number(data.close) }} {{ currency }}</template
                ></Column
            >
        </DataTable>
    </section>
</template>
<style scoped>
    .stock-price-history {
        margin-top: 20px;
        min-width: 0;
    }
    .history-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
    }
    h2 {
        margin: 0;
        font-size: 20px;
    }
    .history-header p,
    .calendar-note {
        font-size: 12px;
        color: var(--app-muted);
        line-height: 1.7;
    }
    .month-navigation {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 16px 0;
    }
    .month-navigation strong {
        min-width: 110px;
        text-align: center;
    }
    .calendar-scroll {
        overflow-x: auto;
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    .price-calendar {
        table-layout: fixed;
        width: 100%;
        min-width: 520px;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
    }
    th {
        padding: 12px 4px;
        background: var(--app-surface-muted);
        color: var(--app-muted);
        font-size: 12px;
    }
    td {
        height: 84px;
        padding: 10px;
        vertical-align: top;
        border: 1px solid var(--app-border-subtle);
    }
    time {
        display: block;
        font-size: 12px;
        color: var(--app-muted);
        margin-bottom: 10px;
    }
    td strong {
        display: block;
        color: var(--app-accent);
        font-size: 14px;
        overflow-wrap: anywhere;
    }
    .outside {
        background: var(--app-surface-muted);
    }
    .no-price {
        color: var(--app-muted);
        font-size: 13px;
    }
    .calendar-note {
        margin: 12px 0 0;
    }
    .empty {
        padding: 28px 16px;
        text-align: center;
        color: var(--app-muted);
    }
    @media (max-width: 600px) {
        td {
            padding: 8px;
            height: 76px;
        }
        td strong {
            font-size: 12px;
        }
    }
</style>
