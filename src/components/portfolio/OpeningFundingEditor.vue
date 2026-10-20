<script setup>
    import { computed, ref, watch } from 'vue';

    const props = defineProps({
        lots: { type: Array, default: () => [] },
        revision: { type: Number, default: 0 },
        disabled: Boolean,
    });
    const emit = defineEmits(['save']);
    const trackingStartAt = ref('');
    const rows = ref([]);
    let nextKey = 0;
    const blank = () => ({
        _key: `new-${++nextKey}`,
        currency: 'USD',
        symbol: 'CASH',
        amount: '',
        quantity: '',
    });
    watch(
        () => props.lots,
        (lots) => {
            trackingStartAt.value =
                lots[0]?.trackingStartAt?.replace(
                    /(\d{4})(\d{2})(\d{2})/,
                    '$1-$2-$3'
                ) || '';
            rows.value = lots.length
                ? lots.map((lot) => ({
                      ...lot,
                      _key: lot.id || `saved-${++nextKey}`,
                  }))
                : [blank()];
        },
        { immediate: true, deep: true }
    );
    const invalid = computed(
        () =>
            !trackingStartAt.value ||
            !rows.value.length ||
            rows.value.some(
                (row) =>
                    !(Number(row.amount) > 0) ||
                    (String(row.symbol).trim().toUpperCase() !== 'CASH' &&
                        !(Number(row.quantity) > 0))
            )
    );
    const save = () =>
        emit('save', {
            action: 'saveOpening',
            revision: props.revision,
            trackingStartAt: trackingStartAt.value,
            lots: rows.value.map((row) => {
                const symbol = String(row.symbol || 'CASH')
                    .trim()
                    .toUpperCase();
                return {
                    currency: row.currency,
                    symbol,
                    amount: Number(row.amount),
                    ...(symbol === 'CASH'
                        ? {}
                        : { quantity: Number(row.quantity) }),
                };
            }),
        });
</script>

<template>
    <details class="opening-editor">
        <summary>기초 원금 설정 · {{ lots.length }}개</summary>
        <p>
            시작일 장 마감 기준의 현금과 주식 취득원가입니다. 이 값은 확정
            원금으로 집계하며 시작일까지의 기존 거래는 다시 계산하지 않습니다.
        </p>
        <label>
            원금 추적 시작일
            <input v-model="trackingStartAt" type="date" :disabled="disabled" />
        </label>
        <div class="scroll">
            <table aria-label="기초 원금 항목">
                <thead>
                    <tr>
                        <th>통화</th>
                        <th>종목</th>
                        <th>취득원가·현금</th>
                        <th>수량</th>
                        <th>삭제</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, index) in rows" :key="row._key">
                        <td>
                            <select v-model="row.currency" :disabled="disabled">
                                <option value="USD">USD</option>
                                <option value="KRW">KRW</option>
                            </select>
                        </td>
                        <td>
                            <input
                                v-model.trim="row.symbol"
                                aria-label="기초 원금 종목"
                                maxlength="40"
                                :disabled="disabled" />
                        </td>
                        <td>
                            <input
                                v-model="row.amount"
                                aria-label="기초 취득원가"
                                type="number"
                                min="0"
                                :step="row.currency === 'KRW' ? 1 : 0.000001"
                                :disabled="disabled" />
                        </td>
                        <td>
                            <input
                                v-model="row.quantity"
                                aria-label="기초 보유 수량"
                                type="number"
                                min="0"
                                step="0.000001"
                                :disabled="
                                    disabled ||
                                    String(row.symbol).trim().toUpperCase() ===
                                        'CASH'
                                " />
                        </td>
                        <td>
                            <button
                                type="button"
                                :aria-label="`${index + 1}번 기초 원금 삭제`"
                                :disabled="disabled || rows.length === 1"
                                @click="rows.splice(index, 1)">
                                삭제
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="actions">
            <button
                type="button"
                :disabled="disabled"
                @click="rows.push(blank())">
                항목 추가
            </button>
            <button type="button" :disabled="disabled || invalid" @click="save">
                기초 원금 저장
            </button>
        </div>
    </details>
</template>

<style scoped>
    .opening-editor {
        margin: 16px 0;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 10px;
    }
    .scroll {
        overflow-x: auto;
    }
    table {
        width: 100%;
        margin-top: 12px;
        border-collapse: collapse;
    }
    th,
    td {
        padding: 8px;
        text-align: left;
        border-bottom: 1px solid var(--app-border);
    }
    input,
    select {
        max-width: 160px;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
    }
</style>
