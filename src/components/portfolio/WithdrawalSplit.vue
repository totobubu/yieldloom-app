<script setup>
    import { computed } from 'vue';
    import {
        withdrawalBreakdown,
        withdrawalSources,
    } from '../../../lib/portfolio-capital.js';
    import { transactionMoney } from '@/services/transactionAmount.js';
    const props = defineProps({
        amount: [Number, String],
        currency: String,
        modelValue: Object,
        disabled: Boolean,
    });
    const emit = defineEmits(['update:modelValue']);
    const error = computed(() => {
        try {
            withdrawalBreakdown(props, {
                classification: 'mixed_withdrawal',
                withdrawalParts: props.modelValue,
            });
            return '';
        } catch (reason) {
            return reason.message;
        }
    });
</script>
<template>
    <fieldset class="withdrawal-split" :disabled="disabled">
        <legend>출금액 {{ transactionMoney(amount, currency) }} 나누기</legend>
        <label v-for="(label, source) in withdrawalSources" :key="source">
            {{ label }} ({{ currency }})
            <input
                :value="modelValue?.[source] ?? 0"
                :aria-label="`출금 ${label}`"
                type="number"
                min="0"
                :max="amount"
                :step="currency === 'KRW' ? 1 : 0.000001"
                @input="
                    emit('update:modelValue', {
                        ...modelValue,
                        [source]: $event.target.value,
                    })
                " />
        </label>
        <p v-if="error" class="error" role="status">{{ error }}</p>
        <p v-else class="help">
            실제 출금액과 일치합니다. 미확인 금액은 원금 회수로 간주하지
            않습니다.
        </p>
    </fieldset>
</template>
<style scoped>
    .withdrawal-split {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        border: 1px solid var(--app-border-subtle, #ddd);
        border-radius: 8px;
        padding: 12px;
        margin: 8px 0;
        min-width: 0;
    }
    label {
        display: grid;
        gap: 4px;
        min-width: 0;
        font-size: 0.85rem;
    }
    input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        font: inherit;
        padding: 8px;
        border: 1px solid var(--app-border, #bbb);
        border-radius: 6px;
        background: var(--app-surface, #fff);
        color: inherit;
    }
    p {
        grid-column: 1/-1;
        margin: 0;
        font-size: 0.8rem;
        white-space: normal;
    }
    .error {
        color: #c62828;
    }
    .help {
        color: var(--app-muted, #666);
    }
    @media (max-width: 500px) {
        .withdrawal-split {
            grid-template-columns: 1fr;
        }
    }
</style>
