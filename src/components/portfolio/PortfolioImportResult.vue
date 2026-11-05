<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import Tag from 'primevue/tag';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import StitchSymbol from './StitchSymbol.vue';

    const props = defineProps({
        receipt: { type: Object, required: true },
        busy: Boolean,
        accountsState: { type: String, default: 'loading' },
        latestHoldingsDate: { type: String, default: '' },
    });
    defineEmits(['view', 'export', 'another', 'calendar', 'retry']);
    const filter = ref('all'),
        page = ref(0),
        pageSize = 50;
    const hasDetails = computed(
        () =>
            props.receipt.rowResultsComplete === true &&
            Array.isArray(props.receipt.rowResults) &&
            props.receipt.rowResults.length ===
                props.receipt.inserted + props.receipt.duplicates
    );
    const rows = computed(() =>
        hasDetails.value ? props.receipt.rowResults : []
    );
    const filtered = computed(() =>
        rows.value.filter(
            (item) => filter.value === 'all' || item.status === filter.value
        )
    );
    const visibleRows = computed(() =>
        filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize)
    );
    const total = computed(
        () => props.receipt.inserted + props.receipt.duplicates
    );
    watch([() => props.receipt, filter], () => {
        page.value = 0;
    });
    const typeLabels = {
        buy: '매수',
        sell: '매도',
        dividend: '배당금',
        dividend_reversal: '배당 취소',
        cash_in: '입금',
        cash_out: '출금',
        transfer_in: '이체 입고',
        transfer_out: '이체 출고',
        split: '분할',
    };
    function number(value) {
        return typeof value === 'number' && Number.isFinite(value)
            ? value.toLocaleString('ko-KR', { maximumFractionDigits: 20 })
            : '미제공';
    }
    const currencyGroups = computed(() => {
        const groups = new Map();
        for (const item of rows.value) {
            if (item.status !== 'inserted' || !item.row.currency) continue;
            const group = groups.get(item.row.currency) || {
                currency: item.row.currency,
                count: 0,
                types: new Set(),
            };
            group.count++;
            group.types.add(item.row.type);
            groups.set(item.row.currency, group);
        }
        return [...groups.values()].map((group) => ({
            ...group,
            labels: [
                ...(group.types.has('buy') ? ['매수 금액'] : []),
                ...(group.types.has('sell') ? ['매도 금액'] : []),
                ...(group.types.has('cash_in') || group.types.has('cash_out')
                    ? ['입출금 순액']
                    : []),
                ...(group.types.has('dividend') ? ['배당 입금액'] : []),
            ],
        }));
    });
    const summaryGroups = computed(() =>
        props.receipt.inserted === 0
            ? [{ currency: '신규 저장 내역 없음', count: 0, labels: [] }]
            : currencyGroups.value.length
              ? currencyGroups.value
              : [
                    {
                        currency: '통화별 신규 내역 미제공',
                        count: null,
                        labels: [
                            '매수 금액',
                            '매도 금액',
                            '입출금 순액',
                            '배당 입금액',
                        ],
                    },
                ]
    );
    const heading = ref(null);
    function focusHeading() {
        heading.value?.focus({ preventScroll: true });
        heading.value
            ?.closest('.import-result')
            ?.scrollIntoView({ block: 'start' });
    }
    defineExpose({ focusHeading });
    const explanation = computed(() => {
        if (props.accountsState !== 'ready')
            return '계좌 목록 갱신 상태를 확인해 주세요.';
        if (props.receipt.kind === 'transactions')
            return '거래 기록을 저장했고 계산 잔고에 반영했습니다. 증권사 잔고내역을 등록하면 해당 기준일 이후 거래만 누적합니다.';
        if (
            props.latestHoldingsDate &&
            props.latestHoldingsDate > props.receipt.asOf
        )
            return `과거 기준일 자료로 보관했습니다. 화면에는 더 최신인 ${props.latestHoldingsDate} 잔고가 표시됩니다.`;
        return '이 기준일의 전체 잔고가 한눈에 보기 > 보유 종목에 표시됩니다. 현재 시세로 계산한 평가액은 아닙니다.';
    });
</script>

<template>
    <div class="import-result">
        <header class="receipt-header">
            <div class="receipt-badges">
                <Tag value="데이터 가져오기 및 저장 영수증" /><slot
                    name="badges" /><Tag
                    severity="secondary"
                    :value="`기준일: ${(receipt.asOf || '미제공').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1년 $2월 $3일')}`"
                    ><template #icon
                        ><StitchSymbol name="receipt_long" /></template
                ></Tag>
            </div>
            <ol class="receipt-steps" aria-label="가져오기 진행 단계">
                <li
                    v-for="(label, index) in [
                        '파일 업로드',
                        '열 매핑·검토',
                        '저장 결과 영수증',
                    ]"
                    :key="label"
                    :aria-current="index === 2 ? 'step' : undefined">
                    <span class="receipt-step-icon"
                        ><StitchSymbol
                            :name="index === 2 ? 'done_all' : 'check'"
                    /></span>
                    <span class="receipt-step-text"
                        ><span class="receipt-step-index"
                            >Step {{ index + 1
                            }}<span class="receipt-step-complete">
                                (완료)</span
                            ></span
                        >
                        <strong>{{ label }}</strong></span
                    >
                </li>
            </ol>
            <div class="receipt-context">
                <div class="result-heading" role="status" aria-live="polite">
                    <h2 ref="heading" tabindex="-1">
                        증권
                        {{
                            receipt.kind === 'holdings'
                                ? '잔고내역'
                                : '거래내역'
                        }}
                        저장 영수증
                    </h2>
                    <Tag
                        :value="`${number(receipt.inserted)}건 저장 완료 · ${number(receipt.duplicates)}건 중복 제외`" />
                </div>
                <p class="receipt-description">
                    총 {{ number(total) }}건 중
                    {{ number(receipt.inserted) }}건을 새로 저장하고
                    {{ number(receipt.duplicates) }}건은 중복으로 제외했습니다.
                    ({{
                        receipt.kind === 'holdings'
                            ? '잔고 기준일'
                            : '조회 종료일'
                    }}: {{ receipt.asOf }})
                </p>
            </div>
        </header>
        <Card class="receipt-card">
            <template #content>
                <div class="receipt-workflow">
                    <div class="receipt-overview">
                        <div class="receipt-summary">
                            <span class="receipt-summary-icon"
                                ><StitchSymbol name="receipt_long"
                            /></span>
                            <div>
                                <h3>
                                    {{
                                        receipt.kind === 'holdings'
                                            ? '잔고내역'
                                            : '거래내역'
                                    }}
                                    저장 영수증
                                </h3>
                                <p>
                                    총 {{ number(total) }}건 처리: 신규
                                    {{ number(receipt.inserted) }}건 · 중복 제외
                                    {{ number(receipt.duplicates) }}건
                                </p>
                            </div>
                            <Tag
                                severity="secondary"
                                value="저장 영수증 유지" />
                        </div>
                        <p class="result-explanation">
                            <span
                                class="receipt-state"
                                role="status"
                                aria-live="polite"
                                >{{
                                    receipt.inserted
                                        ? '자료 저장이 완료되었습니다'
                                        : '이미 등록된 자료입니다'
                                }}</span
                            >. {{ explanation }}
                        </p>
                        <dl class="result-counts">
                            <div>
                                <dt>
                                    <StitchSymbol name="event_available" />
                                    기준일
                                </dt>
                                <dd>{{ receipt.asOf }}</dd>
                            </div>
                            <div>
                                <dt>
                                    <StitchSymbol
                                        name="account_balance_wallet" />
                                    연동 계좌
                                </dt>
                                <dd>{{ receipt.accountAlias }}</dd>
                            </div>
                            <div>
                                <dt>
                                    <StitchSymbol name="description" /> 업로드
                                    파일
                                </dt>
                                <dd>
                                    {{
                                        receipt.fileNames?.join(', ') ||
                                        '파일명 미제공'
                                    }}
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <div class="receipt-side">
                        <section
                            class="receipt-finance"
                            aria-label="통화별 금융 요약 제공 상태">
                            <div class="receipt-finance-title">
                                <h3>
                                    <StitchSymbol name="account_balance" />
                                    통화별 저장 현황
                                </h3>
                                <Tag
                                    severity="secondary"
                                    value="금액 집계 미제공" />
                            </div>
                            <div class="receipt-currencies">
                                <article
                                    v-for="group in summaryGroups"
                                    :key="group.currency">
                                    <div class="receipt-currency-title">
                                        <strong>{{ group.currency }}</strong
                                        ><span v-if="group.count != null"
                                            >{{ number(group.count) }}건 신규
                                            저장</span
                                        >
                                    </div>
                                    <dl>
                                        <div
                                            v-for="label in group.labels"
                                            :key="label">
                                            <dt>{{ label }}</dt>
                                            <dd>미제공</dd>
                                        </div>
                                    </dl>
                                </article>
                            </div>
                            <p class="receipt-finance-note">
                                <StitchSymbol name="lock" /> 금융 집계 계약이
                                없어 합계는 미제공입니다. 통화는 합산하지
                                않습니다.
                            </p>
                        </section>
                        <section
                            class="receipt-followup"
                            aria-label="계좌 갱신과 후속 작업">
                            <div
                                v-if="accountsState !== 'ready'"
                                class="receipt-refresh"
                                :role="
                                    accountsState === 'error'
                                        ? 'alert'
                                        : 'status'
                                ">
                                <StitchSymbol
                                    class="receipt-warning-icon"
                                    name="warning" />
                                <div>
                                    <strong>{{
                                        accountsState === 'error'
                                            ? '계좌 목록 새로고침이 필요합니다'
                                            : '계좌 목록을 갱신하고 있습니다'
                                    }}</strong>
                                    <p>
                                        저장 영수증은 유지됩니다. 계좌 목록
                                        갱신이 완료되면 잔고·거래, 배당 캘린더와
                                        CSV 내보내기를 이용할 수 있습니다.
                                    </p>
                                    <Button
                                        v-if="accountsState === 'error'"
                                        label="계좌 목록 다시 불러오기"
                                        severity="secondary"
                                        outlined
                                        :disabled="busy"
                                        @click="$emit('retry')"
                                        ><template #icon
                                            ><StitchSymbol
                                                name="refresh" /></template
                                    ></Button>
                                </div>
                            </div>
                            <div class="receipt-next">
                                <h3>후속 작업 및 확인</h3>
                                <div class="result-actions">
                                    <Button
                                        label="배당 캘린더 확인"
                                        severity="secondary"
                                        outlined
                                        :disabled="
                                            busy || accountsState !== 'ready'
                                        "
                                        @click="$emit('calendar')"
                                        ><template #icon
                                            ><StitchSymbol
                                                :name="
                                                    accountsState === 'ready'
                                                        ? 'calendar_month'
                                                        : 'lock'
                                                " /></template
                                    ></Button>
                                    <Button
                                        :label="
                                            receipt.kind === 'holdings'
                                                ? '잔고 확인'
                                                : '저장 거래 확인'
                                        "
                                        :severity="
                                            accountsState === 'ready'
                                                ? 'primary'
                                                : 'secondary'
                                        "
                                        :outlined="accountsState !== 'ready'"
                                        :disabled="
                                            busy || accountsState !== 'ready'
                                        "
                                        @click="$emit('view')"
                                        ><template #icon
                                            ><StitchSymbol
                                                :name="
                                                    accountsState === 'ready'
                                                        ? 'account_balance_wallet'
                                                        : 'lock'
                                                " /></template
                                    ></Button>
                                </div>
                                <p
                                    v-if="accountsState !== 'ready'"
                                    class="receipt-lock-help">
                                    계좌 목록 갱신이 완료되면 배당 캘린더와
                                    잔고·거래를 확인할 수 있습니다.
                                </p>
                                <div class="receipt-export-actions">
                                    <Button
                                        label="CSV로 내려받기"
                                        severity="secondary"
                                        outlined
                                        :disabled="
                                            busy || accountsState !== 'ready'
                                        "
                                        @click="$emit('export')"
                                        ><template #icon
                                            ><StitchSymbol
                                                :name="
                                                    accountsState === 'ready'
                                                        ? 'download'
                                                        : 'lock'
                                                " /></template
                                    ></Button>
                                    <p class="receipt-footnote">
                                        CSV는 선택 계좌 전체 내역입니다.
                                    </p>
                                    <Button
                                        class="receipt-another"
                                        label="추가 등록"
                                        severity="secondary"
                                        outlined
                                        :disabled="busy"
                                        @click="$emit('another')"
                                        ><template #icon
                                            ><StitchSymbol
                                                name="upload_file" /></template
                                    ></Button>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
                <section
                    class="receipt-detail"
                    aria-labelledby="receipt-details-title">
                    <div class="receipt-detail-title">
                        <h3 id="receipt-details-title">가져오기 내역 상세</h3>
                        <span>총 {{ number(total) }}건</span>
                    </div>
                    <template v-if="hasDetails">
                        <div class="receipt-table-controls">
                            <div
                                class="receipt-filters"
                                role="group"
                                aria-label="저장 결과 필터">
                                <Button
                                    label="전체 결과"
                                    :aria-pressed="filter === 'all'"
                                    :severity="
                                        filter === 'all'
                                            ? 'primary'
                                            : 'secondary'
                                    "
                                    text
                                    @click="filter = 'all'" />
                                <Button
                                    :label="`신규 저장 (${number(receipt.inserted)})`"
                                    :aria-pressed="filter === 'inserted'"
                                    :severity="
                                        filter === 'inserted'
                                            ? 'primary'
                                            : 'secondary'
                                    "
                                    text
                                    @click="filter = 'inserted'" />
                                <Button
                                    :label="`중복 제외 (${number(receipt.duplicates)})`"
                                    :aria-pressed="filter === 'duplicate'"
                                    :severity="
                                        filter === 'duplicate'
                                            ? 'primary'
                                            : 'secondary'
                                    "
                                    text
                                    @click="filter = 'duplicate'" />
                            </div>

                            <p class="receipt-scroll-hint">
                                가로 스크롤 가능
                                <StitchSymbol name="arrow_forward" />
                            </p>
                        </div>
                        <DataTable
                            class="receipt-table"
                            :pt="{
                                tableContainer: {
                                    tabindex: 0,
                                    role: 'region',
                                    'aria-label':
                                        '가져오기 결과 표 · 가로 스크롤',
                                },
                            }"
                            :value="visibleRows"
                            data-key="position"
                            scrollable
                            table-style="min-width:720px"
                            aria-label="가져오기 행별 저장 결과">
                            <Column header="상태"
                                ><template #body="{ data }"
                                    ><Tag
                                        :severity="
                                            data.status === 'duplicate'
                                                ? 'warn'
                                                : 'success'
                                        "
                                        :value="
                                            data.status === 'duplicate'
                                                ? '중복 제외'
                                                : '신규 저장'
                                        " /></template
                            ></Column>
                            <Column field="row.date" header="거래일자" /><Column
                                header="종목/전표"
                                ><template #body="{ data }"
                                    ><strong>{{ data.row.symbol }}</strong>
                                    <p class="receipt-symbol-name">
                                        {{
                                            data.row.securityName ||
                                            '명칭 미제공'
                                        }}
                                        ({{
                                            data.row.currency || '통화 미제공'
                                        }})
                                    </p></template
                                ></Column
                            >
                            <Column header="구분"
                                ><template #body="{ data }"
                                    ><span
                                        class="receipt-row-type"
                                        :class="`receipt-type-${data.row.type || 'unknown'}`"
                                        >{{
                                            typeLabels[data.row.type] ||
                                            data.row.type ||
                                            (receipt.kind === 'holdings'
                                                ? '잔고'
                                                : '유형 미제공')
                                        }}</span
                                    ></template
                                ></Column
                            >
                            <Column header="수량 (저장값)"
                                ><template #body="{ data }">{{
                                    number(data.row.quantity)
                                }}</template></Column
                            >
                            <Column header="금액 (저장값)"
                                ><template #body="{ data }">{{
                                    data.row.amount == null
                                        ? '미제공'
                                        : `${number(data.row.amount)} ${data.row.currency || '통화 미제공'}`
                                }}</template></Column
                            >
                            <Column header="상세 비고"
                                ><template #body="{ data }"
                                    >{{
                                        data.status === 'duplicate'
                                            ? '기존 내역과 일치하여 제외'
                                            : '신규 저장'
                                    }}<span
                                        v-if="
                                            data.status === 'duplicate' &&
                                            data.row.externalId
                                        ">
                                        · {{ data.row.externalId }}</span
                                    ></template
                                ></Column
                            >
                        </DataTable>
                        <div class="receipt-rows">
                            <article
                                v-for="item in visibleRows"
                                :key="item.position"
                                class="receipt-row"
                                :class="{
                                    duplicate: item.status === 'duplicate',
                                }">
                                <div class="receipt-row-status">
                                    <Tag
                                        :severity="
                                            item.status === 'duplicate'
                                                ? 'warn'
                                                : 'success'
                                        "
                                        :value="
                                            item.status === 'duplicate'
                                                ? '중복 제외'
                                                : '신규 저장'
                                        " /><time>{{ item.row.date }}</time
                                    ><span
                                        class="receipt-row-type"
                                        :class="`receipt-type-${item.row.type || 'unknown'}`"
                                        >{{
                                            typeLabels[item.row.type] ||
                                            item.row.type ||
                                            (receipt.kind === 'holdings'
                                                ? '잔고'
                                                : '유형 미제공')
                                        }}</span
                                    >
                                </div>
                                <div class="receipt-row-values">
                                    <div class="receipt-row-symbol">
                                        <strong>{{ item.row.symbol }}</strong>
                                        <p class="receipt-symbol-name">
                                            {{
                                                item.row.securityName ||
                                                '명칭 미제공'
                                            }}
                                            ({{
                                                item.row.currency ||
                                                '통화 미제공'
                                            }})
                                        </p>
                                    </div>
                                    <div>
                                        <strong>{{
                                            item.row.amount == null
                                                ? '미제공'
                                                : `${number(item.row.amount)} ${item.row.currency || '통화 미제공'}`
                                        }}</strong>
                                        <p>
                                            {{
                                                item.row.quantity == null
                                                    ? '수량 미제공'
                                                    : `${number(item.row.quantity)}주`
                                            }}
                                            ·
                                            {{
                                                item.row.currency ||
                                                '통화 미제공'
                                            }}
                                        </p>
                                    </div>
                                </div>
                                <p class="receipt-row-reason">
                                    {{
                                        item.status === 'duplicate'
                                            ? '기존 등록 내역과 일치하여 제외했습니다.'
                                            : '이번 요청에서 새로 저장했습니다.'
                                    }}<span
                                        v-if="
                                            item.status === 'duplicate' &&
                                            item.row.externalId
                                        ">
                                        · 고유번호
                                        {{ item.row.externalId }}</span
                                    >
                                </p>
                            </article>
                        </div>
                        <p class="receipt-footnote">
                            서버가 이번 저장 요청에서 판정한 행입니다. 신규 저장
                            표시는 현재 잔고 반영·금융사 확인을 뜻하지 않습니다.
                        </p>
                        <p v-if="!filtered.length" class="receipt-footnote">
                            선택한 처리 결과가 없습니다.
                        </p>
                        <nav
                            v-if="filtered.length > pageSize"
                            class="receipt-pagination"
                            aria-label="저장 결과 페이지">
                            <Button
                                label="이전"
                                severity="secondary"
                                outlined
                                :disabled="page === 0"
                                @click="page--" /><span
                                >{{ page * pageSize + 1 }}–{{
                                    Math.min(
                                        (page + 1) * pageSize,
                                        filtered.length
                                    )
                                }}
                                / {{ number(filtered.length) }}</span
                            ><Button
                                label="다음"
                                severity="secondary"
                                outlined
                                :disabled="
                                    (page + 1) * pageSize >= filtered.length
                                "
                                @click="page++" />
                        </nav>
                    </template>
                    <p v-else class="receipt-unavailable">
                        이 영수증은 행별 저장 결과를 제공하지 않습니다.
                        저장·중복 건수는 위 영수증에서 확인하고, 계좌 갱신 후
                        저장 거래·잔고에서 실제 내역을 확인해 주세요.
                    </p>
                </section>
            </template>
        </Card>
    </div>
</template>

<style scoped>
    .import-result {
        display: flex;
        flex-direction: column;
        gap: 24px;
        color: var(--app-text);
        scroll-margin-top: var(--portfolio-scroll-offset, 90px);
        margin-bottom: 24px;
    }
    .receipt-header {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .receipt-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .receipt-steps {
        list-style: none;
        margin: 0;
        padding: 16px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-steps li {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--app-muted);
    }
    .receipt-steps i {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        flex-shrink: 0;
    }
    .receipt-steps [aria-current] {
        color: var(--app-accent);
        font-weight: 700;
    }
    .result-heading {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .result-heading h2 {
        margin: 0;
        font-size: 24px;
        line-height: 32px;
        letter-spacing: -0.01em;
        color: var(--app-text);
        font-weight: 700;
    }
    .receipt-description {
        margin: 0;
        color: var(--app-muted);
        font-size: 14px;
        line-height: 22.75px;
    }
    .receipt-card {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        box-shadow: 0 1px 2px #0000000d;
    }
    .receipt-card :deep(.p-card-body) {
        padding: 24px;
    }
    .receipt-summary {
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        padding: 16px;
    }
    .receipt-summary > i {
        border-radius: 50%;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .receipt-summary > div {
        flex: 1;
        min-width: 0;
    }
    .receipt-summary h3 {
        font-size: 16px;
        line-height: 24px;
        margin: 0;
    }
    .receipt-summary p {
        font-size: 12px;
        line-height: 18px;
        margin: 4px 0 0;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .result-counts {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin: 20px 0;
    }
    .result-counts > div {
        padding: 12px;
        background: var(--app-bg);
        border: 1px solid var(--app-border);
        border-radius: 8px;
    }
    .result-counts dt {
        font-size: 12px;
        color: var(--app-muted);
    }
    .result-counts dd {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 20px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .result-explanation {
        font-size: 13px;
        line-height: 20px;
        color: var(--app-muted);
    }
    .receipt-refresh {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px;
        border: 1px solid var(--p-yellow-400);
        background: color-mix(
            in srgb,
            var(--p-yellow-300) 10%,
            var(--app-surface)
        );
        border-radius: 8px;
        margin: 16px 0;
        font-size: 13px;
        line-height: 20px;
    }
    .receipt-refresh > i {
        margin-top: 3px;
        color: var(--p-yellow-600);
    }
    .receipt-refresh p {
        margin: 4px 0 12px;
    }
    .result-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-top: 20px;
    }
    .result-actions :deep(.p-button-label) {
        white-space: normal;
    }
    .receipt-footnote {
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
        margin: 8px 0 12px;
    }
    .receipt-another {
        width: 100%;
        margin-top: 12px;
    }
    .receipt-detail-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }
    .receipt-detail-title h3,
    .receipt-finance h3 {
        font-size: 20px;
        line-height: 28px;
        margin: 0;
    }
    .receipt-detail-title > span {
        font-size: 12px;
        color: var(--app-muted);
    }
    .receipt-filters {
        display: flex;
        gap: 4px;
        padding: 4px;
        background: var(--app-bg);
        border-radius: 8px;
    }
    .receipt-filters > button {
        flex: 1;
        font-size: 12px;
    }
    .receipt-filters [aria-pressed='true'] {
        background: var(--app-surface);
    }
    .receipt-rows {
        display: grid;
        gap: 10px;
    }
    .receipt-row {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 2px #0000000d;
    }
    .receipt-row.duplicate {
        border-inline-start: 4px solid var(--p-yellow-400);
    }
    .receipt-row-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--app-muted);
        flex-wrap: wrap;
    }
    .receipt-row-type {
        margin-inline-start: auto;
    }
    .receipt-row-values {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin: 12px 0 8px;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
    }
    .receipt-row-values > div {
        text-align: right;
    }
    .receipt-row-values p {
        font-size: 11px;
        color: var(--app-muted);
        margin: 4px 0 0;
    }
    .receipt-row-reason {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
        margin: 0;
        border-top: 1px solid var(--app-border);
        padding-top: 8px;
        overflow-wrap: anywhere;
    }
    .receipt-pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 12px;
        font-size: 12px;
    }
    .receipt-unavailable {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 16px;
        font-size: 13px;
        line-height: 20px;
        color: var(--app-muted);
    }
    .receipt-finance > p {
        font-size: 12px;
        line-height: 18px;
        color: var(--app-muted);
    }
    .receipt-currencies {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }
    .receipt-currencies > article {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-currencies dl {
        display: grid;
        gap: 8px;
        font-size: 12px;
        margin: 12px 0 0;
    }
    .receipt-currencies dl > div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }
    .receipt-currencies dt {
        color: var(--app-muted);
    }
    .receipt-currencies dd {
        margin: 0;
    }
    @media (max-width: 640px) {
        .import-result {
            gap: 16px;
        }
        .receipt-header {
            gap: 12px;
        }
        .receipt-steps {
            padding: 12px;
            gap: 4px;
        }
        .receipt-steps li {
            flex: 1;
            flex-direction: column;
            gap: 4px;
            font-size: 10px;
            text-align: center;
        }
        .receipt-steps i {
            width: 24px;
            height: 24px;
        }
        .result-heading {
            gap: 6px;
        }
        .result-heading h2 {
            font-size: 20px;
            line-height: 28px;
        }
        .receipt-card :deep(.p-card-body) {
            padding: 16px;
        }
        .receipt-summary {
            padding: 12px;
            flex-wrap: wrap;
        }
        .receipt-summary > i {
            width: 32px;
            height: 32px;
        }
        .receipt-summary h3 {
            font-size: 15px;
            line-height: 20px;
        }
        .result-counts {
            gap: 8px;
            margin: 14px 0;
        }
        .result-counts > div {
            padding: 8px;
        }
        .result-counts dd {
            font-size: 13px;
            line-height: 20px;
        }
        .result-actions {
            grid-template-columns: minmax(0, 1fr);
            margin-top: 14px;
        }
        .receipt-refresh {
            padding: 12px;
        }
        .receipt-row {
            padding: 14px;
        }
        .receipt-currencies {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    .receipt-card :deep(.p-card-content) {
        display: flex;
        flex-direction: column;
        gap: 24px;
    }
    .receipt-workflow {
        display: contents;
    }
    .receipt-overview {
        order: 1;
    }
    .receipt-detail {
        order: 2;
    }
    .receipt-finance {
        order: 3;
    }
    .receipt-refresh {
        order: 4;
        margin: 0;
    }
    .receipt-next {
        order: 5;
    }
    .receipt-next h3 {
        font-size: 16px;
        line-height: 24px;
        margin: 0;
    }
    .result-counts {
        margin: 16px 0 0;
    }
    .result-counts > div {
        background: transparent;
        border: 0;
        padding: 0;
    }
    .result-counts dd {
        overflow-wrap: anywhere;
    }
    @media (max-width: 640px) {
        .receipt-card {
            display: contents;
        }
        .receipt-card :deep(.p-card-body),
        .receipt-card :deep(.p-card-content) {
            display: contents;
        }
        .receipt-workflow {
            display: flex;
            flex-direction: column;
            gap: 14px;
            padding: 16px;
            border: 1px solid var(--app-border);
            border-radius: 12px;
            background: var(--app-surface);
        }
        .receipt-overview {
            order: 0;
        }
        .receipt-finance {
            order: 1;
        }
        .receipt-refresh {
            order: 2;
        }
        .receipt-next {
            order: 3;
        }
        .receipt-detail {
            order: 4;
        }
        .result-counts {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
        }
        .result-counts > div {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            padding: 0;
            border-bottom: 1px solid var(--app-border);
        }
        .result-counts dd {
            text-align: right;
            max-width: 65%;
            font-weight: 500;
            margin-top: 0;
        }
    }

    .receipt-table {
        font-size: 12px;
    }
    .receipt-table :deep(.p-datatable-thead > tr > th) {
        font-size: 11px;
        padding: 12px 8px;
        background: var(--app-bg);
    }
    .receipt-table :deep(.p-datatable-tbody > tr > td) {
        padding: 16px 8px;
        overflow-wrap: anywhere;
        max-width: 220px;
    }
    .receipt-rows {
        display: none;
    }
    @media (max-width: 640px) {
        .receipt-table {
            display: none;
        }
        .receipt-rows {
            display: grid;
        }
    }

    :global(html:not(.p-dark)) .import-result {
        --app-text: #191c1e;
        --app-muted: #3e4947;
        --app-border: #bdc9c699;
        --app-bg: #f7f9fb;
        --app-surface: #fff;
    }
    .import-result :deep(.p-tag) {
        font-size: 11px;
        line-height: 16px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 12%,
            var(--app-surface)
        );
    }
    .import-result :deep(.p-tag-warn) {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .receipt-badges :deep(.p-tag) {
        border-radius: 999px;
        padding: 3px 8px;
    }
    .receipt-summary :deep(.p-tag-secondary),
    .receipt-badges :deep(.p-tag-secondary) {
        color: var(--app-muted);
        background: var(--app-bg);
    }
    .import-result :deep(.p-button) {
        min-height: 44px;
        padding: 8px 12px;
        font-size: 13px;
        line-height: 18px;
        border-radius: 8px;
    }
    .receipt-filters :deep(.p-button) {
        min-height: 32px;
        padding: 6px 8px;
        font-size: 11px;
        line-height: 16px;
    }
    .receipt-row-type {
        border-radius: 999px;
        padding: 3px 8px;
        background: var(--app-bg);
        font-size: 11px;
        line-height: 16px;
    }
    .receipt-type-buy {
        color: var(--app-up);
        background: color-mix(in srgb, var(--app-up) 10%, var(--app-surface));
    }
    .receipt-type-sell {
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 12%,
            var(--app-surface)
        );
    }
    .receipt-type-dividend {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .receipt-row.duplicate .receipt-row-values strong {
        text-decoration: line-through;
        color: var(--app-muted);
    }

    .receipt-card {
        display: contents;
    }
    .receipt-card :deep(.p-card-body) {
        display: contents;
    }
    .receipt-card :deep(.p-card-content) {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .receipt-side {
        display: flex;
        flex-direction: column;
        gap: 16px;
        order: 3;
        min-width: 0;
    }
    .receipt-overview {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-detail {
        min-width: 0;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-finance {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-currencies {
        grid-template-columns: minmax(0, 1fr);
    }
    .receipt-next {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .result-actions {
        grid-template-columns: minmax(0, 1fr);
    }
    .receipt-refresh {
        margin: 0;
    }
    @media (min-width: 768px) {
        .receipt-card :deep(.p-card-content) {
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            grid-template-rows: min-content 1fr;
            gap: 20px;
            align-items: start;
        }
        .receipt-overview {
            grid-column: 1 / span 7;
            grid-row: 1;
        }
        .receipt-detail {
            grid-column: 1 / span 7;
            grid-row: 2;
        }
        .receipt-side {
            grid-column: 8 / span 5;
            grid-row: 1 / span 2;
        }
        .receipt-summary {
            flex-wrap: wrap;
        }
        .result-counts {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
        }
        .result-counts > div {
            display: flex;
            gap: 8px;
        }
        .result-counts dd {
            margin: 0;
            font-weight: 500;
        }
        .receipt-detail-title {
            display: none;
        }
    }
    @media (max-width: 640px) {
        .receipt-side {
            order: 1;
        }
        .receipt-overview,
        .receipt-finance,
        .receipt-next {
            padding: 0;
            border: 0;
            background: transparent;
        }
        .receipt-detail {
            padding: 0;
            border: 0;
            background: transparent;
        }
        .receipt-summary {
            padding: 12px;
        }
    }
    .receipt-scroll-hint {
        font-size: 11px;
        color: var(--app-muted);
        text-align: right;
        margin: 4px 0 8px;
    }
    @media (max-width: 640px) {
        .receipt-scroll-hint {
            display: none;
        }
    }
    .receipt-currency-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .receipt-currency-title > span {
        font-size: 11px;
        color: var(--app-muted);
    }

    /* Match the source's actual step hierarchy and metric-sized icon outlines. */
    .receipt-badges {
        gap: 8px;
    }
    .receipt-badges :deep(.p-tag) {
        font-size: 12px;
        line-height: 16px;
        padding: 4px 10px;
        border: 1px solid color-mix(in srgb, var(--app-accent) 30%, transparent);
    }
    .receipt-badges :deep(.p-tag-warn) {
        border-color: var(--p-yellow-400);
    }
    .receipt-badges :deep(.p-tag-secondary) {
        border-color: var(--app-border);
    }
    .receipt-steps {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }
    .receipt-steps li {
        gap: 12px;
    }
    .receipt-step-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border: 1px solid var(--app-accent);
        border-radius: 50%;
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 15%,
            var(--app-surface)
        );
        font-size: 18px;
    }
    [aria-current='step'] .receipt-step-icon {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        box-shadow: 0 0 0 2px
            color-mix(in srgb, var(--app-accent) 20%, transparent);
    }
    .receipt-step-text {
        display: flex;
        flex-direction: column;
    }
    .receipt-step-index {
        font-size: 11px;
        line-height: 16.5px;
        font-weight: 500;
        color: var(--app-muted);
    }
    .receipt-step-text strong {
        font-size: 12px;
        line-height: 16px;
        font-weight: 600;
    }
    .receipt-steps li:last-child {
        justify-content: flex-end;
    }
    .receipt-steps li:last-child .receipt-step-text {
        text-align: right;
    }
    .receipt-context {
        padding-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .result-heading {
        gap: 8px;
    }
    .result-heading h2 {
        color: var(--receipt-title, var(--app-brand-brown));
    }
    :global(.p-dark) .result-heading h2 {
        color: var(--app-text);
    }
    .receipt-summary {
        padding: 0;
        background: transparent;
        border: 0;
        align-items: flex-start;
        flex-wrap: nowrap;
    }
    .receipt-summary-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-size: 24px;
        width: 40px;
        height: 40px;
        background: color-mix(
            in srgb,
            var(--app-accent) 12%,
            var(--app-surface)
        );
        color: var(--app-accent);
        border-radius: 8px;
    }
    .receipt-summary h3 {
        font-size: 16px;
        line-height: 22px;
    }
    .receipt-summary p {
        font-size: 11px;
        line-height: 18px;
    }
    .result-counts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        padding-top: 12px;
        border-top: 1px solid var(--app-border);
        margin: 12px 0 0;
    }
    .result-counts > div {
        display: flex;
        gap: 6px;
        padding: 0;
        border: 0;
        background: transparent;
    }
    .result-counts > div:last-child {
        flex-basis: 100%;
    }
    .result-counts dt,
    .result-counts dd {
        font-size: 11px;
        line-height: 18px;
    }
    .result-counts dd {
        margin: 0;
        font-weight: 500;
        max-width: none;
        text-align: left;
    }
    .result-explanation {
        margin: 12px 0 0;
        font-size: 12px;
        line-height: 20px;
    }
    .receipt-finance-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--app-border);
        margin-bottom: 16px;
    }
    .receipt-finance-title h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        line-height: 20px;
    }
    .receipt-finance-title h3 .stitch-symbol {
        font-size: 20px;
        color: var(--app-accent);
    }
    .receipt-finance-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 11px;
        line-height: 16px;
        background: var(--app-bg);
        padding: 8px;
        border-radius: 6px;
        margin: 16px 0 0;
    }
    .receipt-finance-note .stitch-symbol {
        font-size: 14px;
        margin-top: 1px;
    }
    .receipt-currencies > article {
        padding: 12px;
        background: var(--app-bg);
        border-radius: 8px;
    }
    .receipt-currency-title {
        font-size: 12px;
        line-height: 18px;
    }
    .receipt-currencies dl {
        margin-top: 12px;
        gap: 8px;
    }
    .receipt-warning-icon {
        font-size: 24px;
        color: var(--app-warning-text);
        margin-top: 2px;
    }
    .receipt-next :deep(.p-button .stitch-symbol),
    .receipt-refresh :deep(.p-button .stitch-symbol) {
        font-size: 18px;
    }
    @media (max-width: 640px) {
        .receipt-header {
            padding-top: 8px;
        }
        .receipt-badges {
            gap: 6px;
        }
        .receipt-badges :deep(.p-tag) {
            font-size: 11px;
            line-height: 16px;
            padding: 2px 8px;
            border: 0;
        }
        .receipt-badges :deep(.p-tag-warn) {
            border: 1px solid var(--p-yellow-400);
        }
        .receipt-steps {
            gap: 0;
        }
        .receipt-steps li {
            gap: 4px;
            justify-content: flex-start;
        }
        .receipt-steps li:last-child {
            justify-content: flex-start;
        }
        .receipt-step-icon {
            width: 24px;
            height: 24px;
            font-size: 14px;
        }
        .receipt-step-text {
            display: block;
            font-size: 11px;
            line-height: 16px;
            text-align: center;
        }
        .receipt-step-index,
        .receipt-step-text strong {
            font-size: 11px;
            line-height: 16px;
            font-weight: 500;
        }
        .receipt-step-complete {
            display: none;
        }
        .receipt-steps li:last-child .receipt-step-text {
            text-align: center;
        }
        .receipt-context {
            padding: 0 2px;
        }
        .result-heading {
            flex-wrap: nowrap;
        }
        .result-heading h2 {
            flex: 1;
            min-width: 0;
            color: var(--app-text);
        }
        .result-heading :deep(.p-tag) {
            flex-shrink: 0;
            white-space: nowrap;
        }
        .receipt-summary {
            padding: 12px;
            border: 1px solid var(--app-border);
            border-radius: 8px;
            background: var(--app-bg);
            gap: 12px;
            flex-wrap: wrap;
        }
        .receipt-summary-icon {
            width: 32px;
            height: 32px;
            font-size: 18px;
            border-radius: 50%;
            background: var(--app-accent);
            color: var(--app-accent-contrast);
        }
        .receipt-summary h3 {
            font-size: 15px;
            line-height: 20px;
        }
        .result-counts {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            border: 0;
            margin-top: 12px;
            padding-top: 0;
            gap: 0;
        }
        .result-counts > div {
            justify-content: space-between;
            padding: 6px 0;
            border-bottom: 1px solid var(--app-border);
        }
        .result-counts dd {
            max-width: 65%;
            text-align: right;
        }
        .receipt-finance-title {
            margin-bottom: 12px;
            padding-bottom: 0;
            border: 0;
        }
        .receipt-finance-title h3 {
            font-size: 15px;
        }
    }
    :global(html:not(.p-dark)) .import-result {
        --receipt-title: #382418;
    }
    .receipt-next h3 {
        font-size: 14px;
        line-height: 20px;
    }
    .receipt-another {
        min-height: 40px;
    }
    @media (max-width: 640px) {
        .receipt-next h3 {
            font-size: 15px;
        }
        .receipt-another {
            min-height: 44px;
        }
    }

    .receipt-badges .stitch-symbol {
        font-size: 14px;
    }
    .result-counts dt {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .result-counts dt .stitch-symbol {
        font-size: 13px;
        color: var(--app-muted);
    }
    @media (min-width: 641px) {
        .receipt-badges :deep(.p-tag:first-child)::before {
            content: '';
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--app-accent);
            margin-inline-end: 2px;
        }
    }
    @media (max-width: 640px) {
        .result-counts dt .stitch-symbol {
            display: none;
        }
        .receipt-badges .stitch-symbol {
            font-size: 13px;
        }
    }

    .receipt-next h3 {
        font-size: 12px;
        line-height: 16px;
    }
    .result-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
    }
    .receipt-next :deep(.p-button),
    .receipt-refresh :deep(.p-button) {
        min-height: 40px;
        font-size: 12px;
        line-height: 16px;
        padding: 8px 12px;
    }
    .receipt-lock-help {
        font-size: 11px;
        line-height: 13.75px;
        margin: 8px 0 10px;
        color: var(--app-muted);
    }
    .receipt-export-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        border-top: 1px solid var(--app-border);
        padding-top: 8px;
        margin-top: 10px;
    }
    .receipt-export-actions .receipt-footnote {
        font-size: 11px;
        line-height: 16px;
        margin: 0;
    }
    .receipt-export-actions .receipt-another {
        margin: 0;
    }
    .receipt-summary h3,
    .receipt-finance-title h3,
    .receipt-next h3 {
        color: var(--receipt-title, var(--app-text));
    }
    @media (min-width: 641px) {
        :global(html:not(.p-dark)) .import-result {
            --app-border: #e2e8f0;
            --app-muted: #64748b;
        }
        :global(html:not(.p-dark)) .receipt-description {
            color: #475569;
        }
    }
    @media (max-width: 640px) {
        .receipt-next h3 {
            font-size: 15px;
            line-height: 20px;
        }
        .receipt-next :deep(.p-button),
        .receipt-refresh :deep(.p-button) {
            min-height: 44px;
            font-size: 13px;
            line-height: 18px;
        }
        .receipt-summary h3,
        .receipt-finance-title h3,
        .receipt-next h3 {
            color: var(--app-text);
        }
    }

    /* The source separates the final metric with a rule; use its measured type rhythm. */
    .receipt-currency-title {
        font-size: 12px;
        line-height: 16px;
    }
    .receipt-currencies {
        gap: 16px;
    }
    .receipt-currencies dl {
        margin-top: 8px;
        gap: 6px;
        font-size: 12px;
        line-height: 16px;
    }
    .receipt-currencies dl > div:last-child:not(:first-child) {
        border-top: 1px solid var(--app-border);
        padding-top: 8px;
        margin-top: 2px;
    }
    .receipt-finance > .receipt-finance-note {
        font-size: 11px;
        line-height: 13.75px;
    }
    @media (max-width: 640px) {
        .receipt-currency-title {
            font-size: 13px;
            line-height: 18px;
        }
        .receipt-currencies {
            gap: 8px;
        }
        .receipt-currencies dl {
            padding-top: 4px;
            border-top: 1px solid var(--app-border);
            font-size: 13px;
            line-height: 19.5px;
            gap: 4px;
        }
        .receipt-currencies dl > div:last-child:not(:first-child) {
            border: 0;
            padding-top: 0;
            margin-top: 0;
        }
    }

    .receipt-symbol-name {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
        margin: 0;
        font-weight: 400;
    }
    .receipt-table .receipt-row-type {
        display: inline-block;
        margin: 0;
        border: 1px solid currentColor;
    }
    .receipt-table :deep(.p-datatable-tbody > tr > td) {
        padding: 10px 12px;
        font-size: 12px;
        line-height: 16px;
    }
    @media (max-width: 640px) {
        .receipt-row {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .receipt-row-type {
            padding: 2px 8px;
        }
        .receipt-row-values {
            margin: 0;
            padding-top: 2px;
            line-height: 18.75px;
        }
        .receipt-row-values strong {
            display: block;
            font-size: 15px;
            line-height: 18.75px;
        }
        .receipt-row-values p {
            font-size: 11px;
            line-height: 16px;
            margin: 0;
        }
        .receipt-row-values > .receipt-row-symbol {
            text-align: left;
        }
    }

    [aria-current='step'] .receipt-step-index {
        color: var(--app-accent);
        font-weight: 700;
    }
    [aria-current='step'] .receipt-step-text strong {
        color: var(--receipt-title, var(--app-text));
    }
    @media (max-width: 640px) {
        [aria-current='step'] .receipt-step-text strong {
            color: var(--app-accent);
            font-weight: 700;
        }
    }

    .receipt-followup {
        display: contents;
    }
    @media (max-width: 640px) {
        .import-result {
            padding-bottom: 48px;
        }
        .receipt-workflow,
        .receipt-side {
            display: contents;
        }
        .receipt-overview,
        .receipt-finance {
            padding: 16px;
            border: 1px solid var(--app-border);
            border-radius: 12px;
            background: var(--app-surface);
        }
        .receipt-overview {
            order: 0;
        }
        .receipt-finance {
            order: 1;
        }
        .receipt-followup {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-top: 4px;
            order: 2;
            min-width: 0;
        }
        .receipt-followup .receipt-refresh,
        .receipt-followup .receipt-next {
            padding: 14px;
            border: 1px solid var(--app-border);
            border-radius: 12px;
        }
        .receipt-followup .receipt-refresh {
            border-color: var(--p-yellow-400);
        }
        .receipt-detail {
            padding-top: 8px;
        }
    }

    @media (min-width: 641px) {
        .receipt-detail {
            padding: 0;
            overflow: hidden;
        }
        .receipt-table-controls {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            padding: 14px;
            background: var(--app-bg);
            border-bottom: 1px solid var(--app-border);
        }
        .receipt-table-controls .receipt-filters {
            flex: 0 1 auto;
            padding: 2px;
            gap: 0;
        }
        .receipt-table-controls .receipt-filters :deep(.p-button) {
            border: 0;
            min-height: 24px;
            padding: 4px 10px;
            font-size: 12px;
            line-height: 16px;
        }
        .receipt-table-controls .receipt-scroll-hint {
            display: flex;
            align-items: center;
            gap: 4px;
            margin: 0;
            padding: 2px 8px;
            border: 1px solid var(--app-border);
            border-radius: 4px;
            background: var(--app-surface);
            font-size: 11px;
            line-height: 16px;
        }
        .receipt-scroll-hint .stitch-symbol {
            font-size: 13px;
            color: var(--app-accent);
        }
        .receipt-detail > .receipt-footnote {
            margin: 0;
            padding: 10px 14px;
            border-top: 1px solid var(--app-border);
            background: var(--app-bg);
            line-height: 16.5px;
        }
    }
</style>
