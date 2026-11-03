<script setup>
    import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
    import DatePicker from 'primevue/datepicker';
    import SelectButton from 'primevue/selectbutton';
    import Select from 'primevue/select';
    import CashFxPairControl from './CashFxPairControl.vue';
    import WithdrawalSplit from './WithdrawalSplit.vue';
    import { exact } from '../../../lib/exact-amount.js';
    import {
        cashClassification,
        cashKinds,
        cashNeedsReview,
    } from '../../../lib/portfolio-capital.js';
    import {
        cashReviewType,
        cashReviewDateKey,
        cashReviewEntries,
        primaryCashKinds,
    } from '@/services/cashReview.js';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';

    const props = defineProps({
        user: { type: Object, default: null },
        state: {
            type: Object,
            default: () => ({ entries: [], classifications: [] }),
        },
        accountId: { type: String, default: '' },
        readOnly: Boolean,
        loading: Boolean,
        busy: Boolean,
    });
    const emit = defineEmits(['refresh', 'saving']);
    const root = ref(null),
        title = ref(null),
        start = ref(null),
        end = ref(null),
        status = ref('pending'),
        transactionType = ref('all'),
        fxSaving = ref(false),
        currency = ref('all'),
        page = ref(1);
    const drafts = ref({}),
        results = ref({}),
        notice = ref('');
    const typeOptions = computed(() => [
        { label: '전체 거래 종류', value: 'all' },
        ...[...new Set(props.state.entries.map(cashReviewType))]
            .sort((a, b) => a.localeCompare(b, 'ko'))
            .map((value) => ({ label: value, value })),
    ]);
    const selectedStatusLabel = computed(
        () =>
            statusOptions.find((x) => x.value === status.value)?.label ||
            '확인 필요'
    );
    const statusOptions = [
        { label: '확인 필요', value: 'pending' },
        { label: '전체', value: 'all' },
        { label: '확정', value: 'confirmed' },
    ];
    const currencyOptions = [
        { label: '전체', value: 'all' },
        { label: 'KRW', value: 'KRW' },
        { label: 'USD', value: 'USD' },
    ];
    const annotations = computed(
        () => new Map(props.state.classifications.map((row) => [row.id, row]))
    );
    const rows = computed(() =>
        cashReviewEntries(props.state.entries, props.state.classifications, {
            status: status.value,
            type: transactionType.value,
            currency: currency.value,
            start: start.value,
            end: end.value,
        })
    );
    const visible = computed(() =>
        rows.value.slice((page.value - 1) * 10, page.value * 10)
    );
    const saving = computed(
        () =>
            fxSaving.value ||
            Object.values(results.value).some((row) =>
                ['saving', 'awaiting'].includes(row.phase)
            )
    );
    const saveMessage = computed(() =>
        saving.value
            ? '계좌 내역을 저장하고 있습니다…'
            : Object.values(results.value).some((row) => row.phase === 'failed')
              ? '저장하지 못했습니다. 해당 내역의 재시도를 확인해 주세요.'
              : notice.value || '분류 선택 시 즉시 저장'
    );
    const disabled = computed(
        () => props.readOnly || props.loading || props.busy || saving.value
    );
    const pending = computed(
        () =>
            props.state.entries.filter((row) =>
                cashNeedsReview(row, annotations.value.get(row.id))
            ).length
    );
    let generation = 0;
    watch(
        () => [props.user?.uid, props.accountId],
        () => {
            generation++;
            drafts.value = {};
            results.value = {};
            notice.value = '';
            start.value = end.value = null;
            status.value = 'pending';
            transactionType.value = 'all';
            fxSaving.value = false;
            currency.value = 'all';
        },
        { immediate: true }
    );
    onScopeDispose(() => {
        generation++;
        emit('saving', false);
    });
    watch(saving, (value) => emit('saving', value), { immediate: true });
    watch([status, transactionType, currency, start, end], () => {
        page.value = 1;
    });
    watch(rows, (value) => {
        if ((page.value - 1) * 10 >= value.length)
            page.value = Math.max(1, Math.ceil(value.length / 10));
    });
    watch(
        () => props.state,
        (state) => {
            for (const entry of state.entries) {
                const confirmed = state.classifications.find(
                    (row) => row.id === entry.id
                );
                const previous = drafts.value[entry.id];
                const effectiveKey = JSON.stringify([
                    confirmed?.origin,
                    confirmed?.classification,
                    confirmed?.revision || 0,
                    entry.date,
                    entry.currency,
                    entry.amount,
                ]);
                if (
                    !previous ||
                    previous.effectiveKey !== effectiveKey ||
                    previous.revision !== (confirmed?.revision || 0)
                ) {
                    drafts.value[entry.id] = {
                        effectiveKey,
                        classification:
                            confirmed?.classification ||
                            entry.suggestedKind ||
                            'unknown',
                        note: confirmed?.note || '',
                        withdrawalParts: {
                            ...(confirmed?.withdrawalParts || {
                                principal: 0,
                                dividend: 0,
                                profit: 0,
                                unknown: entry.amount,
                            }),
                        },
                        selection: cashNeedsReview(entry, confirmed)
                            ? null
                            : confirmed?.classification,
                        revision: confirmed?.revision || 0,
                        expanded: false,
                        editing: false,
                    };
                }
                const result = results.value[entry.id];
                if (
                    result?.phase === 'failed' &&
                    result.conflict &&
                    (confirmed?.revision || 0) !== result.input.revision
                ) {
                    delete results.value[entry.id];
                    notice.value =
                        '최신 분류를 불러왔습니다. 내용을 확인한 뒤 다시 선택해 주세요.';
                }
                if (
                    result?.phase === 'awaiting' &&
                    (confirmed?.revision || 0) > result.revision
                ) {
                    delete results.value[entry.id];
                    notice.value = '계좌 내역을 저장했습니다.';
                    if (result.restoreFocus)
                        nextTick(() =>
                            (
                                root.value?.querySelector(
                                    '[data-cash-id] button:not(:disabled)'
                                ) || title.value
                            )?.focus()
                        );
                }
            }
        },
        { immediate: true }
    );
    const money = (amount, code) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: code,
            maximumFractionDigits: code === 'KRW' ? 0 : 6,
        }).format(amount);
    const date = (value) => {
        const key = cashReviewDateKey(value);
        return key
            ? `${key.slice(0, 4)}.${key.slice(4, 6)}.${key.slice(6)}`
            : '날짜 미확인';
    };
    const needsReview = (entry) =>
        cashNeedsReview(entry, annotations.value.get(entry.id));
    const editing = (entry) =>
        needsReview(entry) || drafts.value[entry.id]?.editing;
    const options = (entry) =>
        (drafts.value[entry.id]?.expanded
            ? Object.keys(cashKinds)
            : primaryCashKinds(entry)
        )
            .filter(
                (value) =>
                    value !== 'exchange' ||
                    !needsReview(entry) ||
                    !(props.state.fxPairCandidates || []).some(
                        (c) => c.entryId === entry.id
                    )
            )
            .map((value) => ({ label: cashKinds[value], value }));
    function validation(entry) {
        try {
            cashClassification(drafts.value[entry.id], entry);
            return '';
        } catch (error) {
            return error.message;
        }
    }
    function resetFilters() {
        start.value = end.value = null;
        status.value = 'pending';
        transactionType.value = 'all';
        currency.value = 'all';
    }
    async function choose(entry, value) {
        if (!value || disabled.value || entry.purchaseExchange) return;
        const draft = drafts.value[entry.id];
        draft.classification = value;
        draft.selection = value;
        if (value === 'mixed_withdrawal') {
            delete results.value[entry.id];
            return;
        }
        await persist(entry);
    }
    async function persist(entry, noteOnly = false) {
        if (disabled.value || entry.purchaseExchange || validation(entry))
            return;
        const current = generation,
            accountId = props.accountId,
            user = props.user;
        const draft = drafts.value[entry.id];
        draft.selection = draft.classification;
        const input = {
            action: 'classifyCash',
            noteOnly,
            id: entry.id,
            classification: draft.classification,
            note: draft.note,
            withdrawalParts: { ...draft.withdrawalParts },
            revision: draft.revision,
        };
        const restoreFocus = root.value
            ?.querySelector(`[data-cash-id="${CSS.escape(entry.id)}"]`)
            ?.contains(document.activeElement);
        results.value[entry.id] = {
            phase: 'saving',
            input,
            revision: draft.revision,
            restoreFocus,
        };
        notice.value = '';
        try {
            await portfolioCapitalRequest(user, input, accountId);
            if (current !== generation) return;
            results.value[entry.id] = {
                phase: 'awaiting',
                input,
                revision: draft.revision,
                restoreFocus,
            };
            notice.value =
                '계좌 내역을 저장했습니다. 최신 분류를 확인하고 있습니다.';
            emit('refresh');
        } catch (error) {
            if (current !== generation) return;
            const conflict = [401, 403, 409].includes(error.status);
            results.value[entry.id] = {
                phase: 'failed',
                input,
                conflict,
                error: error.message,
            };
            // Never make an unsuccessful choice look like a confirmed annotation.
            draft.classification =
                annotations.value.get(entry.id)?.classification ||
                entry.suggestedKind ||
                'unknown';
            draft.selection = needsReview(entry)
                ? null
                : annotations.value.get(entry.id)?.classification;
            if (restoreFocus)
                nextTick(() =>
                    root.value
                        ?.querySelector(
                            `[data-cash-id="${CSS.escape(entry.id)}"] .retry`
                        )
                        ?.focus()
                );
        }
    }
    async function retry(entry) {
        const result = results.value[entry.id];
        if (result?.conflict) {
            emit('refresh');
            return;
        }
        if (!result?.input || disabled.value) return;
        Object.assign(drafts.value[entry.id], result.input, {
            withdrawalParts: { ...result.input.withdrawalParts },
        });
        await persist(entry, result.input.noteOnly === true);
    }
    function phaseLabel(entry) {
        if (entry.purchaseExchange) return '현금 집계 제외';
        const phase = results.value[entry.id]?.phase;
        if (!phase && annotations.value.get(entry.id)?.automatic)
            return '자동 분류';
        return phase === 'saving'
            ? '저장 중…'
            : phase === 'awaiting'
              ? '저장 완료 · 조회 중'
              : phase === 'failed'
                ? '저장 실패'
                : needsReview(entry)
                  ? '확인 필요'
                  : '확정 완료';
    }
    function chooseRemainingPrincipal(entry) {
        const parts = drafts.value[entry.id]?.withdrawalParts;
        if (disabled.value || !(Number(parts?.unknown) > 0)) return;
        parts.principal = Number(
            exact(String(parts.principal || 0))
                .add(String(parts.unknown))
                .text()
        );
        parts.unknown = 0;
        notice.value =
            '미확인 나머지만 원금으로 선택했습니다. 배분 확정을 눌러야 저장됩니다.';
    }
    async function openEntry(id, proposedParts) {
        start.value = end.value = null;
        status.value = 'all';
        transactionType.value = 'all';
        currency.value = 'all';
        await nextTick();
        const index = rows.value.findIndex((row) => row.id === id);
        if (index < 0) return;
        const entry = rows.value[index],
            draft = drafts.value[id],
            annotation = annotations.value.get(id);
        if (
            proposedParts &&
            draft &&
            !draft.editing &&
            ['unknown', 'external_withdrawal'].includes(draft.classification) &&
            !disabled.value &&
            ['unknown', 'external_withdrawal', undefined].includes(
                annotation?.classification
            )
        ) {
            const input = {
                classification: 'mixed_withdrawal',
                withdrawalParts: {
                    dividend: proposedParts.dividend,
                    principal: proposedParts.principal,
                    profit: 0,
                    unknown: proposedParts.unknown,
                },
            };
            try {
                cashClassification(input, entry);
                draft.classification = draft.selection = 'mixed_withdrawal';
                draft.withdrawalParts = Object.fromEntries(
                    Object.entries(input.withdrawalParts).map(
                        ([key, value]) => [key, Number(value)]
                    )
                );
                draft.editing = draft.expanded = true;
                notice.value =
                    '추적한 배당·원금 후보와 미확인 나머지를 검토용으로 채웠습니다. 아직 저장하지 않았습니다. 나머지를 선택한 뒤 배분 확정을 누르세요.';
            } catch {
                notice.value =
                    '후보 배분의 금액·통화를 확인하고 직접 검토하세요. 기존 분류는 변경하지 않았습니다.';
            }
        }
        page.value = Math.floor(index / 10) + 1;
        await nextTick();
        const row = [...root.value.querySelectorAll('[data-cash-id]')].find(
            (row) => row.dataset.cashId === id
        );
        row?.scrollIntoView({ block: 'center' });
        row?.querySelector('button:not(:disabled)')?.focus({
            preventScroll: true,
        });
    }
    defineExpose({ openEntry });
</script>

<template>
    <div ref="root" class="cash-entry-review">
        <div class="review-filters" aria-label="계좌 내역 필터">
            <div class="filter-heading">
                <strong>검색 필터</strong
                ><button
                    type="button"
                    class="text-button"
                    :disabled="saving"
                    @click="resetFilters">
                    <i class="pi pi-refresh" aria-hidden="true" /> 전체 기간
                    초기화
                </button>
            </div>
            <div class="date-filters">
                <label for="cash-review-start"
                    >시작일<DatePicker
                        v-model="start"
                        input-id="cash-review-start"
                        date-format="yy.mm.dd"
                        placeholder="선택 전"
                        show-icon
                        show-clear
                        :manual-input="false"
                        :max-date="end || undefined"
                        :disabled="saving"
                /></label>
                <span class="date-separator" aria-hidden="true">~</span>
                <label for="cash-review-end"
                    >종료일<DatePicker
                        v-model="end"
                        input-id="cash-review-end"
                        date-format="yy.mm.dd"
                        placeholder="선택 전"
                        show-icon
                        show-clear
                        :manual-input="false"
                        :min-date="start || undefined"
                        :disabled="saving"
                /></label>
            </div>
            <div class="choice-filter">
                <span id="cash-review-status-label">검토 상태</span
                ><SelectButton
                    v-model="status"
                    :options="statusOptions"
                    option-label="label"
                    option-value="value"
                    :allow-empty="false"
                    :disabled="saving"
                    aria-labelledby="cash-review-status-label" />
            </div>
            <div class="choice-filter">
                <span id="cash-review-currency-label">통화 구분</span
                ><SelectButton
                    v-model="currency"
                    :options="currencyOptions"
                    option-label="label"
                    option-value="value"
                    :allow-empty="false"
                    :disabled="saving"
                    aria-labelledby="cash-review-currency-label" />
            </div>
            <div class="choice-filter type-filter">
                <label id="cash-review-type-label" for="cash-review-type"
                    >거래 종류</label
                ><Select
                    v-model="transactionType"
                    input-id="cash-review-type"
                    aria-labelledby="cash-review-type-label"
                    :options="typeOptions"
                    option-label="label"
                    option-value="value"
                    :disabled="saving" />
            </div>
            <span class="review-count"
                >검토 필요 <strong>{{ pending }}</strong
                >건 · 표시 {{ rows.length }}건 · 상태:
                {{ selectedStatusLabel }}</span
            >
        </div>
        <div class="list-heading">
            <h3 ref="title" tabindex="-1">
                <i class="pi pi-table" aria-hidden="true" /> 거래 내역 검토 및
                분류
            </h3>
            <span
                class="review-save-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                >{{ saveMessage }}</span
            >
        </div>
        <div class="review-table-wrap">
            <table class="review-table">
                <thead>
                    <tr>
                        <th scope="col">거래일 / 거래 종류</th>
                        <th scope="col">금액 / 통화</th>
                        <th scope="col">분류 선택</th>
                        <th scope="col">상태</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="entry in visible"
                        :key="entry.id"
                        :data-cash-id="entry.id"
                        :class="{
                            'row-error': results[entry.id]?.phase === 'failed',
                        }">
                        <td class="entry-identity">
                            <span class="mobile-label">거래일</span
                            ><strong>{{ date(entry.date) }}</strong
                            ><small>{{
                                entry.rawType || '거래 종류 미확인'
                            }}</small
                            ><small v-if="entry.purchaseExchange"
                                >구매 결제 환전 · 현금 등록 제외</small
                            >
                        </td>
                        <td class="entry-amount">
                            <span class="mobile-label">금액</span
                            ><strong>{{
                                money(entry.amount, entry.currency)
                            }}</strong
                            ><small>{{ entry.currency }}</small>
                        </td>
                        <td
                            v-if="drafts[entry.id]"
                            class="entry-classification">
                            <span class="mobile-label"
                                >분류 선택 (즉시 반영)</span
                            >
                            <template
                                v-if="
                                    !entry.purchaseExchange && editing(entry)
                                ">
                                <SelectButton
                                    :model-value="drafts[entry.id].selection"
                                    :options="options(entry)"
                                    option-label="label"
                                    option-value="value"
                                    :allow-empty="false"
                                    :disabled="disabled"
                                    :aria-label="`${date(entry.date)} 계좌 내역 분류`"
                                    @update:model-value="
                                        choose(entry, $event)
                                    " />
                                <button
                                    v-if="!drafts[entry.id].expanded"
                                    type="button"
                                    class="text-button more-kinds"
                                    :disabled="disabled"
                                    @click="drafts[entry.id].expanded = true">
                                    다른 분류
                                    <i
                                        class="pi pi-angle-down"
                                        aria-hidden="true" />
                                </button>
                                <template
                                    v-if="
                                        drafts[entry.id].classification ===
                                        'mixed_withdrawal'
                                    ">
                                    <WithdrawalSplit
                                        v-model="
                                            drafts[entry.id].withdrawalParts
                                        "
                                        :amount="entry.amount"
                                        :currency="entry.currency"
                                        :disabled="disabled" />
                                    <button
                                        v-if="
                                            Number(
                                                drafts[entry.id].withdrawalParts
                                                    .unknown
                                            ) > 0
                                        "
                                        type="button"
                                        :disabled="disabled"
                                        @click="
                                            chooseRemainingPrincipal(entry)
                                        ">
                                        미확인 나머지만 원금으로 선택
                                    </button>
                                    <p
                                        v-if="validation(entry)"
                                        class="row-validation"
                                        role="status">
                                        {{ validation(entry) }}
                                    </p>
                                    <button
                                        type="button"
                                        class="primary-button"
                                        :disabled="
                                            disabled || !!validation(entry)
                                        "
                                        @click="persist(entry)">
                                        배분 확정
                                    </button>
                                </template>
                            </template>
                            <span v-else class="confirmed-kind"
                                ><i
                                    class="pi pi-check-circle"
                                    aria-hidden="true" />
                                {{
                                    cashKinds[
                                        annotations.get(entry.id)
                                            ?.classification
                                    ] || '현금 등록 제외'
                                }}</span
                            >
                            <small
                                v-if="annotations.get(entry.id)?.automatic"
                                class="automatic-cash-reason"
                                >{{
                                    annotations.get(entry.id).reason ===
                                    'verified_one_to_one_fx'
                                        ? '검증된 시각·금액의 일대일 환전 쌍'
                                        : annotations.get(entry.id).reason ===
                                            'recorded_rate_one_to_one_fx'
                                          ? '동일 계좌·날짜·기록 환율·금액의 유일한 환전 쌍 · 시각 미확인'
                                          : '명확한 토스 거래명'
                                }}
                                <template
                                    v-if="
                                        annotations.get(entry.id)
                                            .classification === 'exchange' &&
                                        annotations.get(entry.id).evidence
                                            ?.fee === 'not_verified'
                                    ">
                                    · 수수료 미확인</template
                                ></small
                            >
                            <CashFxPairControl
                                :user="user"
                                :state="state"
                                :draft-notes="drafts"
                                :entry="entry"
                                :account-id="accountId"
                                :read-only="readOnly"
                                :disabled="disabled"
                                @refresh="emit('refresh')"
                                @saving="fxSaving = $event"
                                @notice="notice = $event" />
                            <details class="entry-evidence">
                                <summary>
                                    {{
                                        drafts[entry.id].note
                                            ? '메모 있음'
                                            : '메모 추가 (선택)'
                                    }}
                                    · 보조 정보 확인
                                </summary>
                                <p>
                                    출처:
                                    {{
                                        entry.source === 'manual'
                                            ? '직접 입력'
                                            : entry.source === 'toss-pdf'
                                              ? '토스 PDF'
                                              : '계좌 원본'
                                    }}
                                </p>
                                <p>
                                    기록 환율:
                                    {{
                                        entry.exchangeRate ||
                                        '미확인 / 해당 없음'
                                    }}
                                </p>
                                <label :for="`cash-note-${entry.id}`"
                                    >확인 근거·메모 (선택)</label
                                ><textarea
                                    :id="`cash-note-${entry.id}`"
                                    v-model="drafts[entry.id].note"
                                    rows="2"
                                    maxlength="500"
                                    :disabled="
                                        disabled || entry.purchaseExchange
                                    "
                                    placeholder="필요한 경우에만 기록해 주세요." /><button
                                    v-if="annotations.has(entry.id)"
                                    type="button"
                                    class="text-button"
                                    :disabled="
                                        disabled || entry.purchaseExchange
                                    "
                                    @click="persist(entry, true)">
                                    메모 저장
                                </button>
                            </details>
                        </td>
                        <td class="entry-status">
                            <span
                                class="status-pill"
                                :class="{
                                    failure:
                                        results[entry.id]?.phase === 'failed',
                                    confirmed:
                                        !needsReview(entry) &&
                                        !results[entry.id],
                                }"
                                role="status"
                                ><i
                                    v-if="
                                        ['saving', 'awaiting'].includes(
                                            results[entry.id]?.phase
                                        )
                                    "
                                    class="pi pi-spin pi-spinner"
                                    aria-hidden="true" />{{
                                    phaseLabel(entry)
                                }}</span
                            >
                            <template
                                v-if="results[entry.id]?.phase === 'failed'"
                                ><p role="alert" class="row-validation">
                                    {{ results[entry.id].error }}
                                </p>
                                <button
                                    type="button"
                                    class="retry"
                                    :disabled="disabled"
                                    @click="retry(entry)">
                                    {{
                                        results[entry.id].conflict
                                            ? '최신 내역 다시 조회'
                                            : '해당 건 저장 재시도'
                                    }}
                                </button></template
                            >
                            <template
                                v-else-if="
                                    !needsReview(entry) &&
                                    !entry.purchaseExchange
                                "
                                ><button
                                    type="button"
                                    class="text-button"
                                    :disabled="disabled"
                                    @click="
                                        drafts[entry.id].editing =
                                            !drafts[entry.id].editing
                                    ">
                                    분류 변경</button
                                ><button
                                    v-if="
                                        !annotations.get(entry.id)
                                            ?.internalFxLinkId
                                    "
                                    type="button"
                                    class="text-button undo"
                                    :disabled="disabled"
                                    @click="choose(entry, 'unknown')">
                                    확인 필요로 되돌리기
                                </button></template
                            >
                        </td>
                    </tr>
                    <tr v-if="!visible.length">
                        <td colspan="4" class="empty-review">
                            표시할 계좌 내역이 없습니다. 날짜·검토
                            상태·통화·거래 종류 필터를 확인해 주세요.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="review-pagination">
            <span
                >페이지당 10건 · {{ page }} /
                {{ Math.max(1, Math.ceil(rows.length / 10)) }}</span
            >
            <div>
                <button
                    type="button"
                    :disabled="page <= 1 || saving"
                    @click="page--">
                    이전</button
                ><button
                    type="button"
                    :disabled="page * 10 >= rows.length || saving"
                    @click="page++">
                    다음
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .cash-entry-review {
        --review-soft: color-mix(
            in srgb,
            var(--app-accent, #2151da) 7%,
            var(--app-surface, #fff)
        );
        color: var(--app-text);
    }
    .review-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 18px;
        padding: 20px;
        margin: 20px 0 24px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 18px;
    }
    .filter-heading {
        display: flex;
        gap: 12px;
        align-items: center;
        order: 5;
    }
    .filter-heading strong {
        display: none;
    }
    .date-filters {
        display: flex;
        gap: 8px;
        align-items: end;
        flex: 1 1 330px;
    }
    .date-filters label {
        display: grid;
        gap: 7px;
        min-width: 0;
        flex: 1;
        font-size: 0.78rem;
        color: var(--app-muted);
    }
    .date-separator {
        padding-bottom: 12px;
    }
    .date-filters :deep(.p-datepicker) {
        width: 100%;
    }
    .date-filters :deep(.p-inputtext) {
        width: 100%;
        min-width: 0;
    }
    .choice-filter {
        display: grid;
        gap: 7px;
        font-size: 0.78rem;
        color: var(--app-muted);
    }
    .choice-filter :deep(.p-selectbutton) {
        background: var(--review-soft);
        border-radius: 10px;
        padding: 4px;
    }
    .choice-filter :deep(.p-togglebutton) {
        border: 0;
        background: transparent;
        font-size: 0.78rem;
        padding: 8px 11px;
    }
    .choice-filter :deep(.p-togglebutton-checked) {
        background: var(--app-accent);
        color: #fff;
    }
    .type-filter :deep(.p-select) {
        width: 100%;
        min-width: 0;
    }
    .type-filter {
        min-width: 0;
    }
    .review-count {
        padding: 10px;
        border-radius: 10px;
        background: var(--review-soft);
        color: var(--app-accent);
        font-size: 0.8rem;
        white-space: normal;
    }
    .list-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
    }
    .list-heading h3 {
        margin: 0;
        font-size: 1.05rem;
    }
    .list-heading span {
        font-size: 0.78rem;
        color: var(--app-muted);
        margin-left: auto;
        text-align: right;
        overflow-wrap: anywhere;
    }
    .review-table-wrap {
        border: 1px solid var(--app-border);
        border-radius: 18px;
        overflow: hidden;
        background: var(--app-surface);
    }
    .review-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 0.84rem;
    }
    .review-table th {
        text-align: left;
        padding: 14px;
        background: var(--review-soft);
        color: var(--app-muted);
        font-size: 0.75rem;
        font-weight: 600;
    }
    .review-table th:nth-child(1) {
        width: 19%;
    }
    .review-table th:nth-child(2) {
        width: 16%;
    }
    .review-table th:nth-child(3) {
        width: 44%;
    }
    .review-table th:nth-child(4) {
        width: 21%;
    }
    .review-table td {
        padding: 18px 14px;
        border-top: 1px solid var(--app-border);
        vertical-align: top;
        overflow-wrap: anywhere;
    }
    .entry-identity strong,
    .entry-amount strong {
        display: block;
        font-variant-numeric: tabular-nums;
    }
    .entry-amount strong {
        font-size: 1.05rem;
    }
    .entry-identity small,
    .entry-amount small {
        display: block;
        color: var(--app-muted);
        margin-top: 7px;
        font-size: 0.75rem;
    }
    .entry-classification :deep(.p-selectbutton) {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }
    .entry-classification :deep(.p-togglebutton) {
        flex: 1 1 95px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: var(--review-soft);
        padding: 9px 7px;
        font-size: 0.76rem;
        min-height: 42px;
    }
    .entry-classification :deep(.p-togglebutton-label) {
        white-space: normal;
    }
    .entry-classification :deep(.p-togglebutton-checked) {
        border-color: var(--app-accent);
        color: var(--app-accent);
    }
    .more-kinds {
        margin-top: 7px;
    }
    .text-button {
        border: 0;
        background: transparent;
        color: var(--app-accent);
        padding: 7px 0;
        font: inherit;
        font-size: 0.78rem;
        cursor: pointer;
    }
    .text-button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .confirmed-kind {
        display: inline-flex;
        gap: 7px;
        padding: 10px;
        background: var(--review-soft);
        border-radius: 10px;
        color: var(--app-accent);
        font-weight: 600;
    }
    .status-pill {
        display: inline-flex;
        gap: 5px;
        align-items: center;
        border-radius: 999px;
        background: var(--review-soft);
        color: var(--app-muted);
        padding: 5px 9px;
        font-size: 0.73rem;
        font-weight: 600;
    }
    .status-pill.confirmed {
        color: var(--app-accent);
    }
    .entry-status > .text-button {
        display: block;
    }
    .row-error {
        background: color-mix(in srgb, #dc2626 4%, var(--app-surface));
    }
    .failure,
    .row-validation {
        color: var(--p-red-600, #c62828);
    }
    .row-validation {
        font-size: 0.78rem;
    }
    .retry,
    .primary-button {
        padding: 10px 12px;
        border: 0;
        border-radius: 10px;
        color: #fff;
        background: var(--app-accent);
        cursor: pointer;
        font: inherit;
        font-size: 0.8rem;
    }
    .retry {
        background: #b91c1c;
    }
    .retry:disabled,
    .primary-button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .entry-evidence {
        margin-top: 12px;
        font-size: 0.76rem;
        color: var(--app-muted);
    }
    .entry-evidence summary {
        cursor: pointer;
        padding: 10px;
        background: var(--review-soft);
        border-radius: 9px;
    }
    .entry-evidence p {
        margin: 10px 0;
    }
    .entry-evidence label {
        display: block;
        margin: 8px 0;
    }
    .entry-evidence textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--app-border);
        border-radius: 9px;
        background: var(--app-surface);
        color: inherit;
        padding: 10px;
        font: inherit;
        resize: vertical;
    }
    .review-pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 15px;
        border-radius: 0 0 16px 16px;
        background: var(--review-soft);
        color: var(--app-muted);
        font-size: 0.78rem;
    }
    .review-pagination button {
        border: 0;
        background: transparent;
        color: var(--app-accent);
        padding: 8px 12px;
        font: inherit;
        cursor: pointer;
    }
    .review-pagination button:disabled {
        color: var(--app-muted);
        opacity: 0.5;
        cursor: default;
    }
    .empty-review {
        padding: 28px !important;
        text-align: center;
        color: var(--app-muted);
    }
    .mobile-label {
        display: none;
    }
    @media (max-width: 700px) {
        .review-filters {
            padding: 0;
            border: 0;
            background: transparent;
            gap: 14px;
        }
        .filter-heading {
            order: 0;
            display: flex;
            width: 100%;
            justify-content: space-between;
            align-items: center;
        }
        .filter-heading strong {
            display: block;
        }
        .date-filters {
            flex-basis: 100%;
            gap: 8px;
        }
        .date-separator {
            display: none;
        }
        .choice-filter {
            flex: 1 1 42%;
            min-width: 0;
        }
        .choice-filter :deep(.p-selectbutton) {
            display: flex;
        }
        .choice-filter :deep(.p-togglebutton) {
            flex: 1;
            padding: 8px 6px;
            font-size: 0.72rem;
        }
        .review-count {
            width: 100%;
            box-sizing: border-box;
        }
        .review-table-wrap {
            background: transparent;
            border: 0;
            overflow: visible;
        }
        .review-table,
        .review-table tbody {
            display: block;
        }
        .review-table thead {
            display: none;
        }
        .review-table tbody {
            display: grid;
            gap: 14px;
        }
        .review-table tr {
            display: grid;
            grid-template-columns: 1fr auto;
            border: 1px solid var(--app-border);
            border-radius: 16px;
            padding: 16px;
            background: var(--app-surface);
            gap: 14px 10px;
        }
        .review-table td {
            padding: 0;
            border: 0;
        }
        .entry-identity {
            grid-column: 1;
            grid-row: 1;
        }
        .entry-status {
            grid-column: 2;
            grid-row: 1 / span 2;
            max-width: 138px;
            text-align: right;
        }
        .entry-status > .text-button {
            margin-left: auto;
        }
        .entry-amount {
            grid-column: 1;
            grid-row: 2;
        }
        .entry-classification {
            grid-column: 1 / -1;
        }
        .mobile-label {
            display: block;
            color: var(--app-muted);
            font-size: 0.72rem;
            margin-bottom: 6px;
        }
        .entry-amount strong {
            font-size: 1.35rem;
            color: var(--app-accent);
        }
        .entry-classification :deep(.p-togglebutton) {
            flex-basis: 75px;
        }
        .entry-evidence summary {
            padding: 12px;
        }
        .list-heading h3 {
            font-size: 1rem;
        }
        .list-heading span {
            font-size: 0.7rem;
        }
        .review-pagination {
            margin-top: 14px;
            border-radius: 12px;
        }
        .empty-review {
            grid-column: 1 / -1;
        }
    }

    @media (max-width: 700px) {
        .choice-filter :deep(.p-togglebutton) {
            padding: 8px 4px;
            min-width: 0;
            flex: 1 1 auto;
        }
        .choice-filter :deep(.p-togglebutton-content) {
            padding: 0;
        }
        .choice-filter :deep(.p-togglebutton-label) {
            white-space: nowrap;
            font-size: 0.7rem;
        }
    }
</style>
