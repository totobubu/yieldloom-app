<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import HoldingsChanges from './HoldingsChanges.vue';
    import { familyRequest } from '@/services/familyPortfolio.js';
    import { firebaseUser } from '@/services/firebaseClient.js';
    const props = defineProps({
        accountId: { type: String, required: true },
        revision: { type: [String, Number], default: '' },
    });
    const opened = ref(false),
        rows = ref([]),
        detail = ref(null),
        busy = ref(false),
        error = ref(''),
        cursor = ref(null);
    let generation = 0,
        controller;
    const sortedRows = computed(() =>
        [...rows.value].sort(
            (a, b) =>
                (b.revision ?? 0) - (a.revision ?? 0) ||
                String(b.importedAt).localeCompare(String(a.importedAt))
        )
    );
    function reset() {
        generation++;
        controller?.abort();
        opened.value = false;
        rows.value = [];
        detail.value = null;
        error.value = '';
        cursor.value = null;
        busy.value = false;
    }
    watch(() => [props.accountId, props.revision, firebaseUser.value], reset, {
        flush: 'sync',
    });
    onScopeDispose(reset);
    async function load(more = false, snapshotId = '') {
        const version = ++generation;
        controller?.abort();
        controller = new AbortController();
        busy.value = true;
        error.value = '';
        detail.value = null;
        // Hide old private rows if the new permission check fails.
        const previous = more ? rows.value : [];
        rows.value = [];
        try {
            const result = await familyRequest(
                '',
                undefined,
                {
                    accountId: props.accountId,
                    view: 'snapshotHistory',
                    ...(more && cursor.value ? { cursor: cursor.value } : {}),
                    ...(snapshotId ? { snapshotId } : {}),
                },
                { signal: controller.signal }
            );
            if (version !== generation) return;
            if (snapshotId) {
                detail.value = result.snapshot;
                rows.value = previous;
            } else {
                rows.value = [...previous, ...result.snapshots];
                cursor.value = result.nextCursor;
            }
            opened.value = true;
        } catch (reason) {
            if (version === generation) {
                error.value = reason.message;
                cursor.value = null;
            }
        } finally {
            if (version === generation) busy.value = false;
        }
    }
</script>
<template>
    <section aria-label="잔고 변경 이력" class="snapshot-history">
        <Button
            label="잔고 변경 이력 조회"
            severity="secondary"
            :loading="busy"
            @click="load()" />
        <Button
            v-if="opened"
            label="잔고 이력 닫기"
            text
            :disabled="busy"
            @click="reset" />
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <template v-if="opened">
            <p>
                조회할 때 현재 계좌 권한을 확인합니다. 불러온 목록은 최근
                버전부터 표시하며, 더 보기로 추가 이력을 조회할 수 있습니다.
                이전 자료에는 버전 정보가 없을 수 있습니다.
            </p>
            <p v-if="!rows.length && !detail && !busy">
                저장된 잔고 이력이 없습니다.
            </p>
            <ul>
                <li v-for="row in sortedRows" :key="row.id">
                    {{ row.asOf }} · 버전 {{ row.revision ?? '미확인' }} ·
                    {{ row.importedAt }} ·
                    {{ row.correctionReason || row.source }}
                    <Button
                        label="변경 전후 보기"
                        text
                        :disabled="busy"
                        @click="load(true, row.id)" />
                </li>
            </ul>
            <Button
                v-if="cursor"
                label="잔고 이력 더 보기"
                :disabled="busy"
                @click="load(true)" />
            <div v-if="detail">
                <h4>
                    {{ detail.asOf }} · 버전 {{ detail.revision ?? '미확인' }}
                </h4>
                <p>{{ detail.correctionReason || '잔고 등록' }}</p>
                <p v-if="!detail.previous">
                    변경 전 자료가 보관되지 않은 이력입니다.
                </p>
                <HoldingsChanges
                    :before="detail.previous?.rows || []"
                    :after="detail.rows" />
            </div>
        </template>
    </section>
</template>
<style scoped>
    .snapshot-history {
        margin-block: 1rem;
        overflow-wrap: anywhere;
    }
</style>
