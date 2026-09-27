<!-- stock\src\pages\PasswordResetView.vue -->
<script setup>
    import { ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import { sendPasswordResetEmail } from 'firebase/auth'; // fetchSignInMethodsForEmail은 더 이상 필요 없음
    import { auth } from '../firebase';
    import { useRouter } from 'vue-router';
    import Message from 'primevue/message';

    const email = ref('');
    const router = useRouter();

    useHead({
        title: '비밀번호 재설정',
    });

    const message = ref({ text: '', severity: '' });

    // --- [수정된 함수] ---
    const onResetPassword = async () => {
        message.value = { text: '', severity: '' };
        if (!email.value) {
            message.value = {
                text: '이메일을 입력해주세요.',
                severity: 'warn',
            };
            return;
        }
        try {
            // 이메일 존재 여부를 확인하는 로직을 제거하고, 바로 재설정 이메일을 보냅니다.
            // Firebase는 백그라운드에서 가입된 이메일일 경우에만 실제로 메일을 발송합니다.
            await sendPasswordResetEmail(auth, email.value);

            // 사용자에게는 가입 여부와 관계없이 항상 동일한 성공 메시지를 보여줍니다.
            message.value = {
                text: '요청이 접수되었습니다. 가입된 이메일인 경우, 비밀번호 재설정 링크가 발송됩니다.',
                severity: 'success',
            };
        } catch (err) {
            // Firebase API 자체에서 에러가 발생한 경우 (예: 네트워크 오류, 잘못된 이메일 형식)
            console.error('비밀번호 재설정 과정 오류:', err);
            message.value = {
                text: '오류가 발생했습니다. 이메일 주소를 확인하거나 잠시 후 다시 시도해주세요.',
                severity: 'error',
            };
        }
    };
</script>

<template>
    <div id="t-auth">
        <Card>
            <template #header>
                <div class="flex flex-col justify-content-center">
                    <Button
                        class="t-auth-icon"
                        icon="pi pi-envelope"
                        severity="secondary"
                        rounded
                        disabled
                        aria-label="envelope" />
                </div>
            </template>
            <template #title>비밀번호 재설정</template>
            <template #subtitle
                >가입하신 이메일로 재설정 링크를 보내드립니다.</template
            >
            <template #content>
                <div class="flex flex-column gap-3">
                    <InputGroup>
                        <InputGroupAddon>
                            <i class="pi pi-user"></i>
                        </InputGroupAddon>
                        <InputText
                            v-model="email"
                            type="email"
                            size="large"
                            placeholder="가입한 이메일 ID"
                            @keyup.enter="onResetPassword" />
                    </InputGroup>
                </div>
            </template>
            <template #footer>
                <Message
                    v-if="message.text"
                    :severity="message.severity"
                    :closable="false"
                    class="mb-4">
                    {{ message.text }}
                </Message>

                <div class="flex flex-column gap-3">
                    <Button
                        @click="onResetPassword"
                        label="재설정 이메일 발송" />
                    <Button
                        label="로그인 페이지로"
                        severity="secondary"
                        variant="outlined"
                        asChild
                        v-slot="slotProps">
                        <RouterLink to="/login" :class="slotProps.class"
                            >로그인</RouterLink
                        >
                    </Button>
                </div>
            </template>
        </Card>
    </div>
</template>
