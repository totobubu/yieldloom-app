<script setup>
    import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
    import Select from 'primevue/select';
    import DocumentLedgerHeader from '@/components/portfolio/DocumentLedgerHeader.vue';
    import SheetEvidenceCell from '@/components/portfolio/SheetEvidenceCell.vue';
    import { buildLedgerReview } from '../../lib/sheet-review.js';
    import { useDocumentLedgerWindow } from '@/composables/useDocumentLedgerWindow.js';
    import SheetReconciliationPanel from '@/components/portfolio/SheetReconciliationPanel.vue';
    import SheetCloudReview from '@/components/portfolio/SheetCloudReview.vue';
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
    const identityQuery =
        typeof window === 'undefined'
            ? null
            : window.matchMedia('(min-width: 900px)');
    const freezeIdentity = ref(Boolean(identityQuery?.matches));
    const updateIdentityLayout = () => {
        freezeIdentity.value = Boolean(identityQuery?.matches);
    };
    onMounted(() =>
        identityQuery?.addEventListener('change', updateIdentityLayout)
    );
    onBeforeUnmount(() =>
        identityQuery?.removeEventListener('change', updateIdentityLayout)
    );
    const rows = ref([]),
        observations = ref([]),
        observationStates = ref({}),
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
        tableElement = ref(null),
        listScrollRoot = ref(null),
        ledgerOpen = ref(false);
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
                field !== 'transactionAt' &&
                (activeRows.value.some((r) => r[field] != null) ||
                    observations.value.some((o) => o.values[field] != null))
        )
    );
    const review = computed(() =>
        buildLedgerReview(rows.value, observations.value)
    );
    const valueColumns = computed(() => [
        ...numericFields,
        ...additionalColumns.value,
    ]);
    const fieldDrafts = ref({}),
        approvalRowId = ref(null),
        approvalNote = ref('');
    const approvalOpen = computed({
        get: () => approvalRowId.value !== null,
        set: (value) => {
            if (!value) approvalRowId.value = null;
        },
    });
    const pendingApprovals = computed(() =>
        Object.keys(fieldDrafts.value)
            .filter((id) => Object.keys(fieldDrafts.value[id].choices).length)
            .map((id) => rows.value.find((row) => row.id === id))
            .filter(Boolean)
    );
    const approvalRow = computed(() =>
        rows.value.find((row) => row.id === approvalRowId.value)
    );
    const approvalChanges = computed(() =>
        Object.entries(
            fieldDrafts.value[approvalRowId.value]?.choices || {}
        ).map(([field, id]) => ({
            field,
            before: approvalRow.value?.[field],
            source: review.value.byRow
                .get(approvalRowId.value)
                ?.fields.get(field)
                ?.sources.find((item) => item.id === id),
        }))
    );
    const draftStale = (id) =>
        fieldDrafts.value[id]?.signature !==
        review.value.byRow.get(id)?.signature;
    const rowLabel = (row) =>
        `${accounts.find((item) => item.id === row.accountId)?.name || row.accountId} ${row.date} ${row.symbol}`;
    function chooseField(row, field, id) {
        const current = fieldDrafts.value[row.id];
        if (current && draftStale(row.id)) {
            error.value =
                '대조값이 바뀌었습니다. 이 행의 선택을 취소하고 최신 값을 다시 선택해 주세요.';
            return;
        }
        const draft = current || {
            signature: review.value.byRow.get(row.id).signature,
            choices: {},
        };
        const choices = { ...draft.choices };
        if (id == null) delete choices[field];
        else choices[field] = id;
        fieldDrafts.value = {
            ...fieldDrafts.value,
            [row.id]: { ...draft, choices },
        };
    }
    function discardChoices(id) {
        const next = { ...fieldDrafts.value };
        delete next[id];
        fieldDrafts.value = next;
    }
    function openApproval(row) {
        approvalRowId.value = row.id;
        approvalNote.value = '';
        error.value = '';
    }
    function displayEvidence(value) {
        return value == null
            ? '미제공'
            : typeof value === 'boolean'
              ? value
                  ? '포함'
                  : '별도'
              : typeof value === 'number'
                ? value.toLocaleString('ko-KR', { maximumFractionDigits: 20 })
                : String(value);
    }
    async function approveFields() {
        const row = approvalRow.value;
        if (!row || draftStale(row.id)) return;
        await run(async (current) => {
            const draft = fieldDrafts.value[row.id],
                model = review.value.byRow.get(row.id);
            const result = await client.mutate(firebaseUser.value, 'POST', {
                action: 'resolve-fields',
                version: version.value,
                id: row.id,
                signature: draft.signature,
                choices: { ...draft.choices },
                note: approvalNote.value,
                evidence: model.observations.map((item) => ({
                    id: item.id,
                    accountId: item.accountId,
                    reviewVersion: item.reviewVersion,
                })),
                observationSequence:
                    observationStates.value[row.accountId]?.sequence || 0,
            });
            if (current !== generation) return;
            apply(result);
            discardChoices(row.id);
            approvalRowId.value = null;
            notice.value =
                '선택한 출처 값을 승인·저장했습니다. 원본과 관리자 감사 이력을 보존했습니다.';
        }, '선택한 값을 관리자 시험 장부에 승인·저장하는 중입니다.');
    }
    const filtered = computed(() =>
        activeRows.value.filter(
            (r) =>
                (!account.value || r.accountId === account.value) &&
                (!type.value || r.type === type.value) &&
                (!status.value ||
                    (status.value === '출처 충돌'
                        ? review.value.byRow.get(r.id)?.unresolved > 0
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
    } = useDocumentLedgerWindow(
        sortedRows,
        listRegion,
        tableElement,
        listScrollRoot
    );
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
        observationStates.value =
            result.observationStates || observationStates.value;
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
            observationStates.value = {};
            archives.value = [];
            evidencePreview.value = null;
            editing.value = null;
            fieldDrafts.value = {};
            approvalRowId.value = null;
            approvalNote.value = '';
            ledgerOpen.value = false;
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
        <SheetCloudReview :user="firebaseUser" />
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
                <span>출처 값 충돌 · 미해결</span>
                <strong>{{ review.counts.conflictRows }}행</strong>
                <small
                    >{{ review.counts.conflictFields }}개 필드 · 전체 장부
                    기준</small
                >
            </article>
            <article>
                <span>대조 자료 연결 필요</span>
                <strong
                    >{{
                        review.counts.unmatched + review.counts.ambiguous
                    }}건</strong
                >
                <small
                    >미매칭 {{ review.counts.unmatched }} · 다중 후보
                    {{ review.counts.ambiguous }} · 대조 대상 제외
                    {{ review.counts.outsideScope }}</small
                >
            </article>
            <article>
                <span>수수료·환전비용 미제공</span>
                <strong>{{ review.counts.missingValues }}행</strong>
                <small>교차 검증 잔여 건수가 아닙니다.</small>
            </article>
        </section>
        <p class="review-counts" aria-label="출처 대조 집계">
            전체 등록 거래 {{ rows.length }}행 · 저장된 대조 원문
            {{ review.counts.sourceRecords }}건 · 고유 거래 후보
            {{ review.counts.matchedTransactions }}행 · 승인된 연결
            {{ review.counts.confirmedTransactions }}행 · 비교값 일치
            {{ review.counts.agreedTransactions }}행 · 관리자 연결·채택 대기
            {{ review.counts.awaitingApproval }}건. 일치한 값은 자동 채택하지
            않으며, 비교 자료가 없는 행은 검증 완료로 계산하지 않습니다.
        </p>
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
        <section
            v-show="!ledgerOpen"
            class="ledger-launcher"
            aria-label="거래 목록 필터">
            <h2>거래 목록 조회</h2>
            <form class="filters" @submit.prevent="ledgerOpen = true">
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
                    :options="[...statuses, '출처 충돌']"
                    show-clear
                    placeholder="전체 상태"
                    aria-label="상태 필터" />
                <InputText
                    v-model="search"
                    placeholder="티커·원본 시트 검색"
                    aria-label="거래 검색" />
                <Button
                    type="submit"
                    label="확인"
                    icon="pi pi-check"
                    :disabled="busy" />
            </form>
            <p class="muted">
                조건에 맞는 {{ filtered.length }}건 · 전체 {{ rows.length }}건.
                확인을 누르면 거래 목록을 전체 화면으로 엽니다.
            </p>
        </section>
        <Dialog
            v-model:visible="ledgerOpen"
            modal
            block-scroll
            :draggable="false"
            header="거래 목록"
            :style="{
                width: '100vw',
                height: '100dvh',
                maxWidth: 'none',
                maxHeight: '100dvh',
                margin: 0,
                borderRadius: 0,
            }"
            :content-style="{
                padding: 0,
                overflow: 'hidden',
                minHeight: 0,
                flex: '1 1 auto',
            }">
            <div ref="listScrollRoot" class="ledger-dialog-scroll">
                <section class="ledger-list" aria-label="거래 목록">
                    <div
                        v-if="pendingApprovals.length"
                        class="approval-toolbar"
                        aria-label="출처 값 승인 대기">
                        <div v-for="row in pendingApprovals" :key="row.id">
                            <span
                                >{{ rowLabel(row) }} ·
                                {{
                                    Object.keys(fieldDrafts[row.id].choices)
                                        .length
                                }}개 선택</span
                            >
                            <strong v-if="draftStale(row.id)"
                                >값 변경됨 · 다시 선택 필요</strong
                            >
                            <Button
                                label="선택값 승인·저장"
                                size="small"
                                :disabled="busy || draftStale(row.id)"
                                @click="openApproval(row)" />
                            <Button
                                label="선택 취소"
                                text
                                size="small"
                                :disabled="busy"
                                @click="discardChoices(row.id)" />
                        </div>
                    </div>
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
                            :options="[...statuses, '출처 충돌']"
                            show-clear
                            placeholder="전체 상태"
                            aria-label="상태 필터" />
                        <InputText
                            v-model="search"
                            placeholder="티커·원본 시트 검색"
                            aria-label="거래 검색" />
                        <span
                            >검색/필터 {{ filtered.length }}건 · 전체
                            {{ rows.length }}건 · {{ renderedRows.length }}건
                            표시</span
                        >
                    </div>
                    <p class="muted" aria-label="재투자 추정 안내">
                        ‘배당 재투자 추정’은 시트에 기록된 같은 계좌의 최근 7일
                        배당금을 매수에 계산상 배분했을 때 90% 이상을 충당한다는
                        뜻입니다. 실제 자금 출처가 확인됐거나 거래 자체가
                        추정이라는 뜻은 아닙니다.
                    </p>
                    <p class="muted">
                        USD와 KRW는 같은 금액의 통화별 표기이며 합산하지
                        않습니다. 매도 행의 거래금액은 매도대금입니다.
                    </p>
                    <p class="muted" aria-label="토스 자료 보기 안내">
                        토스 자료는 각 셀의 ‘토스 거래내역·토스 주문내역’ 값으로
                        비교합니다. 등록된 대조 자료는 팝업을 닫은 뒤 본문의
                        ‘대조 자료 목록 → 출처 비교’에서 확인하세요. 비공개 R2
                        보고서의 수집 건수와 이 표에 연결된 자료 수는 다릅니다.
                        거래시간은 원문의 거래 일시이며 주문·체결·결제 일시와
                        구분합니다. 저장된 시각이 없으면 미제공으로 표시합니다.
                    </p>
                    <div ref="listRegion" class="document-list-region">
                        <div
                            aria-hidden="true"
                            :style="{ height: `${paddingTop}px` }" />
                        <div ref="tableElement">
                            <DataTable
                                :value="renderedRows"
                                :pt="{
                                    table: {
                                        'aria-rowcount': filtered.length + 1,
                                    },
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
                                    >조건에 맞는 거래가 없습니다. 필터를
                                    확인하거나 수동 거래를 추가해
                                    주세요.</template
                                >
                                <Column
                                    field="accountId"
                                    header="계좌"
                                    :frozen="freezeIdentity"
                                    style="min-width: 80px"
                                    ><template #body="{ data }">{{
                                        accounts.find(
                                            (a) => a.id === data.accountId
                                        )?.name
                                    }}</template></Column
                                >
                                <Column
                                    field="date"
                                    header="거래일"
                                    sortable
                                    :frozen="freezeIdentity"
                                    style="min-width: 180px">
                                    <template #body="{ data }">
                                        <SheetEvidenceCell
                                            :comparison="
                                                review.byRow
                                                    .get(data.id)
                                                    ?.fields.get('date')
                                            "
                                            :selected="
                                                fieldDrafts[data.id]?.choices
                                                    .date || null
                                            "
                                            label="거래일"
                                            hide-matching-sources
                                            :row-label="rowLabel(data)"
                                            :format="displayEvidence"
                                            :disabled="busy"
                                            @choose="
                                                chooseField(
                                                    data,
                                                    'date',
                                                    $event
                                                )
                                            " />
                                    </template>
                                </Column>
                                <Column
                                    field="transactionAt"
                                    header="거래시간"
                                    sortable
                                    :frozen="freezeIdentity"
                                    style="min-width: 210px">
                                    <template #body="{ data }">
                                        <SheetEvidenceCell
                                            :comparison="
                                                review.byRow
                                                    .get(data.id)
                                                    ?.fields.get(
                                                        'transactionAt'
                                                    )
                                            "
                                            :selected="
                                                fieldDrafts[data.id]?.choices
                                                    .transactionAt || null
                                            "
                                            label="거래시간"
                                            hide-matching-sources
                                            :row-label="rowLabel(data)"
                                            :format="displayEvidence"
                                            :disabled="
                                                busy ||
                                                review.byRow.get(data.id)
                                                    ?.observations.length > 100
                                            "
                                            @choose="
                                                chooseField(
                                                    data,
                                                    'transactionAt',
                                                    $event
                                                )
                                            " />
                                    </template>
                                </Column>
                                <Column
                                    field="type"
                                    header="유형"
                                    :frozen="freezeIdentity"
                                    style="min-width: 75px"
                                    ><template #body="{ data }">{{
                                        typeLabels[data.type]
                                    }}</template></Column
                                >
                                <Column
                                    field="symbol"
                                    header="티커"
                                    sortable
                                    :frozen="freezeIdentity"
                                    style="min-width: 90px" />
                                <Column
                                    field="exDate"
                                    header="배당락일"
                                    style="min-width: 210px">
                                    <template #body="{ data }">
                                        <SheetEvidenceCell
                                            :comparison="
                                                review.byRow
                                                    .get(data.id)
                                                    ?.fields.get('exDate')
                                            "
                                            :selected="
                                                fieldDrafts[data.id]?.choices
                                                    .exDate || null
                                            "
                                            label="배당락일"
                                            hide-matching-sources
                                            :row-label="rowLabel(data)"
                                            :format="displayEvidence"
                                            :disabled="busy"
                                            @choose="
                                                chooseField(
                                                    data,
                                                    'exDate',
                                                    $event
                                                )
                                            " />
                                    </template>
                                </Column>
                                <Column
                                    field="paymentDate"
                                    header="배당지급일"
                                    style="min-width: 210px">
                                    <template #body="{ data }">
                                        <SheetEvidenceCell
                                            :comparison="
                                                review.byRow
                                                    .get(data.id)
                                                    ?.fields.get('paymentDate')
                                            "
                                            :selected="
                                                fieldDrafts[data.id]?.choices
                                                    .paymentDate || null
                                            "
                                            label="배당지급일"
                                            hide-matching-sources
                                            :row-label="rowLabel(data)"
                                            :format="displayEvidence"
                                            :disabled="busy"
                                            @choose="
                                                chooseField(
                                                    data,
                                                    'paymentDate',
                                                    $event
                                                )
                                            " />
                                    </template>
                                </Column>
                                <Column
                                    v-for="field in valueColumns"
                                    :key="field"
                                    :field="field"
                                    :header="labels[field] || field"
                                    sortable
                                    style="min-width: 210px">
                                    <template #body="{ data }">
                                        <SheetEvidenceCell
                                            :comparison="
                                                review.byRow
                                                    .get(data.id)
                                                    ?.fields.get(field)
                                            "
                                            :selected="
                                                fieldDrafts[data.id]?.choices[
                                                    field
                                                ] || null
                                            "
                                            :label="labels[field] || field"
                                            :row-label="rowLabel(data)"
                                            :format="displayEvidence"
                                            :status="data.fieldStatus?.[field]"
                                            :disabled="
                                                busy ||
                                                review.byRow.get(data.id)
                                                    ?.observations.length > 100
                                            "
                                            @choose="
                                                chooseField(data, field, $event)
                                            " />
                                    </template>
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
                                            data.fieldStatus.reinvested ===
                                            '추정'
                                                ? ' · 배당 재투자 추정'
                                                : ''
                                        }}<small
                                            v-if="
                                                data.fieldStatus.reinvested ===
                                                '추정'
                                            ">
                                            최근 7일 배당 배분 기준 · 실제 재원
                                            미확인
                                        </small></template
                                    ></Column
                                >
                                <Column
                                    field="status"
                                    header="상태"
                                    style="min-width: 110px"
                                    ><template #body="{ data }"
                                        ><Tag
                                            :value="
                                                data.duplicate
                                                    ? '중복'
                                                    : data.status
                                            "
                                            :severity="
                                                data.status === '확정'
                                                    ? 'success'
                                                    : 'warn'
                                            " /></template
                                ></Column>
                                <Column
                                    header="원본·검토 근거"
                                    style="min-width: 250px"
                                    ><template #body="{ data }"
                                        ><a
                                            v-if="data.source.spreadsheetId"
                                            :href="`https://docs.google.com/spreadsheets/d/${data.source.spreadsheetId}/edit#gid=${data.source.sheetId}&range=A${data.source.row}`"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            >{{ data.source.sheet }}
                                            {{ data.source.row }}행</a
                                        ><span v-else
                                            >{{ data.source.sheet }} · 검토
                                            필요</span
                                        >
                                        <details v-if="data.evidence.length">
                                            <summary>
                                                근거
                                                {{ data.evidence.length }}개
                                            </summary>
                                            <p
                                                v-for="(e, i) in data.evidence"
                                                :key="i">
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
                        }}행 · 브라우저 스크롤/PageDown으로 전체 목록을
                        확인하세요.
                    </p>
                    <p
                        v-if="
                            windowStart + renderedRows.length >= filtered.length
                        ">
                        목록 끝
                    </p>
                </section>
            </div>
            <DocumentLedgerHeader
                :container="tableElement"
                :region="listRegion"
                :scroll-root="listScrollRoot" />
        </Dialog>
        <Dialog
            v-model:visible="approvalOpen"
            modal
            header="선택 출처 값 승인"
            :style="{ width: '700px', maxWidth: 'calc(100vw - 24px)' }">
            <template v-if="approvalRow">
                <Message v-if="error" severity="error" :closable="false">{{
                    error
                }}</Message>
                <p>
                    {{ rowLabel(approvalRow) }} · 기존 거래를 유지하고 선택한
                    필드만 변경합니다.
                </p>
                <dl class="approval-changes">
                    <div v-for="change in approvalChanges" :key="change.field">
                        <dt>{{ labels[change.field] || change.field }}</dt>
                        <dd>
                            {{ displayEvidence(change.before) }} →
                            {{ displayEvidence(change.source?.value) }}
                        </dd>
                        <small
                            >{{ change.source?.label }} ·
                            {{ change.source?.location }}</small
                        >
                    </div>
                </dl>
                <label for="inline-review-note">관리자 확인 근거</label>
                <Textarea
                    id="inline-review-note"
                    v-model="approvalNote"
                    rows="3"
                    fluid
                    :disabled="busy" />
                <p>
                    구글 시트·토스 원문은 변경하지 않습니다. 선택값, 원래 값,
                    출처와 승인자·시각을 감사 이력에 보존합니다.
                </p>
                <p v-if="draftStale(approvalRow.id)" role="alert">
                    대조값이 변경되었습니다. 취소 후 다시 선택해 주세요.
                </p>
            </template>
            <template #footer>
                <Button
                    label="취소"
                    text
                    :disabled="busy"
                    @click="approvalRowId = null" />
                <Button
                    label="관리자 승인·저장"
                    :loading="busy"
                    :disabled="
                        !approvalNote.trim() ||
                        busy ||
                        draftStale(approvalRowId)
                    "
                    @click="approveFields" />
            </template>
        </Dialog>
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
    .approval-toolbar {
        position: sticky;
        top: var(--studio-header-height, 73px);
        z-index: 5;
        background: var(--p-content-background);
        border: 1px solid var(--p-content-border-color);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
    }
    .approval-toolbar > div {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .approval-changes > div {
        border-bottom: 1px solid var(--p-content-border-color);
        padding: 10px 0;
    }
    .approval-changes dd {
        margin: 6px 0;
        font-weight: 600;
    }
    .review-counts {
        color: var(--p-text-muted-color);
        font-size: 13px;
    }
    .document-list-region {
        min-width: 0;
        max-width: 100%;
    }
    .ledger-dialog-scroll {
        height: 100%;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
    }
    .ledger-dialog-scroll .ledger-list {
        border: 0;
        border-radius: 0;
    }
    .ledger-dialog-scroll .approval-toolbar {
        top: 0;
    }
    .ledger-list td small {
        display: block;
        margin-top: 4px;
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
