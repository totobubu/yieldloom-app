<script setup>
    import { firebaseUser } from '@/services/firebaseClient';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
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
            <router-link to="/">토또부부 배당 스튜디오 · 종목 선택</router-link>
            <div class="header-actions">
                <router-link to="/mypage">내 포트폴리오</router-link>
                <router-link
                    v-if="isPortfolioAdmin(firebaseUser)"
                    to="/admin/portfolio-mappings"
                    >종목 식별 관리</router-link
                >
                <router-link to="/legal">이용 안내</router-link>
                <Button
                    :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'"
                    :label="isDarkMode ? '라이트 모드' : '다크 모드'"
                    :aria-pressed="isDarkMode"
                    severity="secondary"
                    @click="toggleDarkMode" />
            </div>
        </header>
        <main><router-view /></main>
    </div>
</template>
<style scoped>
    .thumbnail-app {
        --app-bg: #f5f5f5;
        --app-surface: #fff;
        --app-surface-muted: #ececec;
        --app-text: #161616;
        --app-muted: #5f5f5f;
        --app-border: #a3a3a3;
        --app-border-subtle: #d4d4d4;
        --app-accent: #1d4ed8;
        --app-accent-contrast: #fff;
        --app-overlay: #000000a8;
        min-height: 100vh;
        background: var(--app-bg);
        color: var(--app-text);
    }
    .thumbnail-app.p-dark {
        --app-bg: #0b0b0b;
        --app-surface: #161616;
        --app-surface-muted: #252525;
        --app-text: #f5f5f5;
        --app-muted: #c2c2c2;
        --app-border: #858585;
        --app-border-subtle: #414141;
        --app-accent: #8ab4ff;
        --app-accent-contrast: #101010;
        --app-overlay: #000000c7;
    }
    header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    header a {
        color: inherit;
        font-weight: 700;
        text-decoration: none;
    }
    .header-actions {
        display: flex;
        align-items: center;
        gap: 0.65rem;
    }
    .header-actions a {
        font-size: 0.86rem;
    }
    main {
        padding: 1rem;
    }
    @media (max-width: 640px) {
        main {
            padding: 0;
        }
        header {
            padding: 12px;
            gap: 12px;
        }
        .header-actions {
            flex-wrap: wrap;
        }
    }
</style>
