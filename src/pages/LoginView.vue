<script setup>
import { ref } from 'vue';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { useRouter } from 'vue-router';
import { auth, firebaseReady, firebaseUser, googleProvider } from '@/services/firebaseClient';

const router = useRouter();
const email = ref(''); const password = ref(''); const message = ref(''); const error = ref(''); const mode = ref('login');
async function submit() {
    error.value = ''; message.value = '';
    try {
        if (mode.value === 'signup') await createUserWithEmailAndPassword(auth, email.value, password.value);
        else await signInWithEmailAndPassword(auth, email.value, password.value);
        router.push('/mypage');
    } catch { error.value = '이메일 또는 비밀번호를 다시 확인하세요.'; }
}
async function google() { try { await signInWithPopup(auth, googleProvider); router.push('/mypage'); } catch { error.value = 'Google 로그인을 완료하지 못했습니다.'; } }
async function reset() { try { await sendPasswordResetEmail(auth, email.value); message.value = '비밀번호 재설정 메일을 보냈습니다.'; } catch { error.value = '재설정할 이메일을 입력하세요.'; } }
</script>
<template><section class="auth-page"><h1>{{ mode === 'signup' ? '회원가입' : '로그인' }}</h1><p v-if="!firebaseReady" class="error">Firebase 웹 설정이 배포 환경에 없습니다.</p><template v-else-if="firebaseUser"><p>{{ firebaseUser.email }}로 로그인되어 있습니다.</p><button @click="signOut(auth)">로그아웃</button><router-link to="/mypage">마이페이지</router-link></template><template v-else><form @submit.prevent="submit"><input v-model="email" type="email" placeholder="이메일" required><input v-model="password" type="password" placeholder="비밀번호 (6자 이상)" required><button>{{ mode === 'signup' ? '회원가입' : '로그인' }}</button></form><button @click="google">Google로 계속하기</button><button @click="mode = mode === 'login' ? 'signup' : 'login'">{{ mode === 'login' ? '회원가입' : '로그인으로' }}</button><button @click="reset">비밀번호 재설정</button><p v-if="message">{{ message }}</p><p v-if="error" class="error">{{ error }}</p></template></section></template>
<style scoped>.auth-page{max-width:420px;margin:48px auto;display:grid;gap:12px}.auth-page form{display:grid;gap:10px}input,button{padding:12px;font:inherit}.error{color:#b91c1c}</style>
