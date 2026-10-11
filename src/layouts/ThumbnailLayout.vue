<script setup>
import { useLayout } from '@/composables/shared/useLayout';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
const { isDarkMode, toggleDarkMode } = useLayout();
</script>
<template>
    <Toast /><ConfirmDialog />
    <div class="thumbnail-app" :class="{ 'p-dark': isDarkMode }">
        <header>
            <router-link to="/">토토부부 배당 스튜디오 · 종목 선택</router-link>
            <Button :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'" :label="isDarkMode ? '라이트 모드' : '다크 모드'" :aria-pressed="isDarkMode" severity="secondary" @click="toggleDarkMode" />
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
main { padding: 1rem; }
</style>
