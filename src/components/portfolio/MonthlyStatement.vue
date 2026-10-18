<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import {
        MONTHLY_STATEMENT_MAX_BYTES,
        createMonthlyStatement,
        parseMonthlyStatement,
        monthlyScopeHash,
        compareMonthlyStatements,
    } from '@/services/monthlyStatement.js';

    const props = defineProps({
        group: { type: Object, default: null },
        month: { type: String, required: true },
        today: { type: String, required: true },
        userId: { type: String, required: true },
        familyId: { type: String, required: true },
        accountIds: { type: Array, required: true },
        rejected: { type: Number, default: 0 },
    });
    const consent = ref(false),
        busy = ref(false),
        error = ref(''),
        status = ref('');
    const previous = ref(null),
        current = ref(null),
        fileInput = ref(null);
    let generation = 0;
    watch(
        () => [
            props.userId,
            props.familyId,
            props.accountIds.join('|'),
            props.month,
            props.today,
            props.group,
            props.rejected,
        ],
        () => {
            generation++;
            consent.value = false;
            busy.value = false;
            error.value = status.value = '';
            previous.value = current.value = null;
            if (fileInput.value) fileInput.value.value = '';
        },
        { flush: 'sync' }
    );
    onScopeDispose(() => generation++);
    const money = (value) =>
        value == null
            ? '미확인'
            : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    const comparison = computed(() => {
        if (!current.value || !previous.value) return null;
        try {
            return compareMonthlyStatements(current.value, previous.value);
        } catch (reason) {
            return { reason: reason.message, difference: null, percent: null };
        }
    });
    async function snapshot() {
        const state = {
            group: props.group,
            month: props.month,
            today: props.today,
            accountCount: props.accountIds.length,
            rejected: props.rejected,
        };
        const scopeHash = await monthlyScopeHash(
            props.userId,
            props.familyId,
            props.accountIds
        );
        return createMonthlyStatement({ ...state, scopeHash });
    }
    async function download() {
        if (busy.value || !consent.value) return;
        const version = generation;
        busy.value = true;
        error.value = status.value = '';
        try {
            const report = await snapshot();
            if (version !== generation) return;
            const url = URL.createObjectURL(
                new Blob([JSON.stringify(report, null, 2)], {
                    type: 'application/json;charset=utf-8',
                })
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `monthly-dividends-${report.month}-${report.currency}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.value =
                '결산 파일 다운로드를 시작했습니다. 개인 자료이므로 안전하게 보관하세요.';
        } catch (reason) {
            if (version === generation) error.value = reason.message;
        } finally {
            if (version === generation) busy.value = false;
        }
    }
    async function load(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || busy.value) return;
        const version = generation;
        busy.value = true;
        error.value = status.value = '';
        previous.value = current.value = null;
        try {
            if (file.size > MONTHLY_STATEMENT_MAX_BYTES)
                throw new Error('결산 파일은 32KB 이하여야 합니다.');
            const loaded = parseMonthlyStatement(await file.text());
            const report = await snapshot();
            if (version !== generation) return;
            compareMonthlyStatements(report, loaded);
            current.value = report;
            previous.value = loaded;
        } catch (reason) {
            if (version === generation) error.value = reason.message;
        } finally {
            if (version === generation) busy.value = false;
        }
    }
</script>

<template>
    <section
        class="monthly-statement"
        aria-labelledby="monthly-statement-title"
        :aria-busy="busy">
        <h3 id="monthly-statement-title">월간 결산 저장·비교</h3>
        <p>
            {{ month }} · {{ group?.currency }} · 선택 계좌
            {{ accountIds.length }}개
        </p>
        <p>
            확인된 저장 배당 {{ money(group?.current.amount) }}
            {{ group?.currency }} · 기록 {{ group?.current.count || 0 }}건 ·
            금액 미확인 {{ group?.current.unknown || 0 }}건
        </p>
        <p>
            결산은 배당 취소를 차감한 저장 기록의 요약입니다. 실제 수령액·세후
            금액·기록의 완전성을 확정하지 않습니다.
        </p>
        <label class="consent"
            ><input v-model="consent" type="checkbox" :disabled="busy" /> 파일에
            배당 금액·통화·월·기록 수가 포함됨을 확인했습니다.</label
        >
        <div class="actions">
            <Button
                label="월간 결산 JSON 저장"
                icon="pi pi-download"
                :disabled="!consent || !group || busy"
                @click="download" />
            <Button
                label="이전 결산 불러오기"
                outlined
                :disabled="!group || busy"
                @click="fileInput?.click()" />
        </div>
        <input
            ref="fileInput"
            class="file-input"
            type="file"
            accept=".json,application/json"
            aria-label="이전 월간 결산 파일"
            :disabled="busy"
            @change="load" />
        <p>
            파일은 서버로 전송하지 않습니다. 계좌번호·명의·개별 거래·종목은
            내보내지 않습니다. 같은 로그인 사용자·가족·계좌 범위끼리 비교합니다.
            직접 보관한 파일을 선택해 비교하세요. 파일 내용의 진위는 검증하지
            않습니다.
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
        <div
            v-if="previous && comparison"
            class="comparison"
            aria-label="월간 결산 비교">
            <h4>{{ previous.month }} 저장 결산 대비 {{ month }}</h4>
            <p>
                이전 확인액 {{ money(previous.knownAmount) }}
                {{ previous.currency }} · 기록 {{ previous.recordCount }}건 ·
                당시 확인일 {{ previous.asOf }}
            </p>
            <p v-if="comparison.difference !== null">
                저장 배당 증감 {{ money(comparison.difference) }}
                {{ group.currency }}
            </p>
            <p v-if="comparison.percent !== null">
                증감률 {{ money(comparison.percent) }}%
            </p>
            <Message
                v-if="comparison.reason"
                severity="info"
                :closable="false"
                >{{ comparison.reason }}</Message
            >
            <Button
                label="결산 비교 닫기"
                text
                @click="previous = current = null" />
        </div>
    </section>
</template>

<style scoped>
    .monthly-statement {
        border: 1px solid var(--app-border);
        border-radius: 14px;
        padding: 1rem;
        margin-block: 1rem;
        overflow-wrap: anywhere;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-block: 1rem;
    }
    .consent {
        display: flex;
        gap: 0.5rem;
        align-items: start;
    }
    .file-input {
        display: none;
    }
    .comparison {
        border-top: 1px solid var(--app-border);
        margin-top: 1rem;
    }
</style>
