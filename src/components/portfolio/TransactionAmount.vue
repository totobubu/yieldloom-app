<script setup>
    import {
        transactionMoney,
        transactionRate,
    } from '@/services/transactionAmount.js';
    defineProps({ row: { type: Object, required: true } });
</script>

<template>
    <span class="transaction-amount">
        <span>{{ transactionMoney(row.amount, row.currency) }}</span>
        <small v-if="row.label" class="kind">{{ row.label }}</small>
        <br v-if="row.secondary || row.rate" />
        <small v-if="row.secondary || row.rate" class="conversion">
            <template v-if="row.secondary"
                >({{
                    transactionMoney(
                        row.secondary.amount,
                        row.secondary.currency
                    )
                }})</template
            >
            <template v-if="row.secondary && row.rate">, </template>
            <template v-if="row.rate"
                >환율 {{ transactionRate(row.rate) }}원/USD</template
            >
        </small>
        <small v-if="row.note" class="status">{{ row.note }}</small>
    </span>
</template>

<style scoped>
    .transaction-amount {
        display: block;
        line-height: 1.5;
    }
    .kind,
    .conversion,
    .status {
        color: var(--app-muted, #64748b);
        font-size: 0.78rem;
    }
    .kind {
        margin-left: 6px;
    }
    .status {
        display: block;
    }
</style>
