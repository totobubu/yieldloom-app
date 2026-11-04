<script setup>
    import { computed, nextTick, ref } from 'vue';
    import WithdrawalSplit from './WithdrawalSplit.vue';
    import CashEntryReview from './CashEntryReview.vue';
    import {
        capitalSummary,
        cashKinds,
        cashClassification,
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
        ['KRW', 'USD'].map((currency) => {
            const item = summary.value[currency];
            return {
                currency,
                principal: item.deposits,
                recovered: item.principalWithdrawals,
                remaining: item.capitalAfterRecovery,
                rate:
                    item.deposits > 0
                        ? (item.principalWithdrawals / item.deposits) * 100
                        : null,
            };
        })
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
    const busy = ref(false),
        saveError = ref(''),
        success = ref('');
    const reviewList = ref(null),
        reviewSaving = ref(false);
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
    async function openEntry(id, proposedParts) {
        if (!cashReview.value) return;
        cashReview.value.open = true;
        await nextTick();
        await reviewList.value?.openEntry(id, proposedParts);
    }
    defineExpose({ openEntry });
    async function save(input) {
        if (busy.value || reviewSaving.value || props.readOnly) return;
        busy.value = true;
        saveError.value = '';
        success.value = '';
        try {
            await portfolioCapitalRequest(props.user, input, props.accountId);
            if (input.action === 'addCash') adding.value = false;
            success.value = '계좌 내역을 저장했습니다.';
            emit('refresh');
        } catch (reason) {
            saveError.value = reason.message;
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
                <h2>저장 분류 기준 원금 회수</h2>
                <p>
                    저장된 현금 입출금 분류의 합계입니다. 매매 손익·기초
                    잔액·자료 누락까지 검증한 최종 남은 원금은 아래 자료
                    출처·계산 근거에서 구분해 확인하세요.
                </p>
            </div>
            <button
                type="button"
                :disabled="loading || busy || reviewSaving || readOnly"
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
            <div class="capital-metrics">
                <article class="metric-card rate-metric">
                    <div class="metric-heading">
                        <h3>
                            <i class="pi pi-chart-pie" aria-hidden="true" />
                            원금 회수율
                        </h3>
                        <span v-if="summary.pending" class="metric-badge"
                            >잠정 집계</span
                        >
                    </div>
                    <div
                        v-for="item in recovery"
                        :key="item.currency"
                        class="rate-line">
                        <div>
                            <span>{{ item.currency }}</span
                            ><strong class="recovery-rate">{{
                                item.rate === null
                                    ? '원금 확인 필요'
                                    : percent(item.rate)
                            }}</strong>
                        </div>
                        <progress
                            v-if="item.rate !== null"
                            :value="Math.min(item.rate, 100)"
                            max="100"
                            :aria-label="`${item.currency} 원금 회수 진행률`" /><small
                            v-if="item.rate >= 100"
                            >투자 원금 이상 회수했습니다.</small
                        >
                    </div>
                    <p class="help">
                        확정 원금 출금 ÷ 확정 외부 입금. 미확인 내역이 있으면
                        잠정 수치입니다.
                    </p>
                </article>
                <article class="metric-card">
                    <div class="metric-heading">
                        <h3>
                            <i class="pi pi-wallet" aria-hidden="true" /> 순투입
                            원금
                        </h3>
                        <span class="metric-badge">통화별 집계</span>
                    </div>
                    <div class="currency-tiles">
                        <div v-for="item in recovery" :key="item.currency">
                            <small>{{
                                item.currency === 'KRW'
                                    ? '원화 (KRW)'
                                    : '달러 (USD)'
                            }}</small
                            ><strong>{{
                                !state.entries.length
                                    ? '내역 필요'
                                    : summary.pending || item.remaining < 0
                                      ? '확인 필요'
                                      : money(item.remaining, item.currency)
                            }}</strong
                            ><span
                                >확정 원금 회수<br />{{
                                    money(item.recovered, item.currency)
                                }}</span
                            >
                        </div>
                    </div>
                    <p class="help">
                        통화별 투자 원금 − 확정 원금 회수. KRW와 USD를 임의
                        환율로 합산하지 않습니다.
                    </p>
                </article>
                <article class="metric-card">
                    <div class="metric-heading">
                        <h3>
                            <i
                                class="pi pi-arrow-right-arrow-left"
                                aria-hidden="true" />
                            외부 입금 · 출금 누적
                        </h3>
                    </div>
                    <dl>
                        <template v-for="item in recovery" :key="item.currency"
                            ><div>
                                <dt>{{ item.currency }} 외부 입금</dt>
                                <dd>
                                    {{ money(item.principal, item.currency) }}
                                </dd>
                            </div>
                            <div>
                                <dt>{{ item.currency }} 전체 외부 출금</dt>
                                <dd>
                                    {{
                                        money(
                                            summary[item.currency].withdrawals,
                                            item.currency
                                        )
                                    }}
                                </dd>
                            </div></template
                        >
                    </dl>
                    <p class="help">
                        계좌 내 이동·환전·재투자는 새 원금이나 회수금으로 더하지
                        않습니다.
                    </p>
                </article>
            </div>
            <details class="calculation-guide">
                <summary>
                    <i class="pi pi-sliders-h" aria-hidden="true" /> 계산 기준
                    및 집계 안내
                </summary>
                <p>
                    원금 회수율은 원금으로 확정한 외부 출금 기준입니다.
                    배당·수익 출금과 출처 미확인 출금은 대표 회수율에서
                    제외하며, 계좌 안의 재투자·환전은 새 원금이나 회수금으로
                    더하지 않습니다.
                </p>
                <p class="help">
                    확정한 계좌 입출금 내역만 집계합니다. 종목별 거래 원장은
                    별도 합산하지 않습니다. 회수율 = 확정 원금 출금 ÷ 확정 외부
                    입금 × 100. 배당·매도대금의 재투자는 원금에 더하지 않습니다.
                    계좌 안에서 받은 배당·매도금은 현금 회수와 다릅니다.
                    미회수액은 손실이 아니며 추가 입금 시 회수율이 낮아질 수
                    있습니다.
                </p>
                <p v-if="summary.pending" class="help" role="status">
                    분류 확인 필요 {{ summary.pending }}건을 제외한 잠정
                    수치입니다.
                </p>
                <h3>통화별 상세 집계</h3>
                <p class="help">순입금은 확정한 외부 입금 − 외부 출금입니다.</p>
                <div class="totals">
                    <article v-for="currency in ['KRW', 'USD']" :key="currency">
                        <small>순투입 원금 · {{ currency }}</small>
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
                            {{ money(summary[currency].deposits, currency) }} ·
                            원금 회수
                            {{
                                money(
                                    summary[currency].principalWithdrawals,
                                    currency
                                )
                            }}</span
                        >
                        <span
                            >배당 사용
                            {{
                                money(summary[currency].dividendUsed, currency)
                            }}
                            · 기타 수익 사용
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
                            {{ money(summary[currency].net, currency) }} · 전체
                            외부 출금
                            {{
                                money(summary[currency].withdrawals, currency)
                            }}</span
                        >
                    </article>
                </div>
                <p class="help">
                    순입금은 전체 외부 입금 − 전체 외부 출금으로 원금과
                    다릅니다. 배당 사용은 누적 수령 배당에서 차감하지 않으며,
                    나머지를 재투자로 가정하지 않습니다. 미확인 내역이 있으면
                    원금 확정을 보류합니다. 전체 계좌 개설 이후 원금이 아닐 수
                    있습니다. 조회 시작 전 자금·누락된 내역을 확인해 주세요.
                    달러 입출금은 달러로 집계하며 임의의 환율로 원화에 합산하지
                    않습니다.
                </p>
                <p v-if="summary.dates.length" class="help">
                    저장된 계좌 거래일 {{ date(summary.dates[0]) }} ~
                    {{ date(summary.dates.at(-1)) }} · 분류 확인 필요
                    {{ summary.pending }}건 · 마이페이지 기간 필터와 별도로 전체
                    저장 내역 기준
                </p>
                <p
                    v-if="state.entries.some((entry) => entry.purchaseExchange)"
                    class="help">
                    구매 결제에 연결된 환전 출금
                    {{
                        state.entries.filter((entry) => entry.purchaseExchange)
                            .length
                    }}건은 현금 등록과 원금 집계에서 제외합니다. ‘전체 내역’에서
                    원본을 확인할 수 있습니다.
                </p>
                <p class="help">
                    PDF 분류는 후보입니다. 원본에서 외부 입출금인지 확인한 뒤
                    확정하세요. 잘못 분류한 행은 ‘확인 필요’로 되돌릴 수
                    있습니다. 직접 입력을 제외하려면 ‘계좌 내 이동’으로 분류하고
                    메모를 남겨 주세요.
                </p>
            </details>
            <p v-if="!summary.dates.length && accountId" class="help">
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
            <details ref="cashReview" class="cash-review" open>
                <summary>계좌 내역 검토 · {{ state.entries.length }}건</summary>
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
                                busy ||
                                reviewSaving ||
                                !!classificationError(form, form)
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
                <CashEntryReview
                    ref="reviewList"
                    :user="user"
                    :state="state"
                    :account-id="accountId"
                    :loading="loading"
                    :read-only="readOnly"
                    :busy="busy"
                    @saving="reviewSaving = $event"
                    @refresh="emit('refresh')" />
            </details>
        </template>
        <p v-if="saveError" role="alert" class="error">{{ saveError }}</p>
        <p v-if="success" role="status">{{ success }}</p>
    </section>
</template>

<style scoped>
    .capital-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin: 16px 0 20px;
    }
    .metric-card {
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 18px;
        background: var(--app-surface);
        min-width: 0;
    }
    .metric-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .metric-heading h3 {
        margin: 0;
        font-size: 0.94rem;
        line-height: 1.5;
    }
    .metric-heading i {
        color: var(--app-accent);
        margin-right: 5px;
    }
    .metric-badge {
        font-size: 0.68rem;
        border-radius: 999px;
        background: color-mix(
            in srgb,
            var(--app-accent) 7%,
            var(--app-surface)
        );
        padding: 5px 8px;
        color: var(--app-muted);
        white-space: nowrap;
    }
    .rate-line {
        margin-top: 16px;
    }
    .rate-line > div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .rate-line > div > span {
        font-size: 0.8rem;
        color: var(--app-muted);
    }
    .rate-line .recovery-rate {
        font-size: 1.65rem;
        margin: 0 0 8px;
    }
    .rate-line small {
        color: var(--app-muted);
    }
    .currency-tiles {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 16px;
    }
    .currency-tiles > div {
        padding: 14px 10px;
        background: color-mix(
            in srgb,
            var(--app-accent) 6%,
            var(--app-surface)
        );
        border-radius: 12px;
        overflow-wrap: anywhere;
    }
    .currency-tiles small {
        font-size: 0.72rem;
        color: var(--app-muted);
    }
    .currency-tiles strong {
        display: block;
        margin: 12px 0;
        font-size: 1.15rem;
    }
    .currency-tiles span {
        font-size: 0.73rem;
        color: var(--app-muted);
    }
    @media (max-width: 1050px) {
        .capital-metrics {
            grid-template-columns: 1fr;
        }
        .metric-card {
            padding: 16px;
        }
        .rate-metric {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .rate-metric .metric-heading,
        .rate-metric > .help {
            grid-column: 1/-1;
        }
        .rate-line {
            margin-top: 0;
        }
        .rate-line .recovery-rate {
            font-size: 1.4rem;
        }
        .metric-heading h3 {
            font-size: 1rem;
        }
    }

    .capital-panel {
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 20px;
        background: var(--app-surface);
        color: var(--app-text);
    }
    .heading,
    .actions {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
    }
    .heading h2 {
        font-size: 1.18rem;
        margin: 0;
    }
    .heading p {
        color: var(--app-muted);
        font-size: 0.85rem;
        line-height: 1.7;
        max-width: 68ch;
    }
    .heading > button {
        white-space: nowrap;
    }
    .recovery-grid,
    .totals {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin: 16px 0;
    }
    .recovery-card,
    .totals article {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        padding: 20px;
        background: color-mix(
            in srgb,
            var(--app-accent) 5%,
            var(--app-surface)
        );
        min-width: 0;
    }
    .recovery-rate {
        display: block;
        font-size: clamp(1.6rem, 4vw, 2.4rem);
        color: var(--app-accent);
        font-variant-numeric: tabular-nums;
        margin: 12px 0;
    }
    .recovery-filter {
        color: var(--app-muted);
        font-size: 0.8rem;
        margin-top: 24px;
    }
    .recovery-card small {
        font-size: 0.8rem;
        color: var(--app-muted);
    }
    .recovery-card > span {
        font-size: 0.8rem;
    }
    .totals strong {
        display: block;
        font-size: 1.4rem;
        margin: 8px 0;
        color: var(--app-accent);
    }
    .totals small,
    .totals span {
        display: block;
        color: var(--app-muted);
        font-size: 0.8rem;
        margin-top: 6px;
    }
    progress {
        width: 100%;
        height: 7px;
        accent-color: var(--app-accent);
    }
    dl {
        margin: 14px 0 0;
    }
    dl > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 9px;
        font-size: 0.83rem;
    }
    dt {
        color: var(--app-muted);
    }
    dd {
        margin: 0;
        text-align: right;
        overflow-wrap: anywhere;
        font-variant-numeric: tabular-nums;
    }
    .help {
        color: var(--app-muted);
        font-size: 0.82rem;
        line-height: 1.7;
    }
    .calculation-guide {
        background: color-mix(
            in srgb,
            var(--app-accent) 6%,
            var(--app-surface)
        );
        padding: 14px 16px;
        border-radius: 12px;
        margin: 18px 0;
    }
    .calculation-guide > summary {
        font-size: 0.87rem;
        color: var(--app-accent);
    }
    .cash-review {
        margin-top: 28px;
    }
    .cash-review > summary {
        font-size: 1.1rem;
        padding: 16px 0;
        border-bottom: 1px solid var(--app-border);
    }
    .cash-review[open] > summary {
        margin-bottom: 14px;
    }
    summary {
        cursor: pointer;
        font-weight: 600;
    }
    h3 {
        font-size: 1rem;
        margin: 22px 0 8px;
    }
    button,
    input,
    select {
        font: inherit;
        border: 1px solid var(--app-border);
        border-radius: 10px;
        padding: 9px 12px;
        background: var(--app-surface);
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
    button:focus-visible,
    summary:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    .cash-form {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 16px 0;
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 16px;
    }
    .cash-form h3,
    .wide {
        grid-column: 1/-1;
    }
    .cash-form label {
        display: grid;
        gap: 7px;
        font-size: 0.85rem;
    }
    .actions {
        justify-content: flex-start;
        margin-top: 12px;
    }
    .error {
        color: var(--p-red-600, #c62828);
    }
    @media (max-width: 700px) {
        .capital-panel {
            padding: 16px;
            border-radius: 16px;
        }
        .heading {
            align-items: start;
        }
        .heading p {
            font-size: 0.8rem;
        }
        .heading > button {
            width: 100%;
            font-size: 0.82rem;
        }
        .recovery-grid,
        .totals {
            gap: 8px;
        }
        .recovery-card,
        .totals article {
            padding: 12px;
            border-radius: 12px;
        }
        .recovery-rate {
            font-size: 1.6rem;
        }
        .recovery-card dl > div {
            display: block;
            margin-top: 10px;
        }
        .recovery-card dd {
            text-align: left;
            margin-top: 3px;
        }
        .totals strong {
            font-size: 1.1rem;
        }
        .totals span {
            font-size: 0.73rem;
        }
        .cash-form {
            grid-template-columns: 1fr;
            padding: 14px;
        }
        .cash-review > summary {
            font-size: 1rem;
        }
    }

    @media (max-width: 700px) {
        .heading h2 {
            font-size: 1rem;
        }
        .heading > button {
            width: auto;
            font-size: 0.75rem;
            padding: 7px 10px;
        }
        .recovery-filter {
            margin: 16px 0 8px;
        }
        .capital-metrics {
            padding: 14px;
            border: 1px solid var(--app-border);
            border-radius: 16px;
            gap: 14px;
        }
        .metric-card {
            padding: 0;
            border: 0;
            border-radius: 0;
        }
        .rate-metric {
            gap: 10px;
        }
        .metric-heading h3 {
            font-size: 0.95rem;
        }
        .metric-badge {
            font-size: 0.62rem;
        }
        .rate-line > div {
            display: block;
        }
        .rate-line .recovery-rate {
            font-size: 1.12rem;
            line-height: 1.5;
            white-space: nowrap;
        }
        .rate-line > div > span {
            font-size: 0.72rem;
        }
        .metric-card > .help {
            display: none;
        }
        .capital-metrics > .metric-card:nth-child(3) {
            display: none;
        }
        .currency-tiles {
            margin-top: 10px;
        }
        .currency-tiles > div {
            padding: 10px;
        }
        .currency-tiles strong {
            margin: 8px 0;
            font-size: 1.05rem;
        }
        .currency-tiles span {
            font-size: 0.72rem;
        }
        .calculation-guide {
            margin: 14px 0;
        }
        .cash-review {
            margin-top: 18px;
        }
        .cash-review > summary {
            padding: 12px 0;
        }
    }
</style>
