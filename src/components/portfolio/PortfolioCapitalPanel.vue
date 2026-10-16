<script setup>
    import { computed, nextTick, ref, watch } from 'vue';
    import WithdrawalSplit from './WithdrawalSplit.vue';
    import {
        capitalSummary,
        capitalRecovery,
        cashKinds,
        cashClassification,
        cashNeedsReview,
    } from '../../../lib/portfolio-capital.js';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';

    const props = defineProps({
        user: Object,
        state: Object,
        loading: Boolean,
        error: String,
        accountId: String,
        readOnly: Boolean,
    });
    const panel = ref(null),
        cashReview = ref(null);
    const emit = defineEmits(['refresh']);
    const summary = computed(() =>
        capitalSummary(props.state.entries, props.state.classifications)
    );
    const recovery = computed(() =>
        capitalRecovery(props.state.entries, props.state.classifications)
    );
    const percent = (value) =>
        `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    const money = (n, currency) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'KRW' ? 0 : 6,
        }).format(n);
    const date = (value) =>
        String(value || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3');
    const filter = ref('pending'),
        page = ref(1),
        busy = ref(false),
        error = ref(''),
        success = ref('');
    const edits = ref({});
    watch(
        () => props.state,
        (state) => {
            edits.value = Object.fromEntries(
                state.entries.map((entry) => {
                    const confirmed = state.classifications.find(
                        (row) => row.id === entry.id
                    );
                    const previous = edits.value[entry.id];
                    if (
                        previous &&
                        previous.revision === (confirmed?.revision || 0)
                    )
                        return [entry.id, previous];
                    return [
                        entry.id,
                        {
                            classification:
                                confirmed?.classification ||
                                entry.suggestedKind ||
                                'unknown',
                            note: confirmed?.note || '',
                            withdrawalParts: confirmed?.withdrawalParts || {
                                principal: 0,
                                dividend: 0,
                                profit: 0,
                                unknown: entry.amount,
                            },
                            revision: confirmed?.revision || 0,
                        },
                    ];
                })
            );
        },
        { immediate: true }
    );
    const entries = computed(() =>
        [...props.state.entries]
            .sort((a, b) =>
                String(b.date)
                    .replace(/\D/g, '')
                    .localeCompare(String(a.date).replace(/\D/g, ''))
            )
            .filter(
                (entry) =>
                    filter.value !== 'pending' ||
                    cashNeedsReview(
                        entry,
                        props.state.classifications.find(
                            (row) => row.id === entry.id
                        )
                    )
            )
    );
    const visible = computed(() =>
        entries.value.slice((page.value - 1) * 10, page.value * 10)
    );
    watch(filter, () => {
        page.value = 1;
    });
    watch(entries, (rows) => {
        if ((page.value - 1) * 10 >= rows.length)
            page.value = Math.max(1, Math.ceil(rows.length / 10));
    });
    const adding = ref(false);
    const newEntry = () => ({
        id: crypto.randomUUID(),
        date: new Date().toLocaleDateString('sv-SE', {
            timeZone: 'Asia/Seoul',
        }),
        currency: 'KRW',
        amount: '',
        classification: 'external_deposit',
        exchangeRate: '',
        withdrawalParts: { principal: 0, dividend: 0, profit: 0, unknown: 0 },
        note: '',
    });
    const form = ref(null);
    function openAdd() {
        form.value = newEntry();
        adding.value = true;
    }
    function classificationError(input, entry) {
        try {
            cashClassification(input, entry);
            return '';
        } catch (reason) {
            return reason.message;
        }
    }
    function seedSplit(input, amount) {
        if (
            input.classification === 'mixed_withdrawal' &&
            !Object.values(input.withdrawalParts || {}).some(
                (value) => Number(value) > 0
            )
        )
            input.withdrawalParts = {
                principal: 0,
                dividend: 0,
                profit: 0,
                unknown: amount,
            };
    }
    async function openEntry(id) {
        filter.value = 'all';
        await nextTick();
        const index = entries.value.findIndex((entry) => entry.id === id);
        if (index >= 0) page.value = Math.floor(index / 10) + 1;
        await nextTick();
        if (!cashReview.value) return;
        cashReview.value.open = true;
        await nextTick();
        const row = [...panel.value.querySelectorAll('[data-cash-id]')].find(
            (row) => row.dataset.cashId === id
        );
        (row || panel.value).scrollIntoView({ block: 'center' });
        row?.querySelector('select')?.focus({ preventScroll: true });
    }
    defineExpose({ openEntry });
    async function save(input) {
        busy.value = true;
        error.value = '';
        success.value = '';
        try {
            await portfolioCapitalRequest(props.user, input, props.accountId);
            if (input.action === 'addCash') adding.value = false;
            success.value = '계좌 내역을 저장했습니다.';
            emit('refresh');
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
</script>

<template>
    <section
        ref="panel"
        class="capital-panel"
        aria-label="투자 원금 대비 회수 현황">
        <div class="heading">
            <div>
                <h2>투자 원금 대비 얼마나 회수했나요?</h2>
                <p>
                    현금 회수율은 실제 외부 출금 기준입니다. 배당·수익의 출금도
                    포함하며, 계좌 안의 재투자·환전은 새 원금이나 회수금으로
                    더하지 않습니다. 아래 출금 원천별 분류와 구분합니다.
                </p>
            </div>
            <button
                type="button"
                :disabled="loading || busy || readOnly"
                @click="openAdd">
                계좌 내역 직접 추가
            </button>
        </div>
        <p v-if="loading" role="status">계좌 내역을 불러오는 중입니다.</p>
        <p v-if="props.error" role="alert" class="error">
            {{ props.error }}
            <button type="button" @click="emit('refresh')">다시 시도</button>
        </p>
        <template v-else-if="!loading || state.entries.length">
            <p class="recovery-filter">회수금 기준 · 실제 외부 출금액</p>
            <div class="recovery-grid">
                <article
                    v-for="item in recovery"
                    :key="item.currency"
                    class="recovery-card">
                    <small>계좌 회수율 · {{ item.currency }}</small>
                    <strong class="recovery-rate">{{
                        item.rate === null
                            ? '원금 확인 필요'
                            : percent(item.rate)
                    }}</strong>
                    <progress
                        v-if="item.rate !== null"
                        :value="Math.min(item.rate, 100)"
                        max="100"
                        :aria-label="`${item.currency} 원금 회수 진행률`" />
                    <dl>
                        <div>
                            <dt>누적 투자 원금</dt>
                            <dd>{{ money(item.principal, item.currency) }}</dd>
                        </div>
                        <div>
                            <dt>누적 회수금</dt>
                            <dd>{{ money(item.recovered, item.currency) }}</dd>
                        </div>
                        <div>
                            <dt>원금까지 남은 금액</dt>
                            <dd>
                                {{
                                    item.rate === null
                                        ? '—'
                                        : money(item.remaining, item.currency)
                                }}
                            </dd>
                        </div>
                    </dl>
                    <span v-if="item.rate >= 100"
                        >투자 원금 이상 회수했습니다.</span
                    >
                </article>
            </div>
            <p class="help">
                확정한 계좌 입출금 내역만 집계합니다. 종목별 거래 원장은 별도
                합산하지 않습니다. 회수율 = 실제 외부 출금액 ÷ 확정한 외부 입금
                × 100. 배당·매도대금의 재투자는 원금에 더하지 않습니다. 계좌
                안에서 받은 배당·매도금은 현금 회수와 다릅니다. 미회수액은
                손실이 아니며 추가 입금 시 회수율이 낮아질 수 있습니다.
            </p>
            <p v-if="summary.pending" class="help" role="status">
                분류 확인 필요 {{ summary.pending }}건을 제외한 잠정 수치입니다.
            </p>
            <h3>투자 원금 확인</h3>
            <p class="help">순입금은 확정한 외부 입금 − 외부 출금입니다.</p>
            <div class="totals">
                <article v-for="currency in ['KRW', 'USD']" :key="currency">
                    <small>저장된 내역 기준 원금 · {{ currency }}</small>
                    <strong>{{
                        !state.entries.length
                            ? '내역 필요'
                            : summary.pending ||
                                summary[currency].capitalAfterRecovery < 0
                              ? '확인 필요'
                              : money(
                                    summary[currency].capitalAfterRecovery,
                                    currency
                                )
                    }}</strong>
                    <span
                        >확인한 외부 입금
                        {{ money(summary[currency].deposits, currency) }} · 원금
                        회수
                        {{
                            money(
                                summary[currency].principalWithdrawals,
                                currency
                            )
                        }}</span
                    >
                    <span
                        >배당 사용
                        {{ money(summary[currency].dividendUsed, currency) }} ·
                        기타 수익 사용
                        {{
                            money(summary[currency].profitUsed, currency)
                        }}</span
                    >
                    <span
                        >출금 출처 미확인
                        {{
                            money(
                                summary[currency].unknownWithdrawals,
                                currency
                            )
                        }}</span
                    >
                    <span class="cash-net"
                        >순입금 (현금 흐름)
                        {{ money(summary[currency].net, currency) }} · 전체 외부
                        출금
                        {{
                            money(summary[currency].withdrawals, currency)
                        }}</span
                    >
                </article>
            </div>
            <p class="help">
                순입금은 전체 외부 입금 − 전체 외부 출금으로 원금과 다릅니다.
                배당 사용은 누적 수령 배당에서 차감하지 않으며, 나머지를
                재투자로 가정하지 않습니다. 미확인 내역이 있으면 원금 확정을
                보류합니다. 전체 계좌 개설 이후 원금이 아닐 수 있습니다. 조회
                시작 전 자금·누락된 내역을 확인해 주세요. 달러 입출금은 달러로
                집계하며 임의의 환율로 원화에 합산하지 않습니다.
            </p>
            <p v-if="summary.dates.length" class="help">
                저장된 계좌 거래일 {{ date(summary.dates[0]) }} ~
                {{ date(summary.dates.at(-1)) }} · 분류 확인 필요
                {{ summary.pending }}건 · 마이페이지 기간 필터와 별도로 전체
                저장 내역 기준
            </p>
            <p v-else-if="accountId" class="help">
                아직 계좌 내역이 없습니다. 입출금·환전이 포함된 PDF를
                업로드하거나 실제 계좌 내역을 직접 추가해 주세요. 기존 주식
                거래만으로 원금을 추정하지 않습니다.
            </p>
            <p v-if="!state.entries.length && !accountId" class="help">
                이전 계좌의 입출금 내역은 직접 추가해 주세요. 가족 포트폴리오의
                새 계좌와는 별도로 집계합니다.
            </p>
            <p v-if="readOnly" class="help">
                조회 권한으로 열었습니다. 수정하려면 계좌 편집 권한이
                필요합니다.
            </p>
            <details
                ref="cashReview"
                class="cash-review"
                :open="adding || undefined">
                <summary>계좌 내역 검토 · {{ state.entries.length }}건</summary>
                <p class="help">
                    PDF 분류는 후보입니다. 원본에서 외부 입출금인지 확인한 뒤
                    확정하세요. 잘못 분류한 행은 ‘확인 필요’로 되돌릴 수
                    있습니다. 직접 입력을 제외하려면 ‘계좌 내 이동’으로 분류하고
                    메모를 남겨 주세요.
                </p>
                <form
                    v-if="adding && form"
                    class="cash-form"
                    @submit.prevent="save({ action: 'addCash', ...form })">
                    <h3>계좌 내역 직접 추가</h3>
                    <label
                        >거래일<input v-model="form.date" type="date" required
                    /></label>
                    <label
                        >통화<select
                            v-model="form.currency"
                            aria-label="계좌 거래 통화">
                            <option>KRW</option>
                            <option>USD</option>
                        </select></label
                    >
                    <label
                        >금액<input
                            v-model="form.amount"
                            type="number"
                            :min="form.currency === 'KRW' ? '1' : '0.000001'"
                            :step="form.currency === 'KRW' ? '1' : '0.000001'"
                            required
                    /></label>
                    <label
                        >구분<select
                            v-model="form.classification"
                            aria-label="계좌 거래 구분"
                            @change="seedSplit(form, form.amount)">
                            <option
                                v-for="(label, kind) in cashKinds"
                                :key="kind"
                                :value="kind">
                                {{ label }}
                            </option>
                        </select></label
                    >
                    <label
                        >기록 환율 (선택)<input
                            v-model="form.exchangeRate"
                            type="number"
                            min="0.000001"
                            step="0.000001"
                    /></label>
                    <WithdrawalSplit
                        v-if="form.classification === 'mixed_withdrawal'"
                        v-model="form.withdrawalParts"
                        class="wide"
                        :amount="form.amount"
                        :currency="form.currency"
                        :disabled="busy || loading || readOnly" />
                    <p
                        v-if="classificationError(form, form)"
                        class="error wide"
                        role="status">
                        {{ classificationError(form, form) }}
                    </p>
                    <label class="wide"
                        >확인 근거·메모<input
                            v-model="form.note"
                            maxlength="500"
                            placeholder="계좌 거래일과 실제 입출금 내역을 확인한 근거"
                            required
                    /></label>
                    <div class="actions wide">
                        <button
                            :disabled="
                                busy || !!classificationError(form, form)
                            ">
                            {{ busy ? '저장 중' : '확인 후 추가' }}</button
                        ><button
                            type="button"
                            :disabled="busy"
                            @click="adding = false">
                            취소
                        </button>
                    </div>
                </form>
                <label
                    >표시할 계좌 내역<select v-model="filter">
                        <option value="pending">확인 필요</option>
                        <option value="all">전체 내역</option>
                    </select></label
                >
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>거래일·원본 구분</th>
                                <th>계좌 금액</th>
                                <th>사용자 분류·메모</th>
                                <th>확인</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="entry in visible"
                                :key="entry.id"
                                :data-cash-id="entry.id">
                                <td>
                                    {{ date(entry.date)
                                    }}<small
                                        >{{ entry.rawType }} ·
                                        {{
                                            entry.source === 'manual'
                                                ? '직접 입력'
                                                : 'PDF'
                                        }}</small
                                    >
                                </td>
                                <td>
                                    {{ money(entry.amount, entry.currency)
                                    }}<small v-if="entry.exchangeRate"
                                        >기록 환율
                                        {{ entry.exchangeRate }}</small
                                    >
                                </td>
                                <td v-if="edits[entry.id]">
                                    <select
                                        v-model="edits[entry.id].classification"
                                        :disabled="readOnly || busy || loading"
                                        :aria-label="`${date(entry.date)} 계좌 내역 분류`"
                                        @change="
                                            seedSplit(
                                                edits[entry.id],
                                                entry.amount
                                            )
                                        ">
                                        <option
                                            v-for="(label, kind) in cashKinds"
                                            :key="kind"
                                            :value="kind">
                                            {{ label }}
                                        </option></select
                                    ><input
                                        v-model="edits[entry.id].note"
                                        :disabled="readOnly || busy || loading"
                                        maxlength="500"
                                        aria-label="분류 메모"
                                        placeholder="확인 근거·메모" />
                                    <WithdrawalSplit
                                        v-if="
                                            edits[entry.id].classification ===
                                            'mixed_withdrawal'
                                        "
                                        v-model="
                                            edits[entry.id].withdrawalParts
                                        "
                                        :amount="entry.amount"
                                        :currency="entry.currency"
                                        :disabled="
                                            busy || loading || readOnly
                                        " />
                                    <small
                                        v-if="
                                            classificationError(
                                                edits[entry.id],
                                                entry
                                            )
                                        "
                                        class="error"
                                        >{{
                                            classificationError(
                                                edits[entry.id],
                                                entry
                                            )
                                        }}</small
                                    >
                                </td>
                                <td>
                                    <button
                                        type="button"
                                        :disabled="
                                            busy ||
                                            loading ||
                                            readOnly ||
                                            !!classificationError(
                                                edits[entry.id],
                                                entry
                                            )
                                        "
                                        @click="
                                            save({
                                                action: 'classifyCash',
                                                id: entry.id,
                                                ...edits[entry.id],
                                            })
                                        ">
                                        {{
                                            state.classifications.some(
                                                (row) => row.id === entry.id
                                            )
                                                ? '수정 저장'
                                                : '분류 확정'
                                        }}
                                    </button>
                                </td>
                            </tr>
                            <tr v-if="!visible.length">
                                <td colspan="4">
                                    표시할 계좌 내역이 없습니다.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div v-if="entries.length > 10" class="actions">
                    <button :disabled="page <= 1" @click="page--">이전</button
                    ><span
                        >{{ page }} / {{ Math.ceil(entries.length / 10) }}</span
                    ><button
                        :disabled="page * 10 >= entries.length"
                        @click="page++">
                        다음
                    </button>
                </div>
            </details>
        </template>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <p v-if="success" role="status">{{ success }}</p>
    </section>
</template>

<style scoped>
    .capital-panel {
        border: 1px solid var(--surface-border, #d1d5db);
        border-radius: 16px;
        background: var(--surface-card, #fff);
        padding: 24px;
        margin: 24px 0;
    }
    .recovery-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 16px 0;
    }
    .recovery-card {
        background: var(--app-surface-muted);
        min-width: 0;
    }
    .recovery-rate {
        font-size: clamp(1.6rem, 4vw, 2.6rem);
        color: var(--app-accent);
        overflow-wrap: anywhere;
    }
    .recovery-filter {
        margin-top: 16px;
    }
    progress {
        width: 100%;
        height: 10px;
        accent-color: var(--app-accent);
    }
    dl {
        margin: 16px 0 0;
    }
    dl > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
    }
    dt {
        color: var(--app-muted);
    }
    dd {
        margin: 0;
        text-align: right;
        overflow-wrap: anywhere;
    }
    .heading,
    .actions {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
    }
    h2,
    h3,
    p {
        margin: 0;
    }
    h2 {
        font-size: 1.2rem;
    }
    p,
    small,
    .help {
        color: var(--text-color-secondary, #666);
    }
    p {
        margin: 8px 0;
    }
    .totals {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 16px 0;
    }
    article {
        border: 1px solid var(--surface-border, #ddd);
        border-radius: 12px;
        padding: 16px;
    }
    strong,
    small,
    article span {
        display: block;
    }
    strong {
        font-size: 1.4rem;
        margin: 6px 0;
    }
    article span {
        font-size: 0.85rem;
    }
    button,
    input,
    select {
        font: inherit;
        border: 1px solid var(--surface-border, #bbb);
        border-radius: 8px;
        padding: 8px 12px;
        background: var(--surface-card, #fff);
        color: inherit;
        max-width: 100%;
    }
    button {
        cursor: pointer;
    }
    button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    details {
        margin-top: 16px;
    }
    summary {
        cursor: pointer;
        font-weight: 600;
    }
    label {
        display: grid;
        gap: 4px;
    }
    .cash-form {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 16px 0;
        padding: 16px;
        border: 1px solid var(--surface-border, #ddd);
        border-radius: 12px;
    }
    h3,
    .wide {
        grid-column: 1/-1;
    }
    .table-wrap {
        overflow-x: auto;
        margin: 12px 0;
    }
    table {
        border-collapse: collapse;
        width: 100%;
        min-width: 650px;
    }
    th,
    td {
        padding: 10px;
        text-align: left;
        border-bottom: 1px solid var(--surface-border, #ddd);
    }
    td input,
    td select {
        display: block;
        width: 100%;
        margin: 4px 0;
    }
    .error {
        color: #c62828;
    }
    .help {
        font-size: 0.88rem;
    }
    .actions {
        justify-content: flex-start;
        margin: 12px 0;
    }
    @media (max-width: 600px) {
        .capital-panel {
            padding: 16px;
        }
        .recovery-grid,
        .totals,
        .cash-form {
            grid-template-columns: 1fr;
        }
    }
</style>
