<script setup>
    import { computed, ref, watch } from 'vue';
    import {
        fundingCandidates,
        fundingMethods,
        fundingSources,
        purchaseBasis,
        validateFunding,
    } from '../../../lib/portfolio-capital.js';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';

    const props = defineProps({
        user: Object,
        transaction: Object,
        asset: Object,
        state: Object,
        loading: Boolean,
        loadError: String,
        accountId: String,
        readOnly: Boolean,
    });
    const emit = defineEmits(['saved', 'close']);
    const basis = computed(() => {
        try {
            return purchaseBasis(props.transaction);
        } catch (reason) {
            return { error: reason.message };
        }
    });
    const stored = computed(() =>
        props.state.allocations.find(
            (row) =>
                row.assetId === props.asset.id &&
                row.transactionId === props.transaction.id
        )
    );
    const parts = ref([]),
        evidenceIds = ref([]),
        note = ref(''),
        accepted = ref(false),
        busy = ref(false),
        error = ref('');
    const money = (n, c) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: c,
            maximumFractionDigits: c === 'KRW' ? 0 : 6,
        }).format(n);
    function blankPart(amount = '') {
        return {
            method: 'unknown',
            amount,
            paidKrw: '',
            source: 'unknown',
            sourceSymbol: '',
        };
    }
    watch(
        () => [props.transaction.id, stored.value?.revision],
        () => {
            const saved =
                stored.value?.status !== 'reset' ? stored.value : null;
            parts.value = saved?.parts?.map((row) => ({ ...row })) || [
                blankPart(basis.value.total || ''),
            ];
            evidenceIds.value = saved?.evidenceIds || [];
            note.value = saved?.note || '';
            accepted.value = false;
            error.value = '';
        },
        { immediate: true }
    );
    const candidates = computed(() => {
        const nearby = fundingCandidates(
            props.transaction,
            props.state.entries,
            props.transaction.accountId
        );
        return [
            ...nearby,
            ...props.state.entries.filter(
                (row) =>
                    evidenceIds.value.includes(row.id) &&
                    !nearby.some((candidate) => candidate.id === row.id)
            ),
        ];
    });
    const usedElsewhere = (id) =>
        props.state.allocations.some(
            (row) =>
                row.status !== 'reset' &&
                row.evidenceIds?.includes(id) &&
                !(
                    row.assetId === props.asset.id &&
                    row.transactionId === props.transaction.id
                )
        );
    const canSuggestConversion = (entry) => {
        const classification =
            props.state.classifications.find((row) => row.id === entry.id)
                ?.classification || entry.suggestedKind;
        return (
            basis.value.currency === 'USD' &&
            classification === 'exchange' &&
            entry.currency === 'KRW' &&
            entry.exchangeRate > 0 &&
            entry.amount / entry.exchangeRate <= basis.value.total
        );
    };
    function useConversion(entry) {
        const converted =
            Math.round((entry.amount / entry.exchangeRate) * 1e6) / 1e6;
        const remainder =
            Math.round((basis.value.total - converted) * 1e6) / 1e6;
        parts.value = [
            {
                method: 'krw_conversion',
                amount: converted,
                paidKrw: entry.amount,
                source: 'unknown',
            },
            ...(remainder > 0 ? [blankPart(remainder)] : []),
        ];
        evidenceIds.value = [entry.id];
        accepted.value = false;
        note.value =
            '선택한 환전 내역의 원화 금액 ÷ 기록 환율로 분할한 참고값입니다. 실제 이 매수에 사용된 금액인지 확인 필요.';
    }
    const sum = computed(() =>
        parts.value.reduce((n, p) => n + (Number(p.amount) || 0), 0)
    );
    const input = computed(() => ({
        action: 'saveFunding',
        assetId: props.asset.id,
        transactionId: props.transaction.id,
        basisKey: basis.value.basisKey,
        revision: stored.value?.revision || 0,
        parts: parts.value,
        evidenceIds: evidenceIds.value,
        note: note.value,
    }));
    const validation = computed(() => {
        if (basis.value.error) return basis.value.error;
        try {
            validateFunding(input.value, props.transaction);
            return '';
        } catch (reason) {
            return reason.message;
        }
    });
    const methods = computed(() =>
        Object.entries(fundingMethods).filter(([method]) =>
            basis.value.currency === 'USD'
                ? method !== 'krw_cash'
                : method === 'krw_cash' || method === 'unknown'
        )
    );
    const stale = computed(
        () =>
            stored.value?.status !== 'reset' &&
            stored.value?.basisKey &&
            stored.value.basisKey !== basis.value.basisKey
    );
    async function save(reset = false) {
        busy.value = true;
        error.value = '';
        try {
            await portfolioCapitalRequest(
                props.user,
                reset
                    ? {
                          action: 'resetFunding',
                          assetId: props.asset.id,
                          transactionId: props.transaction.id,
                          revision: stored.value?.revision || 0,
                      }
                    : input.value,
                props.accountId
            );
            emit('saved');
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
</script>

<template>
    <section class="funding-editor" aria-label="매수 자금 구성 확인">
        <div class="heading">
            <h3>매수 자금 구성 확인</h3>
            <button type="button" :disabled="busy" @click="emit('close')">
                닫기
            </button>
        </div>
        <p v-if="loading" role="status">계좌 내역을 불러오는 중입니다.</p>
        <p v-if="loadError" role="alert" class="error">{{ loadError }}</p>
        <p v-if="basis.error" role="alert">{{ basis.error }}</p>
        <template v-else>
            <p>
                매수 정산액
                <strong>{{ money(basis.total, basis.currency) }}</strong> ·
                수수료·세금 포함
            </p>
            <p class="help">
                달러 잔액에도 직접 투자한 원금이 섞일 수 있습니다. 결제 통화와
                자금 출처를 따로 확인해 주세요. 매도대금은 원금과 수익이 섞일 수
                있어 별도로 분류합니다.
            </p>
            <p v-if="stale" role="alert" class="error">
                원장 정산액이 변경되었습니다. 기존 배분을 다시 확인해 주세요.
            </p>
            <details>
                <summary>
                    같은 날 계좌 내역 {{ candidates.length }}건 · 근거 후보
                </summary>
                <p class="help">
                    날짜가 같다는 이유만으로 이 매수에 사용됐다고 확정하지
                    않습니다. 여러 매수·환전이나 계좌가 섞일 수 있습니다.
                </p>
                <p v-if="!candidates.length">
                    연결 가능한 계좌 내역이 없습니다. 입출금·환전 PDF를
                    가져오거나 계좌 내역을 직접 추가해 주세요.
                </p>
                <div v-for="entry in candidates" :key="entry.id">
                    <label class="evidence"
                        ><input
                            v-model="evidenceIds"
                            type="checkbox"
                            :value="entry.id"
                            :disabled="
                                busy || loading || !!loadError || readOnly
                            "
                            @change="accepted = false" />{{ entry.date }} ·
                        {{ entry.rawType }} ·
                        {{ money(entry.amount, entry.currency)
                        }}<span v-if="entry.exchangeRate">
                            · 기록 환율 {{ entry.exchangeRate }}</span
                        ><small
                            v-if="!entry.accountId || !transaction.accountId"
                            >계좌 일치 확인 필요</small
                        ><small v-if="usedElsewhere(entry.id)"
                            >다른 매수에도 선택된 근거 · 중복 사용 여부
                            확인</small
                        ></label
                    >
                    <button
                        v-if="canSuggestConversion(entry)"
                        type="button"
                        :disabled="busy || loading || !!loadError || readOnly"
                        @click="useConversion(entry)">
                        환전 금액을 참고해 분할 입력
                    </button>
                </div>
            </details>
            <form @submit.prevent="save()">
                <fieldset
                    v-for="(part, index) in parts"
                    :key="index"
                    :disabled="busy || loading || !!loadError || readOnly">
                    <legend>자금 {{ index + 1 }}</legend>
                    <label
                        >결제 구성<select
                            v-model="part.method"
                            :aria-label="`자금 ${index + 1} 결제 구성`"
                            @change="accepted = false">
                            <option
                                v-for="[method, label] in methods"
                                :key="method"
                                :value="method">
                                {{ label }}
                            </option>
                        </select></label
                    >
                    <label
                        >사용 금액 ({{ basis.currency }})<input
                            v-model="part.amount"
                            :aria-label="`자금 ${index + 1} 사용 금액`"
                            type="number"
                            min="0.000001"
                            :step="basis.currency === 'KRW' ? '1' : '0.000001'"
                            required
                            @input="accepted = false"
                    /></label>
                    <label v-if="part.method === 'krw_conversion'"
                        >환전에 사용한 원화<input
                            v-model="part.paidKrw"
                            :aria-label="`자금 ${index + 1} 환전 원화`"
                            type="number"
                            min="1"
                            step="1"
                            required
                            @input="accepted = false" /><small
                            v-if="part.amount > 0 && part.paidKrw > 0"
                            >입력 금액 기준 환율
                            {{
                                (part.paidKrw / part.amount).toLocaleString(
                                    'ko-KR',
                                    { maximumFractionDigits: 4 }
                                )
                            }}원/USD</small
                        ></label
                    >
                    <label
                        >자금 출처<select
                            v-model="part.source"
                            :aria-label="`자금 ${index + 1} 자금 출처`"
                            @change="accepted = false">
                            <option
                                v-for="(label, source) in fundingSources"
                                :key="source"
                                :value="source">
                                {{ label }}
                            </option>
                        </select></label
                    >
                    <label v-if="part.source === 'other_dividend'"
                        >배당금을 받은 종목 코드
                        <input
                            v-model="part.sourceSymbol"
                            required
                            maxlength="40"
                            placeholder="예: SCHD"
                            :aria-label="`자금 ${index + 1} 배당 출처 종목`"
                            @input="accepted = false" />
                    </label>
                    <button
                        v-if="parts.length > 1"
                        type="button"
                        @click="
                            parts.splice(index, 1);
                            accepted = false;
                        ">
                        이 자금 삭제
                    </button>
                </fieldset>
                <button
                    type="button"
                    :disabled="
                        parts.length >= 12 ||
                        busy ||
                        loading ||
                        !!loadError ||
                        readOnly
                    "
                    @click="
                        parts.push(blankPart());
                        accepted = false;
                    ">
                    자금 나누기
                </button>
                <p>
                    배분 합계
                    <strong>{{ money(sum, basis.currency) }}</strong> / 정산액
                    {{ money(basis.total, basis.currency) }}
                </p>
                <p v-if="validation" class="error" role="status">
                    {{ validation }}
                </p>
                <label class="note"
                    >확인 근거·메모<textarea
                        v-model="note"
                        maxlength="500"
                        rows="2"
                        @input="accepted = false" />
                </label>
                <p class="help">
                    배당금 재투자도 이 종목의 매수원가에 포함됩니다. 배당 성과는
                    배당을 지급한 종목에 남습니다. 이 배분은 해당 매수의
                    설명으로 저장됩니다. 순입금 원금에 다시 더하지 않습니다.
                    ‘확인 필요’ 금액은 미확정으로 남습니다.
                </p>
                <label class="evidence"
                    ><input v-model="accepted" type="checkbox" />계좌 내역과
                    금액을 확인했습니다.</label
                >
                <div class="actions">
                    <button
                        :disabled="
                            busy ||
                            loading ||
                            !!loadError ||
                            readOnly ||
                            !accepted ||
                            !!validation
                        ">
                        {{ busy ? '저장 중' : '자금 구성 저장' }}</button
                    ><button
                        v-if="stored && stored.status !== 'reset'"
                        type="button"
                        :disabled="busy || loading || !!loadError || readOnly"
                        @click="save(true)">
                        확정 해제
                    </button>
                </div>
            </form>
        </template>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
    </section>
</template>

<style scoped>
    .funding-editor {
        padding: 16px;
        background: var(--surface-ground, #f5f6fa);
        border: 1px solid var(--surface-border, #ddd);
        border-radius: 12px;
        white-space: normal;
        min-width: 0;
    }
    h3,
    p {
        margin: 0;
    }
    p {
        margin: 10px 0;
    }
    .heading,
    .actions {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
    }
    .help,
    small {
        color: var(--text-color-secondary, #666);
        font-size: 0.88rem;
    }
    .error {
        color: #c62828;
    }
    fieldset {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        border: 1px solid var(--surface-border, #ccc);
        border-radius: 10px;
        margin: 12px 0;
    }
    label {
        display: grid;
        gap: 4px;
    }
    .evidence {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0;
        flex-wrap: wrap;
    }
    .evidence input {
        width: auto;
    }
    button,
    input,
    select,
    textarea {
        font: inherit;
        max-width: 100%;
        padding: 8px;
        border: 1px solid var(--surface-border, #bbb);
        border-radius: 8px;
        background: var(--surface-card, #fff);
        color: inherit;
    }
    button {
        cursor: pointer;
    }
    button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .note {
        margin: 12px 0;
    }
    summary {
        cursor: pointer;
    }
    @media (max-width: 600px) {
        fieldset {
            grid-template-columns: 1fr;
        }
    }
</style>
