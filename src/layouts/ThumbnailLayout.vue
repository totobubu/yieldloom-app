<script setup>
import { useLayout } from '@/composables/shared/useLayout';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { signOut } from 'firebase/auth';
import { auth, firebaseReady, firebaseUser } from '@/services/firebaseClient';
const { isDarkMode, toggleDarkMode } = useLayout();
const logout = async () => { if (auth) await signOut(auth); };
</script>
<template>
    <Toast /><ConfirmDialog />
    <div class="thumbnail-app" :class="{ 'p-dark': isDarkMode }">
        <header>
            <router-link to="/">토또부부 배당 스튜디오 · 종목 선택</router-link>
            <div class="header-actions">
                <router-link v-if="firebaseReady && firebaseUser" to="/mypage">마이페이지</router-link>
                <router-link v-else-if="firebaseReady" to="/login">로그인</router-link>
                <Button v-if="firebaseReady && firebaseUser" label="로그아웃" severity="secondary" @click="logout" />
                <Button :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'" :label="isDarkMode ? '라이트 모드' : '다크 모드'" :aria-pressed="isDarkMode" severity="secondary" @click="toggleDarkMode" />
            </div>
        </header>
        <main><router-view /></main>
    </div>
</template>
<style scoped>
.thumbnail-app { min-height: 100vh; background: #f4f6f8; color: #172033; }
.thumbnail-app.p-dark { background: #09111f; color: #f3f6fb; }
.thumbnail-app.p-dark :deep(.ticker-thumbnail-page) { color: #f3f6fb; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem; border-bottom: 1px solid #8090a540; }
header a { color: inherit; font-weight: 700; text-decoration: none; }
.header-actions { display:flex; align-items:center; gap:.65rem; }
.header-actions a { font-size:.86rem; }
main { padding: 1rem; }
</style>
