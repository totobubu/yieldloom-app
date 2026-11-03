<script setup>
    import { onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import Message from 'primevue/message';
    const props = defineProps({
        accountId: { type: String, required: true },
        client: { type: Object, required: true },
    });
    const opened = ref(false),
        busy = ref(false),
        error = ref(''),
        state = ref(null),
        selected = ref(''),
        confirmDisconnect = ref(false);
    let generation = 0,
        controller;
    const labels = {
        not_connected: '미연결',
        pending_verification: '계좌 확인 필요',
        verified: '계좌 확인 완료',
        disconnected: '연결 해제됨',
        reauthorization_required: '연결 권한 다시 확인 필요',
        execution_not_configured: '연결 준비 중',
    };
    function reset() {
        generation++;
        controller?.abort();
        state.value = null;
        selected.value = '';
        error.value = '';
        busy.value = false;
        confirmDisconnect.value = false;
    }
    async function run(action) {
        if (busy.value) return;
        const version = ++generation;
        controller = new AbortController();
        busy.value = true;
        error.value = '';
        try {
            const result = action
                ? await props.client.act(
                      props.accountId,
                      {
                          action,
                          revision: state.value.revision,
                          ...(action === 'register'
                              ? { connectionId: selected.value }
                              : {}),
                      },
                      controller.signal
                  )
                : await props.client.status(props.accountId, controller.signal);
            if (version !== generation) return;
            state.value = result;
            confirmDisconnect.value = false;
            if (!result.options.some((o) => o.id === selected.value))
                selected.value = result.options[0]?.id || '';
        } catch (reason) {
            if (version === generation && reason.name !== 'AbortError') {
                error.value = reason.message;
                state.value = null;
            }
        } finally {
            if (version === generation) busy.value = false;
        }
    }
    function toggle(event) {
        opened.value = event.target.open;
        reset();
        if (opened.value) run();
    }
    watch([() => props.accountId, () => props.client.user()], () => {
        reset();
        if (opened.value) run();
    });
    onScopeDispose(reset);
</script>
<template>
    <details class="toss-connection" @toggle="toggle">
        <summary>토스 API 연결</summary>
        <div v-if="opened" class="connection-content" :aria-busy="busy">
            <p>
                선택 계좌의 연결을 등록하고 확인합니다. 원본 키와 토큰 입력은
                아직 제공하지 않습니다.
            </p>
            <p role="status" aria-live="polite">
                {{
                    busy
                        ? '연결 요청 처리 중…'
                        : labels[state?.status] || '상태 확인 필요'
                }}
            </p>
            <Message
                v-if="state?.mode === 'simulation'"
                severity="warn"
                :closable="false"
                >개발 전용 모의 데이터입니다. 실제 토스 연결·수집·장부 반영이
                아닙니다.</Message
            >
            <Message
                v-if="state?.mode === 'disabled'"
                severity="info"
                :closable="false"
                >실제 API 실행 환경과 비밀 저장소가 아직 준비되지
                않았습니다.</Message
            >
            <Message v-if="error" severity="error" :closable="false">{{
                error
            }}</Message>
            <Button
                label="연결 상태 다시 확인"
                :disabled="busy"
                @click="run()" />
            <template v-if="state?.canManage">
                <template
                    v-if="
                        ['not_connected', 'disconnected'].includes(state.status)
                    ">
                    <label :for="`toss-reference-${accountId}`"
                        >등록된 본인 연결</label
                    >
                    <Select
                        v-model="selected"
                        :input-id="`toss-reference-${accountId}`"
                        :options="state.options"
                        option-label="label"
                        option-value="id"
                        :disabled="busy"
                        placeholder="사용 가능한 연결 없음" />
                    <Button
                        label="연결 등록"
                        :disabled="busy || !selected"
                        @click="run('register')" />
                </template>
                <template v-else>
                    <Button
                        label="계좌 연결 확인"
                        :disabled="busy"
                        @click="run('verify')" />
                    <Button
                        label="선택 계좌 조회"
                        :disabled="busy || state.status !== 'verified'"
                        @click="run('query')" />
                    <p>
                        연결 해제는 신규 조회를 차단합니다. 원본 장부 삭제나
                        공급자 키 폐기는 수행하지 않습니다.
                    </p>
                    <label
                        ><input
                            v-model="confirmDisconnect"
                            type="checkbox"
                            :disabled="busy" />선택 계좌의 연결 해제를
                        확인합니다.</label
                    >
                    <Button
                        label="연결 해제"
                        severity="secondary"
                        :disabled="busy || !confirmDisconnect"
                        @click="run('disconnect')" />
                </template>
            </template>
            <p v-else-if="state && state.mode !== 'disabled'">
                명의자 본인이 연결을 설정하고 조회할 수 있습니다.
            </p>
            <p v-if="state?.checkedAt">
                마지막 연결 확인: {{ state.checkedAt }}
            </p>
            <p v-if="state?.syncedAt">
                마지막 잔고 조회: {{ state.syncedAt }} · 과거 거래의 완전성을
                뜻하지 않습니다.
            </p>
            <ul v-if="state?.holdings" aria-label="조회한 보유 수량">
                <li v-for="holding in state.holdings" :key="holding.symbol">
                    {{ holding.symbol }} · {{ holding.quantity }}주
                </li>
            </ul>
        </div>
    </details>
</template>
<style scoped>
    .toss-connection {
        margin-block: 1rem;
    }
    summary {
        cursor: pointer;
        font-weight: 600;
    }
    .connection-content {
        display: grid;
        gap: 0.75rem;
        padding-block: 1rem;
        overflow-wrap: anywhere;
    }
    .connection-content label:has(input) {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }
</style>
