<!-- src/pages/LoginView.vue -->
<script setup>
import { ref, onMounted } from 'vue';
import { useHead } from '@vueuse/head';

import { useRouter, useRoute } from 'vue-router';
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

import Message from 'primevue/message';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';

useHead({
    title: '로그인',
});

const email = ref('');
const password = ref('');
const rememberMe = ref(true);
const router = useRouter();
const route = useRoute();

const errorMessage = ref('');
const successMessage = ref('');
const isGoogleLoading = ref(false);

onMounted(() => {
    if (route.query.from === 'signup') {
        successMessage.value = '회원가입이 완료되었습니다. 로그인해주세요.';
    } else if (route.query.from === 'logout') {
        successMessage.value = '로그아웃되었습니다.';
    }
});

const onLogin = async () => {
    errorMessage.value = '';
    successMessage.value = '';
    try {
        const persistenceType = rememberMe.value
            ? browserLocalPersistence
            : browserSessionPersistence;

        await setPersistence(auth, persistenceType);

        await signInWithEmailAndPassword(auth, email.value, password.value);

        router.push('/bookmark');
    } catch (err) {
        console.error('로그인 실패:', err.code);
        if (
            err.code === 'auth/invalid-credential' ||
            err.code === 'auth/user-not-found' ||
            err.code === 'auth/wrong-password'
        ) {
            errorMessage.value = '이메일 또는 비밀번호를 확인해주세요.';
        } else {
            errorMessage.value = '로그인 중 오류가 발생했습니다.';
        }
    }
};

const onGoogleLogin = async () => {
    errorMessage.value = '';
    successMessage.value = '';
    isGoogleLoading.value = true;
    try {
        const persistenceType = rememberMe.value
            ? browserLocalPersistence
            : browserSessionPersistence;

        await setPersistence(auth, persistenceType);
        await signInWithPopup(auth, googleProvider);

        router.push('/bookmark');
    } catch (err) {
        console.error('구글 로그인 실패:', err.code);
        if (err.code !== 'auth/popup-closed-by-user') {
            errorMessage.value = '구글 로그인 중 오류가 발생했습니다.';
        }
    } finally {
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
                    <div class="flex flex-col justify-content-between text-sm">
                        <div class="flex items-center gap-2">
                            <Checkbox id="rememberMe" v-model="rememberMe" :binary="true" size="small" />
                            <label for="rememberMe">로그인 상태 유지</label>
                        </div>
                    </div>
                </div>
            </template>

            <template #footer>
                <Message v-if="successMessage" severity="success" :closable="false" class="mb-4">
                    {{ successMessage }}
                </Message>

                <Message v-if="errorMessage" severity="error" :closable="false" class="mb-4">
                    {{ errorMessage }}
                </Message>

                <div class="flex flex-column gap-3 mt-3">
                    <Button @click="onLogin" label="로그인" />
                    <Button :loading="isGoogleLoading" icon="pi pi-google" label="Google로 계속하기" severity="secondary"
                        @click="onGoogleLogin" />
                    <Button label="회원가입" severity="secondary" variant="outlined" asChild v-slot="slotProps">
                        <RouterLink to="/signup" :class="slotProps.class">회원가입</RouterLink>
                    </Button>

                    <Button label="비밀번호 찾기" severity="secondary" variant="text" size="small" asChild v-slot="slotProps">
                        <RouterLink to="/password-reset" :class="slotProps.class">비밀번호 찾기</RouterLink>
                    </Button>
                </div>
            </template>
        </Card>
    </div>
</template>
