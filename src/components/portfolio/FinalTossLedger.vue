<script setup>
    import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
    import Select from 'primevue/select';
    import { firebaseUser } from '@/services/firebaseClient.js';
    import { createSheetReportClient } from '@/services/sheetReports.js';
    import { useDocumentLedgerWindow } from '@/composables/useDocumentLedgerWindow.js';
    import {
        filterFinalRows,
        summarizeFinalRows,
    } from '../../../lib/final-ledger-view.js';

    const client = createSheetReportClient();
    const selectPt = {
        root: {
            style: {
                background: 'var(--app-surface)',
                color: 'var(--app-text)',
            },
        },
        label: { style: { color: 'var(--app-text)' } },
    };
    const fieldStyle = {
        background: 'var(--app-surface)',
        color: 'var(--app-text)',
    };
    const detailLabels = {
        symbol: '종목',
        securityCode: '종목 코드',
        eventType: '거래 유형',
        orderType: '주문 유형',
        orderStatus: '주문 상태',
        currency: '통화',
        orderedAt: '주문 시각',
        finalFilledAt: '최종 체결 시각',
        recordedDate: '기록일',
        filledQuantity: '체결 수량',
        requestedQuantity: '주문 수량',
        recordedQuantity: '기록 수량',
        averageFilledPrice: '평균 체결가',
        executionAmount: '총 체결 금액',
        orderAmountUsd: '주문 금액',
        commission: '수수료',
        tax: '세금',
        netDividendUsd: '세후 배당',
        grossDividendUsd: '세전 배당',
        paidAt: '실제 입금 시각',
        originalTransactionId: '원문 거래 ID',
        statementNativeTransactionAmount: '명세서 원통화 거래금액',
        statementSettlementAmountNative: '명세서 원통화 정산금액',
        statementSettlementAmountKrw: '명세서 원화 정산금액',
        recordedExchangeRate: '기록 환율',
    };
    const snapshot = shallowRef(null),
        busy = ref(false),
        error = ref('');
    const scope = ref('wife'),
        type = ref(''),
        currency = ref(''),
        search = ref(''),
        from = ref(''),
        to = ref('');
    const sort = ref('date'),
        direction = ref(-1),
        region = ref(null),
        table = ref(null);
    const selected = ref(null),
        detail = shallowRef(null),
        detailBusy = ref(false),
        detailError = ref('');
    let generation = 0,
        detailGeneration = 0;
    const labels = {
        BUY: '매수',
        SELL: '매도',
        DIVIDEND: '배당',
        TAX_REFUND: '세금환급',
        CANCELED: '미체결 취소',
    };
    const scopes = [
        { label: '아내', value: 'wife' },
        { label: '계좌 미지정 명세서', value: 'unassigned' },
    ];
    const types = [
        { label: '전체 거래', value: '' },
        ...Object.entries(labels).map(([value, label]) => ({ label, value })),
    ];
    const currencies = [
        { label: '전체 통화', value: '' },
        { label: 'USD', value: 'USD' },
        { label: 'KRW', value: 'KRW' },
    ];
    const columns = [
        { key: 'date', label: '체결·기록일' },
        { key: 'symbol', label: '종목' },
        { key: 'type', label: '유형' },
        { key: 'quantity', label: '수량' },
        { key: 'unitPrice', label: '단가' },
        { key: 'amount', label: '금액' },
        { key: 'commission', label: '수수료' },
        { key: 'tax', label: '세금' },
    ];
    const sourceRows = computed(() =>
        snapshot.value
            ? scope.value === 'wife'
                ? snapshot.value.rows
                : snapshot.value.unassignedRows
            : []
    );
    const filtered = computed(() =>
        filterFinalRows(sourceRows.value, {
            search: search.value,
            type: type.value,
            currency: currency.value,
            from: from.value,
            to: to.value,
            sort: sort.value,
            direction: direction.value,
        })
    );
    const summary = computed(() => summarizeFinalRows(filtered.value));
    const { renderedRows, paddingTop, paddingBottom, start, jump } =
        useDocumentLedgerWindow(filtered, region, table);
    const sourceOpen = computed({
        get: () => selected.value !== null,
        set: (value) => {
            if (!value) {
                selected.value = null;
                detail.value = null;
                detailGeneration++;
            }
        },
    });
    function number(value) {
        if (value === null || value === undefined) return '미제공';
        const [whole, fraction] = String(value).split('.');
        return (
            whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
            (fraction === undefined ? '' : '.' + fraction)
        );
    }
    function order(field) {
        if (sort.value === field) direction.value *= -1;
        else {
            sort.value = field;
            direction.value = field === 'date' ? -1 : 1;
        }
    }
    async function load(refresh = false) {
        const current = ++generation,
            user = firebaseUser.value;
        snapshot.value = null;
        error.value = '';
        busy.value = Boolean(user);
        selected.value = null;
        detail.value = null;
        detailGeneration++;
        if (!user) return;
        try {
            const result = await client.load(user, 'wife', 'final', {
                refresh,
            });
            if (current === generation && user === firebaseUser.value)
                snapshot.value = result;
        } catch (e) {
            if (current === generation) error.value = e.message;
        } finally {
            if (current === generation) busy.value = false;
        }
    }
    async function inspect(row) {
        const current = ++detailGeneration,
            user = firebaseUser.value;
        selected.value = row;
        detail.value = null;
        detailError.value = '';
        detailBusy.value = true;
        try {
            const result = await client.load(user, 'wife', 'final', {
                observationId: row.id,
            });
            if (current === detailGeneration && user === firebaseUser.value)
                detail.value = result.detail;
        } catch (e) {
            if (current === detailGeneration) detailError.value = e.message;
            if ([401, 403].includes(e.status)) {
                generation++;
                snapshot.value = null;
                error.value = e.message;
            }
        } finally {
            if (current === detailGeneration) detailBusy.value = false;
        }
    }
    watch(
        () => [
            firebaseUser.value,
            firebaseUser.value?.uid,
            firebaseUser.value?.email,
            firebaseUser.value?.emailVerified,
        ],
        () => {
            client.clear();
            scope.value = 'wife';
            type.value = '';
            currency.value = '';
            search.value = '';
            from.value = '';
            to.value = '';
            load();
        },
        { immediate: true }
    );
    watch(scope, () => {
        type.value = '';
        selected.value = null;
        detail.value = null;
        detailGeneration++;
    });
    onBeforeUnmount(() => {
        generation++;
        detailGeneration++;
        client.clear();
    });
</script>

<template>
    <main class="final-ledger">
        <header class="page-header">
            <div>
                <span class="eyebrow">관리자 · 거래 기록</span>
                <h1>토스 거래내역</h1>
                <p>
                    채택한 기준 내역과 검증된 신규 관측을 날짜와 통화별로
                    확인합니다.
                </p>
            </div>
            <Button
                label="새로고침"
                class="refresh-button"
                severity="secondary"
                :loading="busy"
                :disabled="busy"
                @click="load(true)" />
        </header>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <p v-if="busy" role="status">최종 거래내역을 불러오고 있습니다.</p>
        <p v-else-if="!firebaseUser">관리자 로그인 후 조회할 수 있습니다.</p>
        <template v-if="snapshot">
            <div class="version">
                <Tag value="기준 장부 채택" severity="success" /><span
                    >기준일 {{ snapshot.snapshotAt?.slice(0, 10) }}</span
                ><span>버전 {{ snapshot.releaseId.slice(0, 12) }}</span>
                <span v-if="snapshot.incrementEntryCount"
                    >검증된 증분 {{ snapshot.incrementRowCount }}행 · 기존
                    채택값 유지</span
                >
            </div>
            <section class="filters" aria-label="거래 필터">
                <label
                    >계좌<Select
                        v-model="scope"
                        :pt="selectPt"
                        :options="scopes"
                        option-label="label"
                        option-value="value"
                        aria-label="계좌"
                /></label>
                <label
                    >유형<Select
                        v-model="type"
                        :pt="selectPt"
                        placeholder="전체 거래"
                        :options="types"
                        option-label="label"
                        option-value="value"
                        aria-label="거래 유형"
                /></label>
                <label
                    >통화<Select
                        v-model="currency"
                        :pt="selectPt"
                        placeholder="전체 통화"
                        :options="currencies"
                        option-label="label"
                        option-value="value"
                        aria-label="통화"
                /></label>
                <label class="search"
                    >전체 검색<InputText
                        v-model="search"
                        :style="fieldStyle"
                        type="search"
                        aria-label="전체 거래 검색"
                        placeholder="종목 · 날짜 · 유형 · 출처"
                /></label>
                <label
                    >시작일<input
                        v-model="from"
                        type="date"
                        aria-label="시작일" /></label
                ><label
                    >종료일<input v-model="to" type="date" aria-label="종료일"
                /></label>
            </section>
            <p v-if="scope === 'unassigned'" class="scope-note">
                계좌가 지정되지 않은 명세서 기록입니다. 아내 거래 합계와 별도로
                표시합니다.
            </p>
            <p v-else class="scope-note">
                기존 채택 기록과 토스 신규 관측을 함께 표시합니다. 웹 배당은
                실제 입금액이며, 중복 여부가 미확정인 관측은 합계에서
                제외합니다. 금액은 각 행의 통화 기준입니다.
            </p>
            <section class="summary" aria-label="현재 목록 요약">
                <article>
                    <span>현재 목록</span
                    ><strong>{{ filtered.length.toLocaleString() }}건</strong>
                </article>
                <article v-for="item in summary" :key="item.key">
                    <span
                        >{{ labels[item.type] }}
                        {{ item.type === 'DIVIDEND' ? '세후 기록액' : '금액' }}
                        · {{ item.currency }}</span
                    ><strong>{{ number(item.amount) }}</strong
                    ><small
                        >{{ item.count }}건<span v-if="item.missingAmount">
                            · 금액 미제공 {{ item.missingAmount }}건</span
                        ></small
                    >
                </article>
            </section>
            <section ref="region" aria-label="최종 거래 목록">
                <div class="list-heading">
                    <h2>거래 목록</h2>
                    <div>
                        <Button label="처음" text @click="jump(false)" /><Button
                            label="마지막"
                            text
                            @click="jump(true)" />
                    </div>
                </div>
                <p v-if="!filtered.length" role="status">
                    조건에 맞는 기록이 없습니다.
                </p>
                <div class="table-wrap">
                    <table ref="table" :aria-rowcount="filtered.length + 1">
                        <thead>
                            <tr>
                                <th
                                    v-for="col in columns"
                                    :key="col.key"
                                    :aria-sort="
                                        sort === col.key
                                            ? direction === 1
                                                ? 'ascending'
                                                : 'descending'
                                            : 'none'
                                    ">
                                    <button
                                        type="button"
                                        @click="order(col.key)">
                                        {{ col.label
                                        }}<span v-if="sort === col.key">{{
                                            direction === 1 ? ' ↑' : ' ↓'
                                        }}</span>
                                    </button>
                                </th>
                                <th>통화</th>
                                <th>출처</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="paddingTop" aria-hidden="true">
                                <td
                                    colspan="10"
                                    :style="{
                                        height: `${paddingTop}px`,
                                        padding: 0,
                                    }"></td>
                            </tr>
                            <tr
                                v-for="(row, index) in renderedRows"
                                :key="row.id"
                                :data-ledger-index="start + index"
                                :aria-rowindex="start + index + 2">
                                <td>
                                    {{ row.date || '미제공'
                                    }}<small>{{ row.dateRole }}</small>
                                </td>
                                <td>
                                    <strong>{{ row.symbol || '—' }}</strong>
                                    <small v-if="row.increment">{{
                                        row.sourceLabel
                                    }}</small>
                                </td>
                                <td>
                                    {{ labels[row.type]
                                    }}<small v-if="row.state !== '거래'">{{
                                        row.state
                                    }}</small>
                                </td>
                                <td>{{ number(row.quantity) }}</td>
                                <td>{{ number(row.unitPrice) }}</td>
                                <td>
                                    {{ number(row.amount)
                                    }}<small>{{ row.amountMeaning }}</small>
                                </td>
                                <td>{{ number(row.commission) }}</td>
                                <td>
                                    {{ number(row.tax)
                                    }}<small v-if="row.taxDerived"
                                        >계산값</small
                                    >
                                </td>
                                <td>{{ row.currency }}</td>
                                <td>
                                    <Button
                                        label="출처"
                                        text
                                        size="small"
                                        :aria-label="`${row.symbol} ${row.date} 출처`"
                                        @click="inspect(row)" />
                                </td>
                            </tr>
                            <tr v-if="paddingBottom" aria-hidden="true">
                                <td
                                    colspan="10"
                                    :style="{
                                        height: `${paddingBottom}px`,
                                        padding: 0,
                                    }"></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </template>
        <Dialog
            v-model:visible="sourceOpen"
            modal
            header="거래 출처"
            :style="{ width: 'min(46rem, 94vw)' }"
            :draggable="false"
            ><p v-if="detailBusy" role="status">출처를 불러오고 있습니다.</p>
            <Message v-if="detailError" severity="error" :closable="false">{{
                detailError
            }}</Message
            ><template v-if="detail"
                ><p>
                    {{ detail.sourceLabel }} · {{ detail.accountAssignment }}
                </p>
                <dl>
                    <template v-for="field in detail.fields" :key="field.field"
                        ><dt>
                            {{ detailLabels[field.field] || field.field
                            }}<small v-if="field.calculated">계산값</small>
                        </dt>
                        <dd>
                            {{ field.value }} {{ field.unit || '' }}
                        </dd></template
                    >
                </dl>
                <p>
                    개별 체결 ID·실제 환율·실제 결제 시각은 제공된 값이 없으면
                    표시하지 않습니다.
                </p></template
            ></Dialog
        >
    </main>
</template>

<style scoped>
    .final-ledger {
        max-width: 1500px;
        margin: 0 auto;
        padding: 2rem 1.25rem 5rem;
        color: var(--p-text-color);
    }
    .page-header,
    .list-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }
    .refresh-button {
        flex-shrink: 0;
        white-space: nowrap;
    }
    .eyebrow {
        font-size: 0.8rem;
        color: var(--p-text-muted-color);
    }
    h1 {
        font-size: 1.8rem;
        margin: 0.45rem 0;
    }
    h2 {
        font-size: 1.15rem;
    }
    p {
        color: var(--p-text-muted-color);
        line-height: 1.6;
    }
    .version {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
        font-size: 0.85rem;
        margin: 1rem 0;
    }
    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        padding: 1.25rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: 12px;
        background: var(--p-content-background);
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        font-size: 0.85rem;
    }
    label.search {
        flex: 1;
        min-width: 180px;
    }
    input[type='date'] {
        padding: 0.65rem;
        border: 1px solid var(--p-form-field-border-color);
        border-radius: 6px;
        background: var(--p-form-field-background);
        color: var(--p-text-color);
        font: inherit;
    }
    .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin: 1.25rem 0;
    }
    .summary article {
        padding: 1rem 1.25rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: 12px;
        flex: 1;
        min-width: 170px;
    }
    .summary span,
    .summary small {
        font-size: 0.8rem;
        color: var(--p-text-muted-color);
    }
    .summary strong {
        display: block;
        font-size: 1.3rem;
        margin: 0.6rem 0;
        font-variant-numeric: tabular-nums;
    }
    .table-wrap {
        overflow-x: auto;
        max-width: 100%;
        border: 1px solid var(--p-content-border-color);
        border-radius: 10px;
    }
    table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.85rem;
    }
    th,
    td {
        text-align: left;
        padding: 0.9rem 0.75rem;
        border-bottom: 1px solid var(--p-content-border-color);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }
    th {
        background: var(--p-content-hover-background);
    }
    th button {
        font: inherit;
        border: 0;
        background: none;
        color: inherit;
        cursor: pointer;
        padding: 0;
    }
    td small {
        display: block;
        color: var(--p-text-muted-color);
        font-size: 0.7rem;
        margin-top: 0.3rem;
    }
    .scope-note {
        font-size: 0.85rem;
    }
    dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.6rem;
        font-size: 0.9rem;
    }
    dt,
    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
    dt {
        color: var(--p-text-muted-color);
    }
    dt small {
        display: block;
    }
    @media (max-width: 600px) {
        .final-ledger {
            padding: 1.25rem 0.75rem 5rem;
        }
        .page-header {
            align-items: flex-start;
        }
        h1 {
            font-size: 1.5rem;
        }
        .filters {
            padding: 0.9rem;
            gap: 0.8rem;
        }
        .filters label {
            flex: 1;
            min-width: 125px;
        }
        .summary {
            gap: 0.6rem;
        }
        .summary article {
            min-width: 135px;
            padding: 0.8rem;
        }
        .version {
            gap: 0.6rem;
        }
        .summary strong {
            font-size: 1.15rem;
        }
    }
</style>
