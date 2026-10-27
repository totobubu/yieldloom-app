<script setup>
    import { computed } from 'vue';
    import Select from 'primevue/select';
    const props = defineProps({
        comparison: { type: Object, default: null },
        selected: { type: String, default: null },
        label: { type: String, required: true },
        rowLabel: { type: String, required: true },
        format: { type: Function, required: true },
        disabled: Boolean,
        status: { type: String, default: '' },
    });
    defineEmits(['choose']);
    const approvalTime = (value) =>
        Number.isFinite(Date.parse(value))
            ? `${new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`
            : '기록 시각 미확인';
    const options = computed(() =>
        (props.comparison?.sources || [])
            .filter((source) => source.eligible)
            .map((source) => ({
                ...source,
                text: `${props.format(source.value)} · ${source.label}${source.alias ? ' · 티커 별칭 후보' : ''} · ${source.location}`,
            }))
    );
</script>
<template>
    <div class="evidence-cell">
        <strong v-if="comparison?.current != null">{{
            format(comparison.current)
        }}</strong>
        <span v-else class="missing">미제공</span>
        <small v-if="status === '추정'">계산 추정값</small>
        <template v-if="comparison?.sources.length">
            <small v-for="source in comparison.sources" :key="source.id">
                {{ source.label }}: {{ format(source.value) }}
                <span v-if="!source.eligible"> · 연결 확인 필요</span>
            </small>
            <Select
                v-if="comparison.needsChoice || selected || comparison.resolved"
                :model-value="
                    selected ||
                    (comparison.resolved
                        ? comparison.decision.sourceId ||
                          comparison.decision.observationId
                        : null)
                "
                :options="options"
                option-label="text"
                option-value="id"
                :aria-label="`${rowLabel} ${label} 승인값`"
                placeholder="출처 값 선택"
                :disabled="disabled || !options.length"
                show-clear
                @update:model-value="$emit('choose', $event)" />
            <small v-if="comparison.resolved" class="approved"
                >관리자 승인 완료</small
            >
            <small v-if="comparison.resolved">
                {{ comparison.decision.actor }} ·
                {{ approvalTime(comparison.decision.at) }} ·
                {{ comparison.decision.note }}
            </small>
            <small v-else-if="comparison.conflict" class="conflict"
                >출처 값 충돌 · 승인 필요</small
            >
            <small v-else-if="comparison.needsChoice"
                >추가 값 · 승인 필요</small
            >
        </template>
    </div>
</template>
<style scoped>
    .evidence-cell {
        display: grid;
        gap: 6px;
        min-width: 170px;
    }
    .evidence-cell small {
        font-size: 11px;
        color: var(--p-text-muted-color);
        overflow-wrap: anywhere;
    }
    .missing {
        color: var(--p-text-muted-color);
    }
    .evidence-cell .conflict {
        color: var(--p-orange-700);
    }
    .evidence-cell .approved {
        color: var(--p-green-700);
    }
</style>
