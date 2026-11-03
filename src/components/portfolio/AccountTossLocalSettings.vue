<script setup>
    import { ref, watch, onScopeDispose } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';
    import AccountTossLocalUpdate from './AccountTossLocalUpdate.vue';
    const props = defineProps({
        accountId: { type: String, required: true },
        accountLabel: { type: String, default: '' },
        client: { type: Object, required: true },
    });
    const code = ref(''),
        busy = ref(false),
        connected = ref(false),
        note = ref(''),
        error = ref(''),
        url = ref('');
    const confirmToken = ref(false),
        confirmRegister = ref(false),
        confirmDisconnect = ref(false);
    let generation = 0;
    function reset() {
        generation++;
        code.value = '';
        connected.value = false;
        note.value = '';
        error.value = '';
        url.value = '';
        busy.value = false;
        confirmToken.value = false;
        confirmRegister.value = false;
        confirmDisconnect.value = false;
    }
    watch(() => [props.accountId, props.client], reset);
    onScopeDispose(reset);
    async function run(action) {
        if (busy.value) return;
        const version = ++generation,
            accountId = props.accountId;
        busy.value = true;
        error.value = '';
        note.value = '';
        try {
            if (code.value) {
                props.client.setPairing(code.value);
                code.value = '';
            }
            if (action === 'prepare') {
                const result = await props.client.prepare(accountId);
                if (version !== generation) return;
                url.value = result;
                note.value =
                    '아래 등록 페이지를 열어 이 PC에서 API 정보를 입력하세요.';
            } else if (action === 'register') {
                if (!confirmRegister.value) return;
                await props.client.register(accountId);
                if (version !== generation) return;
                confirmRegister.value = false;
                url.value = '';
                note.value =
                    '계좌별 연결 참조를 저장했습니다. 토큰 발급과 실제 조회는 별도 실행합니다.';
            } else if (action === 'token') {
                if (!confirmToken.value) return;
                await props.client.issueToken(accountId, true);
                if (version !== generation) return;
                confirmToken.value = false;
                note.value = '토큰을 이 PC의 암호화 저장소에 보관했습니다.';
            } else if (action === 'disconnect') {
                if (!confirmDisconnect.value) return;
                await props.client.disconnect(accountId);
                if (version !== generation) return;
                connected.value = false;
                confirmDisconnect.value = false;
                note.value =
                    '새 조회를 차단했습니다. 기존 원문·장부·토스 키는 보존합니다.';
            } else {
                const state = await props.client.status(accountId);
                if (version !== generation) return;
                connected.value = state.connected === true;
                note.value = connected.value
                    ? '선택 계좌와 로컬 연결을 확인했습니다.'
                    : '이 계좌의 로컬 API 등록을 완료하세요.';
            }
        } catch {
            if (version === generation) {
                connected.value = false;
                error.value =
                    '연결 요청을 완료하지 못했습니다. 로컬 프로그램·연결 코드·저장소 잠금·본인 계좌 권한·운영 기능 활성화를 확인하세요. 요청 결과가 불확실하면 상태부터 확인하세요.';
            }
        } finally {
            if (version === generation) busy.value = false;
        }
    }
</script>
<template>
    <section class="local-settings" aria-label="계좌별 로컬 토스 연결 설정">
        <h3>{{ accountLabel || '선택 계좌' }} API 연결</h3>
        <p>
            같은 PC에서 로컬 프로그램을 실행한 뒤 연결 코드를 입력합니다. 토스
            API 비밀키는 로컬 등록 페이지에서만 입력하세요.
        </p>
        <label :for="`toss-pairing-${accountId}`"
            >로컬 프로그램 연결 코드</label
        >
        <InputText
            :id="`toss-pairing-${accountId}`"
            v-model="code"
            type="password"
            autocomplete="off"
            maxlength="43"
            :disabled="busy" />
        <Button
            label="로컬 연결 확인"
            :disabled="busy"
            @click="run('status')" />
        <Button
            label="로컬 등록 페이지 준비"
            :disabled="busy"
            @click="run('prepare')" />
        <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer"
            >이 PC에서 선택 계좌 API 등록 페이지 열기</a
        >
        <label
            ><input
                v-model="confirmRegister"
                type="checkbox"
                :disabled="busy" />로컬 등록을 마쳤으며 이 계좌에 연결 참조를
            저장합니다.</label
        >
        <Button
            label="등록 완료 확인·저장"
            :disabled="busy || !confirmRegister"
            @click="run('register')" />
        <template v-if="connected">
            <label
                ><input
                    v-model="confirmToken"
                    type="checkbox"
                    :disabled="busy" />새 토큰 발급 시 같은 client의 기존 토큰이
                무효화되는 것을 확인합니다.</label
            >
            <Button
                label="토큰 발급·재발급"
                :disabled="busy || !confirmToken"
                @click="run('token')" />
            <AccountTossLocalUpdate
                :account-id="accountId"
                :connector="busy ? null : client" />
            <label
                ><input
                    v-model="confirmDisconnect"
                    type="checkbox"
                    :disabled="busy" />이 계좌의 새 API 조회를
                차단합니다.</label
            >
            <Button
                label="로컬 계좌 연결 해제"
                severity="secondary"
                :disabled="busy || !confirmDisconnect"
                @click="run('disconnect')" />
        </template>
        <p v-if="note" role="status">{{ note }}</p>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <p>
            API 관측 저장은 기존 PDF 장부나 원금 확정값을 덮어쓰지 않습니다.
            서로 다른 출처의 같은 거래를 임의로 합산하지 않습니다.
        </p>
    </section>
</template>
<style scoped>
    .local-settings {
        display: grid;
        gap: 0.75rem;
        padding-block: 1rem;
        overflow-wrap: anywhere;
    }
    label:has(input) {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
    }
</style>
