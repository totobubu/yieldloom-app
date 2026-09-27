<!-- stock\src\pages\NotFound.vue -->
<template>
    <div class="p-4 max-w-md mx-auto">
        <h2 class="mb-4">로그인</h2>
        <div class="p-fluid">
            <InputText v-model="email" placeholder="이메일" />
            <Password
                v-model="password"
                placeholder="비밀번호"
                toggleMask
                class="mt-3" />
            <Button label="로그인" class="mt-4" @click="login" />
        </div>
    </div>
</template>

<script setup>
    import { ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import { auth } from '../firebase';
    import { signInWithEmailAndPassword } from 'firebase/auth';
    import { useRouter } from 'vue-router';

    const email = ref('');
    const password = ref('');
    const router = useRouter();

    useHead({
        title: '404',
    });

    const login = async () => {
        try {
            await signInWithEmailAndPassword(auth, email.value, password.value);
            alert('로그인 성공!');
            router.push('/');
        } catch (err) {
            alert('로그인 실패: ' + err.message);
        }
    };
</script>
