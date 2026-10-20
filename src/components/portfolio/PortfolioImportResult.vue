<script setup>
    import { computed, ref } from 'vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import Tag from 'primevue/tag';

    const props = defineProps({
        receipt: { type: Object, required: true },
        busy: Boolean,
        accountsState: { type: String, default: 'loading' },
        latestHoldingsDate: { type: String, default: '' },
    });
    defineEmits(['view', 'export', 'another', 'calendar']);
    const heading = ref(null);
    function focusHeading() {
        heading.value?.focus({ preventScroll: true });
        heading.value
            ?.closest('.import-result')
            ?.scrollIntoView({ block: 'start' });
    }
    defineExpose({ focusHeading });
    const explanation = computed(() => {
        if (props.accountsState !== 'ready')
            return '저장은 완료되었습니다. 계좌 목록 갱신 상태를 확인해 주세요.';
        if (props.receipt.kind === 'transactions')
            return '거래 기록을 저장했고 계산 잔고에 반영했습니다. 증권사 잔고내역을 등록하면 해당 기준일 이후 거래만 누적합니다.';
        if (
            props.latestHoldingsDate &&
            props.latestHoldingsDate > props.receipt.asOf
        )
            return `과거 기준일 자료로 보관했습니다. 화면에는 더 최신인 ${props.latestHoldingsDate} 잔고가 표시됩니다.`;
        return '이 기준일의 전체 잔고가 한눈에 보기에 표시됩니다. 현재 시세로 계산한 평가액은 아닙니다.';
    });
</script>

<template>
    <Card class="import-result" role="status" aria-live="polite">
        <template #content>
            <p class="result-step">STEP 3 · 저장 결과</p>
            <div class="result-heading">
                <i class="pi pi-check-circle" aria-hidden="true" />
                <div>
                    <h2 ref="heading" tabindex="-1">
                        {{
                            receipt.inserted
                                ? '자료 저장이 완료되었습니다'
                                : '이미 등록된 자료입니다'
                        }}
                    </h2>
                    <p>
                        {{ receipt.accountAlias }} ·
                        {{
                            receipt.kind === 'holdings'
                                ? '잔고내역'
                                : '거래내역'
                        }}
                    </p>
                </div>
                <Tag
                    :value="receipt.inserted ? '저장 완료' : '중복 확인'"
                    :severity="receipt.inserted ? 'success' : 'secondary'" />
            </div>
            <dl class="result-counts">
                <div>
                    <dt>새로 저장</dt>
                    <dd>{{ receipt.inserted.toLocaleString('ko-KR') }}행</dd>
                </div>
                <div>
                    <dt>중복 제외</dt>
                    <dd>{{ receipt.duplicates.toLocaleString('ko-KR') }}행</dd>
                </div>
                <div>
                    <dt>
                        {{
                            receipt.kind === 'transactions'
                                ? '조회 종료일'
                                : '잔고 기준일'
                        }}
                    </dt>
                    <dd>{{ receipt.asOf }}</dd>
                </div>
            </dl>
            <p>{{ explanation }}</p>
            <div class="result-actions">
                <Button
                    :label="
                        receipt.kind === 'holdings'
                            ? '잔고 확인'
                            : '저장 거래 확인'
                    "
                    :disabled="busy || accountsState !== 'ready'"
                    @click="$emit('view')" />
                <Button
                    label="CSV로 내려받기"
                    icon="pi pi-download"
                    severity="secondary"
                    outlined
                    :disabled="busy || accountsState !== 'ready'"
                    @click="$emit('export')" />
                <Button
                    label="배당 캘린더 확인"
                    icon="pi pi-calendar"
                    severity="secondary"
                    outlined
                    :disabled="busy || accountsState !== 'ready'"
                    @click="$emit('calendar')" />
                <Button
                    label="추가 등록"
                    severity="secondary"
                    text
                    :disabled="busy"
                    @click="$emit('another')" />
            </div>
        </template>
    </Card>
</template>

<style scoped>
    .import-result {
        margin-bottom: 1.5rem;
        border: 1px solid var(--p-green-300);
        scroll-margin-top: 90px;
    }
    .result-step {
        margin: 0 0 16px;
        color: var(--app-accent);
        font-size: 12px;
        font-weight: 650;
    }
    .result-heading {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
    }
    .result-heading > i {
        font-size: 1.8rem;
        color: var(--p-green-600);
    }
    .result-heading > div {
        flex: 1;
        min-width: 0;
    }
    .result-heading h2 {
        margin: 0;
        font-size: 1.1rem;
        word-break: keep-all;
    }
    .result-heading p {
        margin: 0.3rem 0 0;
        overflow-wrap: anywhere;
    }
    .result-counts {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem 2rem;
        margin: 1.25rem 0;
    }
    .result-counts dt {
        font-size: 0.8rem;
        color: var(--app-muted);
    }
    .result-counts dd {
        margin: 0.25rem 0 0;
        font-weight: 600;
    }
    .result-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1rem;
    }
    @media (max-width: 767px) {
        .result-actions {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>
