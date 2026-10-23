<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import SelectButton from 'primevue/selectbutton';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Dialog from 'primevue/dialog';
    import Message from 'primevue/message';
    import InfoHelp from '@/components/common/InfoHelp.vue';
    import { calendarToday, monthDays } from '@/services/portfolioCalendar.js';
    const props = defineProps({
        symbol: { type: String, required: true },
        rows: { type: Array, default: () => [] },
        candles: { type: Array, default: () => [] },
        loading: { type: Boolean, default: false },
        error: { type: String, default: '' },
        currency: { type: String, default: 'USD' },
        adjustmentBasis: { type: String, default: '' },
    });
    const view = ref('calendar'),
        period = ref('');
    const options = [
        { label: '달력', value: 'calendar' },
        { label: '표', value: 'table' },
    ];
    const selectedDate = ref(null);
    const fields = [
        { key: 'open', label: '시가' },
        { key: 'high', label: '고가' },
        { key: 'low', label: '저가' },
        { key: 'close', label: '종가' },
    ];
    // Prefer the complete candle row; never mix adjusted fallback closes with OHLC.
    const prices = computed(() => {
        const rows = new Map(
            props.rows.map((row) => [
                row.date,
                { date: row.date, close: row.close },
            ])
        );
        for (const row of props.candles) {
            if (row.date <= calendarToday() && Number(row.close) > 0)
                rows.set(row.date, { ...row, candle: true });
        }
        return [...rows.values()]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 120);
    });
    const byDate = computed(
        () => new Map(prices.value.map((row) => [row.date, row]))
    );
    const selectedPrice = computed(() => byDate.value.get(selectedDate.value));
    watch([() => props.symbol, period], () => {
        selectedDate.value = null;
    });
    const currentMonth = calendarToday().slice(0, 7);
    const latestMonth = computed(() => prices.value[0]?.date.slice(0, 7) || '');
    const lastMonth = computed(() =>
        latestMonth.value > currentMonth ? latestMonth.value : currentMonth
    );
    const firstMonth = computed(
        () => prices.value.at(-1)?.date.slice(0, 7) || ''
    );
    watch(
        [() => props.symbol, latestMonth, firstMonth, lastMonth],
        ([symbol], [previousSymbol] = []) => {
            if (
                symbol !== previousSymbol ||
                !period.value ||
                period.value < firstMonth.value ||
                period.value > lastMonth.value
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
    const provided = (value) => value != null && Number.isFinite(Number(value));
    const price = (value) =>
        !provided(value)
            ? '—'
            : props.currency === 'USD'
              ? `$ ${number(value)}`
              : `${number(value)} ${props.currency}`;
    function moveMonth(offset) {
        const date = new Date(`${period.value}-01T12:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() + offset);
        period.value = date.toISOString().slice(0, 7);
    }
</script>
<template>
    <section class="stock-price-history" aria-label="일별 시세 이력">
        <header class="history-header">
            <div>
                <div class="history-title">
                    <h2>시세 이력</h2>
                    <InfoHelp
                        label="시세 이력 안내"
                        :text="`${currency} 기준 · ‘—’는 시세 미제공입니다. 휴장일 또는 수집되지 않은 날짜에 가격을 채우지 않습니다.`" />
                </div>
                <p>
                    최근 {{ prices.length }}거래일 · 달력은 종가 표시 ·
                    {{ currency }} ·
                    {{ candles.length ? '일봉 제공처 기준' : basisLabel }}
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
        <Message
            v-if="loading"
            severity="info"
            :closable="false"
            class="history-status"
            >일별 시세를 불러오고 있습니다.</Message
        >
        <Message
            v-else-if="error"
            severity="warn"
            :closable="false"
            class="history-status"
            >상세 일봉을 불러오지 못했습니다. 제공된 종가만 표시합니다. 위
            차트에서 다시 시도할 수 있습니다.</Message
        >
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
                    :disabled="period >= lastMonth"
                    @click="moveMonth(1)" />
                <Button
                    label="현재 월"
                    text
                    size="small"
                    severity="secondary"
                    :disabled="period === currentMonth"
                    @click="period = currentMonth" />
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
                                <button
                                    v-if="day.inMonth && byDate.has(day.date)"
                                    type="button"
                                    class="quoted-day"
                                    :aria-label="`${day.date} 시세 상세`"
                                    @click="selectedDate = day.date">
                                    <time :datetime="day.date">{{
                                        day.day
                                    }}</time>
                                    <strong>{{
                                        price(byDate.get(day.date).close)
                                    }}</strong>
                                </button>
                                <template v-else-if="day.inMonth">
                                    <time :datetime="day.date">{{
                                        day.day
                                    }}</time>
                                    <span
                                        class="no-price"
                                        aria-label="시세 없음"
                                        >—</span
                                    >
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
        <DataTable
            v-else
            :value="prices"
            striped-rows
            scrollable
            scroll-height="420px"
            :table-style="{ minWidth: '680px' }"
            :table-props="{ 'aria-label': '일별 시세 표' }">
            <Column field="date" header="기준일" />
            <Column
                v-for="field in fields"
                :key="field.key"
                :header="field.label">
                <template #body="{ data }">{{
                    price(data[field.key])
                }}</template>
            </Column>
            <Column header="거래량">
                <template #body="{ data }">{{
                    provided(data.volume) ? `${number(data.volume)}주` : '—'
                }}</template>
            </Column>
        </DataTable>
        <Dialog
            :visible="!!selectedPrice"
            modal
            :header="`${selectedDate || ''} 시세 상세`"
            :style="{ width: '440px', maxWidth: 'calc(100vw - 32px)' }"
            @update:visible="selectedDate = null">
            <template v-if="selectedPrice">
                <p class="detail-source">
                    {{ symbol }} ·
                    {{ selectedPrice.candle ? '일봉 제공처 기준' : basisLabel }}
                </p>
                <dl class="price-detail">
                    <div v-for="field in fields" :key="field.key">
                        <dt>{{ field.label }}</dt>
                        <dd>{{ price(selectedPrice[field.key]) }}</dd>
                    </div>
                    <div>
                        <dt>거래량</dt>
                        <dd>
                            {{
                                provided(selectedPrice.volume)
                                    ? `${number(selectedPrice.volume)}주`
                                    : '—'
                            }}
                        </dd>
                    </div>
                </dl>
                <p class="detail-note">‘—’는 미제공 항목입니다.</p>
            </template>
        </Dialog>
    </section>
</template>
<style scoped>
    .stock-price-history {
        margin-top: 0;
        min-width: 0;
    }
    .history-title {
        display: flex;
        align-items: center;
        gap: 4px;
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
    .history-header p {
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
    .quoted-day {
        display: block;
        width: 100%;
        min-height: 60px;
        padding: 0;
        text-align: left;
        border: 0;
        border-radius: 4px;
        background: transparent;
        font: inherit;
        cursor: pointer;
    }
    .quoted-day:hover {
        background: var(--app-surface-muted);
    }
    .quoted-day:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    .history-status {
        margin: 12px 0;
    }
    .detail-source,
    .detail-note {
        color: var(--app-muted);
        font-size: 13px;
    }
    .price-detail {
        margin: 16px 0;
        font-variant-numeric: tabular-nums;
    }
    .price-detail > div {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 0;
        border-bottom: 1px solid var(--app-border);
    }
    .price-detail dt {
        color: var(--app-muted);
    }
    .price-detail dd {
        margin: 0;
        font-weight: 650;
    }
    .outside {
        background: var(--app-surface-muted);
    }
    .no-price {
        color: var(--app-muted);
        font-size: 13px;
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
