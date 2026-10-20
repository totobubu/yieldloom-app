<script setup>
    import Button from 'primevue/button';
    defineProps({
        accounts: { type: Array, required: true },
        selected: { type: String, default: '' },
        userId: { type: String, default: '' },
        busy: Boolean,
    });
    defineEmits(['select', 'upload']);
</script>
<template>
    <p v-if="!accounts.length">
        등록된 계좌가 없습니다. 계좌 추가로 시작하세요.
    </p>
    <ul v-else class="accounts">
        <li v-for="account in accounts" :key="account.id">
            <Button
                :label="`${account.institution} · ${account.alias} · ${account.maskedNumber}`"
                severity="secondary"
                :outlined="selected !== account.id"
                :disabled="busy"
                :aria-pressed="selected === account.id"
                @click="$emit('select', account.id)" />
            <small>자료 기준일 {{ account.asOf || '미확인' }}</small>
            <Button
                v-if="
                    ['owner', 'editor'].includes(account.permissions?.[userId])
                "
                label="자료 업로드"
                icon="pi pi-upload"
                :disabled="busy"
                @click="$emit('upload', account.id)" />
            <small v-else>조회 전용</small>
        </li>
    </ul>
</template>
<style scoped>
    .accounts {
        list-style: none;
        padding: 0;
        display: grid;
        gap: 1rem;
    }
    .accounts li {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        flex-wrap: wrap;
        padding: 1rem 0;
        border-bottom: 1px solid var(--p-content-border-color);
    }
</style>
