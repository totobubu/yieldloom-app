<script setup>
    import { ref, watch } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import InputNumber from 'primevue/inputnumber';
    import Message from 'primevue/message';

    const props = defineProps({
        snapshot: { type: Object, default: null },
        accountLabel: { type: String, required: true },
        busy: Boolean,
    });
    const emit = defineEmits(['preview']);
    const rows = ref([]),
        asOf = ref(''),
        confirmed = ref(false),
        error = ref('');
    let nextId = 0;
    const emptyRow = () => ({
        id: ++nextId,
        symbol: '',
        quantity: null,
        amount: null,
        currency: 'USD',
    });
    watch(
        () => props.snapshot,
        (snapshot) => {
            rows.value = snapshot?.rows?.length
                ? snapshot.rows.map((row) => ({ ...row, id: ++nextId }))
                : [emptyRow()];
            asOf.value = '';
            confirmed.value = false;
            error.value = '';
        },
        { immediate: true }
    );
    function preview() {
        error.value = '';
        if (!confirmed.value) {
            error.value = '선택 계좌의 전체 잔고임을 확인하세요.';
            return;
        }
        if (props.snapshot && asOf.value <= props.snapshot.asOf) {
            error.value = '기존 잔고보다 새로운 기준일을 입력하세요.';
            return;
        }
        emit('preview', {
            asOf: asOf.value,
            baseSnapshot: props.snapshot
                ? {
                      asOf: props.snapshot.asOf,
                      importedAt: props.snapshot.importedAt ?? null,
                  }
                : null,
            identityConfirmed: true,
            completeSnapshotConfirmed: true,
            rows: rows.value.map(({ symbol, quantity, amount, currency }) => ({
                date: asOf.value,
                symbol,
                quantity,
                amount,
                currency,
            })),
        });
    }
</script>

<template>
    <form
        class="manual-holdings"
        aria-label="수동 잔고 입력"
        @submit.prevent="preview">
        <h3>수동 잔고 입력</h3>
        <Message severity="warn" :closable="false">
            {{ accountLabel }}의 전체 잔고를 입력하세요. 저장하면 이전 잔고를
            대체하며, 목록에서 뺀 종목은 새 잔고에 포함되지 않습니다. 거래
            원장은 변경하지 않습니다.
        </Message>
        <p v-if="snapshot">
            기존 기준일 {{ snapshot.asOf }} · 기존 종목을 아래에 불러왔습니다.
            모든 수량과 평가액을 새 기준일에 맞춰 확인하세요.
        </p>
        <p>
            최대 200행. 현금은 CASH로 입력하세요. 평가액을 모르면 비워 두세요.
            통화별 금액을 자동 환산하지 않습니다.
        </p>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <fieldset :disabled="busy">
            <legend>새 기준일의 전체 보유 목록</legend>
            <label for="manual-asof">수동 잔고 기준일</label>
            <InputText id="manual-asof" v-model="asOf" type="date" required />
            <div v-for="(row, index) in rows" :key="row.id" class="holding-row">
                <label :for="`manual-symbol-${row.id}`"
                    >{{ index + 1 }}행 종목
                    <InputText
                        :id="`manual-symbol-${row.id}`"
                        v-model="row.symbol"
                        required
                        maxlength="40"
                        placeholder="AAPL / CASH" />
                </label>
                <label :for="`manual-quantity-${row.id}`"
                    >{{ index + 1 }}행 수량
                    <InputNumber
                        v-model="row.quantity"
                        :input-id="`manual-quantity-${row.id}`"
                        :min="0"
                        :max="1e15"
                        :max-fraction-digits="10"
                        required />
                </label>
                <label :for="`manual-amount-${row.id}`"
                    >{{ index + 1 }}행 평가액 (선택)
                    <InputNumber
                        v-model="row.amount"
                        :input-id="`manual-amount-${row.id}`"
                        :min="0"
                        :max="1e15"
                        :max-fraction-digits="10" />
                </label>
                <label :for="`manual-currency-${row.id}`"
                    >{{ index + 1 }}행 통화
                    <InputText
                        :id="`manual-currency-${row.id}`"
                        v-model="row.currency"
                        required
                        maxlength="3"
                        pattern="[A-Za-z]{3}" />
                </label>
                <Button
                    type="button"
                    severity="secondary"
                    label="삭제"
                    :aria-label="`${index + 1}행 삭제`"
                    :disabled="rows.length === 1"
                    @click="
                        rows.splice(index, 1);
                        confirmed = false;
                    " />
            </div>
            <Button
                type="button"
                label="종목 추가"
                severity="secondary"
                :disabled="rows.length >= 200"
                @click="
                    rows.push(emptyRow());
                    confirmed = false;
                " />
            <label class="complete-confirmation">
                <input v-model="confirmed" type="checkbox" required />
                선택 계좌의 명의·금융기관을 확인했고, 현금을 포함한 전체 잔고와
                새 기준일의 수량·평가액을 확인했습니다.
            </label>
            <Button type="submit" label="수동 잔고 검토" :loading="busy" />
        </fieldset>
    </form>
</template>

<style scoped>
    .manual-holdings {
        display: grid;
        gap: 1rem;
    }
    fieldset {
        min-width: 0;
        margin: 0;
        padding: 1rem;
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    .holding-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
        gap: 0.75rem;
        align-items: end;
        margin: 1rem 0;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
    }
    .complete-confirmation {
        flex-direction: row;
        align-items: start;
        margin: 1rem 0;
    }
    .holding-row :deep(input) {
        width: 100%;
        min-width: 0;
    }
    @media (max-width: 700px) {
        .holding-row {
            grid-template-columns: minmax(0, 1fr);
            border-bottom: 1px solid var(--app-border);
            padding-bottom: 1rem;
        }
    }
</style>
