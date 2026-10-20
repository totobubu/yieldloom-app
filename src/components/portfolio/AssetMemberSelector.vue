<script setup>
    import Avatar from 'primevue/avatar';
    import Button from 'primevue/button';
    defineProps({
        profiles: { type: Array, required: true },
        selected: { type: String, default: '' },
        busy: Boolean,
    });
    defineEmits(['select', 'add']);
</script>

<template>
    <div class="members" aria-label="자산관리 가족 선택">
        <button
            v-for="person in profiles"
            :key="person.key"
            type="button"
            class="member"
            :aria-pressed="selected === person.key"
            :disabled="busy"
            @click="$emit('select', person.key)">
            <Avatar
                :label="person.name.slice(0, 2)"
                size="large"
                shape="circle"
                aria-hidden="true" />
            <span>{{ person.name }}</span>
        </button>
        <Button
            label="가족 추가"
            icon="pi pi-user-plus"
            outlined
            :disabled="busy"
            @click="$emit('add')" />
    </div>
</template>

<style scoped>
    .members {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
    }
    .member {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 0.7rem;
        border: 2px solid transparent;
        border-radius: 1rem;
        background: transparent;
        color: var(--p-text-color);
        cursor: pointer;
    }
    .member[aria-pressed='true'] {
        border-color: var(--p-primary-color);
        background: var(--p-content-background);
    }
    .member:focus-visible {
        outline: 2px solid var(--p-primary-color);
        outline-offset: 3px;
    }
</style>
