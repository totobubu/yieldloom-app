<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Dialog from 'primevue/dialog';
    import SelectButton from 'primevue/selectbutton';
    import Paginator from 'primevue/paginator';
    import InfoHelp from '@/components/common/InfoHelp.vue';
    import DividendRocChart from './DividendRocChart.vue';
    import {
        dividendRocHistory,
        monthlyDividendRocSummary,
    } from '../../../lib/dividend-roc-history.js';
    const props = defineProps({
        history: { type: Array, default: () => [] },
        observations: { type: Array, default: () => [] },
        currency: { type: String, default: 'USD' },
        loading: Boolean,
        failed: Boolean,
    });
    const view = ref('monthly'),
        page = ref(0),
        selectedMonth = ref('');
    const modes = [
        { label: '월별 요약', value: 'monthly', icon: 'pi pi-calendar' },
        { label: '회차별 이력', value: 'table', icon: 'pi pi-list' },
        { label: '차트', value: 'chart', icon: 'pi pi-chart-line' },
    ];
    const rows = computed(() =>
        dividendRocHistory(props.history, props.observations, props.currency)
    );
    const pageRows = computed(() =>
        rows.value.slice(page.value * 12, (page.value + 1) * 12)
    );
    const monthly = computed(() =>
        monthlyDividendRocSummary(
            rows.value.filter((row) => row.currency === props.currency)
        )
    );
    const years = computed(() => [
        ...new Set(monthly.value.map((row) => row.year)),
    ]);
    const monthlyByKey = computed(
        () => new Map(monthly.value.map((row) => [row.key, row]))
    );
    const yearTotals = computed(
        () =>
            new Map(
                years.value.map((year) => {
                    const yearRows = monthly.value.filter(
                        (row) => row.year === year
                    );
                    return [
                        year,
                        {
                            distributionTotal: yearRows.reduce(
                                (sum, row) => sum + row.distributionTotal,
                                0
                            ),
                            paymentCount: yearRows.reduce(
                                (sum, row) => sum + row.paymentCount,
                                0
                            ),
                        },
                    ];
                })
            )
    );
    const selectedSummary = computed(() =>
        monthlyByKey.value.get(selectedMonth.value)
    );
    const monthDialog = ref(false);
    function openMonthDetail(key) {
        view.value = 'monthly';
        if (typeof key === 'string') selectedMonth.value = key;
        if (!selectedSummary.value)
            selectedMonth.value = monthly.value.at(-1)?.key ?? '';
        monthDialog.value = !!selectedSummary.value;
    }
    const annual = computed(() =>
        props.observations
            .filter((row) => row.scope === 'fiscal_year_to_date')
            .sort((a, b) =>
                String(b.throughPaymentDate || '').localeCompare(
                    String(a.throughPaymentDate || '')
                )
            )
    );
    const safeUrl = (value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : null;
        } catch {
            return null;
        }
    };
    const sources = computed(() => [
        ...new Map(
            props.observations.flatMap((row) => {
                const url = safeUrl(row.sourceUrl);
                return url
                    ? [
                          [
                              url,
                              {
                                  url,
                                  label:
                                      row.sourceType ===
                                      'cached_issuer_distribution_table'
                                          ? '운용사 페이지'
                                          : '공시 문서',
                              },
                          ],
                      ]
                    : [];
            })
        ).values(),
    ]);
    const display = (value) =>
        value == null || value === '' ? '—' : String(value);
    const money = (value, currency) =>
        value == null || value === ''
            ? '—'
            : currency === 'USD'
              ? `$${value}`
              : `${value} ${currency}`;
    const summaryMoney = (value, currency) => {
        const amount = Number(value).toLocaleString('ko-KR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
        });
        return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
    };
    const rocLabel = (row) => {
        if (row?.weightedRocPercent == null) return 'ROC —';
        const partial = row.rocKnownCount < row.paymentCount ? '*' : '';
        return `ROC ${row.weightedRocPercent.toFixed(1)}%${partial}`;
    };
    const helpText =
        '‘—’는 값 미제공이며 0이 아닙니다. ROC는 분배금 중 자본환급으로 보고된 부분으로, 분배금에 더하지 않습니다. 배당락일·통화·금액이 일치하는 배당과 ROC 지급 내역을 연결합니다. 일치하지 않는 기록은 별도 행으로 표시합니다. ROC 금액은 원문 제공값만 표시하며 비율로 역산하지 않습니다. 추정 자료와 최종 세무 결과는 다를 수 있습니다. 같은 지급 건은 확정 자료를 우선하고 같은 단계의 ROC 값이 다르면 미확인으로 표시합니다. 회계연도 누적 자료는 지급 건별 이력에 합산하지 않습니다.';
    watch(
        rows,
        () => {
            page.value = 0;
            if (!monthlyByKey.value.has(selectedMonth.value))
                selectedMonth.value = monthly.value.at(-1)?.key ?? '';
        },
        { immediate: true }
    );
</script>
<template>
    <section
        class="dividend-roc-history"
        aria-labelledby="dividend-roc-heading"
        :aria-busy="loading">
        <header class="history-heading">
            <div>
                <div class="history-title">
                    <h2 id="dividend-roc-heading">배당·ROC 이력</h2>
                    <InfoHelp
                        label="배당·ROC 연결 및 금액 안내"
                        :text="helpText" />
                </div>
                <p>배당락일 기준 · 주당 세전 · 지급 내역 {{ rows.length }}건</p>
            </div>
            <div class="history-actions">
                <SelectButton
                    v-model="view"
                    :options="modes"
                    option-label="label"
                    option-value="value"
                    :allow-empty="false"
                    aria-label="배당·ROC 표시 방식"></SelectButton>
                <div v-if="sources.length" class="history-sources">
                    <a
                        v-for="(source, index) in sources"
                        :key="source.url"
                        :href="source.url"
                        target="_blank"
                        rel="noopener noreferrer">
                        <i class="pi pi-file" aria-hidden="true" />{{
                            source.label
                        }}{{ sources.length > 1 ? ` ${index + 1}` : '' }}
                        <i class="pi pi-external-link" aria-hidden="true" />
                    </a>
                </div>
                <Button
                    v-else
                    label="원문 공시 미제공"
                    icon="pi pi-file"
                    severity="secondary"
                    disabled />
            </div>
        </header>
        <p v-if="loading" role="status" class="history-note">
            ROC 자료를 불러오는 중입니다.
        </p>
        <p v-else-if="failed" role="status" class="history-note">
            ROC 자료를 불러오지 못했습니다. 확인 가능한 배당 이력만 표시합니다.
        </p>
        <p v-else-if="!observations.length" class="history-note">
            공개된 ROC 근거를 수집하지 못했습니다. ROC 0%를 의미하지 않습니다.
        </p>
        <p v-if="!rows.length && !loading" class="history-empty">
            확인 가능한 배당·ROC 지급 이력이 없습니다.
        </p>
        <template v-if="rows.length">
            <div class="month-detail-entry">
                <i class="pi pi-calendar" aria-hidden="true" />
                <div>
                    <strong>달 상세 진입</strong
                    ><span
                        >회차별 배당락일 · 지급일 · 배당액 · ROC액 · ROC 비율 ·
                        출처 조회</span
                    >
                </div>
                <Button
                    label="상세 조회"
                    icon="pi pi-chevron-right"
                    icon-pos="right"
                    :disabled="!monthly.length"
                    @click="openMonthDetail" />
            </div>
            <div
                v-if="view === 'monthly' && monthly.length"
                class="monthly-history">
                <div
                    class="monthly-table-wrap"
                    tabindex="0"
                    role="region"
                    aria-label="연도별 월간 배당과 ROC 요약">
                    <table class="monthly-table">
                        <caption class="studio-sr-only">
                            연도별 월간 주당 분배금 합계, 지급 회차 및 ROC 비율
                        </caption>
                        <thead>
                            <tr>
                                <th scope="col">월</th>
                                <th
                                    v-for="year in years"
                                    :key="year"
                                    scope="col">
                                    {{ year }}년 ({{ currency }})
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="month in 12" :key="month">
                                <th scope="row">{{ month }}월</th>
                                <td v-for="year in years" :key="year">
                                    <button
                                        v-if="
                                            monthlyByKey.get(
                                                `${year}-${String(month).padStart(2, '0')}`
                                            )
                                        "
                                        type="button"
                                        class="monthly-cell"
                                        :class="{
                                            selected:
                                                selectedMonth ===
                                                `${year}-${String(month).padStart(2, '0')}`,
                                        }"
                                        :aria-pressed="
                                            selectedMonth ===
                                            `${year}-${String(month).padStart(2, '0')}`
                                        "
                                        :aria-label="`${year}년 ${month}월 상세 보기`"
                                        @click="
                                            openMonthDetail(
                                                `${year}-${String(month).padStart(2, '0')}`
                                            )
                                        ">
                                        <strong>{{
                                            summaryMoney(
                                                monthlyByKey.get(
                                                    `${year}-${String(month).padStart(2, '0')}`
                                                ).distributionTotal,
                                                monthlyByKey.get(
                                                    `${year}-${String(month).padStart(2, '0')}`
                                                ).currency
                                            )
                                        }}</strong>
                                    </button>
                                    <span v-else class="monthly-missing"
                                        >—</span
                                    >
                                </td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr>
                                <th scope="row">관측 합계</th>
                                <td v-for="year in years" :key="year">
                                    <strong>{{
                                        summaryMoney(
                                            yearTotals.get(year)
                                                .distributionTotal,
                                            currency
                                        )
                                    }}</strong>
                                    <small
                                        >{{
                                            yearTotals.get(year).paymentCount
                                        }}회</small
                                    >
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <p class="roc-disclosure">
                    ROC(자본환급) 미확인은 0%가 아니며, 0%를 순이익 전액으로
                    추론하지 않습니다. 세무 확정 내역이 아닌 공시 관측
                    정보입니다.
                </p>
                <nav class="monthly-pagination" aria-label="월별 요약 페이지">
                    <span>총 1페이지 중 1페이지</span>
                    <div>
                        <Button
                            icon="pi pi-chevron-left"
                            aria-label="이전 월별 요약 페이지"
                            severity="secondary"
                            disabled />
                        <Button
                            label="1"
                            aria-label="현재 월별 요약 1페이지"
                            aria-current="page" />
                        <Button
                            icon="pi pi-chevron-right"
                            aria-label="다음 월별 요약 페이지"
                            severity="secondary"
                            disabled />
                    </div>
                </nav>
            </div>
            <p
                v-else-if="view === 'monthly'"
                class="history-empty"
                role="status">
                월별로 묶을 수 있는 배당락일과 분배금이 없습니다. 회차별
                이력에서 원본 자료를 확인해 주세요.
            </p>
            <div v-else-if="view === 'table'" class="history-table-wrap">
                <table class="history-table">
                    <caption class="studio-sr-only">
                        배당·ROC 지급 이력
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col">배당락일</th>
                            <th scope="col">지급일</th>
                            <th scope="col">주당 분배금</th>
                            <th scope="col">ROC 금액</th>
                            <th scope="col">ROC 비율</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in pageRows" :key="row.id">
                            <th scope="row" class="payment-date">
                                {{ row.exDate || '미확인'
                                }}<small v-if="row.note">{{ row.note }}</small>
                            </th>
                            <td data-label="지급일" class="payable-date">
                                {{ row.payableDate || '미확인' }}
                            </td>
                            <td data-label="주당 분배금" class="payment-number">
                                <span
                                    :class="{
                                        'distribution-value':
                                            row.distributionAmount != null,
                                    }">
                                    {{
                                        money(
                                            row.distributionAmount,
                                            row.currency
                                        )
                                    }}
                                </span>
                            </td>
                            <td data-label="ROC 금액" class="payment-number">
                                {{ money(row.rocAmount, row.currency) }}
                            </td>
                            <td
                                data-label="ROC 비율"
                                class="payment-number payment-percent">
                                {{ display(row.rocPercent)
                                }}{{ row.rocPercent == null ? '' : '%' }}
                                <details
                                    v-if="row.note.includes('ROC 자료 간')"
                                    class="evidence-difference">
                                    <summary>자료 차이 보기</summary>
                                    <p
                                        v-for="record in row.evidence"
                                        :key="record.observationId">
                                        ROC {{ display(record.rocAmount) }}
                                        {{ record.currency }} ·
                                        {{ display(record.rocPercent) }}%
                                    </p>
                                </details>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <DividendRocChart v-else :rows="pageRows" :currency="currency" />
            <Paginator
                v-if="view !== 'monthly' && rows.length > 12"
                :first="page * 12"
                :rows="12"
                :total-records="rows.length"
                :page-link-size="3"
                template="PrevPageLink PageLinks NextPageLink"
                aria-label="배당·ROC 이력 페이지"
                @page="page = $event.page" />
        </template>

        <details v-if="annual.length" class="annual-history">
            <summary>회계연도 누적 내역 · {{ annual.length }}건</summary>
            <p class="history-note">
                공시된 누적 자료입니다. 위 지급 건별 이력과 합산하지 않습니다.
            </p>
            <div
                class="annual-scroll"
                tabindex="0"
                role="region"
                aria-label="회계연도 누적 자료">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">누적 종료일</th>
                            <th scope="col">분배금</th>
                            <th scope="col">ROC 금액</th>
                            <th scope="col">ROC 비율</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in annual" :key="row.observationId">
                            <th scope="row">
                                {{ row.throughPaymentDate || '미확인'
                                }}<small v-if="row.fiscalYearEnd"
                                    >회계연도 종료
                                    {{ row.fiscalYearEnd }}</small
                                >
                            </th>
                            <td>
                                {{
                                    money(row.distributionAmount, row.currency)
                                }}
                            </td>
                            <td>{{ money(row.rocAmount, row.currency) }}</td>
                            <td>
                                {{ display(row.rocPercent)
                                }}{{ row.rocPercent == null ? '' : '%' }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </details>
        <Dialog
            v-model:visible="monthDialog"
            modal
            :draggable="false"
            :block-scroll="true"
            header="달 상세"
            :style="{ width: '56rem', maxWidth: 'calc(100vw - 32px)' }">
            <section
                v-if="selectedSummary"
                tabindex="-1"
                autofocus
                class="selected-month"
                aria-live="polite"
                :aria-label="`${selectedSummary.year}년 ${selectedSummary.month}월 회차별 이력`">
                <header>
                    <div>
                        <h3>
                            {{ selectedSummary.year }}년
                            {{ selectedSummary.month }}월
                        </h3>
                        <p>
                            총
                            {{
                                summaryMoney(
                                    selectedSummary.distributionTotal,
                                    selectedSummary.currency
                                )
                            }}
                            · {{ selectedSummary.paymentCount }}회 ·
                            {{ rocLabel(selectedSummary) }}
                        </p>
                    </div>
                    <span
                        v-if="
                            selectedSummary.rocKnownCount <
                            selectedSummary.paymentCount
                        "
                        >ROC {{ selectedSummary.rocKnownCount }}/{{
                            selectedSummary.paymentCount
                        }}회 확인</span
                    >
                </header>
                <div
                    class="selected-month-scroll"
                    tabindex="0"
                    role="region"
                    aria-label="선택 월 배당·ROC 회차 상세">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">배당락일</th>
                                <th scope="col">지급일</th>
                                <th scope="col">주당 분배금</th>
                                <th scope="col">ROC 금액</th>
                                <th scope="col">ROC 비율</th>
                                <th scope="col">출처</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="row in selectedSummary.rows"
                                :key="row.id">
                                <th scope="row">
                                    {{ row.exDate
                                    }}<small v-if="row.note">{{
                                        row.note
                                    }}</small>
                                </th>
                                <td>{{ row.payableDate || '미확인' }}</td>
                                <td>
                                    {{
                                        money(
                                            row.distributionAmount,
                                            row.currency
                                        )
                                    }}
                                </td>
                                <td>
                                    {{ money(row.rocAmount, row.currency) }}
                                </td>
                                <td class="payment-percent">
                                    {{ display(row.rocPercent)
                                    }}{{ row.rocPercent == null ? '' : '%' }}
                                </td>
                                <td class="month-evidence">
                                    <template
                                        v-for="record in row.evidence || []"
                                        :key="record.observationId">
                                        <a
                                            v-if="safeUrl(record.sourceUrl)"
                                            :href="safeUrl(record.sourceUrl)"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            >공시 원문</a
                                        >
                                        <span
                                            v-if="
                                                row.note?.includes(
                                                    'ROC 자료 간'
                                                )
                                            "
                                            >ROC
                                            {{ display(record.rocAmount) }}
                                            {{ record.currency }} ·
                                            {{
                                                display(record.rocPercent)
                                            }}%</span
                                        >
                                    </template>
                                    <span
                                        v-if="
                                            !(row.evidence || []).some(
                                                (record) =>
                                                    safeUrl(record.sourceUrl)
                                            )
                                        "
                                        >원문 미제공</span
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
            <p class="history-note monthly-note">
                * 일부 회차만 ROC 비율이 확인된 달입니다. 월 ROC는 확인된 회차의
                분배금으로 가중 계산합니다. ROC 금액은 원문 제공값만 표시하며
                비율로 역산하지 않습니다.
            </p>
        </Dialog>
    </section>
</template>
<style scoped>
    .dividend-roc-history {
        padding: 24px;
        margin: 24px 0;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        min-width: 0;
    }
    .history-heading {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
    }
    .history-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
    }
    .history-actions :deep(.p-togglebutton) {
        height: 36px;
        min-height: 36px;
        padding: 0 12px;
        font-size: 14px;
        white-space: nowrap;
    }
    .history-actions :deep(.p-togglebutton-label) {
        white-space: nowrap;
    }
    @media (max-width: 1023px) {
        .history-heading {
            flex-direction: column;
            align-items: stretch;
            gap: 16px;
        }
    }
    .month-detail-entry {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        border-radius: 12px;
        background: var(--app-surface-muted);
        margin: 20px 0 24px;
    }
    .month-detail-entry > i {
        font-size: 24px;
        color: var(--app-accent);
    }
    .month-detail-entry > div {
        display: grid;
        gap: 4px;
        flex: 1;
    }
    .month-detail-entry span {
        font-size: 12px;
        color: var(--app-muted);
    }
    .month-detail-entry :deep(.p-button) {
        min-height: 40px;
        flex-shrink: 0;
    }
    @media (max-width: 639px) {
        .month-detail-entry {
            flex-wrap: wrap;
        }
        .month-detail-entry > div {
            flex-basis: calc(100% - 40px);
        }
        .month-detail-entry :deep(.p-button) {
            width: 100%;
        }
    }
    .history-title {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
    }
    h2 {
        font-size: 20px;
        margin: 0;
    }
    .history-heading p,
    .history-note {
        font-size: 12px;
        color: var(--app-muted);
        line-height: 1.7;
    }
    .history-heading p {
        margin: 4px 0 12px;
    }
    .history-sources {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 16px;
    }
    .history-sources a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        font-size: 12px;
        color: var(--app-accent);
        text-decoration: none;
        padding: 0 16px;
        border-radius: 8px;
        background: var(--app-surface-muted);
    }
    .monthly-table-wrap {
        overflow-x: auto;
        border: 1px solid var(--app-border-subtle);
        border-radius: 12px;
    }
    .monthly-table {
        min-width: max-content;
        font-size: 14px;
        line-height: 20px;
    }
    .monthly-table th:first-child {
        position: sticky;
        left: 0;
        z-index: 1;
        min-width: 64px;
        background: var(--app-surface);
    }
    .monthly-table thead th:first-child {
        z-index: 2;
        background: var(--app-surface-muted);
    }
    .monthly-table th:not(:first-child),
    .monthly-table td {
        min-width: 142px;
        text-align: right;
        padding: 0;
    }
    .monthly-table tbody th,
    .monthly-table tfoot th {
        padding: 12px 16px;
    }
    .monthly-table thead th {
        padding: 12px 16px;
        font-size: 13px;
        line-height: 16px;
    }
    .monthly-table td {
        border-left: 0;
    }
    .monthly-cell {
        display: flex;
        width: 100%;
        min-height: 40px;
        flex-direction: column;
        align-items: flex-end;
        justify-content: center;
        gap: 0;
        line-height: 16px;
        padding: 12px 16px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: var(--app-text);
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        line-height: 16px;
    }
    .monthly-cell:hover,
    .monthly-cell:focus-visible {
        background: var(--app-surface-muted);
    }
    .monthly-cell.selected {
        background: color-mix(in srgb, var(--app-accent) 12%, transparent);
        box-shadow: inset 0 0 0 2px var(--app-accent);
    }
    .monthly-cell strong,
    .monthly-table tfoot strong {
        color: var(--app-accent);
        font-size: 13px;
    }
    .monthly-table small {
        margin-top: 0;
        white-space: nowrap;
    }
    .monthly-missing {
        display: grid;
        min-height: 40px;
        place-items: center;
        color: var(--app-muted);
    }
    .monthly-table tfoot th,
    .monthly-table tfoot td {
        background: var(--app-surface-muted);
        border-top: 1px solid var(--app-border);
        border-bottom: 0;
    }
    .monthly-table tfoot td {
        padding: 12px;
    }
    .monthly-table tfoot small {
        display: inline;
        margin-left: 8px;
    }
    .selected-month {
        margin-top: 0;
        padding: 18px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface-muted);
    }
    .selected-month > header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
    }
    .selected-month h3 {
        margin: 0;
        font-size: 16px;
    }
    .selected-month header p {
        margin: 5px 0 0;
        color: var(--app-muted);
        font-size: 12px;
    }
    .selected-month header > span {
        padding: 5px 8px;
        border-radius: 999px;
        background: var(--app-surface);
        color: var(--app-muted);
        font-size: 11px;
        white-space: nowrap;
    }
    .selected-month-scroll {
        overflow-x: auto;
        border-radius: 8px;
        background: var(--app-surface);
    }
    .selected-month-scroll table {
        min-width: 560px;
    }
    .selected-month-scroll th:nth-child(n + 3),
    .selected-month-scroll td:nth-child(n + 3) {
        text-align: right;
    }
    .roc-disclosure {
        padding: 14px;
        margin: 24px 0 0;
        border-radius: 8px;
        background: var(--app-surface-muted);
        font-size: 12px;
        line-height: 1.625;
        color: var(--app-muted);
    }
    .monthly-pagination {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-top: 24px;
        padding-top: 8px;
        font-size: 11px;
        color: var(--app-muted);
    }
    .monthly-pagination > div {
        display: flex;
        gap: 6px;
    }
    .monthly-pagination :deep(.p-button) {
        width: 36px;
        height: 36px;
        padding: 0;
    }
    .month-evidence a,
    .month-evidence span {
        display: block;
    }
    .selected-month-scroll small {
        display: block;
        white-space: normal;
    }
    .monthly-note {
        margin: 10px 0 0;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
    }
    th,
    td {
        text-align: left;
        padding: 16px;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    thead th {
        background: var(--app-surface-muted);
        color: var(--app-muted);
        font-size: 12px;
    }
    thead th:nth-child(n + 3),
    .payment-number {
        text-align: right;
    }
    .history-table-wrap {
        border: 1px solid var(--app-border-subtle);
        border-radius: 12px;
        overflow: hidden;
    }
    tbody tr:last-child > * {
        border-bottom: 0;
    }
    .distribution-value {
        color: var(--app-accent);
        font-size: 17px;
        font-weight: 750;
        letter-spacing: -0.02em;
        line-height: 1.5;
    }
    .payment-percent {
        color: var(--app-accent);
        font-weight: 700;
    }
    small {
        display: block;
        font-size: 11px;
        margin-top: 5px;
        font-weight: 400;
        color: var(--app-muted);
    }
    .payment-date small {
        max-width: 210px;
        line-height: 1.6;
    }
    .history-empty {
        padding: 28px 0;
        text-align: center;
        color: var(--app-muted);
    }
    .annual-history {
        margin-top: 22px;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    summary {
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
    }
    .annual-scroll {
        overflow-x: auto;
    }
    .annual-scroll table {
        min-width: 500px;
    }
    .evidence-difference {
        margin-top: 8px;
        color: var(--app-muted);
        font-size: 11px;
        font-weight: 400;
    }
    .evidence-difference p {
        white-space: normal;
    }
    @media (max-width: 767px) {
        .dividend-roc-history {
            padding: 20px;
        }
    }
    @media (max-width: 600px) {
        h2 {
            font-size: 18px;
        }
        .history-heading {
            align-items: flex-start;
        }
        .monthly-table th:not(:first-child),
        .monthly-table td {
            min-width: 132px;
        }
        .selected-month {
            padding: 14px;
        }
        .selected-month > header {
            flex-direction: column;
        }
        .history-table-wrap {
            border: 0;
            overflow: visible;
        }
        .history-table,
        .history-table tbody {
            display: block;
        }
        .history-table thead {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip-path: inset(50%);
        }
        .history-table tbody tr {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px 0;
            border: 1px solid var(--app-border);
            border-radius: 14px;
            padding: 12px 16px;
            margin-bottom: 10px;
        }
        .history-table .payment-date {
            grid-column: 1 / -1;
            padding: 0;
            border: 0;
        }
        .payment-date small {
            max-width: none;
        }
        .history-table .payable-date {
            grid-column: 1 / -1;
            padding: 0;
            border: 0;
            font-size: 12px;
            color: var(--app-muted);
        }
        .payable-date::before {
            content: attr(data-label) ': ';
        }
        .history-table .payment-number {
            border: 0;
            padding: 12px 4px;
            text-align: center;
            background: var(--app-surface-muted);
            font-size: 12px;
            overflow-wrap: anywhere;
        }
        .payment-number::before {
            display: block;
            content: attr(data-label);
            font-size: 10px;
            color: var(--app-muted);
            font-weight: 400;
            margin-bottom: 6px;
        }
        .payment-number:nth-child(3) {
            border-radius: 8px 0 0 8px;
        }
        .payment-number:last-child {
            border-radius: 0 8px 8px 0;
        }
        .annual-history {
            padding: 12px;
        }
    }
</style>
