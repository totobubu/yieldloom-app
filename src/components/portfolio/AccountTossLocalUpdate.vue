<script setup>
    import { ref, watch, onScopeDispose } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    const props = defineProps({
        accountId: { type: String, required: true },
        // Only a trusted same-computer adapter may be supplied. No URL input,
        // localhost scanning, credentials or Firebase-token forwarding.
        connector: { type: Object, default: null },
    });
    const from = ref(''),
        to = ref(''),
        busy = ref(false),
        note = ref(''),
        error = ref('');
    let generation = 0;
    function reset() {
        generation++;
        note.value = '';
        error.value = '';
        busy.value = false;
        from.value = '';
        to.value = '';
    }
    watch(
        () => [props.accountId, props.connector],
        (_, previous) => {
            if (busy.value) previous?.[1]?.cancel?.(previous[0]);
            reset();
        }
    );
    onScopeDispose(() => {
        if (busy.value) props.connector?.cancel?.(props.accountId);
        reset();
    });
    async function update() {
        if (!props.connector || busy.value) return;
        const version = ++generation,
            accountId = props.accountId;
        busy.value = true;
        note.value = '';
        error.value = '';
        try {
            const status = await props.connector.status(accountId);
            if (version !== generation) return;
            if (
                status.accountId !== accountId ||
                !status.connected ||
                !status.readOnly
            )
                throw Error();
            const result = await props.connector.update({
                accountId,
                from: from.value,
                to: to.value,
            });
            if (version !== generation) return;
            if (
                result.accountId !== accountId ||
                result.canonicalUnchanged !== true ||
                !(
                    (result.status === 'collected_locally' &&
                        result.cloudSaved === false) ||
                    (result.status === 'observations_saved' &&
                        result.cloudSaved === true)
                )
            )
                throw Error();
            note.value = result.cloudSaved
                ? `API 주문 관측 ${result.saved}건의 계좌별 저장을 확인했습니다. 기존 장부·원금 계산은 변경하지 않았습니다. PDF 자료와 대조해 검토하세요.`
                : '선택 기간의 주문 원문을 이 PC에 보존했습니다. 계좌 장부 저장과 거래 확정은 별도 검토가 필요합니다.';
            if (result.collectionPending)
                note.value =
                    result.saved === 0
                        ? '이번 요청에서 저장한 새 관측이 없습니다. 전체 수집 미완료입니다.'
                        : note.value;
            if (result.collectionPending)
                note.value +=
                    result.stopReason === 'OPEN_RESPONSE_LIMIT'
                        ? ' OPEN은 기간 필터 없는 단일 응답으로, 응답의 30초 통신 제한·60초 허가·20MB 제한에 걸렸습니다. 날짜를 좁혀도 OPEN 응답 크기는 줄지 않습니다. 전체 수집 완료가 아닙니다.'
                        : ' 수집이 일부 남았습니다. 같은 기간으로 다시 클릭하면 보존된 원문·커서에서 권한을 다시 확인해 이어갑니다. 자동 재시도하지 않습니다.';
        } catch {
            if (version === generation)
                error.value =
                    '로컬 업데이트를 완료하지 못했습니다. 계좌 연결·권한·토큰·허용 IP를 확인하세요. 자동 재발급하거나 다시 실행하지 않습니다.';
        } finally {
            if (version === generation) busy.value = false;
        }
    }
</script>
<template>
    <section class="local-update" aria-label="선택 계좌 로컬 API 업데이트">
        <h3>이 PC에서 토스 API 업데이트</h3>
        <p>
            토스에 등록한 공인 IP를 사용하는 PC의 로컬 프로그램이 조회합니다.
            API 비밀키는 웹사이트에 입력하지 않습니다.
        </p>
        <Message v-if="!connector" severity="info" :closable="false"
            >로컬 프로그램 연결이 준비되지 않았습니다. 계좌별 인증정보 등록과
            연결 승인이 완료된 뒤 사용할 수 있습니다.</Message
        >
        <form @submit.prevent="update">
            <label :for="`toss-local-from-${accountId}`"
                >주문 조회 시작일</label
            >
            <input
                :id="`toss-local-from-${accountId}`"
                v-model="from"
                type="date"
                required
                :max="to || undefined"
                :disabled="!connector || busy" />
            <label :for="`toss-local-to-${accountId}`">주문 조회 종료일</label>
            <input
                :id="`toss-local-to-${accountId}`"
                v-model="to"
                type="date"
                required
                :min="from || undefined"
                :disabled="!connector || busy" />
            <Button
                type="submit"
                label="선택 계좌 로컬 업데이트"
                :loading="busy"
                :disabled="!connector || busy || !from || !to || from > to" />
        </form>
        <p>
            주문·체결 조회 범위입니다. 환전·입출금·배당 입금 내역은 기존
            PDF·원문 경로로 확인합니다.
        </p>
        <p v-if="note" role="status">{{ note }}</p>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
    </section>
</template>
<style scoped>
    .local-update,
    form {
        display: grid;
        gap: 0.75rem;
    }
    input {
        max-width: 100%;
        color: var(--p-text-color);
        background: var(--p-content-background);
        border: 1px solid var(--p-content-border-color);
        border-radius: var(--p-border-radius-sm);
        padding: 0.6rem;
    }
</style>
