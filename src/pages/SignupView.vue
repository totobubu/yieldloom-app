<!-- src/pages/SignupView.vue -->
<script setup>
import { ref } from 'vue';
import { useHead } from '@vueuse/head';
import { auth, googleProvider } from '../firebase';
import {
    createUserWithEmailAndPassword,
    signInWithPopup,
    setPersistence,
    browserLocalPersistence,
} from 'firebase/auth';
import { useRouter } from 'vue-router';
import Message from 'primevue/message';
import { useToast } from 'primevue/usetoast';

const email = ref('');
const password = ref('');
const router = useRouter();
const toast = useToast();

const errorMessage = ref('');
const isLoading = ref(false);
const isGoogleLoading = ref(false);

useHead({
    title: '회원가입',
});

const signUp = async () => {
    errorMessage.value = '';
    isLoading.value = true;
    try {
        await createUserWithEmailAndPassword(
            auth,
            email.value,
            password.value
        );

        toast.add({
            severity: 'success',
            summary: '회원가입 성공',
            detail: '북마크 페이지로 이동합니다.', // 메시지 변경
            life: 3000,
        });

        // --- [핵심 수정] ---
        setTimeout(() => {
            router.push('/bookmark');
        }, 1500);
        // --- // ---
    } catch (err) {
        console.error('회원가입 실패:', err.code);
        if (err.code === 'auth/email-already-in-use') {
            errorMessage.value = '이미 사용 중인 이메일입니다.';
        } else if (err.code === 'auth/weak-password') {
            errorMessage.value = '비밀번호는 6자리 이상이어야 합니다.';
        } else {
            errorMessage.value = '회원가입 중 오류가 발생했습니다.';
        }
        isLoading.value = false; // 에러 발생 시에만 로딩 상태 해제
    }
};

const signUpWithGoogle = async () => {
    errorMessage.value = '';
    isGoogleLoading.value = true;
    try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithPopup(auth, googleProvider);

        toast.add({
            severity: 'success',
            summary: 'Google 계정 연결',
            detail: '북마크 페이지로 이동합니다.',
            life: 3000,
        });

        setTimeout(() => {
            router.push('/bookmark');
        }, 1500);
    } catch (err) {
        console.error('구글 회원가입 실패:', err.code);
        if (err.code !== 'auth/popup-closed-by-user') {
            errorMessage.value = '구글 로그인 중 오류가 발생했습니다.';
        }
        isGoogleLoading.value = false;
    }
};
</script>
<template>
    <div id="t-auth">
        <Card>
            <template #header>
                <div class="flex flex-col justify-content-center">
                    <Button class="t-auth-icon" icon="pi pi-unlock" severity="secondary" rounded disabled
                        aria-label="unlock" />
                </div>
            </template>
            <template #content>
                <div class="flex flex-column gap-3">
                    <div class="flex flex-column gap-3">
                        <InputGroup>
                            <InputGroupAddon>
                                <i class="pi pi-user"></i>
                            </InputGroupAddon>
                            <InputText v-model="email" type="text" size="large" placeholder="이메일 ID" />
                        </InputGroup>
                        <InputGroup>
                            <InputGroupAddon>
                                <i class="pi pi-key"></i>
                            </InputGroupAddon>
                            <Password v-model="password" placeholder="비밀번호" toggleMask />
                        </InputGroup>
                    </div>
                </div>
            </template>

            <template #footer>
                <Message v-if="errorMessage" severity="error" :closable="false" class="mb-4">
                    {{ errorMessage }}
                </Message>

                <div class="flex flex-column gap-3 mt-3">
                    <Button @click="signUp" label="회원가입" :loading="isLoading" />
                    <Button label="Google로 계속하기" icon="pi pi-google" severity="secondary" :loading="isGoogleLoading"
                        @click="signUpWithGoogle" />
                    <Button label="로그인" severity="secondary" variant="outlined" asChild v-slot="slotProps">
                        <RouterLink to="/login" :class="slotProps.class">로그인</RouterLink>
                    </Button>
                </div>
            </template>
        </Card>
    </div>
</template>
