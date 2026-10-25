<script setup>
    import { computed, ref, watch } from 'vue';
    import Select from 'primevue/select';
    import { useDocumentLedgerWindow } from '../../composables/useDocumentLedgerWindow.js';
    import { accounts } from '../../../lib/sheet-ledger.js';
    import {
        compareEvidence,
        candidates,
        extraFields,
        sourceKinds,
        summarizeCapital,
    } from '../../../lib/sheet-reconciliation.js';

    const props = defineProps({
        rows: { type: Array, required: true },
        observations: { type: Array, required: true },
        archives: { type: Array, required: true },
        busy: Boolean,
        disabled: Boolean,
        preview: { type: Object, default: null },
        accountId: { type: String, default: null },
        labels: { type: Object, required: true },
    });
    const emit = defineEmits([
        'command',
        'clear-preview',
        'archive',
        'inspect',
    ]);
    const batchDraft = ref(null),
        observationRegion = ref(null),
        observationTable = ref(null),
        observationSearch = ref('');
    const separateEvent = ref(false);
    const input = ref(''),
        inputError = ref(''),
        selectedId = ref(null),
        targetId = ref(''),
        fields = ref([]),
        note = ref(''),
        scope = ref('UNKNOWN'),
        origin = ref('UNKNOWN'),
        peer = ref(null);
    const suggestedObservations = computed(() =>
        props.observations.map((o) => {
            if (o.acceptedTargetId || o.targetId) return o;
            const matches = candidates(props.rows, o);
            return {
                ...o,
                candidateIds: matches.map((r) => r.id),
                targetId: matches.length === 1 ? matches[0].id : null,
            };
        })
    );
    const selected = computed(() =>
        suggestedObservations.value.find((o) => o.id === selectedId.value)
    );
    const targets = computed(() =>
        selected.value
            ? props.rows
                  .filter(
                      (r) =>
                          r.accountId === selected.value.accountId &&
                          r.type === selected.value.type
                  )
                  .map((r) => ({
                      id: r.id,
                      label: `${r.date} ${r.symbol || r.type} · ${r.id}`,
                  }))
            : []
    );
    const target = computed(() =>
        props.rows.find((r) => r.id === targetId.value)
    );
    const comparisons = computed(() =>
        target.value
            ? compareEvidence(
                  target.value,
                  suggestedObservations.value.map((o) =>
                      o.id === selectedId.value
                          ? { ...o, targetId: target.value.id }
                          : o
                  )
              )
            : []
    );
    const capital = computed(() =>
        summarizeCapital(props.rows, props.accountId)
    );
    const visibleObservations = computed(() =>
        suggestedObservations.value
            .filter(
                (o) =>
                    (!props.accountId || o.accountId === props.accountId) &&
                    `${o.symbol} ${o.sourceId} ${o.location}`
                        .toLowerCase()
                        .includes(observationSearch.value.toLowerCase())
            )
            .toSorted(
                (a, b) =>
                    String(b.values?.date || '').localeCompare(
                        String(a.values?.date || '')
                    ) || a.id.localeCompare(b.id)
            )
    );
    const observationWindow = useDocumentLedgerWindow(
        visibleObservations,
        observationRegion,
        observationTable
    );
    const label = (field) =>
        props.labels[field] ||
        extraFields[field] ||
        { date: '거래일', exDate: '배당락일', paymentDate: '지급일' }[field] ||
        field;
    const display = (v) =>
        v == null
            ? '미확인'
            : v === true
              ? '포함'
              : v === false
                ? '별도'
                : String(v);
    const amount = (v, currency) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'KRW' ? 0 : 2,
        }).format(v);
    const sourceValue = (comparison, kind) =>
        comparison.sources.filter((s) => s.kind === kind);
    watch(selectedId, () => {
        separateEvent.value = false;
        targetId.value = selected.value?.targetId || '';
        fields.value = Object.keys(selected.value?.values || {}).filter(
            (f) => selected.value.values[f] != null
        );
        note.value = '';
        scope.value = 'UNKNOWN';
        origin.value = 'UNKNOWN';
        peer.value = null;
    });
    watch(input, () => {
        inputError.value = '';
        batchDraft.value = null;
        emit('clear-preview');
    });
    watch(
        () => selected.value?.acceptedTargetId,
        (id) => {
            if (id) targetId.value = id;
        }
    );
    watch(
        () => props.accountId,
        (id) => {
            if (id && selected.value?.accountId !== id) selectedId.value = null;
        }
    );
    async function submit(action) {
        inputError.value = '';
        try {
            const observations = JSON.parse(input.value);
            if (
                !Array.isArray(observations) ||
                !observations.length ||
                observations.length > 100 ||
                new Set(observations.map((o) => o.accountId)).size !== 1
            )
                throw new Error();
            if (!batchDraft.value) {
                const hash = await crypto.subtle.digest(
                    'SHA-256',
                    new TextEncoder().encode(input.value)
                );
                batchDraft.value = {
                    accountId: observations[0].accountId,
                    batchId: crypto.randomUUID(),
                    checkpoint: {
                        sourceHash: [...new Uint8Array(hash)]
                            .map((v) => v.toString(16).padStart(2, '0'))
                            .join(''),
                        offset: 0,
                        count: observations.length,
                    },
                };
            }
            emit('command', {
                action,
                ...batchDraft.value,
                observations,
                ...(action === 'batch-commit'
                    ? { fingerprint: props.preview.fingerprint }
                    : {}),
            });
        } catch {
            inputError.value =
                '동일 계좌의 대조 자료 1~100건을 JSON 배열로 입력해 주세요.';
        }
    }
    function accept() {
        emit('command', {
            action: 'accept-evidence',
            observationId: selected.value.id,
            accountId: selected.value.accountId,
            reviewVersion: selected.value.reviewVersion,
            targetId: targetId.value || null,
            fields: fields.value,
            note: note.value,
            separateEvent: separateEvent.value,
        });
    }
    function classify() {
        emit('command', {
            action: 'classify-cash',
            id: target.value.id,
            scope: scope.value,
            origin: origin.value,
            peerAccountId: peer.value,
            evidenceIds: props.observations
                .filter((o) => o.targetId === target.value.id && !o.forecast)
                .map((o) => o.id),
            note: note.value,
        });
    }
</script>

<template>
    <section class="reconciliation-panel" aria-label="출처 대조와 원금 검증">
        <h2>출처 대조 · 원금 검증</h2>
        <p>
            외부 순입금과 원금 출처를 따로 확인합니다. 배당 이익을 활용한 출금은
            원금을 자동 차감하지 않습니다. 혼합·미확인 재원은 임의 배분하지
            않습니다.
        </p>
        <p class="muted">
            {{
                accountId
                    ? accounts.find((a) => a.id === accountId)?.name
                    : '부부 합산'
            }}
            · USD/KRW는 합산하지 않습니다. 매수·환전 자체는 새 원금으로 집계하지
            않습니다. 배당 재투자 계산은 후속 기능입니다.
        </p>
        <div class="capital-cards">
            <article
                v-for="(totals, currency) in capital.currencies"
                :key="currency">
                <h3>
                    {{ currency === 'Usd' ? 'USD' : 'KRW' }} ·
                    {{
                        totals.complete
                            ? '등록 입출금 분류 완료'
                            : '원금 미확정'
                    }}
                </h3>
                <dl>
                    <dt>확인된 외부 순입금</dt>
                    <dd>
                        {{
                            amount(
                                totals.externalNet,
                                currency === 'Usd' ? 'USD' : 'KRW'
                            )
                        }}
                    </dd>
                    <dt>확인된 원금 잔여분 · 부분 합계</dt>
                    <dd>
                        {{
                            amount(
                                totals.confirmedPrincipal,
                                currency === 'Usd' ? 'USD' : 'KRW'
                            )
                        }}
                    </dd>
                    <dt>배당 활용 출금 · 원금 차감 제외</dt>
                    <dd>
                        {{
                            amount(
                                totals.dividendReuseWithdrawals,
                                currency === 'Usd' ? 'USD' : 'KRW'
                            )
                        }}
                    </dd>
                    <template v-if="accountId"
                        ><dt>계좌 간 이체 순액 · 외부원금 아님</dt>
                        <dd>
                            {{
                                amount(
                                    totals.transferNet,
                                    currency === 'Usd' ? 'USD' : 'KRW'
                                )
                            }}
                        </dd></template
                    >
                    <dt>금액/출처 확인 필요</dt>
                    <dd>{{ totals.pending }}건</dd>
                </dl>
                <small v-if="!capital.events"
                    >입출금 대조 자료가 없습니다. 0원으로 확정된 것이
                    아닙니다.</small
                >
                <small
                    >등록 자료만의 합계이며 전체 계좌 원금의 완전성을 보장하지
                    않습니다.</small
                >
            </article>
        </div>
        <details>
            <summary>
                시트 보존 원본 · 예상/오류/보류 행 포함 ({{
                    archives.length
                }}개)
            </summary>
            <p>
                가져오기 확정 시 시험 장부에 별도 보존합니다. 기존 구글시트와
                PDF Firebase 데이터는 수정하지 않습니다.
            </p>
            <p v-if="!archives.length">
                원본 스냅샷은 아직 없습니다. 거래 등록 여부와는 별개이며 기존
                구글시트 원본은 그대로 유지됩니다.
            </p>
            <div
                v-for="archive in archives"
                :key="archive.id"
                class="archive-row">
                <span
                    >{{ archive.cutoff }} · 제외/보류
                    {{ archive.excludedCount }}건 ·
                    {{ archive.bytes }} bytes</span
                >
                <Button
                    label="보존 원본 다운로드"
                    severity="secondary"
                    :disabled="busy || disabled"
                    @click="emit('archive', archive.id)" />
            </div>
        </details>
        <details>
            <summary>대조 자료 제출 · 실제 웹 자동수집과 구분</summary>
            <p>
                토스/PDF에서 확보한 관측값을 JSON 배열로 제출합니다. 저장해도
                기존 거래값은 바뀌지 않습니다. 원문 위치와 계좌를 지정하고,
                확인하지 못한 값은 null로 두세요.
            </p>
            <p>
                허용 출처: PDF, TOSS_TRANSACTION, TOSS_ORDER,
                TOSS_EXPECTED_DIVIDEND. 비밀번호·인증 토큰은 입력하지 마세요.
            </p>
            <pre class="example">
[{"kind":"TOSS_TRANSACTION","sourceId":"고유번호","accountId":"wife","type":"WITHDRAWAL","location":"거래내역 상세 위치","values":{"date":"2026-10-12","transactionAt":"2026-10-12 14:51","cashKrw":1000}}]</pre
            >
            <label for="reconciliation-json">대조 자료 JSON</label>
            <textarea
                id="reconciliation-json"
                v-model="input"
                rows="6"
                :disabled="busy || disabled" />
            <p v-if="inputError" role="alert">{{ inputError }}</p>
            <div class="actions">
                <Button
                    label="대조 자료 미리보기"
                    :disabled="busy || disabled || !input.trim()"
                    @click="submit('batch-preview')" />
                <Button
                    v-if="preview"
                    label="대조 자료만 저장"
                    :disabled="busy || disabled"
                    @click="submit('batch-commit')" />
            </div>
            <div v-if="preview" role="status">
                신규 {{ preview.staged.additions.length }}건 · 중복
                {{ preview.staged.duplicates }}건. 예상 배당은 실제 거래에
                포함되지 않습니다.
            </div>
        </details>
        <details :open="visibleObservations.length <= 100">
            <summary>
                대조 자료 목록 · {{ visibleObservations.length }}건
            </summary>
            <label for="observation-search">대조 자료 검색</label>
            <InputText
                id="observation-search"
                v-model="observationSearch"
                placeholder="티커·원본 번호·위치" />
            <div class="actions">
                <Button
                    label="대조 자료 처음으로"
                    severity="secondary"
                    @click="observationWindow.jump(false)" />
                <Button
                    label="대조 자료 끝으로"
                    severity="secondary"
                    @click="observationWindow.jump(true)" />
            </div>
            <div ref="observationRegion">
                <div
                    :style="{
                        height: observationWindow.paddingTop.value + 'px',
                    }"
                    aria-hidden="true" />
                <div ref="observationTable">
                    <DataTable
                        :value="observationWindow.renderedRows.value"
                        :pt="{
                            bodyRow: observationWindow.rowAttributes,
                            table: {
                                'aria-rowcount': visibleObservations.length + 1,
                            },
                        }"
                        data-key="id"
                        scrollable
                        size="small"
                        table-style="min-width: 720px">
                        <template #empty
                            >등록된 대조 자료가 없습니다. 토스 브라우저 수집
                            완료를 의미하지 않습니다.</template
                        >
                        <Column header="계좌"
                            ><template #body="{ data }">{{
                                accounts.find((a) => a.id === data.accountId)
                                    ?.name
                            }}</template></Column
                        >
                        <Column header="출처"
                            ><template #body="{ data }">{{
                                sourceKinds[data.kind]
                            }}</template></Column
                        >
                        <Column field="symbol" header="티커" />
                        <Column field="location" header="원본 위치" />
                        <Column header="상태"
                            ><template #body="{ data }">{{
                                data.forecast
                                    ? '예상 · 실제 거래 제외'
                                    : data.acceptedTargetId
                                      ? '관리자 채택 이력 있음'
                                      : data.targetId
                                        ? '연결 후보 · 미확정'
                                        : '미매칭 · 확인 필요'
                            }}</template></Column
                        >
                        <Column header="검토"
                            ><template #body="{ data }"
                                ><Button
                                    label="출처 비교"
                                    severity="secondary"
                                    :disabled="busy || disabled"
                                    @click="
                                        selectedId = data.id;
                                        emit('inspect', data);
                                    " /></template
                        ></Column>
                    </DataTable>
                </div>
                <div
                    :style="{
                        height: observationWindow.paddingBottom.value + 'px',
                    }"
                    aria-hidden="true" />
            </div>
        </details>
        <div v-if="selected" class="review-editor">
            <h3>
                {{ sourceKinds[selected.kind] }} ·
                {{ selected.symbol || selected.type }}
            </h3>
            <p>{{ selected.location }} · {{ selected.capture }}</p>
            <details v-if="selected.original">
                <summary>보존된 제출 원문</summary>
                <pre class="example">{{
                    JSON.stringify(selected.original, null, 2)
                }}</pre>
            </details>
            <pre v-if="selected.rawText" class="example">{{
                selected.rawText
            }}</pre>
            <label for="evidence-target">연결할 시험 거래</label>
            <Select
                v-model="targetId"
                input-id="evidence-target"
                aria-label="연결할 시험 거래"
                :options="[
                    { id: '', label: '신규 시험 거래로 검토' },
                    ...targets,
                ]"
                option-label="label"
                option-value="id"
                :disabled="busy || disabled || selected.forecast" />
            <p v-if="selected.forecast">
                예상 배당은 대조 자료로만 보존하며 실제 입금으로 채택할 수
                없습니다.
            </p>
            <label v-if="!targetId && !selected.forecast" class="field-choice">
                <input
                    v-model="separateEvent"
                    type="checkbox"
                    :disabled="busy || disabled" />
                같은 날짜의 기존 후보와 다른 사건임을 원본 번호·일시로
                확인했습니다.
            </label>
            <DataTable
                v-if="target"
                :value="comparisons"
                scrollable
                size="small"
                table-style="min-width: 1000px">
                <Column header="필드"
                    ><template #body="{ data }">{{
                        label(data.field)
                    }}</template></Column
                >
                <Column header="최초 등록값"
                    ><template #body="{ data }">{{
                        display(data.baseline)
                    }}</template></Column
                >
                <Column
                    v-for="(name, kind) in sourceKinds"
                    :key="kind"
                    :header="name">
                    <template #body="{ data }"
                        ><div v-for="s in sourceValue(data, kind)" :key="s.id">
                            {{ display(s.value)
                            }}<small>{{ s.location }}</small>
                        </div>
                        <span v-if="!sourceValue(data, kind).length"
                            >미확인</span
                        ></template
                    >
                </Column>
                <Column header="차이/채택"
                    ><template #body="{ data }"
                        >{{ data.conflict ? '출처 간 불일치' : '충돌 없음' }} ·
                        {{ data.decision ? '관리자 채택됨' : '미확정'
                        }}<small>현재값: {{ display(data.current) }}</small
                        ><small v-if="data.decision"
                            >근거: {{ data.decision.note }}</small
                        ></template
                    ></Column
                >
            </DataTable>
            <fieldset :disabled="busy || disabled || selected.forecast">
                <legend>채택할 관측값 · 원본은 유지됩니다</legend>
                <label
                    v-for="(value, field) in selected.values"
                    :key="field"
                    class="field-choice">
                    <input
                        v-model="fields"
                        type="checkbox"
                        :value="field"
                        :disabled="value === null" />
                    {{ label(field) }}: {{ display(value) }}
                </label>
            </fieldset>
            <label for="evidence-note">관리자 확인 근거</label>
            <textarea
                id="evidence-note"
                v-model="note"
                rows="2"
                :disabled="busy || disabled" />
            <Button
                label="선택한 값만 시험 장부에 채택"
                :disabled="
                    busy ||
                    disabled ||
                    selected.forecast ||
                    !note.trim() ||
                    !fields.length
                "
                @click="accept" />
            <fieldset
                v-if="target && ['DEPOSIT', 'WITHDRAWAL'].includes(target.type)"
                :disabled="busy || disabled">
                <legend>입출금 자금 출처 확인 · 자동 FIFO/비례배분 없음</legend>
                <label for="cash-scope">이동 범위</label>
                <Select
                    v-model="scope"
                    input-id="cash-scope"
                    aria-label="이동 범위"
                    :options="[
                        { id: 'UNKNOWN', label: '미확인' },
                        { id: 'EXTERNAL', label: '외부 입출금' },
                        { id: 'ACCOUNT_TRANSFER', label: '부부 계좌 간 이체' },
                    ]"
                    option-label="label"
                    option-value="id" />
                <label for="cash-origin">자금 출처</label>
                <Select
                    v-model="origin"
                    input-id="cash-origin"
                    aria-label="자금 출처"
                    :options="[
                        { id: 'UNKNOWN', label: '미확인' },
                        { id: 'PRINCIPAL', label: '본인 원금' },
                        { id: 'DIVIDEND_PROFIT', label: '배당 이익 활용' },
                        { id: 'MIXED', label: '혼합 · 관리자 추가 확인' },
                    ]"
                    option-label="label"
                    option-value="id" />
                <template v-if="scope === 'ACCOUNT_TRANSFER'"
                    ><label for="cash-peer">상대 계좌</label
                    ><Select
                        v-model="peer"
                        input-id="cash-peer"
                        aria-label="상대 계좌"
                        :options="
                            accounts.filter((a) => a.id !== target.accountId)
                        "
                        option-label="name"
                        option-value="id"
                /></template>
                <Button
                    label="입출금 분류 확인"
                    :disabled="busy || disabled || !note.trim()"
                    @click="classify" />
            </fieldset>
            <details v-if="target?.review?.history?.length">
                <summary>
                    관리자 확인 이력 ({{ target.review.history.length }}개)
                </summary>
                <p v-for="(entry, index) in target.review.history" :key="index">
                    {{ entry.at }} · {{ entry.note }}
                </p>
            </details>
        </div>
    </section>
</template>

<style scoped>
    .reconciliation-panel {
        padding: 1.25rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: 12px;
        background: var(--p-content-background);
        margin: 1.5rem 0;
        min-width: 0;
    }
    .capital-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
        gap: 1rem;
    }
    article,
    .review-editor {
        border: 1px solid var(--p-content-border-color);
        border-radius: 8px;
        padding: 1rem;
        margin: 1rem 0;
        min-width: 0;
    }
    dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.5rem;
    }
    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
    small {
        display: block;
        opacity: 0.8;
    }
    details {
        margin: 1rem 0;
    }
    summary {
        cursor: pointer;
    }
    textarea {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin: 0.5rem 0;
        background: var(--p-form-field-background);
        color: var(--p-form-field-color);
        border: 1px solid var(--p-form-field-border-color);
        border-radius: 6px;
        padding: 0.75rem;
    }
    .example {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 200px;
        overflow: auto;
    }
    .actions,
    .archive-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
    }
    .field-choice {
        display: block;
        margin: 0.5rem 0;
    }
    fieldset {
        min-width: 0;
        margin: 1rem 0;
        border: 1px solid var(--p-content-border-color);
    }
    fieldset .p-select {
        display: flex;
        margin: 0.5rem 0;
    }
</style>
