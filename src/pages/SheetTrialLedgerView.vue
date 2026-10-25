<script setup>
    import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
    import Select from 'primevue/select';
    import { useDocumentLedgerWindow } from '@/composables/useDocumentLedgerWindow.js';
    import SheetReconciliationPanel from '@/components/portfolio/SheetReconciliationPanel.vue';
    import {
        comparisonFields,
        extraFields,
    } from '../../lib/sheet-reconciliation.js';
    import { firebaseUser } from '@/services/firebaseClient.js';
    import { createSheetLedgerClient } from '@/services/sheetLedger.js';
    import {
        accounts,
        fundingSources,
        numericFields,
        statuses,
        summarize,
        types,
    } from '../../lib/sheet-ledger.js';

    const client = createSheetLedgerClient();
    const rows = ref([]),
        observations = ref([]),
        archives = ref([]),
        evidencePreview = ref(null),
        version = ref(0),
        busy = ref(false),
        progress = ref(''),
        error = ref(''),
        notice = ref('');
    const account = ref(null),
        type = ref(null),
        status = ref(null),
        search = ref(''),
        editing = ref(null);
    const editOpen = computed({
        get: () => Boolean(editing.value),
        set: (open) => {
            if (!open) editing.value = null;
        },
    });
    let generation = 0;
    const creating = ref(false),
        manualRequestId = ref(null),
        addedId = ref(null);
    const sortField = ref('date'),
        sortOrder = ref(-1),
        listRegion = ref(null),
        tableElement = ref(null);
    const labels = {
        quantity: '수량(주)',
        unitPriceUsd: '매수단가($)',
        unitPriceKrw: '매수단가(₩)',
        purchaseUsd: '거래금액($)',
        purchaseKrw: '거래금액(₩)',
        exchangeRate: '환율(₩/$)',
        netDividendUsd: '세후 배당($)',
        netDividendKrw: '세후 배당(₩)',
        grossDividendUsd: '세전 배당($)',
        grossDividendKrw: '세전 배당(₩)',
        dividendPerShare: '주당 배당($)',
        commissionUsd: '거래수수료($)',
        commissionKrw: '거래수수료(₩)',
        taxUsd: '원천징수세($)',
        taxKrw: '원천징수세(₩)',
        fxFeeUsd: '환전비용($)',
        fxFeeKrw: '환전비용(₩)',
        ...extraFields,
    };
    const typeLabels = {
        BUY: '매수',
        SELL: '매도',
        DIVIDEND: '배당',
        FEE: '비용',
        DEPOSIT: '입금',
        WITHDRAWAL: '출금',
        FX: '환전',
    };
    const activeRows = computed(() => rows.value);
    const additionalColumns = computed(() =>
        Object.keys(extraFields).filter(
            (field) =>
                !numericFields.includes(field) &&
                (activeRows.value.some((r) => r[field] != null) ||
                    observations.value.some((o) => o.values[field] != null))
        )
    );
    const filtered = computed(() =>
        activeRows.value.filter(
            (r) =>
                (!account.value || r.accountId === account.value) &&
                (!type.value || r.type === type.value) &&
                (!status.value ||
                    (status.value === '검토 필요'
                        ? r.needsReview
                        : r.status === status.value)) &&
                (!search.value ||
                    `${r.symbol} ${r.source.sheet} ${r.id}`
                        .toLowerCase()
                        .includes(search.value.toLowerCase()))
        )
    );
    const summary = computed(() => summarize(filtered.value));

    const sortedRows = computed(() =>
        [...filtered.value].sort((a, b) => {
            const x = a[sortField.value],
                y = b[sortField.value];
            if (x == null || y == null)
                return x == null && y == null
                    ? a.id.localeCompare(b.id)
                    : x == null
                      ? 1
                      : -1;
            return (
                (typeof x === 'number' && typeof y === 'number'
                    ? x - y
                    : String(x).localeCompare(String(y))) * sortOrder.value ||
                a.id.localeCompare(b.id)
            );
        })
    );
    const {
        start: windowStart,
        renderedRows,
        paddingTop,
        paddingBottom,
        rowAttributes,
        jump,
    } = useDocumentLedgerWindow(sortedRows, listRegion, tableElement);
    watch(editing, (value) => {
        if (!value) {
            creating.value = false;
            manualRequestId.value = null;
        }
    });
    function sortList(event) {
        sortField.value = event.sortField;
        sortOrder.value = event.sortOrder;
    }
    function addManual() {
        creating.value = true;
        manualRequestId.value = crypto.randomUUID();
        error.value = '';
        editing.value = {
            ...Object.fromEntries(numericFields.map((f) => [f, null])),
            accountId: account.value,
            type: 'BUY',
            symbol: '',
            date: null,
            exDate: null,
            paymentDate: null,
            transactionAt: null,
            timeZone: null,
            fundingSource: '미확인',
            reinvested: null,
            status: '미확인',
            note: '',
        };
    }
    function showAdded() {
        account.value = null;
        type.value = null;
        status.value = null;
        search.value = addedId.value;
    }

    const money = (value, currency = 'USD') =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'KRW' ? 0 : 2,
        }).format(value);
    function display(value, field) {
        if (value == null) return '미확인';
        return new Intl.NumberFormat('ko-KR', {
            maximumFractionDigits:
                field === 'quantity' || field === 'dividendPerShare'
                    ? 6
                    : field.endsWith('Krw')
                      ? 0
                      : 4,
        }).format(value);
    }
    async function run(operation, message = '') {
        if (busy.value) return;
        const current = generation;
        busy.value = true;
        progress.value = message;
        error.value = '';
        notice.value = '';
        try {
            await operation(current);
        } catch (e) {
            if (current === generation) {
                error.value = e.message;
            }
        } finally {
            if (current === generation) {
                busy.value = false;
                progress.value = '';
            }
        }
    }
    function apply(result) {
        rows.value = result.rows;
        version.value = result.version;
        observations.value = result.observations || [];
        archives.value = result.archives || [];
        evidencePreview.value = null;
    }
    async function load() {
        await run(async (current) => {
            const result = await client.load(firebaseUser.value);
            if (current === generation) apply(result);
        }, '시험 장부를 불러오는 중입니다.');
    }
    async function save() {
        await run(async (current) => {
            const isNew = creating.value;
            const draft = editing.value;
            const body = isNew
                ? {
                      action: 'add-manual',
                      version: version.value,
                      requestId: manualRequestId.value,
                      data: {
                          accountId: draft.accountId,
                          type: draft.type,
                          symbol: draft.symbol,
                          note: draft.note || '',
                          values: Object.fromEntries(
                              comparisonFields
                                  .filter((f) => Object.hasOwn(draft, f))
                                  .map((f) => [
                                      f,
                                      draft[f] === '' ? null : draft[f],
                                  ])
                          ),
                      },
                  }
                : { id: draft.id, version: version.value, patch: draft };
            const result = await client.mutate(
                firebaseUser.value,
                isNew ? 'POST' : 'PATCH',
                body
            );
            if (current === generation) {
                apply(result);
                editing.value = null;
                if (isNew) addedId.value = result.addedId;
                notice.value = isNew
                    ? '수동 거래를 시험 장부에 추가했습니다. 원본 대조 전 검토 필요 상태입니다.'
                    : '거래를 수정했습니다.';
            }
        });
    }
    async function reconcile(command) {
        await run(async (current) => {
            const result = await client.mutate(firebaseUser.value, 'POST', {
                ...command,
                version: version.value,
            });
            if (current !== generation) return;
            if (command.action === 'batch-preview')
                evidencePreview.value = result;
            else {
                apply(result);
                notice.value =
                    command.action === 'batch-commit'
                        ? `${result.importedEvidence}건의 대조 자료를 저장했습니다. 거래값은 자동 변경하지 않았습니다.`
                        : '시험 장부의 관리자 검토를 반영했습니다. 원본 자료는 유지됩니다.';
            }
        }, '시험 장부의 출처 대조를 처리하는 중입니다.');
    }
    async function inspectObservation(observation) {
        await run(async (current) => {
            const detailed = await client.detail(
                firebaseUser.value,
                observation
            );
            if (current !== generation) return;
            observations.value = observations.value.map((o) =>
                o.id === detailed.id ? { ...o, ...detailed } : o
            );
        }, '보존된 관측 원문을 확인하는 중입니다.');
    }
    async function downloadArchive(id) {
        await run(async (current) => {
            const result = await client.archive(firebaseUser.value, id);
            if (current !== generation) return;
            const objectUrl = URL.createObjectURL(
                new Blob([JSON.stringify(result.archive, null, 2)], {
                    type: 'application/json',
                })
            );
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `sheet-source-${id.slice(0, 12)}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }, '보존 원본을 내려받는 중입니다.');
    }
    watch(
        () =>
            firebaseUser.value
                ? `${firebaseUser.value.uid}:${firebaseUser.value.email}:${firebaseUser.value.emailVerified}`
                : null,
        () => {
            generation++;
            client.clear();
            rows.value = [];
            observations.value = [];
            archives.value = [];
            evidencePreview.value = null;
            editing.value = null;
            busy.value = false;
            progress.value = '';
            if (firebaseUser.value) load();
        }
    );
    onMounted(load);
    onBeforeUnmount(() => {
        generation++;
        client.clear();
    });
</script>

<template>
    <main class="trial-ledger">
        <header>
            <div>
                <span class="eyebrow">관리자 · 시험 계좌</span>
                <h1>부부 거래 목록</h1>
                <p>
                    남편과 아내의 매수·배당을 시간순으로 확인하고, 빠진 비용과
                    자금 출처를 정리하세요.
                </p>
            </div>
            <Button
                label="새로고침"
                icon="pi pi-refresh"
                severity="secondary"
                :loading="busy"
                :disabled="busy"
                @click="load" />
        </header>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <Message v-if="notice" severity="success" :closable="false">{{
            notice
        }}</Message>
        <p role="status" aria-live="polite">{{ progress }}</p>
        <section class="summary-grid" aria-label="거래 요약">
            <article>
                <span>본인원금 분류 매수액 · 납입원금 아님</span
                ><strong>{{ money(summary.principalUsd) }}</strong>
            </article>
            <article>
                <span>총 매수금액</span
                ><strong>{{ money(summary.purchaseUsd) }}</strong>
            </article>
            <article>
                <span>세전 배당</span
                ><strong>{{ money(summary.grossUsd) }}</strong>
            </article>
            <article>
                <span>세후 배당</span
                ><strong>{{ money(summary.netUsd) }}</strong>
            </article>
            <article>
                <span>확인된 비용 · 통화별</span
                ><strong>{{ money(summary.costsUsd) }}</strong
                ><small>{{ money(summary.costsKrw, 'KRW') }}</small>
            </article>
            <article>
                <span>미확인·검토 필요</span
                ><strong>{{ summary.unknown }}행</strong>
            </article>
        </section>
        <SheetReconciliationPanel
            :key="
                firebaseUser
                    ? `${firebaseUser.uid}:${firebaseUser.email}:${firebaseUser.emailVerified}`
                    : 'signed-out'
            "
            :rows="rows"
            :observations="observations"
            :archives="archives"
            :busy="busy"
            :preview="evidencePreview"
            :account-id="account"
            :labels="labels"
            @command="reconcile"
            @inspect="inspectObservation"
            @clear-preview="evidencePreview = null"
            @archive="downloadArchive" />
        <section class="ledger-list" aria-label="거래 목록">
            <div class="filters">
                <Button
                    label="처음 거래로 이동"
                    severity="secondary"
                    @click="jump(false)" />
                <Button
                    label="마지막 거래로 이동"
                    severity="secondary"
                    @click="jump(true)" />
                <Button
                    label="거래 행 추가"
                    :disabled="busy"
                    @click="addManual" />
                <Button
                    v-if="addedId"
                    label="추가한 거래 보기"
                    severity="secondary"
                    @click="showAdded" />
                <Select
                    v-model="account"
                    :options="accounts"
                    option-label="name"
                    option-value="id"
                    show-clear
                    placeholder="전체 계좌"
                    aria-label="계좌 필터" />
                <Select
                    v-model="type"
                    :options="
                        types.map((value) => ({
                            value,
                            label: typeLabels[value],
                        }))
                    "
                    option-label="label"
                    option-value="value"
                    show-clear
                    placeholder="전체 유형"
                    aria-label="거래유형 필터" />
                <Select
                    v-model="status"
                    :options="[...statuses, '검토 필요']"
                    show-clear
                    placeholder="전체 상태"
                    aria-label="상태 필터" />
                <InputText
                    v-model="search"
                    placeholder="티커·원본 시트 검색"
                    aria-label="거래 검색" />
                <span
                    >검색/필터 {{ filtered.length }}건 · 전체
                    {{ rows.length }}건 · {{ renderedRows.length }}건 표시</span
                >
            </div>
            <p class="muted">
                USD와 KRW는 같은 금액의 통화별 표기이며 합산하지 않습니다. 매도
                행의 거래금액은 매도대금입니다.
            </p>
            <div ref="listRegion" class="document-list-region">
                <div
                    aria-hidden="true"
                    :style="{ height: `${paddingTop}px` }" />
                <div ref="tableElement">
                    <DataTable
                        :value="renderedRows"
                        :pt="{
                            table: { 'aria-rowcount': filtered.length + 1 },
                            bodyRow: rowAttributes,
                        }"
                        lazy
                        data-key="id"
                        scrollable
                        :sort-field="sortField"
                        :sort-order="sortOrder"
                        size="small"
                        striped-rows
                        :loading="busy"
                        table-style="min-width: 3700px"
                        @sort="sortList">
                        <template #empty
                            >조건에 맞는 거래가 없습니다. 필터를 확인하거나 수동
                            거래를 추가해 주세요.</template
                        >
                        <Column
                            field="accountId"
                            header="계좌"
                            frozen
                            style="min-width: 80px"
                            ><template #body="{ data }">{{
                                accounts.find((a) => a.id === data.accountId)
                                    ?.name
                            }}</template></Column
                        >
                        <Column
                            field="date"
                            header="거래일"
                            sortable
                            frozen
                            style="min-width: 120px" />
                        <Column
                            field="type"
                            header="유형"
                            frozen
                            style="min-width: 75px"
                            ><template #body="{ data }">{{
                                typeLabels[data.type]
                            }}</template></Column
                        >
                        <Column
                            field="symbol"
                            header="티커"
                            sortable
                            frozen
                            style="min-width: 90px" />
                        <Column
                            field="exDate"
                            header="배당락일"
                            style="min-width: 120px"
                            ><template #body="{ data }">{{
                                data.exDate || '—'
                            }}</template></Column
                        >
                        <Column
                            field="paymentDate"
                            header="배당지급일"
                            style="min-width: 120px"
                            ><template #body="{ data }">{{
                                data.paymentDate || '—'
                            }}</template></Column
                        >
                        <Column
                            v-for="field in numericFields"
                            :key="field"
                            :field="field"
                            :header="labels[field]"
                            sortable
                            style="min-width: 145px"
                            ><template #body="{ data }"
                                ><span
                                    :title="
                                        data.fieldStatus[field] ||
                                        (data[field] == null
                                            ? '미확인'
                                            : '원본값')
                                    "
                                    >{{ display(data[field], field)
                                    }}<small
                                        v-if="
                                            data.fieldStatus[field] === '추정'
                                        ">
                                        (추정)</small
                                    ></span
                                ></template
                            ></Column
                        >
                        <Column
                            v-for="field in additionalColumns"
                            :key="field"
                            :field="field"
                            :header="labels[field]"
                            style="min-width: 190px">
                            <template #body="{ data }">{{
                                data[field] == null
                                    ? '미확인'
                                    : data[field] === true
                                      ? '포함'
                                      : data[field] === false
                                        ? '별도'
                                        : data[field]
                            }}</template>
                        </Column>
                        <Column
                            field="fundingSource"
                            header="원금출처"
                            style="min-width: 120px" />
                        <Column
                            field="reinvested"
                            header="재투자여부"
                            style="min-width: 130px"
                            ><template #body="{ data }"
                                >{{
                                    data.reinvested == null
                                        ? '미확인'
                                        : data.reinvested
                                          ? '예'
                                          : '아니오'
                                }}{{
                                    data.fieldStatus.reinvested === '추정'
                                        ? ' (추정)'
                                        : ''
                                }}</template
                            ></Column
                        >
                        <Column
                            field="status"
                            header="상태"
                            style="min-width: 110px"
                            ><template #body="{ data }"
                                ><Tag
                                    :value="
                                        data.duplicate ? '중복' : data.status
                                    "
                                    :severity="
                                        data.status === '확정'
                                            ? 'success'
                                            : 'warn'
                                    " /></template
                        ></Column>
                        <Column header="원본·검토 근거" style="min-width: 250px"
                            ><template #body="{ data }"
                                ><a
                                    v-if="data.source.spreadsheetId"
                                    :href="`https://docs.google.com/spreadsheets/d/${data.source.spreadsheetId}/edit#gid=${data.source.sheetId}&range=A${data.source.row}`"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >{{ data.source.sheet }}
                                    {{ data.source.row }}행</a
                                ><span v-else
                                    >{{ data.source.sheet }} · 검토 필요</span
                                >
                                <details v-if="data.evidence.length">
                                    <summary>
                                        근거 {{ data.evidence.length }}개
                                    </summary>
                                    <p v-for="(e, i) in data.evidence" :key="i">
                                        {{ e }}
                                    </p>
                                </details></template
                            ></Column
                        >
                        <Column header="수정" style="min-width: 90px"
                            ><template #body="{ data }"
                                ><Button
                                    label="수정"
                                    size="small"
                                    severity="secondary"
                                    :disabled="busy"
                                    @click="
                                        editing = JSON.parse(
                                            JSON.stringify(data)
                                        )
                                    " /></template
                        ></Column>
                    </DataTable>
                </div>
                <div
                    aria-hidden="true"
                    :style="{ height: `${paddingBottom}px` }" />
            </div>
            <p class="list-progress" role="status" aria-live="polite">
                전체 {{ filtered.length }}건 중
                {{ filtered.length ? windowStart + 1 : 0 }}–{{
                    windowStart + renderedRows.length
                }}행 · 브라우저 스크롤/PageDown으로 전체 목록을 확인하세요.
            </p>
            <p v-if="windowStart + renderedRows.length >= filtered.length">
                목록 끝
            </p>
        </section>
        <Dialog
            v-model:visible="editOpen"
            modal
            :header="creating ? '수동 거래 추가' : '거래 수정'"
            :style="{ width: '760px', maxWidth: '95vw' }"
            :closable="!busy">
            <form v-if="editing" class="edit-form" @submit.prevent="save">
                <p>
                    빈 금액·시간대는 미확인입니다.
                    {{
                        creating
                            ? '수동 입력은 원본 대조 전 검토 필요로 저장합니다. 표시되지 않은 초·수수료는 입력하지 마세요.'
                            : '원본 추적 정보와 거래유형은 유지됩니다.'
                    }}
                </p>
                <Message v-if="error" severity="error" :closable="false">{{
                    error
                }}</Message>
                <div class="edit-grid">
                    <template v-if="creating">
                        <label for="manual-account"
                            >계좌<Select
                                v-model="editing.accountId"
                                input-id="manual-account"
                                aria-label="추가 계좌"
                                :options="accounts"
                                option-label="name"
                                option-value="id"
                                placeholder="계좌 선택"
                        /></label>
                        <label for="manual-type"
                            >거래유형<Select
                                v-model="editing.type"
                                input-id="manual-type"
                                aria-label="추가 거래유형"
                                :options="
                                    types.map((value) => ({
                                        value,
                                        label: typeLabels[value],
                                    }))
                                "
                                option-label="label"
                                option-value="value"
                        /></label>
                        <label for="manual-time"
                            >거래 일시 · 표시 정밀도 그대로<InputText
                                id="manual-time"
                                :model-value="editing.transactionAt || ''"
                                placeholder="2026-01-02 14:51 또는 14:51:05.123"
                                @update:model-value="
                                    editing.transactionAt = $event || null
                                "
                        /></label>
                        <label for="manual-zone"
                            >표시 시간대<InputText
                                id="manual-zone"
                                :model-value="editing.timeZone || ''"
                                placeholder="미확인 · 확인된 경우만 입력"
                                @update:model-value="
                                    editing.timeZone = $event || null
                                "
                        /></label>
                        <label for="manual-note"
                            >수동 입력 메모<InputText
                                id="manual-note"
                                v-model="editing.note"
                        /></label>
                    </template>
                    <label for="edit-symbol"
                        >티커<InputText
                            id="edit-symbol"
                            v-model="editing.symbol"
                            :required="
                                ['BUY', 'SELL', 'DIVIDEND'].includes(
                                    editing.type
                                )
                            "
                    /></label>
                    <label
                        v-for="key in ['date', 'exDate', 'paymentDate']"
                        :key="key"
                        :for="`edit-${key}`"
                        >{{
                            {
                                date: '거래일',
                                exDate: '배당락일',
                                paymentDate: '배당지급일',
                            }[key]
                        }}<InputText
                            :id="`edit-${key}`"
                            :model-value="editing[key] || ''"
                            type="date"
                            :required="key === 'date'"
                            @update:model-value="editing[key] = $event || null"
                    /></label>
                    <label
                        v-for="field in numericFields"
                        :key="field"
                        :for="`edit-${field}`"
                        >{{ labels[field]
                        }}<InputNumber
                            v-model="editing[field]"
                            :input-id="`edit-${field}`"
                            :min="0"
                            :max-fraction-digits="8"
                            placeholder="미확인"
                    /></label>
                    <label for="edit-funding"
                        >원금출처<Select
                            v-model="editing.fundingSource"
                            input-id="edit-funding"
                            :options="fundingSources"
                    /></label>
                    <label for="edit-reinvested"
                        >재투자여부<Select
                            v-model="editing.reinvested"
                            input-id="edit-reinvested"
                            :options="[
                                { label: '미확인', value: null },
                                { label: '예', value: true },
                                { label: '아니오', value: false },
                            ]"
                            option-label="label"
                            option-value="value"
                    /></label>
                    <label for="edit-status"
                        >상태<Select
                            v-model="editing.status"
                            input-id="edit-status"
                            :options="statuses"
                    /></label>
                </div>
                <Button
                    type="submit"
                    :label="creating ? '추가 저장' : '수정 저장'"
                    :disabled="busy"
                    :loading="busy" /><Button
                    label="취소"
                    severity="secondary"
                    :disabled="busy"
                    @click="editing = null" />
            </form>
        </Dialog>
    </main>
</template>

<style scoped>
    .trial-ledger {
        width: 100%;
        box-sizing: border-box;
        min-width: 0;
        max-width: 1800px;
        margin: auto;
        padding: 2rem;
        display: grid;
        gap: 1.5rem;
        color: var(--p-text-color);
    }
    header,
    .import-actions,
    .filters {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
    }
    header {
        justify-content: space-between;
    }
    h1 {
        margin: 0.4rem 0;
        font-size: 2rem;
    }
    h2 {
        font-size: 1.1rem;
        margin-top: 0;
    }
    p {
        line-height: 1.6;
    }
    .eyebrow,
    .muted,
    article span {
        color: var(--p-text-muted-color);
        font-size: 0.875rem;
    }
    .import-panel,
    .ledger-list,
    .summary-grid article {
        border: 1px solid var(--p-content-border-color);
        border-radius: 12px;
        background: var(--p-content-background);
        padding: 1.25rem;
        min-width: 0;
    }
    .url-field {
        flex: 1;
        min-width: 220px;
        display: grid;
        gap: 0.5rem;
    }
    .summary-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .summary-grid article {
        display: grid;
        gap: 0.65rem;
    }
    article strong {
        font-size: 1.35rem;
    }
    .preview-notice {
        margin-top: 1rem;
    }
    .edit-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    .edit-grid label {
        display: grid;
        gap: 0.5rem;
    }
    .document-list-region {
        min-width: 0;
        max-width: 100%;
    }
    .filters > * {
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
        overflow-wrap: anywhere;
    }
    .edit-form > button {
        margin-right: 0.5rem;
    }
    summary {
        cursor: pointer;
        padding: 0.5rem 0;
    }
    small {
        color: var(--p-text-muted-color);
    }
    @media (max-width: 640px) {
        .trial-ledger {
            padding: 1rem 0.5rem;
        }
        .import-panel,
        .ledger-list {
            padding: 0.75rem;
        }
        .filters > *,
        .import-actions > * {
            width: 100%;
        }
        .edit-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
