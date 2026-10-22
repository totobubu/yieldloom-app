<script setup>
    import { computed, ref, watch } from 'vue';
    import SelectButton from 'primevue/selectbutton';
    import Paginator from 'primevue/paginator';
    import InfoHelp from '@/components/common/InfoHelp.vue';
    import DividendRocChart from './DividendRocChart.vue';
    import { dividendRocHistory } from '../../../lib/dividend-roc-history.js';
    const props = defineProps({
        history: { type: Array, default: () => [] },
        observations: { type: Array, default: () => [] },
        currency: { type: String, default: 'USD' },
        loading: Boolean,
        failed: Boolean,
    });
    const view = ref('table'),
        page = ref(0);
    const modes = [
        { label: '표', value: 'table', icon: 'pi pi-table' },
        { label: '차트', value: 'chart', icon: 'pi pi-chart-bar' },
    ];
    const rows = computed(() =>
        dividendRocHistory(props.history, props.observations, props.currency)
    );
    const pageRows = computed(() =>
        rows.value.slice(page.value * 12, (page.value + 1) * 12)
    );
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
    const helpText =
        '배당락일·통화·금액이 일치하는 배당과 ROC 지급 내역을 연결합니다. 일치하지 않는 기록은 별도 행으로 표시합니다. ROC 금액은 원문 제공값만 표시하며 비율로 역산하지 않습니다. 추정 자료와 최종 세무 결과는 다를 수 있습니다. 같은 지급 건은 확정 자료를 우선하고 같은 단계의 ROC 값이 다르면 미확인으로 표시합니다. 회계연도 누적 자료는 지급 건별 이력에 합산하지 않습니다.';
    watch(rows, () => {
        page.value = 0;
    });
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
            <SelectButton
                v-model="view"
                :options="modes"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                aria-label="배당·ROC 표시 방식"
                ><template #option="{ option }"
                    ><i :class="option.icon" aria-hidden="true" /><span>{{
                        option.label
                    }}</span></template
                ></SelectButton
            >
        </header>
        <div v-if="sources.length" class="history-sources">
            <a
                v-for="(source, index) in sources"
                :key="source.url"
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ source.label
                }}{{ sources.length > 1 ? ` ${index + 1}` : '' }}
                <i class="pi pi-external-link" aria-hidden="true"
            /></a>
        </div>
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
            <div v-if="view === 'table'" class="history-table-wrap">
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
                                {{ display(row.distributionAmount)
                                }}<small>{{ row.currency }}</small>
                            </td>
                            <td data-label="ROC 금액" class="payment-number">
                                {{ display(row.rocAmount)
                                }}<small v-if="row.rocAmount != null">{{
                                    row.currency
                                }}</small>
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
                v-if="rows.length > 12"
                :first="page * 12"
                :rows="12"
                :total-records="rows.length"
                :page-link-size="3"
                template="PrevPageLink PageLinks NextPageLink"
                aria-label="배당·ROC 이력 페이지"
                @page="page = $event.page" />
        </template>
        <p class="history-note">
            ‘—’는 값 미제공이며 0이 아닙니다. ROC는 분배금 중 자본환급으로
            보고된 부분으로, 분배금에 더하지 않습니다.
        </p>
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
                                {{ display(row.distributionAmount) }}
                                {{ row.currency }}
                            </td>
                            <td>{{ display(row.rocAmount) }}</td>
                            <td>
                                {{ display(row.rocPercent)
                                }}{{ row.rocPercent == null ? '' : '%' }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </details>
    </section>
</template>
<style scoped>
    .dividend-roc-history {
        padding: 24px;
        margin: 24px 0;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 18px;
        min-width: 0;
    }
    .history-heading {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
    }
    .history-title {
        display: flex;
        align-items: center;
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
        justify-content: flex-end;
        gap: 8px 16px;
        margin-bottom: 10px;
    }
    .history-sources a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        font-size: 12px;
        color: var(--app-accent);
        text-decoration: none;
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
    @media (max-width: 600px) {
        .dividend-roc-history {
            padding: 16px;
        }
        h2 {
            font-size: 18px;
        }
        .history-heading {
            align-items: flex-start;
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
            padding: 16px 12px;
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
