<script setup>
    defineProps({
        files: { type: Array, default: () => [] },
        accountLabel: { type: String, required: true },
        blocked: Boolean,
        busy: Boolean,
    });
    const confirmed = defineModel('confirmed', {
        type: Boolean,
        default: false,
    });
    const statuses = {
        matched: {
            severity: 'success',
            message:
                '선택 계좌와 끝 4자리가 일치합니다. 명의자는 원본과 직접 확인해 주세요.',
        },
        mismatch: {
            severity: 'error',
            message:
                '선택 계좌와 계좌번호가 다릅니다. 올바른 계좌를 선택해 다시 추출해 주세요.',
        },
        unregistered: {
            severity: 'warn',
            message:
                '등록된 계좌번호가 없어 자동 대조할 수 없습니다. 원본과 저장 대상 계좌를 직접 확인해 주세요.',
        },
        missing: {
            severity: 'error',
            message:
                'PDF에서 계좌번호를 확인할 수 없어 저장할 수 없습니다. 원본 파일과 지원 형식을 확인해 주세요.',
        },
    };
    const status = (file) => statuses[file.accountMatch] || statuses.missing;
</script>

<template>
    <section class="statement-identity" aria-label="거래내역서 계좌 확인">
        <h3>거래내역서 계좌 확인</h3>
        <p>저장 대상: {{ accountLabel }}</p>
        <div v-for="(file, index) in files" :key="index" class="statement-file">
            <strong>{{ file.fileName }}</strong>
            <p>
                PDF에서 추출한 성명: {{ file.customerName || '확인할 수 없음' }}
            </p>
            <p>
                PDF에서 추출한 계좌번호:
                {{ file.maskedNumber || '확인할 수 없음' }}
            </p>
            <Message :severity="status(file).severity" :closable="false">
                {{ status(file).message }}
            </Message>
        </div>
        <label v-if="!blocked">
            <input v-model="confirmed" type="checkbox" :disabled="busy" />
            첨부한 모든 거래내역서의 성명·계좌번호를 확인했고, 저장 대상 계좌의
            자료가 맞습니다.
        </label>
    </section>
</template>

<style scoped>
    .statement-file {
        padding: 16px 0;
        border-top: 1px solid var(--app-border);
        overflow-wrap: anywhere;
    }
    .statement-file p {
        margin: 8px 0;
    }
</style>
