<script setup>
    import { ref, watch } from 'vue';
    import Dialog from 'primevue/dialog';
    import InputText from 'primevue/inputtext';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    const visible = defineModel('visible', { type: Boolean });
    defineProps({ busy: Boolean, error: { type: String, default: '' } });
    defineEmits(['submit']);
    const name = ref('');
    watch(visible, () => {
        name.value = '';
    });
</script>
<template>
    <Dialog
        v-model:visible="visible"
        modal
        header="가족 추가"
        :style="{ width: '28rem', maxWidth: '95vw' }"
        :closable="!busy"
        :close-on-escape="!busy">
        <form @submit.prevent="$emit('submit', name.trim())">
            <label for="asset-member-name">가족 이름</label>
            <InputText
                id="asset-member-name"
                v-model="name"
                autofocus
                required
                maxlength="100"
                :disabled="busy"
                fluid />
            <p>이 로그인 계정에서 가족의 계좌와 자료를 직접 관리합니다.</p>
            <Message v-if="error" severity="error" :closable="false">{{
                error
            }}</Message>
            <Button
                type="submit"
                label="가족 등록"
                :loading="busy"
                :disabled="busy || !name.trim()" />
        </form>
    </Dialog>
</template>
