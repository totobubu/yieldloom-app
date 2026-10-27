<script setup>
    import { ref, watch, onBeforeUnmount } from 'vue';
    import Select from 'primevue/select';
    import { createTossLocalSync } from '../../services/tossLocalSync.js';
    const props = defineProps({
        user: { type: Object, default: null },
        ledgerClient: { type: Object, required: true },
        connector: { type: Object, default: null },
    });
    const emit = defineEmits(['saved']);
    const account = ref('wife'),
        busy = ref(false),
        connected = ref(false);
    const note = ref(
        '같은 컴퓨터에 토스 로그인 창을 열어두는 방식입니다. 현재 기존 수집기 연결은 준비되지 않았습니다.'
    );
    let controller;
    function configure() {
        controller?.cancel();
        connected.value = false;
        controller = createTossLocalSync({
            connector: props.connector,
            ledgerClient: props.ledgerClient,
            context: () => ({ user: props.user, accountId: account.value }),
            onSaved: (result) => emit('saved', result),
            onState: (state) => {
                note.value = state.note;
            },
        });
    }
    watch(
        () => [
            props.user,
            props.user?.uid,
            props.user?.email,
            props.user?.emailVerified,
            props.connector,
            account.value,
        ],
        configure,
        {
            immediate: true,
        }
    );
    async function run(update) {
        if (busy.value) return;
        busy.value = true;
        const active = controller;
        try {
            if (update) await active.update();
            else await active.check();
            if (active !== controller) return;
            connected.value = true;
        } catch (error) {
            if (active === controller) {
                connected.value = false;
                note.value = error.message;
            }
        } finally {
            busy.value = false;
        }
    }
    onBeforeUnmount(() => controller?.cancel());
</script>
<template>
    <section class="toss-sync" aria-label="토스 최신 자료 가져오기">
        <h3>토스 최신 자료 가져오기</h3>
        <p>
            별도 토스 창의 로그인은 유지합니다. 주문·환전·출금은 실행하지
            않으며, 가져온 원문과 관리자 승인값을 분리합니다.
        </p>
        <div class="sync-controls">
            <Select
                v-model="account"
                :options="[
                    { label: '아내', value: 'wife' },
                    { label: '남편', value: 'husband' },
                ]"
                option-label="label"
                option-value="value"
                aria-label="수집 대상 계좌"
                :disabled="busy" />
            <Button
                label="연결 상태 확인"
                severity="secondary"
                :disabled="!user || busy"
                @click="run(false)" />
            <Button
                label="최신 자료 1배치 가져오기"
                :disabled="!user || !connected || busy"
                :loading="busy"
                @click="run(true)" />
        </div>
        <p role="status">{{ note }}</p>
        <small
            >연결 도구가 확인되기 전에는 실제 수집을 시작하지 않습니다. 끊긴
            배치는 같은 ID로 재전송하고, 서버 저장 확인 후에만 수집기
            체크포인트를 진행합니다.</small
        >
    </section>
</template>
<style scoped>
    .toss-sync {
        margin-block: 1.5rem;
    }
    .sync-controls {
        display: flex;
        gap: 0.6rem;
        flex-wrap: wrap;
    }
    small {
        color: var(--p-text-muted-color);
    }
</style>
