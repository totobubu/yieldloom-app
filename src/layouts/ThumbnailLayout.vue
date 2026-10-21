<script setup>
    import { computed, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { signOut } from 'firebase/auth';
    import { auth, authLoading, firebaseUser } from '@/services/firebaseClient';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
    import { useLayout } from '@/composables/shared/useLayout';
    import Button from 'primevue/button';
    import Drawer from 'primevue/drawer';
    import Divider from 'primevue/divider';
    import Message from 'primevue/message';
    import Toast from 'primevue/toast';
    import ConfirmDialog from 'primevue/confirmdialog';
    import FullscreenDataLoading from '@/components/FullscreenDataLoading.vue';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';

    const route = useRoute();
    const router = useRouter();
    const { isDarkMode, toggleDarkMode } = useLayout();
    const accountOpen = ref(false);
    const signingOut = ref(false);
    const accountError = ref('');
    useFullscreenLoading(authLoading, '로그인 정보를 확인하고 있습니다.');
    const isAuth = computed(() => route.name === 'login');
    const isAdmin = computed(() => isPortfolioAdmin(firebaseUser.value));
    const inStocks = computed(() =>
        ['thumbnail-home', 'ticker-stock'].includes(route.name)
    );
    const inPortfolio = computed(() => route.path.startsWith('/mypage'));
    watch(
        () => route.fullPath,
        () => {
            accountOpen.value = false;
            accountError.value = '';
        }
    );
    async function logout() {
        signingOut.value = true;
        accountError.value = '';
        try {
            await signOut(auth);
            accountOpen.value = false;
            await router.push('/');
        } catch {
            accountError.value = '로그아웃하지 못했습니다. 다시 시도해 주세요.';
        } finally {
            signingOut.value = false;
        }
    }
</script>

<template>
    <div class="thumbnail-app studio-shell" :class="{ 'p-dark': isDarkMode }">
        <a class="skip-link" href="#studio-main">본문으로 바로가기</a>
        <header class="studio-header">
            <div class="header-inner">
                <router-link
                    class="studio-brand"
                    to="/"
                    aria-label="토또부부 배당 스튜디오 홈"
                    ><span class="brand-mark"
                        ><i class="pi pi-chart-bar" aria-hidden="true" /></span
                    ><span
                        >토또부부
                        <span class="brand-secondary">배당 스튜디오</span></span
                    ></router-link
                >
                <nav class="desktop-nav" aria-label="주요 메뉴">
                    <router-link
                        to="/"
                        :aria-current="inStocks ? 'page' : undefined"
                        :class="{
                            active:
                                route.name === 'thumbnail-home' ||
                                route.name === 'ticker-stock',
                        }"
                        >종목 검색</router-link
                    >
                    <router-link
                        v-if="isAdmin"
                        to="/mypage"
                        :aria-current="inPortfolio ? 'page' : undefined"
                        :class="{ active: inPortfolio }"
                        >내 포트폴리오</router-link
                    >
                    <router-link
                        v-if="isAdmin"
                        to="/simulator"
                        :class="{ active: route.name === 'dividend-simulator' }"
                        :aria-current="
                            route.name === 'dividend-simulator'
                                ? 'page'
                                : undefined
                        "
                        >배당 시뮬레이터</router-link
                    >
                </nav>
                <div class="header-actions">
                    <router-link class="guide-link" to="/legal"
                        >이용 안내</router-link
                    >
                    <div
                        v-if="inPortfolio"
                        id="portfolio-header-actions"
                        class="portfolio-header-actions" />
                    <Button
                        :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'"
                        :aria-label="isDarkMode ? '라이트 모드' : '다크 모드'"
                        :aria-pressed="isDarkMode"
                        text
                        rounded
                        severity="secondary"
                        @click="toggleDarkMode" />
                    <Button
                        v-if="isAdmin"
                        icon="pi pi-user"
                        aria-label="계정 및 설정"
                        outlined
                        rounded
                        severity="secondary"
                        :aria-expanded="accountOpen"
                        aria-controls="account-drawer"
                        @click="accountOpen = true" />
                </div>
            </div>
        </header>
        <main id="studio-main" class="studio-main" tabindex="-1">
            <router-view />
        </main>
        <footer class="studio-footer">
            <span>토또부부 배당 스튜디오</span
            ><router-link to="/legal">데이터 출처 · 이용 안내</router-link>
            <p>
                공개된 자료를 정리한 정보입니다. 기준일과 원문을 확인해 주세요.
            </p>
        </footer>
        <nav v-if="!isAuth" class="mobile-nav" aria-label="모바일 주요 메뉴">
            <router-link
                to="/"
                :class="{ active: inStocks }"
                :aria-current="inStocks ? 'page' : undefined"
                ><i class="pi pi-search" aria-hidden="true" /><span
                    >종목 검색</span
                ></router-link
            >
            <router-link
                v-if="isAdmin"
                to="/mypage"
                :class="{ active: inPortfolio }"
                :aria-current="inPortfolio ? 'page' : undefined"
                ><i class="pi pi-wallet" aria-hidden="true" /><span
                    >내 포트폴리오</span
                ></router-link
            >
            <router-link
                v-if="isAdmin"
                to="/simulator"
                :class="{ active: route.name === 'dividend-simulator' }"
                :aria-current="
                    route.name === 'dividend-simulator' ? 'page' : undefined
                "
                ><i class="pi pi-calculator" aria-hidden="true" /><span
                    >시뮬레이터</span
                ></router-link
            >
        </nav>
        <Drawer
            id="account-drawer"
            v-model:visible="accountOpen"
            header="계정 및 설정"
            position="right"
            :style="{ width: 'min(380px, 100vw)' }">
            <div class="account-summary">
                <span class="brand-mark"
                    ><i class="pi pi-user" aria-hidden="true"
                /></span>
                <div>
                    <strong>{{
                        firebaseUser ? '내 계정' : '로그인하고 시작하세요'
                    }}</strong>
                    <p>
                        {{
                            firebaseUser?.email ||
                            '계좌와 배당 기록을 한곳에서 관리하세요.'
                        }}
                    </p>
                </div>
            </div>
            <Message v-if="accountError" severity="error" :closable="false">{{
                accountError
            }}</Message>
            <div class="account-links">
                <Button
                    v-if="isAdmin"
                    label="내 포트폴리오"
                    icon="pi pi-wallet"
                    severity="secondary"
                    outlined
                    @click="router.push('/mypage')" />
                <Button
                    :label="
                        isDarkMode ? '라이트 모드로 보기' : '다크 모드로 보기'
                    "
                    :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'"
                    severity="secondary"
                    text
                    @click="toggleDarkMode" />
                <Divider />
                <Button
                    label="이용 안내 · 데이터 출처"
                    icon="pi pi-info-circle"
                    severity="secondary"
                    text
                    @click="router.push('/legal')" />
                <Button
                    v-if="isAdmin"
                    label="종목 의견함"
                    icon="pi pi-inbox"
                    severity="secondary"
                    text
                    @click="router.push('/admin/feedback')" />
                <Button
                    v-if="isAdmin"
                    label="ETF 데이터 검토 · 수집 상태"
                    icon="pi pi-check-square"
                    severity="secondary"
                    text
                    @click="router.push('/admin/metadata')" />
                <Button
                    v-if="isAdmin"
                    label="종목 식별 관리"
                    icon="pi pi-cog"
                    severity="secondary"
                    text
                    @click="router.push('/admin/portfolio-mappings')" />
                <Button
                    v-if="isAdmin"
                    label="로그아웃"
                    icon="pi pi-sign-out"
                    severity="secondary"
                    outlined
                    :loading="signingOut"
                    @click="logout" />
            </div>
        </Drawer>
        <Toast /><ConfirmDialog />
        <FullscreenDataLoading />
    </div>
</template>

<style scoped>
    .studio-shell {
        --studio-header-height: 73px;
    }
    .studio-header {
        position: sticky;
        top: 0;
        z-index: 30;
        background: var(--app-surface);
        border-bottom: 1px solid var(--app-border);
    }
    .header-inner {
        max-width: 1344px;
        height: calc(var(--studio-header-height) - 1px);
        padding: 0 32px;
        margin: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
    }
    .studio-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        color: var(--app-text);
        font-size: 17px;
        font-weight: 750;
        white-space: nowrap;
        letter-spacing: -0.04em;
    }
    .brand-mark {
        width: 36px;
        height: 36px;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        border-radius: 10px;
        display: inline-grid;
        place-items: center;
        flex-shrink: 0;
    }
    .desktop-nav {
        height: 100%;
        display: flex;
        gap: 28px;
    }
    .desktop-nav a {
        height: 100%;
        display: flex;
        align-items: center;
        color: var(--app-muted);
        text-decoration: none;
        border-bottom: 3px solid transparent;
        font-weight: 600;
    }
    .desktop-nav a.active {
        color: var(--app-accent);
        border-bottom-color: var(--app-accent);
    }
    .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .portfolio-header-actions {
        display: flex;
        align-items: center;
    }
    .guide-link {
        color: var(--app-muted);
        text-decoration: none;
        font-size: 13px;
        padding: 12px 8px;
    }
    .login-link {
        background: var(--app-surface-muted);
        color: var(--app-accent);
        text-decoration: none;
        padding: 10px 16px;
        border-radius: 10px;
        font-weight: 650;
    }
    .studio-main {
        max-width: 1344px;
        margin: auto;
        padding: 32px;
        min-height: calc(100dvh - 220px);
        outline: none;
    }
    .studio-footer {
        max-width: 1280px;
        margin: 24px auto 0;
        padding: 24px 0 32px;
        border-top: 1px solid var(--app-border);
        display: flex;
        flex-wrap: wrap;
        gap: 8px 24px;
        color: var(--app-muted);
        font-size: 13px;
    }
    .studio-footer a {
        color: inherit;
        margin-left: auto;
    }
    .studio-footer p {
        width: 100%;
        margin: 0;
    }
    .mobile-nav {
        display: none;
    }
    .account-summary {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 8px 0 24px;
    }
    .account-summary p {
        font-size: 13px;
        color: var(--app-muted);
        overflow-wrap: anywhere;
        margin: 4px 0 0;
    }
    .account-links {
        display: grid;
        gap: 12px;
    }
    .account-links :deep(.p-button) {
        justify-content: flex-start;
    }
    .skip-link {
        position: fixed;
        top: -80px;
        left: 16px;
        z-index: 1000;
        padding: 12px;
        background: var(--app-surface);
        color: var(--app-accent);
    }
    .skip-link:focus {
        top: 8px;
    }
    @media (max-width: 1000px) {
        .brand-secondary {
            display: none;
        }
        .desktop-nav {
            gap: 16px;
        }
        .guide-link {
            display: none;
        }
    }
    @media (max-width: 767px) {
        .studio-shell {
            --studio-header-height: 61px;
        }
        .header-inner {
            padding: 0 16px;
            gap: 8px;
        }
        .studio-brand {
            font-size: 15px;
            gap: 8px;
        }
        .brand-mark {
            width: 32px;
            height: 32px;
        }
        .brand-secondary {
            display: inline;
        }
        .desktop-nav,
        .login-link {
            display: none;
        }
        .header-actions {
            gap: 0;
        }
        .header-actions :deep(.p-button) {
            width: 44px;
            height: 44px;
        }
        .studio-main {
            padding: 24px 16px;
        }
        .studio-footer {
            margin: 16px 16px 0;
            padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
        }
        .mobile-nav {
            position: fixed;
            bottom: 0;
            inset-inline: 0;
            z-index: 30;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            background: var(--app-surface);
            border-top: 1px solid var(--app-border);
            padding: 6px 16px calc(6px + env(safe-area-inset-bottom, 0px));
        }
        .mobile-nav a {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            min-height: 52px;
            font-size: 12px;
            font-weight: 600;
            text-decoration: none;
            color: var(--app-muted);
            border-radius: 10px;
        }
        .mobile-nav a.active {
            color: var(--app-accent);
            background: var(--app-surface-muted);
        }
        .mobile-nav i {
            font-size: 18px;
        }
    }
    @media (max-width: 370px) {
        .studio-brand {
            font-size: 13px;
        }
        .brand-secondary {
            display: none;
        }
        .header-inner {
            padding-inline: 12px;
        }
    }
</style>
