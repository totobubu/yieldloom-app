<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import { principalPolicyPreview } from '../../services/principalPolicyPreview.js';
    const props = defineProps({
        account: { type: Object, required: true },
        state: { type: Object, required: true },
        client: { type: Object, required: true },
        loading: Boolean,
        ledgerError: { type: String, default: '' },
    });
    const emit = defineEmits(['review-cash']);
    const opened = ref(false),
        observations = ref([]),
        cursor = ref(null),
        busy = ref(false),
        error = ref('');
    let generation = 0;
    watch(
        () => [
            props.account.id,
            props.client.user?.(),
            props.account.permissions?.[props.client.user?.()?.uid],
            props.account.familyId,
        ],
        () => {
            generation++;
            opened.value = false;
            observations.value = [];
            cursor.value = null;
            error.value = '';
            busy.value = false;
        }
    );
    onScopeDispose(() => {
        generation++;
        observations.value = [];
    });
    const preview = computed(() =>
        props.loading || props.ledgerError || !opened.value
            ? null
            : principalPolicyPreview(props.state, props.account.id)
    );
    const reviewRows = computed(() =>
        (preview.value?.rows || []).filter(
            (r) =>
                ['buy', 'sell', 'withdrawal'].includes(r.kind) || r.manualNeeded
        )
    );
    const sources = {
        'toss-pdf': '토스 PDF 가져오기',
        manual: '직접 등록',
        legacy: '이전 자료 이행',
    };
    async function readApi(more = false) {
        if (busy.value) return;
        const version = ++generation;
        busy.value = true;
        error.value = '';
        try {
            const result = await props.client.act(props.account.id, {
                action: 'local-observations',
                ...(more && cursor.value ? { after: cursor.value } : {}),
            });
            if (version !== generation) return;
            observations.value = more
                ? [...observations.value, ...result.observations]
                : result.observations;
            cursor.value = result.nextCursor;
        } catch {
            if (version === generation)
                error.value =
                    'API 관측을 확인하지 못했습니다. 기존 장부가 없는 것으로 해석하지 않습니다.';
        } finally {
            if (version === generation) busy.value = false;
        }
    }
</script>
<template>
    <details class="evidence-panel" @toggle="opened = $event.target.open">
        <summary>선택 계좌 자료 출처·원금 계산 근거</summary>
        <div v-if="opened" class="evidence-content">
            <p>
                최근 가져오기 출처:
                {{ sources[account.source] || account.source || '미확인' }} ·
                기준일 {{ account.asOf || '미확인' }}
            </p>
            <p>
                보유값 스냅샷 출처:
                {{
                    sources[account.snapshot?.source] ||
                    account.snapshot?.source ||
                    '미확인'
                }}
                · 스냅샷 기준일 {{ account.snapshot?.asOf || '미확인' }}. 최근
                가져오기 표시만으로 전체 원장의 출처가 확정되지는 않습니다.
            </p>
            <p>
                현재 보유값은 저장된 계좌 스냅샷, 원금은 저장 장부의 현금
                행·분류·자금 배분을 읽습니다. 새 API 관측은 검토 전까지 계산에
                자동 합산하지 않습니다.
            </p>
            <h3>원금 추적 규칙 미리보기</h3>
            <p>
                배당은 먼저 들어온 순서로 재투자·출금에 배분하고, 출금 부족분은
                추적 가능한 원금에서 차감합니다. 원금으로 매수한 주식의 실현
                손익은 원금에 반영합니다. 기존 수동 확정은 보존하며 아래 결과는
                자동 저장하지 않습니다.
            </p>
            <p v-if="loading" role="status">현재 계좌 근거를 읽고 있습니다.</p>
            <Message v-if="ledgerError" severity="error" :closable="false"
                >계좌 장부를 확인하지 못해 계산 근거 표시를
                보류했습니다.</Message
            >
            <template v-if="preview">
                <Message severity="warn" :closable="false"
                    >전체 입출금 범위와 기초 잔액이 입증되지 않아 전체 남은
                    원금은 미확정입니다. 배당 재원 주식의 매도대금은 처리 규칙
                    확인 전 보류합니다.</Message
                >
                <p v-for="note in preview.notes" :key="note">{{ note }}</p>
                <ul aria-label="추적 결과와 수동 확인 대상">
                    <li v-for="row in reviewRows.slice(0, 50)" :key="row.id">
                        {{ row.at }} · {{ row.currency }} ·
                        {{ row.amount || '금액 미확인' }} · {{ row.source }}
                        <span v-if="row.parts"
                            >배당 {{ row.parts.dividend || '0' }} / 원금
                            {{ row.parts.principal || '0' }} / 미확인
                            {{ row.parts.unknown || '0' }}</span
                        >
                        <span v-if="row.realizedPnl != null"
                            >원금 반영 실현손익 {{ row.realizedPnl }}</span
                        >
                        <span>{{
                            row.mode === 'manual_preserved'
                                ? '기존 수동 확정 보존'
                                : '로직상 대조 후보'
                        }}</span>
                        <strong v-if="row.manualNeeded"
                            >확인 필요:
                            {{
                                row.reason ||
                                '추적되지 않는 나머지의 원금 여부를 기존 현금 분류에서 선택하세요.'
                            }}</strong
                        >
                        <Button
                            v-if="row.manualNeeded && row.kind === 'withdrawal'"
                            label="미확인 나머지 검토·선택"
                            severity="secondary"
                            @click="
                                emit('review-cash', {
                                    id: row.id,
                                    parts: row.parts,
                                })
                            " />
                        <details v-if="row.evidence.length">
                            <summary>자금·취득원가 근거</summary>
                            <ul>
                                <li v-for="(e, i) in row.evidence" :key="i">
                                    {{ e.id }} · {{ e.source }} · {{ e.amount }}
                                </li>
                            </ul>
                        </details>
                    </li>
                </ul>
                <p v-if="reviewRows.length > 50">
                    대조 후보 {{ reviewRows.length }}건 중 처음 50건을
                    표시합니다. 전체 내역과 수동 선택은 기존 현금 분류·자금 배분
                    화면에서 확인하세요.
                </p>
            </template>
            <h3>API 주문 관측 원문</h3>
            <p>
                로컬에서 제출한 미검증 관측입니다. 페이지·배치 해시는 저장
                내용의 무결성을 확인하며, 토스가 발급한 자료임을 독립적으로
                증명하지 않습니다.
            </p>
            <p v-if="state.fxLinkViews?.length">
                환전 쌍은 기존 계좌·날짜·환율·방향·금액의 유일한 1대1 판정을
                재사용합니다. 아래 ID는 앱 내부 연결 ID이며 토스 거래 ID가
                아닙니다.
            </p>
            <ul v-if="state.fxLinkViews?.length">
                <li v-for="link in state.fxLinkViews" :key="link.id">
                    {{ link.id }} ·
                    {{
                        link.mode === 'automatic'
                            ? '유일한 1대1 자동 연결'
                            : '수동 검토 연결'
                    }}
                    ·
                    {{
                        link.status === 'active'
                            ? '연결 근거 유효'
                            : '근거 다시 확인 필요'
                    }}
                </li>
            </ul>
            <p>
                PDF와 같은 거래일 수 있습니다. 주문 ID와 체결·정산 의미를 확인해
                검토하며 자동으로 두 번 더하지 않습니다.
            </p>
            <Button
                label="계좌 API 관측 읽기"
                :disabled="busy"
                @click="readApi()" />
            <Message v-if="error" severity="error" :closable="false">{{
                error
            }}</Message>
            <ul>
                <li v-for="r in observations" :key="r.id">
                    <details>
                        <summary>
                            {{ r.original.symbol }} · {{ r.original.side }} ·
                            {{ r.original.orderedAt }} · 미검증 로컬 관측
                        </summary>
                        <pre>{{ JSON.stringify(r.original, null, 2) }}</pre>
                    </details>
                </li>
            </ul>
            <Button
                v-if="cursor"
                label="API 관측 더 읽기"
                :disabled="busy"
                @click="readApi(true)" />
        </div>
    </details>
</template>
<style scoped>
    .evidence-panel {
        margin-block: 1rem;
        overflow-wrap: anywhere;
    }
    .evidence-content {
        display: grid;
        gap: 0.75rem;
        padding-block: 1rem;
    }
    summary {
        cursor: pointer;
        font-weight: 600;
    }
    li {
        margin-block: 0.75rem;
    }
    li > span,
    li > strong {
        display: block;
    }
    pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
</style>
