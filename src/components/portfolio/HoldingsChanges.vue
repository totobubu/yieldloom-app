<script setup>
    import { computed } from 'vue';
    import { holdingsChanges } from '@/services/holdingsChanges.js';
    const props = defineProps({
        before: { type: Array, default: () => [] },
        after: { type: Array, required: true },
    });
    const changes = computed(() => holdingsChanges(props.before, props.after));
    const format = (v) =>
        v == null
            ? '미확인 / 없음'
            : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 10 });
</script>
<template>
    <div class="changes">
        <p v-if="!changes.length">수량·평가액 변경이 없습니다.</p>
        <table v-else aria-label="잔고 변경 전후">
            <thead>
                <tr>
                    <th>종목·통화</th>
                    <th>변경</th>
                    <th>이전 수량</th>
                    <th>변경 수량</th>
                    <th>이전 평가액</th>
                    <th>변경 평가액</th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="row in changes"
                    :key="`${row.symbol}:${row.currency}`">
                    <th>{{ row.symbol }} · {{ row.currency }}</th>
                    <td>{{ row.status }}</td>
                    <td>{{ format(row.beforeQuantity) }}</td>
                    <td>{{ format(row.afterQuantity) }}</td>
                    <td>{{ format(row.beforeAmount) }}</td>
                    <td>{{ format(row.afterAmount) }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
<style scoped>
    .changes {
        overflow: auto;
        max-width: 100%;
        min-width: 0;
    }
    table {
        width: 100%;
        min-width: 680px;
        border-collapse: collapse;
    }
    th,
    td {
        text-align: left;
        padding: 0.6rem;
        border-bottom: 1px solid var(--app-border);
    }
</style>
