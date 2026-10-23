<script setup>
    import { computed, ref, watch, onScopeDispose } from 'vue';
    import Button from 'primevue/button';
    import Dialog from 'primevue/dialog';
    import { firebaseUser } from '@/services/firebaseClient.js';
    import { isPortfolioAdmin } from '../../../lib/portfolio-admin.js';
    import { stockCollectionRequest } from '@/services/stockCollection.js';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    const props = defineProps({ symbol: { type: String, required: true } });
    const emit = defineEmits(['collected']);
    const busy = ref(false),
        message = ref(''),
        error = ref(''),
        receipt = ref(null),
        record = ref(null),
        showRecord = ref(false),
        recordLoading = ref(false),
        recordError = ref('');
    const stateLabels = {
        success: '완료',
        failure: '실패',
        skipped: '건너뜀',
        cancelled: '취소',
        timed_out: '시간 초과',
        queued: '대기',
        in_progress: '진행 중',
        completed: '종료',
    };
    const steps = computed(() =>
        record.value?.diagnostics?.steps?.length
            ? record.value.diagnostics.steps
            : [
                  { name: '수집 요청 접수', state: 'success' },
                  {
                      name: '공식 자료 수집 · 결과 검증',
                      state:
                          record.value?.state === 'failed'
                              ? 'failure'
                              : ['publishing', 'ready'].includes(
                                      record.value?.state
                                  )
                                ? 'success'
                                : 'in_progress',
                  },
                  {
                      name: '운영 배포 · 화면 반영',
                      state:
                          record.value?.state === 'ready'
                              ? 'success'
                              : record.value?.state === 'publishing'
                                ? 'in_progress'
                                : 'queued',
                  },
              ]
    );
    useFullscreenLoading(busy, () => message.value);
    let controller, recordController;
    async function openRecord() {
        showRecord.value = true;
        if (record.value) return;
        const user = firebaseUser.value,
            symbol = props.symbol;
        recordController?.abort();
        const current = new AbortController();
        recordController = current;
        recordLoading.value = true;
        recordError.value = '';
        try {
            const result = await stockCollectionRequest(user, symbol, {
                history: true,
                signal: current.signal,
            });
            if (
                !current.signal.aborted &&
                user === firebaseUser.value &&
                symbol === props.symbol
            )
                record.value = result;
        } catch (reason) {
            if (!current.signal.aborted) recordError.value = reason.message;
        } finally {
            if (recordController === current) recordLoading.value = false;
        }
    }
    const reset = () => {
        controller?.abort();
        recordController?.abort();
        recordLoading.value = false;
        recordError.value = '';
        busy.value = false;
        receipt.value = null;
        record.value = null;
        showRecord.value = false;
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
        message.value = `${symbol} 데이터 수집을 요청하고 있습니다.`;
        try {
            if (!receipt.value) {
                record.value = null;
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
                record.value = result;
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
                record.value = { ...record.value, ...result };
                if (result.state === 'failed') {
                    receipt.value = null;
                    throw new Error(result.diagnostics?.reason || result.error);
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
        <p v-else-if="message && !busy" role="status">{{ message }}</p>
        <Button
            v-if="!busy"
            label="수집 기록"
            icon="pi pi-list"
            severity="secondary"
            text
            size="small"
            @click="openRecord" />
        <Dialog
            v-model:visible="showRecord"
            :header="`${symbol} 수집 기록`"
            modal
            block-scroll
            :draggable="false"
            :style="{ width: 'min(580px, calc(100vw - 32px))' }">
            <p v-if="recordLoading" role="status">
                최근 수집 기록을 불러오고 있습니다.
            </p>
            <p v-else-if="recordError" role="alert">{{ recordError }}</p>
            <p v-else-if="record?.state === 'idle'">
                이 종목의 최근 수집 실행 기록이 없습니다.
            </p>
            <div v-else-if="record" class="collection-record">
                <template v-if="record?.diagnostics">
                    <h3>실패 이유</h3>
                    <p role="alert">{{ record.diagnostics.reason }}</p>
                    <p>{{ record.diagnostics.nextAction }}</p>
                </template>
                <h3>진행 과정</h3>
                <ol class="collection-steps">
                    <li
                        v-for="(step, index) in steps"
                        :key="index"
                        :data-state="step.state">
                        <span>{{ step.name }}</span>
                        <strong>{{
                            stateLabels[step.state] || '확인 필요'
                        }}</strong>
                        <a
                            v-if="step.logUrl"
                            :href="step.logUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                            :aria-label="`${step.name} 원본 로그 열기`"
                            >로그
                            <i class="pi pi-external-link" aria-hidden="true"
                        /></a>
                    </li>
                </ol>
                <p v-if="record?.state === 'failed'">
                    저장·검증 단계가 완료되어도 전체 수집 성공을 뜻하지
                    않습니다. 실패 후 정리 작업이 포함될 수 있습니다.
                </p>
                <p
                    v-if="
                        record?.state === 'failed' &&
                        !record?.diagnostics?.steps?.length
                    ">
                    세부 단계를 불러오지 못했습니다. 원본 실행 기록을 확인해
                    주세요.
                </p>
                <a
                    v-if="record?.runUrl"
                    :href="record.runUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="collection-run-link"
                    >GitHub 원본 실행 기록
                    <i class="pi pi-external-link" aria-hidden="true"
                /></a>
                <small v-if="record?.requestId"
                    >요청 ID: {{ record.requestId }}</small
                >
            </div>
        </Dialog>
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
    .collection-record {
        text-align: left;
    }
    .collection-record h3 {
        margin: 20px 0 8px;
        font-size: 15px;
    }
    .collection-record h3:first-child {
        margin-top: 0;
    }
    .collection-record small {
        display: block;
        margin-top: 16px;
        overflow-wrap: anywhere;
        color: var(--app-muted);
    }
    .collection-steps {
        list-style: none;
        padding: 0;
        margin: 12px 0;
        border: 1px solid var(--app-border);
        border-radius: 10px;
    }
    .collection-steps li {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        padding: 12px;
        font-size: 13px;
        border-bottom: 1px solid var(--app-border);
    }
    .collection-steps li:last-child {
        border-bottom: 0;
    }
    .collection-steps li > span {
        flex: 1;
        min-width: 140px;
    }
    .collection-steps li[data-state='failure'] strong {
        color: var(--p-red-600);
    }
    .collection-steps a,
    .collection-run-link {
        color: var(--app-accent);
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
