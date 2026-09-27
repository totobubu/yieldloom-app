<script setup lang="ts">
    import { RouterView } from 'vue-router';
    import { useLayout } from '@/composables/shared/useLayout';

    import Button from 'primevue/button';
    import Toast from 'primevue/toast';
    import ConfirmDialog from 'primevue/confirmdialog';

    const { isDarkMode, toggleDarkMode } = useLayout();
</script>

<template>
    <Toast />
    <ConfirmDialog />
    <div class="content-studio-shell" :class="{ 'p-dark': isDarkMode }">
        <header class="content-studio-header">
            <router-link to="/" class="content-studio-brand">
                DIVGROW CONTENT STUDIO
            </router-link>
            <nav aria-label="콘텐츠 스튜디오 관리">
                <router-link to="/distributions">배당</router-link>
                <router-link to="/sources">소스</router-link>
                <router-link to="/reconciliation">대조</router-link>
                <router-link to="/renders">산출물</router-link>
                <router-link to="/archive">아카이브</router-link>
            </nav>
            <Button
                type="button"
                severity="secondary"
                :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'"
                :label="isDarkMode ? '라이트 모드' : '다크 모드'"
                :aria-label="isDarkMode ? '라이트 모드로 전환' : '다크 모드로 전환'"
                :aria-pressed="isDarkMode"
                v-tooltip.bottom="isDarkMode ? '라이트 모드로 전환' : '다크 모드로 전환'"
                @click="toggleDarkMode" />
        </header>
        <main class="content-studio-main">
            <RouterView />
        </main>
    </div>
</template>

<style scoped>
    .content-studio-shell {
        --studio-bg: #f4f6f8;
        --studio-surface: #ffffff;
        --studio-surface-subtle: #f8fafc;
        --studio-text: #172033;
        --studio-muted: #667085;
        --studio-border: #dde3ea;
        --studio-accent: #b86b00;
        --studio-success: #16794b;
        --studio-warning: #a84f00;
        --studio-danger: #b42318;
        min-height: 100vh;
        background: var(--studio-bg);
        color: var(--studio-text);
    }

    .content-studio-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 4rem;
        padding: 0.75rem 1.25rem;
        border-bottom: 1px solid var(--studio-border);
        background: var(--studio-surface);
    }

    .content-studio-brand {
        color: inherit;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-decoration: none;
    }

    nav { display: flex; flex-wrap: wrap; gap: .75rem; margin-left: auto; margin-right: 1rem; }
    nav a { color: var(--studio-muted); font-size: .88rem; text-decoration: none; }
    nav a.router-link-active { color: var(--studio-accent); font-weight: 800; }

    .content-studio-main {
        width: min(1200px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 2rem 0 4rem;
    }

    :global(html.p-dark) .content-studio-shell,
    .content-studio-shell.p-dark {
        --studio-bg: #09111f;
        --studio-surface: #111c2d;
        --studio-surface-subtle: #17243a;
        --studio-text: #f3f6fb;
        --studio-muted: #a9b5c6;
        --studio-border: #2b3a51;
        --studio-accent: #f6b94d;
        --studio-success: #62d39b;
        --studio-warning: #ffb15c;
        --studio-danger: #ff8a80;
    }

    :global(html.p-dark) .content-studio-header,
    .content-studio-shell.p-dark .content-studio-header {
        border-bottom-color: var(--studio-border);
        background: var(--studio-surface);
    }
</style>
