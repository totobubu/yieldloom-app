<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Dialog from 'primevue/dialog';
    import Message from 'primevue/message';
    import Select from 'primevue/select';
    import { firebaseUser } from '@/services/firebaseClient';
    import {
        familyRequest,
        loadFamilyLedger,
    } from '@/services/familyPortfolio';
    import { loadPortfolioCsv } from '@/services/portfolioCsv';

    const props = defineProps({
        visible: Boolean,
        accounts: { type: Array, default: () => [] },
        familyId: { type: String, default: '' },
        initialAccountId: { type: String, default: '' },
        initialKind: { type: String, default: 'holdings' },
    });
    const emit = defineEmits(['update:visible']);
    const accountId = ref(''),
        kind = ref('holdings');
    const loading = ref(false),
        error = ref(''),
        status = ref(''),
        count = ref(0);
    const accountOptions = computed(() =>
        props.accounts.map((account) => ({
            label: account.alias,
            value: account.id,
        }))
    );
    const kindOptions = [
        { label: '기준일 잔고', value: 'holdings' },
        { label: '저장된 전체 거래', value: 'transactions' },
    ];
    let controller;
    function cancel() {
        controller?.abort();
        controller = undefined;
        loading.value = false;
    }
    watch(
        () => [
            props.visible,
            props.familyId,
            props.initialKind,
            firebaseUser.value?.uid,
            props.accounts.map((a) => a.id).join(','),
        ],
        () => {
            cancel();
            error.value = '';
            status.value = '';
            count.value = 0;
            accountId.value = props.accounts.some(
                (a) => a.id === props.initialAccountId
            )
                ? props.initialAccountId
                : props.accounts[0]?.id || '';
            kind.value = props.initialKind;
        },
        { immediate: true, flush: 'sync' }
    );
    watch([accountId, kind], () => {
        cancel();
        error.value = '';
        status.value = '';
    });
    onScopeDispose(cancel);

    async function download() {
        if (loading.value) return;
        const requestController = new AbortController();
        controller = requestController;
        const uid = firebaseUser.value?.uid,
            id = accountId.value,
            selectedKind = kind.value,
            family = props.familyId;
        const isCurrent = () =>
            props.visible &&
            firebaseUser.value?.uid === uid &&
            props.familyId === family &&
            accountId.value === id &&
            kind.value === selectedKind &&
            props.accounts.some((a) => a.id === id);
        loading.value = true;
        error.value = '';
        status.value = '';
        count.value = 0;
        try {
            const result = await loadPortfolioCsv({
                request: familyRequest,
                loadLedger: loadFamilyLedger,
                familyId: family,
                accountId: id,
                kind: selectedKind,
                signal: requestController.signal,
                isCurrent,
                onProgress: (value) => {
                    count.value = value;
                },
            });
            if (!isCurrent() || requestController.signal.aborted) return;
            const url = URL.createObjectURL(
                new Blob([result.csv], { type: 'text/csv;charset=utf-8' })
            );
            const link = document.createElement('a');
            const alias = String(
                props.accounts.find((a) => a.id === id)?.alias || 'account'
            )
                .replace(/[^\p{L}\p{N}_-]/gu, '_')
                .slice(0, 40);
            link.href = url;
            link.download = `yieldloom-${alias}-${selectedKind}.csv`;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.value = `${result.count.toLocaleString('ko-KR')}행의 CSV 파일 다운로드를 요청했습니다.`;
        } catch (reason) {
            if (isCurrent() && !requestController.signal.aborted)
                error.value = reason.message;
        } finally {
            if (controller === requestController) {
                controller = undefined;
                loading.value = false;
            }
        }
    }
</script>

<template>
    <Dialog
        :visible="visible"
        modal
        header="CSV 내보내기"
        :style="{ width: '32rem', maxWidth: '94vw' }"
        @update:visible="emit('update:visible', $event)">
        <div class="export-fields">
            <p class="export-intro">
                선택한 계좌의 저장 자료를 엑셀 등에서 열 수 있는 CSV로
                내려받으세요.
            </p>
            <label id="export-account-label" for="export-account"
                >내보낼 계좌</label
            >
            <Select
                v-model="accountId"
                input-id="export-account"
                aria-labelledby="export-account-label"
                :options="accountOptions"
                option-label="label"
                option-value="value"
                :disabled="loading"
                placeholder="계좌 선택" />
            <label id="export-kind-label" for="export-kind">내보낼 자료</label>
            <Select
                v-model="kind"
                input-id="export-kind"
                aria-labelledby="export-kind-label"
                :options="kindOptions"
                option-label="label"
                option-value="value"
                :disabled="loading" />
            <p v-if="kind === 'holdings'">
                저장된 최신 기준일의 잔고입니다. 현재 시세로 계산한 평가액이
                아니며, 미확인 금액은 빈칸으로 남깁니다.
            </p>
            <p v-else>
                화면에 조회한 일부 행이 아닌, 이 계좌에 저장된 전체 거래를 최대
                10,000행까지 내보냅니다. 이전 단일 계좌 자료는 포함하지
                않습니다.
            </p>
            <small
                >통화·자료 기준일·출처를 함께 담습니다. 다시 올릴 때는 계좌별
                표준 CSV 양식과 200행 제한을 확인하세요. 텍스트 안전 처리가
                복원되도록 csvEscaped 열을 유지해 주세요.</small
            >
            <p v-if="loading" role="status" aria-live="polite">
                자료 조회 중 · {{ count.toLocaleString('ko-KR') }}행 확인
            </p>
            <Message v-if="error" severity="error" :closable="false">{{
                error
            }}</Message>
            <Message
                v-if="status"
                severity="success"
                :closable="false"
                role="status"
                >{{ status }}</Message
            >
        </div>
        <template #footer>
            <Button
                :label="loading ? '내보내기 취소' : '닫기'"
                severity="secondary"
                outlined
                @click="emit('update:visible', false)" />
            <Button
                label="CSV 다운로드"
                icon="pi pi-download"
                :loading="loading"
                :disabled="!accountId || !accounts.length"
                @click="download" />
        </template>
    </Dialog>
</template>

<style scoped>
    .export-fields {
        display: grid;
        gap: 0.75rem;
    }
    .export-fields p {
        margin: 0;
        line-height: 1.7;
    }
    .export-fields label {
        font-weight: 600;
        margin-top: 0.25rem;
    }
    .export-fields small {
        color: var(--app-muted);
        line-height: 1.7;
    }
</style>
