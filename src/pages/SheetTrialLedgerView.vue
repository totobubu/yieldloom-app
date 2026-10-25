<script setup>
    import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
    import Select from 'primevue/select';
    import { firebaseUser } from '@/services/firebaseClient.js';
    import {
        connectGoogleSheet,
        createSheetLedgerClient,
    } from '@/services/sheetLedger.js';
    import {
        accounts,
        fundingSources,
        numericFields,
        statuses,
        summarize,
        spreadsheetId,
        types,
    } from '../../lib/sheet-ledger.js';

    const client = createSheetLedgerClient();
    const rows = ref([]),
        version = ref(0),
        preview = ref(null),
        busy = ref(false),
        progress = ref(''),
        error = ref(''),
        notice = ref('');
    const url = ref(
        'https://docs.google.com/spreadsheets/d/15j5-2_FBiHp4Ie95yCytS-i07fiojpw2TyLhd-aVAe8/edit'
    );
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
    let googleToken = null,
        generation = 0;
    const connected = ref(false);
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
    };
    const typeLabels = {
        BUY: '매수',
        SELL: '매도',
        DIVIDEND: '배당',
        FEE: '비용',
    };
    const activeRows = computed(() => preview.value?.rows || rows.value);
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
                    `${r.symbol} ${r.source.sheet}`
                        .toLowerCase()
                        .includes(search.value.toLowerCase()))
        )
    );
    const summary = computed(() => summarize(filtered.value));
    const newCount = computed(
        () => preview.value?.rows.filter((r) => !r.duplicate).length || 0
    );
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
                if (e.code === 'google_reconnect_required') {
                    googleToken = null;
                    connected.value = false;
                    error.value =
                        'Google 연결이 만료되었습니다. 미리보기 분석을 눌러 다시 연결해 주세요.';
                } else error.value = e.message;
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
    }
    async function load() {
        await run(async (current) => {
            const result = await client.load(firebaseUser.value);
            if (current === generation) apply(result);
        }, '시험 장부를 불러오는 중입니다.');
    }
    async function analyze() {
        await run(async (current) => {
            if (!firebaseUser.value)
                throw new Error('관리자 로그인이 필요합니다.');
            // Validate in the page as well so native form validation cannot silently
            // suppress clicks and keyboard submissions.
            spreadsheetId(url.value);
            if (!googleToken) {
                progress.value =
                    'Google 읽기 권한을 연결하는 중입니다. 열린 팝업을 확인해 주세요.';
                const token = await connectGoogleSheet(firebaseUser.value);
                if (current !== generation) return;
                googleToken = token;
                connected.value = true;
            }
            progress.value =
                '구글시트 내용을 읽고 실제 거래를 분석하는 중입니다.';
            const result = await client.mutate(firebaseUser.value, 'POST', {
                action: 'preview',
                url: url.value,
                googleToken,
            });
            if (current === generation) {
                preview.value = result;
                notice.value = `분석 완료: ${result.rows.length}개 거래를 미리보기에서 확인해 주세요.`;
            }
        }, '시트 불러오기를 시작합니다.');
    }
    async function commit() {
        await run(async (current) => {
            const result = await client.mutate(firebaseUser.value, 'POST', {
                action: 'commit',
                url: url.value,
                googleToken,
                version: preview.value.version,
                fingerprint: preview.value.fingerprint,
            });
            if (current !== generation) return;
            apply(result);
            preview.value = null;
            googleToken = null;
            connected.value = false;
            notice.value = `${result.imported}개 거래를 시험 계좌에 저장했습니다.`;
        });
    }
    async function save() {
        await run(async (current) => {
            const result = await client.mutate(firebaseUser.value, 'PATCH', {
                id: editing.value.id,
                version: version.value,
                patch: editing.value,
            });
            if (current === generation) {
                apply(result);
                editing.value = null;
                notice.value = '거래를 수정했습니다.';
            }
        });
    }
    watch(url, () => {
        preview.value = null;
    });
    watch(
        () =>
            firebaseUser.value
                ? `${firebaseUser.value.uid}:${firebaseUser.value.email}:${firebaseUser.value.emailVerified}`
                : null,
        () => {
            generation++;
            client.clear();
            rows.value = [];
            preview.value = null;
            editing.value = null;
            googleToken = null;
            connected.value = false;
            busy.value = false;
            progress.value = '';
            if (firebaseUser.value) load();
        }
    );
    onMounted(load);
    onBeforeUnmount(() => {
        generation++;
        googleToken = null;
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
                :disabled="Boolean(preview)"
                @click="load" />
        </header>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <Message v-if="notice" severity="success" :closable="false">{{
            notice
        }}</Message>
        <section class="import-panel" aria-label="구글시트 가져오기">
            <h2>구글시트 가져오기</h2>
            <p>
                夫·夫배당은 남편, 妻·妻배당은 아내 계좌로 가져옵니다. 실제
                거래만 미리보기에서 확인한 후 저장하세요.
            </p>
            <form class="import-actions" novalidate @submit.prevent="analyze">
                <label class="url-field" for="sheet-url"
                    >시트 URL<InputText
                        id="sheet-url"
                        v-model="url"
                        type="url"
                        required
                        :disabled="busy"
                /></label>
                <Button
                    type="button"
                    :label="busy ? '처리 중' : '미리보기 분석'"
                    icon="pi pi-search"
                    :loading="busy"
                    :disabled="busy"
                    @click="analyze" />
            </form>
            <p role="status" aria-live="polite">
                {{
                    progress ||
                    (connected
                        ? 'Google 연결됨 · 다시 연결할 필요 없이 분석할 수 있습니다.'
                        : '분석 버튼을 누르면 필요한 경우 Google 읽기 권한을 연결합니다.')
                }}
            </p>
            <p class="muted">
                최초 이전용 · 저장 후 수정은 시험 장부에 반영됩니다. 누락 비용은
                0원이 아닌 ‘미확인’입니다.
            </p>
            <div v-if="preview" class="preview-notice">
                <Message severity="info" :closable="false"
                    >미리보기: 신규 {{ newCount }}개 · 중복
                    {{ preview.rows.length - newCount }}개 · 제외/보류
                    {{ preview.excluded.length }}개 · 기준일
                    {{ preview.cutoff }}</Message
                >
                <p v-for="warning in preview.warnings" :key="warning">
                    {{ warning }}
                </p>
                <div class="import-actions">
                    <Button
                        label="확인한 신규 거래 저장"
                        icon="pi pi-check"
                        :loading="busy"
                        :disabled="!newCount"
                        @click="commit" /><Button
                        label="미리보기 닫기"
                        severity="secondary"
                        :disabled="busy"
                        @click="preview = null" />
                </div>
                <details>
                    <summary>제외·보류 행과 사유 확인</summary>
                    <DataTable
                        :value="preview.excluded"
                        paginator
                        :rows="10"
                        size="small"
                        ><Column field="sheet" header="원본 시트" /><Column
                            field="row"
                            header="행" /><Column
                            field="symbol"
                            header="티커" /><Column
                            field="reason"
                            header="사유"
                    /></DataTable>
                </details>
            </div>
        </section>
        <section class="summary-grid" aria-label="거래 요약">
            <article>
                <span>확인된 본인원금</span
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
                <span>배당 재투자금 · 추정 포함</span
                ><strong>{{ money(summary.reinvestedUsd) }}</strong>
            </article>
            <article>
                <span>미확인·검토 필요</span
                ><strong>{{ summary.unknown }}행</strong>
            </article>
        </section>
        <section class="ledger-list" aria-label="거래 목록">
            <div class="filters">
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
                    >{{ filtered.length }}개 거래{{
                        preview ? ' · 미리보기' : ''
                    }}</span
                >
            </div>
            <p class="muted">
                USD와 KRW는 같은 금액의 통화별 표기이며 합산하지 않습니다. 매도
                행의 거래금액은 매도대금입니다.
            </p>
            <DataTable
                :value="filtered"
                data-key="id"
                scrollable
                scroll-height="560px"
                paginator
                :rows="25"
                :rows-per-page-options="[25, 50, 100]"
                sort-field="date"
                :sort-order="-1"
                size="small"
                striped-rows
                :loading="busy"
                table-style="min-width: 3700px">
                <template #empty
                    >저장된 거래가 없습니다. Google 읽기 권한을 연결하고 시트를
                    분석해 주세요.</template
                >
                <Column
                    field="accountId"
                    header="계좌"
                    frozen
                    style="min-width: 80px"
                    ><template #body="{ data }">{{
                        accounts.find((a) => a.id === data.accountId)?.name
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
                                (data[field] == null ? '미확인' : '원본값')
                            "
                            >{{ display(data[field], field)
                            }}<small v-if="data.fieldStatus[field] === '추정'">
                                (추정)</small
                            ></span
                        ></template
                    ></Column
                >
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
                <Column field="status" header="상태" style="min-width: 110px"
                    ><template #body="{ data }"
                        ><Tag
                            :value="data.duplicate ? '중복' : data.status"
                            :severity="
                                data.status === '확정' ? 'success' : 'warn'
                            " /></template
                ></Column>
                <Column header="원본·검토 근거" style="min-width: 250px"
                    ><template #body="{ data }"
                        ><a
                            :href="`https://docs.google.com/spreadsheets/d/${data.source.spreadsheetId}/edit#gid=${data.source.sheetId}&range=A${data.source.row}`"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ data.source.sheet }} {{ data.source.row }}행</a
                        >
                        <details v-if="data.evidence.length">
                            <summary>근거 {{ data.evidence.length }}개</summary>
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
                            :disabled="Boolean(preview) || busy"
                            @click="
                                editing = JSON.parse(JSON.stringify(data))
                            " /></template
                ></Column>
            </DataTable>
        </section>
        <Dialog
            v-model:visible="editOpen"
            modal
            header="거래 수정"
            :style="{ width: '760px', maxWidth: '95vw' }"
            :closable="!busy">
            <form v-if="editing" class="edit-form" @submit.prevent="save">
                <p>
                    빈 금액은 미확인으로 저장됩니다. 원본 추적 정보와 거래유형은
                    유지됩니다.
                </p>
                <Message v-if="error" severity="error" :closable="false">{{
                    error
                }}</Message>
                <div class="edit-grid">
                    <label for="edit-symbol"
                        >티커<InputText
                            id="edit-symbol"
                            v-model="editing.symbol"
                            required
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
                    label="수정 저장"
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
