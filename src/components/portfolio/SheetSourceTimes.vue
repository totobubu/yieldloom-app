<script setup>
    import { computed } from 'vue';
    import { sourceTimeRoles } from '../../../lib/sheet-source-times.js';
    const props = defineProps({
        candidates: { type: Array, default: () => [] },
    });
    const previewTimes = computed(() => {
        const priorities = [
            'executionDateTime',
            'paidAt',
            'dateTime',
            'orderedUiAt',
            'reservedAt',
            'orderedAt',
            'failedAt',
            'cancelledAt',
            'settledAt',
        ];
        // Display-only repetition removal, never a merge of source records.
        const distinct = new Map();
        for (const item of props.candidates)
            for (const time of item.times)
                distinct.set(`${time.role}:${time.value}`, time);
        return [...distinct.values()]
            .sort(
                (a, b) =>
                    priorities.indexOf(a.role) - priorities.indexOf(b.role) ||
                    a.value.localeCompare(b.value)
            )
            .slice(0, 3);
    });
</script>
<template>
    <p
        v-for="time in previewTimes"
        :key="`${time.role}:${time.value}`"
        class="source-time-preview">
        {{ sourceTimeRoles[time.role] }}:
        {{ time.value }}
        <small>토스 원문 후보 · 장부값과 별도</small>
    </p>
    <details v-if="candidates.length" class="source-times">
        <summary>토스 원문 시각 · {{ candidates.length }}개 후보</summary>
        <p>
            계좌·유형·종목·날짜가 같은 원문입니다. 동일 거래로 승인한 값은
            아닙니다. 위에는 시각을 최대 3개 요약하며, 같은 표시 시각의 별도
            주문도 아래에 각각 보존합니다.
        </p>
        <article v-for="item in candidates" :key="item.id">
            <p v-if="item.directIdentityVerified === false">
                저장된 상세 텍스트 · 선택 주문 ID와 직접 일치는 미확인
            </p>
            <p>
                원문 날짜: {{ item.eventDate }} · 주문 상태:
                {{ item.sourceStatus || '해당 없음·미확인' }}
            </p>
            <p v-if="item.quantity != null">
                원문 체결수량: {{ item.quantity }}주
            </p>
            <p v-for="time in item.times" :key="time.field">
                <strong
                    >{{ sourceTimeRoles[time.role] || '원문 기록 시각' }}:
                    {{ time.value }}</strong
                >
                <small
                    >{{ time.timeZone || '시간대 미명시' }} ·
                    {{ time.field }}</small
                >
            </p>
            <small v-if="item.source.sha256"
                >{{ item.source.archiveKey }} · {{ item.source.file }} · SHA-256
                {{ item.source.sha256 }}</small
            >
            <small v-else
                >{{ item.source.label }} · {{ item.source.location }}</small
            >
            <small v-if="item.source.integrity === 'R2_RESPONSE_DIGEST'"
                >지문은 저장된 R2 응답 기준입니다.</small
            >
        </article>
    </details>
</template>
<style scoped>
    .source-times {
        margin-top: 0.5rem;
        font-size: 0.8rem;
        max-width: 28rem;
        overflow-wrap: anywhere;
    }
    .source-time-preview {
        font-size: 0.8rem;
    }
    summary {
        cursor: pointer;
        color: var(--p-primary-color);
    }
    p {
        margin-block: 0.4rem;
    }
    small {
        display: block;
        color: var(--p-text-muted-color);
    }
    article {
        border-top: 1px solid var(--p-content-border-color);
        padding-block: 0.5rem;
    }
</style>
