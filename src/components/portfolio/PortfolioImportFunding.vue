<script setup>
    import { computed, ref } from 'vue';
    import { fundingEvidenceIndices } from '@/services/tossImportReview.js';
    import Dialog from 'primevue/dialog';
    import Button from 'primevue/button';
    import {
        reviewMoney,
        reviewNumber,
        reviewSecurityLabel,
    } from '@/services/importReviewPresentation.js';
    const props = defineProps({
        rows: { type: Array, required: true },
        cashIndices: { type: Array, default: null },
        busy: Boolean,
        showSummary: Boolean,
    });
    const selectedIndex = defineModel('selectedIndex', {
        type: Number,
        default: null,
    });
    const limit = ref(3);
    const matches = computed(() =>
        props.rows
            .map((row, index) => ({ row, index }))
            .filter(
                ({ row }) =>
                    row._fundingStatus === 'matched_exchange' &&
                    (props.cashIndices === null ||
                        fundingEvidenceIndices(row._fundingSuggestion).some(
                            (index) => props.cashIndices.includes(index)
                        ))
            )
    );
    const selected = computed(() =>
        selectedIndex.value === null ? null : props.rows[selectedIndex.value]
    );
    const suggestion = computed(() => selected.value?._fundingSuggestion);
    const legs = computed(
        () =>
            suggestion.value?.legs ||
            (suggestion.value
                ? [
                      {
                          krwIndex: suggestion.value.krwIndex,
                          usdIndex: suggestion.value.usdIndex,
                          amount: suggestion.value.amount,
                          paidKrw: suggestion.value.paidKrw,
                      },
                  ]
                : [])
    );
    const visible = computed({
        get: () => selectedIndex.value !== null,
        set: (value) => {
            if (!value) selectedIndex.value = null;
        },
    });
</script>
<template>
    <div
        v-if="showSummary"
        class="funding-summary"
        aria-label="환전과 매수 결제 연결">
        <div class="funding-heading">
            <strong
                ><i class="pi pi-link" aria-hidden="true" />동일 날짜 환전·매수
                결제 연결</strong
            ><span>{{ matches.length }}건 연결</span>
        </div>
        <p>
            같은 날짜의 원화 출금·달러 입금을 먼저 대조하고 환전 자금을 구매에
            배분합니다. 개별 주문의 자금 출처와 부족한 금액은 확인이 필요합니다.
        </p>
        <div
            v-for="item in matches.slice(0, limit)"
            :key="item.index"
            class="funding-preview">
            <span>{{ item.row.date }}</span
            ><strong>{{
                reviewMoney(item.row._fundingSuggestion.paidKrw, 'KRW')
            }}</strong
            ><i class="pi pi-arrow-right" aria-hidden="true" /><strong>{{
                reviewMoney(
                    item.row._fundingSuggestion.convertedAmount ??
                        item.row._fundingSuggestion.amount,
                    'USD'
                )
            }}</strong
            ><i class="pi pi-arrow-right" aria-hidden="true" /><button
                type="button"
                :disabled="busy"
                @click="selectedIndex = item.index">
                {{ reviewSecurityLabel(item.row) }} 매수
                <i class="pi pi-external-link" aria-hidden="true" />
            </button>
        </div>
        <p v-if="!matches.length">
            현재 필터에 연결된 환전 결제가 없습니다. 원본 날짜·통화·금액·환율을
            확인해 주세요.
        </p>
        <Button
            v-if="matches.length > limit"
            type="button"
            :label="`연결 ${matches.length - limit}건 더 보기`"
            text
            size="small"
            :disabled="busy"
            @click="limit += 10" />
    </div>
    <Dialog
        v-model:visible="visible"
        append-to="self"
        modal
        header="매수 결제 구성"
        :style="{ width: 'min(600px, 94vw)' }">
        <template v-if="selected && suggestion">
            <div class="funding-security">
                <strong>{{ selected.securityName || selected.symbol }}</strong
                ><span>{{ selected.symbol }} · {{ selected.date }}</span>
            </div>
            <ol class="funding-steps">
                <li
                    v-for="(leg, index) in legs"
                    :key="`${leg.krwIndex}:${leg.usdIndex}`">
                    <span>{{ index + 1 }}</span>
                    <div>
                        <strong
                            >환전 배분 {{ reviewMoney(leg.paidKrw, 'KRW') }} →
                            {{ reviewMoney(leg.amount, 'USD') }}</strong
                        >
                        <small
                            >원본 환전
                            {{ reviewMoney(rows[leg.krwIndex]?.amount, 'KRW') }}
                            →
                            {{ reviewMoney(rows[leg.usdIndex]?.amount, 'USD') }}
                            · {{ leg.krwIndex + 1 }}행 /
                            {{ leg.usdIndex + 1 }}행</small
                        >
                    </div>
                </li>
                <li>
                    <span>{{ legs.length + 1 }}</span>
                    <div>
                        <strong
                            >{{ reviewSecurityLabel(selected) }} 매수 정산
                            {{ reviewMoney(suggestion.amount, 'USD') }}</strong
                        ><small
                            >{{ reviewNumber(selected.quantity) }}주 ·
                            {{ selectedIndex + 1 }}행</small
                        >
                    </div>
                </li>
            </ol>
            <p v-if="suggestion.unconfirmedAmount > 0" class="funding-note">
                결제 자금 미확인:
                {{ reviewMoney(suggestion.unconfirmedAmount, 'USD') }}
            </p>
            <p class="funding-note">
                {{
                    suggestion.basis === 'date_pool'
                        ? '같은 날짜 환전 자금을 정해진 순서로 배분한 제안입니다. 사용하지 않은 달러는 잔액으로, 부족한 결제 금액은 미확인으로 유지합니다.'
                        : suggestion.basis === 'settlement'
                          ? '원문 원화 정산액과 달러 정산액을 각각 대조했습니다.'
                          : '달러 정산액과 원화 출금액·환율을 대조했습니다. 원화 반올림 오차는 최대 1원까지 허용합니다.'
                }}
            </p>
            <p class="funding-note">
                이 연결은 매수 결제 경로입니다. 원화가 외부에서 납입된 원금인지,
                매도·배당금인지에 대한 최초 출처는 별도 확인이 필요합니다.
            </p>
        </template>
        <p v-else class="funding-note">
            현재 자료로는 결제 구성을 확정할 수 없습니다. 거래를 수정하면
            날짜·통화·정산액을 다시 대조합니다.
        </p>
    </Dialog>
</template>
<style scoped>
    .funding-summary {
        border: 1px solid var(--review-line, var(--app-border));
        border-radius: 10px;
        background: var(--app-surface);
        padding: 12px 14px;
        margin-bottom: 14px;
        font-size: 11px;
    }
    .funding-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .funding-heading strong {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
    }
    .funding-heading i,
    .funding-heading > span {
        color: var(--app-accent);
    }
    .funding-summary > p {
        font-size: 10px;
        color: var(--app-muted);
        margin: 6px 0 0;
    }
    .funding-preview {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
        padding: 8px;
        border-radius: 6px;
        background: var(--review-tint, var(--app-surface-muted));
    }
    .funding-preview > span {
        color: var(--app-muted);
        font-size: 10px;
    }
    .funding-preview > i {
        font-size: 9px;
        color: var(--app-muted);
    }
    .funding-preview button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        background: transparent;
        color: var(--app-accent);
        padding: 0;
        font: inherit;
        font-weight: 650;
        cursor: pointer;
    }
    .funding-preview button > i {
        font-size: 0.9em;
        line-height: 1;
        flex-shrink: 0;
    }
    .funding-security strong,
    .funding-security span {
        display: block;
    }
    .funding-security span {
        font-size: 12px;
        color: var(--app-muted);
        margin-top: 4px;
    }
    .funding-steps {
        list-style: none;
        margin: 24px 0;
        padding: 0;
        display: grid;
        gap: 16px;
    }
    .funding-steps li {
        display: flex;
        align-items: flex-start;
        gap: 12px;
    }
    .funding-steps li > span {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        font-size: 12px;
        flex-shrink: 0;
    }
    .funding-steps strong {
        font-size: 13px;
    }
    .funding-steps small {
        display: block;
        color: var(--app-muted);
        font-size: 11px;
        margin-top: 3px;
    }
    .funding-note {
        font-size: 12px;
        line-height: 1.7;
        color: var(--app-muted);
    }
</style>
