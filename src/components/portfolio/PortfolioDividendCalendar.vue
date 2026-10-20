<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import SelectButton from 'primevue/selectbutton';
    import Message from 'primevue/message';
    import Tag from 'primevue/tag';
    import Dialog from 'primevue/dialog';
    import DividendAlerts from './DividendAlerts.vue';
    import DividendReconciliation from './DividendReconciliation.vue';
    import { firebaseUser } from '@/services/firebaseClient';
    import { loadFamilyLedger } from '@/services/familyPortfolio';
    import { loadPortfolioSchedules } from '@/services/thumbnail/dividendSchedule';
    import {
        calendarToday,
        validCalendarDate,
        monthDays,
        portfolioScheduleRows,
        recordedDividendRows,
        calendarTotals,
    } from '@/services/portfolioCalendar';
    const props = defineProps({
        accounts: { type: Array, default: () => [] },
        positions: { type: Array, default: () => [] },
        familyId: { type: String, default: '' },
    });
    const mode = ref('schedule'),
        view = ref('month'),
        basis = ref('payable'),
        period = ref(calendarToday().slice(0, 7)),
        accountId = ref(''),
        currency = ref('');
    const schedules = ref({}),
        scheduleErrors = ref({}),
        scheduleLoading = ref(false),
        scheduleError = ref('');
    const recorded = ref([]),
        ledgerEntries = ref([]),
        ledgerLoading = ref(false),
        ledgerError = ref(''),
        detailDate = ref(''),
        visibleCount = ref(50);
    watch(period, (value) => {
        if (!validCalendarDate(`${value}-01`))
            period.value = calendarToday().slice(0, 7);
    });
    const modeOptions = [
        { label: '공시 일정·예상', value: 'schedule' },
        { label: '저장된 배당 거래', value: 'recorded' },
        { label: '예상·기록 대조', value: 'reconcile' },
    ];
    const viewOptions = [
        { label: '월간', value: 'month' },
        { label: '연간', value: 'year' },
    ];
    const basisOptions = [
        { label: '지급일', value: 'payable' },
        { label: '배당락일', value: 'ex' },
    ];
    const selectedAccounts = computed(() =>
        props.accounts.filter(
            (a) => !accountId.value || a.id === accountId.value
        )
    );
    const positions = computed(() =>
        props.positions.filter((p) =>
            selectedAccounts.value.some((a) => a.id === p.accountId)
        )
    );
    const projection = computed(() =>
        portfolioScheduleRows(positions.value, schedules.value, {
            basis: basis.value,
            entries: ledgerEntries.value,
        })
    );
    const rows = computed(() =>
        (mode.value === 'schedule'
            ? projection.value.rows
            : recorded.value
        ).filter(
            (row) =>
                (!accountId.value || row.accountId === accountId.value) &&
                (!currency.value || row.currency === currency.value)
        )
    );
    const currencyOptions = computed(() => [
        { label: '모든 통화', value: '' },
        ...[
            ...new Set(
                [...projection.value.rows, ...recorded.value]
                    .map((row) => row.currency)
                    .filter(Boolean)
            ),
        ]
            .sort()
            .map((value) => ({ label: value, value })),
    ]);
    const accountOptions = computed(() => [
        { label: '모든 계좌', value: '' },
        ...props.accounts.map((a) => ({ label: a.alias, value: a.id })),
    ]);
    const rangeRows = computed(() =>
        rows.value.filter((row) =>
            row.date.startsWith(
                view.value === 'year' ? period.value.slice(0, 4) : period.value
            )
        )
    );
    const totals = computed(() => calendarTotals(rangeRows.value));
    const days = computed(() => monthDays(period.value));
    const rowsByDate = computed(() => {
        const dates = new Map();
        for (const row of rows.value) {
            if (!dates.has(row.date)) dates.set(row.date, []);
            dates.get(row.date).push(row);
        }
        return dates;
    });
    const onDate = (date) => rowsByDate.value.get(date) || [];
    watch([mode, view, period, accountId, currency], () => {
        visibleCount.value = 50;
    });
    const yearMonths = computed(() =>
        Array.from({ length: 12 }, (_, i) => {
            const month = `${period.value.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`;
            const events = rows.value.filter((row) =>
                row.date.startsWith(month)
            );
            return {
                month,
                label: `${i + 1}월`,
                count: events.length,
                totals: calendarTotals(events),
            };
        })
    );
    const accountLabel = (id) =>
        props.accounts.find((a) => a.id === id)?.alias || '계좌';
    const missingAccounts = computed(() =>
        selectedAccounts.value.filter((a) => !a.snapshot)
    );
    const dates = computed(() =>
        [...new Set(positions.value.map((p) => p.asOf))].sort()
    );
    const busy = computed(() =>
        mode.value === 'recorded'
            ? ledgerLoading.value
            : scheduleLoading.value || ledgerLoading.value
    );
    const error = computed(() =>
        mode.value === 'reconcile'
            ? scheduleError.value || ledgerError.value
            : mode.value === 'schedule'
              ? scheduleError.value
              : ledgerError.value
    );
    const stateNames = {
        announced: '공시 일정',
        review: '확인 필요',
        forecast: '주기 추정',
        recorded: '배당 거래',
        reversal: '배당 취소',
    };
    const money = (value, code) =>
        value === null
            ? '금액 미확인'
            : `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 6 })} ${code || '통화 미확인'}`;
    let scheduleSequence = 0,
        ledgerSequence = 0,
        scheduleController,
        ledgerController;
    function clearLedger() {
        ledgerSequence++;
        ledgerController?.abort();
        recorded.value = [];
        ledgerEntries.value = [];
        ledgerError.value = '';
        ledgerLoading.value = false;
        detailDate.value = '';
    }
    async function loadSchedules(force = false) {
        const sequence = ++scheduleSequence;
        scheduleController?.abort();
        scheduleController = new AbortController();
        const controller = scheduleController;
        schedules.value = {};
        scheduleErrors.value = {};
        scheduleError.value = '';
        scheduleLoading.value = true;
        try {
            const result = await loadPortfolioSchedules(
                positions.value
                    .map((p) => p.symbol)
                    .filter((s) => s !== 'CASH'),
                controller.signal,
                force
            );
            if (sequence === scheduleSequence) {
                schedules.value = result.schedules;
                scheduleErrors.value = result.errors;
            }
        } catch (reason) {
            if (sequence === scheduleSequence && !controller.signal.aborted)
                scheduleError.value = reason.message;
        } finally {
            if (sequence === scheduleSequence) scheduleLoading.value = false;
        }
    }
    async function loadRecorded(force = false) {
        clearLedger();
        if (!selectedAccounts.value.length) return;
        const sequence = ledgerSequence,
            uid = firebaseUser.value?.uid,
            controller = new AbortController();
        ledgerController = controller;
        ledgerLoading.value = true;
        try {
            const entries = await loadFamilyLedger({
                force,
                familyId: props.familyId,
                accounts: selectedAccounts.value,
                signal: controller.signal,
                isCurrent: () =>
                    sequence === ledgerSequence &&
                    firebaseUser.value?.uid === uid,
            });
            if (sequence === ledgerSequence) {
                ledgerEntries.value = entries;
                recorded.value = recordedDividendRows(entries);
            }
        } catch (reason) {
            if (sequence === ledgerSequence && !controller.signal.aborted)
                ledgerError.value = reason.message;
        } finally {
            if (sequence === ledgerSequence) ledgerLoading.value = false;
        }
    }
    watch(
        () => [
            props.familyId,
            firebaseUser.value?.uid,
            JSON.stringify(props.positions),
            JSON.stringify(
                props.accounts.map((a) => [
                    a.id,
                    a.entriesRevision,
                    a.snapshot?.asOf,
                ])
            ),
        ],
        () => {
            if (
                accountId.value &&
                !props.accounts.some((a) => a.id === accountId.value)
            )
                accountId.value = '';
            clearLedger();
            if (mode.value !== 'recorded') loadSchedules();
            loadRecorded();
        },
        { immediate: true, flush: 'sync' }
    );
    watch(mode, () => {
        detailDate.value = '';
        clearLedger();
        if (
            mode.value !== 'recorded' &&
            positions.value.some(
                (p) => p.symbol !== 'CASH' && !schedules.value[p.symbol]
            )
        )
            loadSchedules();
        loadRecorded();
    });
    watch(accountId, () => {
        if (mode.value !== 'recorded') loadSchedules();
        clearLedger();
        loadRecorded();
    });
    onScopeDispose(() => {
        scheduleSequence++;
        scheduleController?.abort();
        clearLedger();
    });
    async function refreshData() {
        if (mode.value !== 'recorded')
            await Promise.all([loadSchedules(true), loadRecorded(true)]);
        else await loadRecorded(true);
    }
    const reconciliationSchedules = computed(
        () =>
            portfolioScheduleRows(positions.value, schedules.value, {
                basis: 'payable',
                entries: ledgerEntries.value,
            }).rows
    );
    function move(direction) {
        const year = Number(period.value.slice(0, 4)),
            month = Number(period.value.slice(5));
        const next = new Date(
            Date.UTC(
                year,
                month - 1 + (view.value === 'year' ? 12 : 1) * direction,
                1
            )
        );
        if (next.getUTCFullYear() >= 1900 && next.getUTCFullYear() <= 2100)
            period.value = next.toISOString().slice(0, 7);
        detailDate.value = '';
    }
    const safeSource = (url) => (/^https?:\/\//.test(url || '') ? url : null);
</script>

<template>
    <section class="dividend-calendar" aria-label="개인 배당 캘린더">
        <header class="calendar-heading">
            <div>
                <span class="studio-eyebrow">DIVIDEND CALENDAR</span>
                <h2>내 배당 캘린더</h2>
                <p>공시 일정은 계획으로, 배당 거래는 기록으로 확인하세요.</p>
            </div>
            <Button
                label="일정·거래 새로고침"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                :disabled="busy"
                @click="refreshData()" />
        </header>
        <div class="calendar-toolbar">
            <SelectButton
                v-model="mode"
                :options="modeOptions"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                aria-label="배당 자료 종류" />
            <div class="calendar-filters">
                <Select
                    v-model="accountId"
                    :options="accountOptions"
                    option-label="label"
                    option-value="value"
                    placeholder="모든 계좌"
                    aria-label="배당 계좌 필터" /><Select
                    v-model="currency"
                    :options="currencyOptions"
                    option-label="label"
                    option-value="value"
                    placeholder="모든 통화"
                    aria-label="배당 통화 필터" />
            </div>
        </div>
        <Message severity="info" :closable="false"
            ><template v-if="mode === 'schedule'"
                >예상액은 배당락일 잔고 × 공시 배당금의
                <b>세전 참고액</b>입니다. 과거 잔고는 거래 내역으로 복원하며,
                실제 배당 입금액이 있으면 이를 우선 사용합니다.</template
            ><template v-else
                >업로드해 저장한 배당 거래만 표시합니다. 세전·세후 실수령액이나
                모든 지급 내역이 완전하다는 뜻은 아닙니다. 배당 취소는 음수로
                차감하며 공시 예상액과 합산하지 않습니다.</template
            ></Message
        >
        <p v-if="dates.length" class="calendar-meta">
            수량 자료 기준일 {{ dates.join(' · ')
            }}<b v-if="dates.length > 1"> · 계좌별 기준일이 다릅니다.</b>
        </p>
        <Message
            v-if="mode === 'schedule' && missingAccounts.length"
            severity="warn"
            :closable="false"
            >잔고 자료 없는 계좌
            {{ missingAccounts.map((a) => a.alias).join(', ') }}는 공시 일정
            연결에서 제외됩니다. 배당 거래는 별도로 조회할 수 있습니다.</Message
        >
        <Message v-if="error" severity="error" :closable="false"
            >{{ error }}
            <Button label="배당 자료 다시 시도" text @click="refreshData()"
        /></Message>
        <details
            v-if="mode !== 'recorded' && Object.keys(scheduleErrors).length"
            class="calendar-warning">
            <summary>
                일정을 확인하지 못한 종목
                {{ Object.keys(scheduleErrors).length }}개
            </summary>
            <p v-for="(message, symbol) in scheduleErrors" :key="symbol">
                {{ symbol }} · {{ message }}
            </p>
        </details>
        <p
            v-if="
                mode === 'schedule' &&
                basis === 'payable' &&
                projection.undated.length
            "
            class="calendar-meta">
            지급일 미확인 일정 {{ projection.undated.length }}건은 제외했습니다.
            배당락일 기준으로 바꾸어 확인하세요.
        </p>
        <div class="calendar-navigation">
            <div class="period-picker">
                <Button
                    icon="pi pi-chevron-left"
                    aria-label="이전 배당 기간"
                    text
                    @click="move(-1)" /><label
                    for="dividend-period"
                    class="sr-only"
                    >배당 조회 월</label
                ><input
                    id="dividend-period"
                    v-model="period"
                    type="month"
                    min="1900-01"
                    max="2100-12"
                    required /><Button
                    icon="pi pi-chevron-right"
                    aria-label="다음 배당 기간"
                    text
                    @click="move(1)" />
            </div>
            <SelectButton
                v-model="view"
                :options="viewOptions"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                aria-label="배당 달력 보기" /><Select
                v-if="mode === 'schedule'"
                v-model="basis"
                :options="basisOptions"
                option-label="label"
                option-value="value"
                aria-label="배당 일정 날짜 기준" />
        </div>
        <DividendReconciliation
            v-if="mode === 'reconcile' && !busy && !error"
            :key="`${firebaseUser?.uid}:${familyId}:${accountId}:${currency}:${period}:${view}:${scheduleSequence}:${ledgerSequence}`"
            :schedules="reconciliationSchedules"
            :recorded="recorded"
            :accounts="selectedAccounts"
            :period="view === 'year' ? period.slice(0, 4) : period"
            :currency="currency" />
        <p v-if="mode === 'reconcile' && busy" role="status">
            배당 대조 자료를 확인하고 있습니다.
        </p>
        <template v-if="mode !== 'reconcile'">
            <DividendAlerts
                v-if="
                    mode === 'schedule' &&
                    !busy &&
                    !error &&
                    selectedAccounts.length
                "
                :key="`alerts:${firebaseUser?.uid}:${familyId}`"
                :rows="rows"
                :basis="basis"
                :show-settings="false" />
            <p v-if="busy" role="status">배당 자료를 확인하고 있습니다.</p>
            <div v-else class="calendar-totals">
                <article v-for="total in totals" :key="total.currency">
                    <span
                        >{{
                            mode === 'schedule'
                                ? '확인된 세전 예상액'
                                : '저장된 거래금액'
                        }}
                        · {{ total.currency }}</span
                    ><strong>{{
                        total.known
                            ? money(total.amount, total.currency)
                            : '금액 미확인'
                    }}</strong
                    ><small
                        >금액 확인 {{ total.known }}건 · 미확인
                        {{ total.unknown }}건</small
                    >
                </article>
                <p v-if="!rangeRows.length">
                    이 기간에 확인된 자료가 없습니다. 배당이 0이라는 뜻은
                    아닙니다.
                </p>
            </div>
            <template v-if="!busy">
                <div v-if="view === 'year'" class="year-timeline">
                    <button
                        v-for="month in yearMonths"
                        :key="month.month"
                        class="year-month"
                        @click="
                            period = month.month;
                            view = 'month';
                        ">
                        <b>{{ month.label }}</b
                        ><span>{{
                            month.count ? `${month.count}건` : '확인 자료 없음'
                        }}</span
                        ><span
                            v-for="total in month.totals"
                            :key="total.currency"
                            >{{
                                total.known
                                    ? money(total.amount, total.currency)
                                    : `${total.currency} 금액 미확인`
                            }}<small v-if="total.unknown">
                                · 미확인 {{ total.unknown }}건</small
                            ></span
                        >
                    </button>
                </div>
                <div v-else class="calendar-body">
                    <div class="month-grid" aria-label="배당 월간 달력">
                        <div
                            v-for="weekday in [
                                '일',
                                '월',
                                '화',
                                '수',
                                '목',
                                '금',
                                '토',
                            ]"
                            :key="weekday"
                            class="weekday">
                            {{ weekday }}
                        </div>
                        <button
                            v-for="day in days"
                            :key="day.date"
                            class="day-cell"
                            :class="{
                                'outside-month': !day.inMonth,
                                today: day.date === calendarToday(),
                            }"
                            :aria-label="`${day.date} 배당 일정 ${onDate(day.date).length}건`"
                            @click="detailDate = day.date">
                            <b>{{ day.day }}</b
                            ><span
                                v-for="event in onDate(day.date).slice(0, 2)"
                                :key="event.id"
                                class="day-event"
                                :class="event.status"
                                >{{ event.symbol
                                }}<small>{{
                                    stateNames[event.status]
                                }}</small></span
                            ><small v-if="onDate(day.date).length > 2"
                                >+{{ onDate(day.date).length - 2 }}건 더
                                보기</small
                            >
                        </button>
                    </div>
                    <section class="month-events" aria-label="월간 배당 목록">
                        <h3>이번 달 일정 {{ rangeRows.length }}건</h3>
                        <button
                            v-for="event in rangeRows.slice(0, visibleCount)"
                            :key="event.id"
                            class="event-row"
                            @click="detailDate = event.date">
                            <div>
                                <b>{{ event.symbol }}</b
                                ><Tag
                                    :value="stateNames[event.status]"
                                    :severity="
                                        event.status === 'forecast' ||
                                        event.status === 'review'
                                            ? 'warn'
                                            : 'info'
                                    " />
                            </div>
                            <span
                                >{{ event.date }} ·
                                {{ accountLabel(event.accountId) }}</span
                            ><strong>{{
                                money(event.amount, event.currency)
                            }}</strong>
                        </button>
                        <Button
                            v-if="rangeRows.length > visibleCount"
                            :label="`배당 목록 더 보기 (${visibleCount}/${rangeRows.length})`"
                            severity="secondary"
                            outlined
                            @click="visibleCount += 50" />
                        <p v-if="!rangeRows.length" class="calendar-meta">
                            계좌·통화·조회 기간을 확인해 주세요.
                        </p>
                    </section>
                </div>
            </template>
            <Dialog
                :visible="!!detailDate"
                modal
                :header="`${detailDate} 배당 상세`"
                :style="{ width: '38rem', maxWidth: '94vw' }"
                @update:visible="detailDate = ''">
                <article
                    v-for="event in onDate(detailDate)"
                    :key="event.id"
                    class="event-detail">
                    <div>
                        <h3>
                            {{ event.symbol }} ·
                            {{ accountLabel(event.accountId) }}
                        </h3>
                        <Tag :value="stateNames[event.status]" />
                    </div>
                    <strong>{{ money(event.amount, event.currency) }}</strong>
                    <p>{{ event.notice }}</p>
                    <dl>
                        <template v-if="event.exDate"
                            ><dt>배당락일 / 공시 지급일</dt>
                            <dd>
                                {{ event.exDate }} /
                                {{ event.payableDate || '미확인' }}
                            </dd></template
                        >
                        <dt>자료 기준일</dt>
                        <dd>{{ event.quantityAsOf || '미확인' }}</dd>
                        <template v-if="event.quantity !== undefined"
                            ><dt>자료 수량 / 주당 배당금</dt>
                            <dd>
                                {{ event.quantity }}주 /
                                {{ money(event.perShare, event.currency) }}
                            </dd></template
                        >
                    </dl>
                    <a
                        v-if="safeSource(event.sourceUrl)"
                        :href="event.sourceUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        >공시 원문 확인
                        <i class="pi pi-external-link" aria-hidden="true"
                    /></a>
                </article>
                <p v-if="!onDate(detailDate).length">
                    이 날짜에 확인된 자료가 없습니다.
                </p>
            </Dialog>
        </template>
    </section>
</template>
<style scoped>
    .dividend-calendar {
        display: grid;
        gap: 18px;
        padding-top: 20px;
        min-width: 0;
    }
    .calendar-heading,
    .calendar-toolbar,
    .calendar-filters,
    .calendar-navigation,
    .period-picker {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: space-between;
    }
    .calendar-heading h2 {
        margin: 6px 0;
        font-size: 26px;
    }
    .calendar-heading p,
    .calendar-meta {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.8;
        margin: 0;
    }
    .calendar-warning {
        padding: 14px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface-muted);
    }
    .calendar-warning summary {
        cursor: pointer;
    }
    .calendar-warning p {
        font-size: 13px;
    }
    .period-picker {
        justify-content: flex-start;
        gap: 4px;
    }
    .period-picker input {
        color: var(--app-text);
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        padding: 10px;
        border-radius: 8px;
        font: inherit;
        max-width: 190px;
    }
    .calendar-totals {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
    }
    .calendar-totals article {
        display: grid;
        gap: 10px;
        padding: 20px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 14px;
        min-width: 200px;
    }
    .calendar-totals strong {
        font-size: 25px;
    }
    .calendar-totals span,
    .calendar-totals small {
        color: var(--app-muted);
        font-size: 13px;
    }
    .calendar-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 290px;
        gap: 20px;
        align-items: start;
    }
    .month-grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        border-left: 1px solid var(--app-border);
        border-top: 1px solid var(--app-border);
        border-radius: 12px;
        overflow: hidden;
        background: var(--app-surface);
    }
    .weekday {
        padding: 12px;
        text-align: center;
        font-size: 13px;
        background: var(--app-surface-muted);
    }
    .day-cell {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 5px;
        min-height: 112px;
        min-width: 0;
        padding: 8px;
        border: 0;
        border-right: 1px solid var(--app-border);
        border-bottom: 1px solid var(--app-border);
        color: var(--app-text);
        background: var(--app-surface);
        cursor: pointer;
        text-align: left;
        font: inherit;
        font-size: 12px;
    }
    .day-cell:hover,
    .year-month:hover,
    .event-row:hover {
        background: var(--app-surface-muted);
    }
    .day-cell:focus-visible,
    .event-row:focus-visible,
    .year-month:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: -3px;
    }
    .outside-month {
        opacity: 0.45;
    }
    .today > b {
        color: var(--app-accent);
    }
    .day-event {
        background: var(--app-surface-muted);
        border-left: 3px solid var(--app-accent);
        padding: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .day-event small {
        display: block;
        font-size: 10px;
    }
    .day-event.forecast,
    .day-event.review {
        border-left-style: dashed;
    }
    .month-events {
        display: grid;
        gap: 10px;
    }
    .month-events h3 {
        margin: 0 0 6px;
        font-size: 17px;
    }
    .event-row,
    .year-month {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 14px;
        text-align: left;
        color: var(--app-text);
        display: grid;
        gap: 10px;
        cursor: pointer;
        font: inherit;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .event-row > div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }
    .event-row > span {
        font-size: 12px;
        color: var(--app-muted);
    }
    .event-row strong {
        font-size: 16px;
    }
    .year-timeline {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
    }
    .year-month {
        align-content: start;
        min-height: 140px;
    }
    .year-month > b {
        color: var(--app-accent);
        font-size: 20px;
    }
    .year-month span {
        font-size: 13px;
    }
    .event-detail {
        padding: 18px 0;
        border-bottom: 1px solid var(--app-border);
    }
    .event-detail h3 {
        margin: 0;
    }
    .event-detail > div {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        align-items: center;
    }
    .event-detail > strong {
        display: block;
        font-size: 23px;
        margin-top: 16px;
    }
    .event-detail p,
    .event-detail dl {
        font-size: 13px;
        line-height: 1.8;
    }
    .event-detail dt {
        color: var(--app-muted);
    }
    .event-detail dd {
        margin: 0 0 8px;
    }
    .event-detail a {
        color: var(--app-accent);
    }
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }
    @media (max-width: 1000px) {
        .calendar-body {
            grid-template-columns: 1fr;
        }
        .month-events {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .month-events h3 {
            grid-column: 1/-1;
        }
        .year-timeline {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
    @media (max-width: 600px) {
        .month-grid {
            display: none;
        }
        .month-events {
            grid-template-columns: 1fr;
        }
        .year-timeline {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .calendar-totals article {
            width: 100%;
            min-width: 0;
        }
        .calendar-filters {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr 1fr;
        }
        .calendar-heading h2 {
            font-size: 23px;
        }
        .event-detail > div {
            align-items: flex-start;
            flex-direction: column;
        }
        .calendar-navigation {
            justify-content: flex-start;
        }
    }
</style>
