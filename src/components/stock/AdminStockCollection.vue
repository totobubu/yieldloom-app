<script setup>
    import { ref, watch, onScopeDispose } from 'vue';
    import Button from 'primevue/button';
    import { firebaseUser } from '@/services/firebaseClient.js';
    import { isPortfolioAdmin } from '../../../lib/portfolio-admin.js';
    import { stockCollectionRequest } from '@/services/stockCollection.js';
    const props = defineProps({ symbol: { type: String, required: true } });
    const emit = defineEmits(['collected']);
    const busy = ref(false),
        message = ref(''),
        error = ref(''),
        receipt = ref(null);
    let controller;
    const reset = () => {
        controller?.abort();
        busy.value = false;
        receipt.value = null;
        message.value = '';
        error.value = '';
    };
    watch([() => props.symbol, firebaseUser], reset);
    onScopeDispose(reset);
    const pause = (signal) =>
        new Promise((resolve, reject) => {
            const done = () => {
                signal.removeEventListener('abort', abort);
                resolve();
            };
            const timer = setTimeout(done, 15000);
            const abort = () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            signal.addEventListener('abort', abort, { once: true });
        });
    async function collect() {
        if (busy.value || !isPortfolioAdmin(firebaseUser.value)) return;
        const user = firebaseUser.value,
            symbol = props.symbol;
        controller = new AbortController();
        const current = controller;
        busy.value = true;
        error.value = '';
        try {
            if (!receipt.value) {
                const result = await stockCollectionRequest(user, symbol, {
                    signal: current.signal,
                });
                if (
                    current.signal.aborted ||
                    firebaseUser.value !== user ||
                    props.symbol !== symbol
                )
                    return;
                receipt.value = result;
            }
            for (let i = 0; i < 40; i++) {
                if (current.signal.aborted) return;
                const result = await stockCollectionRequest(user, symbol, {
                    requestId: receipt.value.requestId,
                    signal: current.signal,
                });
                if (
                    current.signal.aborted ||
                    firebaseUser.value !== user ||
                    props.symbol !== symbol
                )
                    return;
                if (result.state === 'failed') {
                    receipt.value = null;
                    throw new Error(result.error);
                }
                if (result.state === 'ready') {
                    receipt.value = null;
                    message.value =
                        result.data?.dataStatus === 'fresh'
                            ? '최신 데이터로 업데이트했습니다.'
                            : '수집은 완료됐으며 일부 자료는 확인이 필요합니다.';
                    emit('collected', result.data);
                    return;
                }
                message.value =
                    result.state === 'publishing'
                        ? '수집 완료 · 화면 반영 중입니다.'
                        : result.state === 'queued'
                          ? '수집을 기다리고 있습니다.'
                          : `${symbol} 데이터를 수집하고 있습니다.`;
                await pause(current.signal);
            }
            message.value =
                '수집이 계속 진행 중입니다. 상태 확인을 눌러 주세요.';
        } catch (reason) {
            if (current.signal.aborted) return;
            error.value = reason.message;
        } finally {
            if (controller === current) busy.value = false;
        }
    }
</script>
<template>
    <div v-if="isPortfolioAdmin(firebaseUser)" class="admin-stock-collection">
        <Button
            :label="receipt && !busy ? '수집 상태 확인' : '데이터 수집'"
            icon="pi pi-refresh"
            severity="secondary"
            outlined
            :loading="busy"
            :disabled="busy"
            @click="collect" />
        <p v-if="error" class="collection-error" role="alert">{{ error }}</p>
        <p v-else-if="message" role="status">{{ message }}</p>
    </div>
</template>
<style scoped>
    .admin-stock-collection {
        max-width: 300px;
        text-align: right;
    }
    p {
        margin: 8px 0 0;
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.6;
    }
    .collection-error {
        color: var(--p-red-600);
    }
    @media (max-width: 600px) {
        .admin-stock-collection {
            text-align: left;
        }
    }
</style>
