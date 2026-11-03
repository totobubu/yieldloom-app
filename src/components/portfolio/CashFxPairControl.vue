<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Select from 'primevue/select';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import { internalFxLinkId } from '../../../lib/cash-fx-links.js';
    const props = defineProps({
        user: { type: Object, default: null },
        accountId: { type: String, default: '' },
        entry: { type: Object, default: () => ({}) },
        state: { type: Object, default: () => ({ entries: [] }) },
        disabled: Boolean,
        readOnly: Boolean,
    });
    const emit = defineEmits(['refresh', 'saving', 'notice']);
    const selection = ref(null),
        phase = ref('idle'),
        error = ref(''),
        conflict = ref(false);
    let generation = 0;
    const busy = computed(() => ['saving', 'awaiting'].includes(phase.value));
    const linked = computed(() =>
        (props.state.fxLinkViews || []).find(
            (l) =>
                l.entryIds.includes(props.entry.id) && l.status !== 'detached'
        )
    );
    const candidates = computed(() => {
        const claimed = new Set(
            (props.state.fxLinkViews || [])
                .filter((l) => l.mode === 'approved' && l.status !== 'detached')
                .flatMap((l) => l.entryIds)
        );
        return (
            (props.state.fxPairCandidates || []).find(
                (c) => c.entryId === props.entry.id
            )?.peerIds || []
        )
            .filter((id) => !claimed.has(id))
            .map((id) => props.state.entries.find((e) => e.id === id))
            .filter(Boolean)
            .map((e) => ({
                value: e.id,
                label: `${e.date} · ${e.rawType} · ${e.amount} ${e.currency} · 원장 ${e.id.slice(-8)}`,
            }));
    });
    const visible = computed(() => linked.value || candidates.value.length);
    watch(busy, (v) => emit('saving', v));
    watch(
        () => props.state,
        () => {
            if (phase.value !== 'saving') {
                phase.value = 'idle';
                error.value = '';
                conflict.value = false;
                selection.value = null;
            }
        }
    );
    watch(
        () => [props.user?.uid, props.accountId],
        () => {
            generation++;
            phase.value = 'idle';
            selection.value = null;
            error.value = '';
        },
        { immediate: true }
    );
    onScopeDispose(() => {
        generation++;
        emit('saving', false);
    });
    async function save(action) {
        if (props.disabled || props.readOnly || busy.value || conflict.value)
            return;
        const state = props.state,
            accountId = props.accountId,
            user = props.user,
            scope = ++generation;
        const ids =
            action === 'detachFxPair'
                ? linked.value?.entryIds
                : [props.entry.id, selection.value];
        if (!ids?.[1]) return;
        phase.value = 'saving';
        error.value = '';
        emit('notice', '');
        try {
            const linkId = await internalFxLinkId(accountId, ids);
            if (scope !== generation) return;
            const stored = new Map(
                (state.storedClassifications || []).map((a) => [a.id, a])
            );
            const doc = (state.fxLinks || []).find((l) => l.id === linkId);
            await portfolioCapitalRequest(
                user,
                {
                    action,
                    linkId,
                    entryIds: ids,
                    revision: doc?.revision || 0,
                    annotationRevisions: Object.fromEntries(
                        ids.map((id) => [id, stored.get(id)?.revision || 0])
                    ),
                    entryFingerprints: Object.fromEntries(
                        ids.map((id) => [id, state.fxEntryFingerprints?.[id]])
                    ),
                    ledgerVersion: state.ledgerVersion,
                },
                accountId
            );
            if (scope !== generation) return;
            phase.value = 'awaiting';
            emit(
                'notice',
                action === 'detachFxPair'
                    ? '환전 연결을 해제했습니다.'
                    : '환전 연결을 비공개로 저장했습니다.'
            );
            emit('refresh');
        } catch (e) {
            if (scope !== generation) return;
            phase.value = 'failed';
            error.value = e.message;
            conflict.value = [401, 403, 409].includes(e.status);
            emit(
                'notice',
                '환전 연결을 저장하지 못했습니다. 해당 내역을 확인해 주세요.'
            );
        }
    }
</script>
<template>
    <div v-if="visible" class="fx-pair-control" aria-label="환전 연결">
        <template v-if="linked">
            <p class="fx-link-label">
                {{
                    linked.status === 'stale'
                        ? '연결 확인 필요'
                        : '앱 내부 환전 연결'
                }}
                ·
                {{ linked.mode === 'automatic' ? '자동 연결' : '사용자 승인' }}
            </p>
            <details>
                <summary>내부 연결 ID 확인</summary>
                <code>{{ linked.id }}</code>
                <p>토스 발급 거래번호와 별개인 앱 내부 연결 ID입니다.</p>
            </details>
            <button
                type="button"
                :disabled="disabled || readOnly || busy"
                @click="save('detachFxPair')">
                양쪽 연결 해제
            </button>
        </template>
        <template v-else>
            <label
                :id="`fx-peer-label-${entry.id}`"
                :for="`fx-peer-${entry.id}`"
                >환전 짝 선택</label
            >
            <Select
                v-model="selection"
                :input-id="`fx-peer-${entry.id}`"
                :aria-labelledby="`fx-peer-label-${entry.id}`"
                :options="candidates"
                option-label="label"
                option-value="value"
                placeholder="내역을 선택하세요"
                :pt="{
                    overlay: { style: { maxWidth: 'calc(100vw - 32px)' } },
                    option: {
                        style: {
                            whiteSpace: 'normal',
                            overflowWrap: 'anywhere',
                        },
                    },
                }"
                :disabled="disabled || readOnly || busy || conflict" />
            <button
                type="button"
                :disabled="
                    !selection || disabled || readOnly || busy || conflict
                "
                @click="save('approveFxPair')">
                양쪽 연결 승인
            </button>
        </template>
        <p v-if="busy" role="status">
            {{ phase === 'awaiting' ? '저장 완료 · 조회 중' : '연결 저장 중…' }}
        </p>
        <p v-if="error" role="alert">{{ error }}</p>
        <button
            v-if="conflict"
            type="button"
            :disabled="busy"
            @click="emit('refresh')">
            최신 연결 다시 조회
        </button>
    </div>
</template>
<style scoped>
    .fx-pair-control {
        display: grid;
        gap: 8px;
        margin-top: 12px;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 10px;
        background: var(--app-surface);
        font-size: 0.78rem;
        min-width: 0;
    }
    .fx-pair-control p {
        margin: 0;
    }
    .fx-pair-control code {
        overflow-wrap: anywhere;
        display: block;
        margin: 8px 0;
    }
    .fx-pair-control button {
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 8px;
        background: var(--app-surface);
        color: var(--app-accent);
        cursor: pointer;
        font: inherit;
    }
    .fx-pair-control button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .fx-pair-control :deep(.p-select) {
        min-width: 0;
        width: 100%;
        max-width: 100%;
    }
    .fx-pair-control :deep(.p-select-label) {
        white-space: normal;
        overflow-wrap: anywhere;
    }
    .fx-pair-control [role='alert'] {
        color: var(--p-red-600);
    }
</style>
