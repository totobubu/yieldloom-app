<script setup>
    import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
    import brandSymbol from '@/assets/brand/stitch-symbol.png';
    import PortfolioNavigation from '@/components/navigation/PortfolioNavigation.vue';
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
    const submenuOpen = ref(true);
    const mobileSubmenuOpen = ref(false);
    const viewportWidth = ref(1280);
    const isMobileViewport = computed(() => viewportWidth.value < 768);
    const isCompactViewport = computed(() => viewportWidth.value < 1024);
    function updateViewport() {
        viewportWidth.value = window.innerWidth;
    }
    onMounted(() => {
        updateViewport();
        window.addEventListener('resize', updateViewport);
    });
    onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));
    const signingOut = ref(false);
    const accountError = ref('');
    useFullscreenLoading(authLoading, '로그인 정보를 확인하고 있습니다.');
    const isAuth = computed(() => route.name === 'login');
    const isAdmin = computed(() => isPortfolioAdmin(firebaseUser.value));
    const inStocks = computed(
        () =>
            route.name === 'ticker-stock' ||
            (route.name === 'thumbnail-home' && route.query.sort !== 'ipoDate')
    );
    const inNewListings = computed(
        () => route.name === 'thumbnail-home' && route.query.sort === 'ipoDate'
    );
    const inComparison = computed(() =>
        ['security-compare', 'underlying-explorer'].includes(route.name)
    );
    // Independent content frames have their own width/padding contract.
    // The shell's 1120px header/footer grid does not constrain these frames.
    const contentLayout = computed(() => {
        if (route.path.startsWith('/mypage')) return 'portfolio';
        if (inComparison.value) return 'comparison';
        if (route.name === 'thumbnail-home') return 'catalog';
        if (route.name === 'ticker-stock')
            return ['dividends', 'share'].includes(route.query.tab)
                ? 'editor'
                : 'catalog';
        return undefined;
    });
    const inPortfolio = computed(() => route.path.startsWith('/mypage'));
    const portfolioHeaderClosed = computed(
        () =>
            isAdmin.value &&
            inPortfolio.value &&
            !accountOpen.value &&
            (isCompactViewport.value
                ? !mobileSubmenuOpen.value
                : !submenuOpen.value)
    );
    watch(
        () => route.fullPath,
        () => {
            accountOpen.value = false;
            mobileSubmenuOpen.value = false;
            accountError.value = '';
        }
    );
    // Loading dialogs restore focus when leaving; resolve a pending submenu
    // destination after that restoration, once per route change.
    let pendingAnchor = '';
    watch(
        () => route.hash,
        (hash) => {
            pendingAnchor = hash;
        },
        { immediate: true }
    );
    function focusPendingAnchor() {
        if (
            ![
                '#asset-concentration',
                '#dividend-growth',
                '#manual-balance',
                '#capital-details-heading',
            ].includes(pendingAnchor)
        )
            return;
        const target = document.getElementById(pendingAnchor.slice(1));
        if (!target) return;
        target.scrollIntoView({ block: 'start' });
        target.focus({ preventScroll: true });
        pendingAnchor = '';
    }
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
    <div
        class="thumbnail-app studio-shell"
        :class="{
            'p-dark': isDarkMode,
            'portfolio-submenu-open': isAdmin && inPortfolio && submenuOpen,
            'portfolio-submenu-closed': isAdmin && inPortfolio && !submenuOpen,
            'portfolio-header-closed': portfolioHeaderClosed,
        }">
        <a class="skip-link" href="#studio-main">본문으로 바로가기</a>
        <header class="studio-header">
            <div class="header-inner">
                <router-link
                    class="studio-brand"
                    to="/"
                    aria-label="모으멍 배당달력 홈"
                    ><img class="brand-symbol" :src="brandSymbol" alt="" />
                    <span
                        >모으멍
                        <span class="brand-secondary">배당달력</span></span
                    ></router-link
                >
                <nav class="desktop-nav" aria-label="주요 메뉴">
                    <router-link
                        to="/"
                        :aria-current="inStocks ? 'page' : undefined"
                        :class="{
                            active: inStocks,
                        }"
                        ><i class="pi pi-search" aria-hidden="true" />종목
                        검색</router-link
                    >
                    <router-link
                        to="/compare"
                        :class="{ active: inComparison }"
                        :aria-current="inComparison ? 'page' : undefined"
                        ><i class="pi pi-clone" aria-hidden="true" />종목
                        비교</router-link
                    >
                    <router-link
                        :to="{
                            name: 'thumbnail-home',
                            query: { sort: 'ipoDate' },
                        }"
                        :class="{ active: inNewListings }"
                        :aria-current="inNewListings ? 'page' : undefined"
                        ><i class="pi pi-sparkles" aria-hidden="true" />신규
                        상장</router-link
                    >
                </nav>
                <div class="header-actions">
                    <router-link class="guide-link" to="/legal"
                        ><i
                            class="pi pi-question-circle"
                            aria-hidden="true" /><span
                            >이용 안내</span
                        ></router-link
                    >
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
            <PortfolioNavigation
                v-if="portfolioHeaderClosed && isMobileViewport"
                presentation="breadcrumb" />
        </header>
        <div
            class="shell-body"
            :data-content-layout="contentLayout"
            :class="{
                'with-submenu': isAdmin && inPortfolio && submenuOpen,
                'with-compact-submenu': isAdmin && inPortfolio && !submenuOpen,
            }">
            <aside
                v-if="isAdmin && inPortfolio && submenuOpen"
                id="portfolio-submenu"
                class="shell-submenu">
                <PortfolioNavigation />
            </aside>
            <aside
                v-else-if="isAdmin && inPortfolio"
                id="portfolio-submenu"
                class="portfolio-compact-rail"
                aria-label="서브메뉴 컴팩트 레일">
                <PortfolioNavigation
                    presentation="compact"
                    @expand="submenuOpen = true" />
            </aside>
            <main
                id="studio-main"
                class="studio-main"
                :data-content-layout="contentLayout"
                tabindex="-1">
                <div v-if="isAdmin && inPortfolio" class="submenu-controls">
                    <div
                        id="portfolio-header-actions"
                        class="portfolio-header-actions" />
                    <Button
                        class="desktop-submenu-toggle"
                        :label="submenuOpen ? '메뉴 접기' : '메뉴 펼치기'"
                        icon="pi pi-bars"
                        text
                        severity="secondary"
                        :aria-expanded="submenuOpen"
                        aria-controls="portfolio-submenu"
                        @click="submenuOpen = !submenuOpen" />
                    <Button
                        class="mobile-submenu-toggle"
                        label="포트폴리오 메뉴"
                        icon="pi pi-bars"
                        text
                        severity="secondary"
                        :aria-expanded="mobileSubmenuOpen"
                        aria-controls="portfolio-submenu-drawer"
                        @click="mobileSubmenuOpen = !mobileSubmenuOpen" />
                </div>
                <div
                    v-if="
                        isAdmin &&
                        inPortfolio &&
                        !isMobileViewport &&
                        isCompactViewport &&
                        mobileSubmenuOpen
                    "
                    id="portfolio-submenu-drawer"
                    class="tablet-submenu-panel">
                    <PortfolioNavigation presentation="sections" />
                </div>
                <router-view />
            </main>
        </div>
        <footer class="studio-footer">
            <div class="footer-inner">
                <div class="footer-brand">
                    <img :src="brandSymbol" alt="" /><strong
                        >모으멍 배당달력</strong
                    ><router-link to="/legal"
                        >데이터 출처 · 이용 안내</router-link
                    >
                </div>
                <p>
                    공개된 자료를 정리한 정보입니다. 기준일과 원문을 확인해
                    주세요.
                </p>
            </div>
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
                to="/compare"
                :class="{ active: inComparison }"
                :aria-current="inComparison ? 'page' : undefined"
                ><i class="pi pi-clone" aria-hidden="true" /><span
                    >종목 비교</span
                ></router-link
            >
            <router-link
                :to="{ name: 'thumbnail-home', query: { sort: 'ipoDate' } }"
                :class="{ active: inNewListings }"
                :aria-current="inNewListings ? 'page' : undefined"
                ><i class="pi pi-calendar" aria-hidden="true" /><span
                    >신규 상장</span
                ></router-link
            >
            <router-link
                to="/legal"
                :class="{ active: route.name === 'legal' }"
                :aria-current="route.name === 'legal' ? 'page' : undefined"
                ><i class="pi pi-info-circle" aria-hidden="true" /><span
                    >이용 안내</span
                ></router-link
            >
        </nav>
        <Drawer
            id="account-drawer"
            v-model:visible="accountOpen"
            header="계정 및 관리"
            :position="isCompactViewport ? 'left' : 'right'"
            :style="{
                width: `min(${isMobileViewport ? 340 : isCompactViewport ? 320 : 360}px, 100vw)`,
            }">
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
            <nav
                v-if="isCompactViewport"
                class="drawer-public-navigation"
                aria-label="공개 메뉴">
                <router-link to="/">종목 검색</router-link>
                <router-link to="/compare">종목 비교</router-link>
                <router-link
                    :to="{ name: 'thumbnail-home', query: { sort: 'ipoDate' } }"
                    >신규 상장</router-link
                >
                <router-link to="/legal">이용 안내</router-link>
            </nav>
            <PortfolioNavigation v-if="isAdmin" />
            <Divider />
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
                <details
                    v-if="isAdmin"
                    class="account-admin-group"
                    :open="!isCompactViewport">
                    <summary>관리자 설정 그룹</summary>
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
                        label="원금 기준안"
                        icon="pi pi-chart-pie"
                        severity="secondary"
                        text
                        @click="router.push('/admin/portfolio-example')" />
                </details>
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
        <Drawer
            v-if="isAdmin && isMobileViewport"
            id="portfolio-submenu-drawer"
            v-model:visible="mobileSubmenuOpen"
            header="내 작업 공간"
            position="bottom"
            :style="{
                width: '100%',
                height: 'auto',
                maxHeight: '82dvh',
                borderRadius: '16px 16px 0 0',
            }">
            <PortfolioNavigation />
        </Drawer>
        <Toast /><ConfirmDialog />
        <FullscreenDataLoading @after-hide="focusPendingAnchor" />
    </div>
</template>

<style scoped>
    .studio-shell {
        --studio-toolbar-height: 64px;
        --studio-header-height: var(--studio-toolbar-height);
        display: flex;
        flex-direction: column;
    }
    /* Closed originals include the toolbar's full height plus its border. */
    .portfolio-header-closed {
        --studio-header-height: calc(var(--studio-toolbar-height) + 1px);
    }
    .portfolio-header-closed .header-inner {
        height: var(--studio-toolbar-height);
    }
    .studio-header {
        position: sticky;
        top: 0;
        z-index: 30;
        background: var(--app-surface);
        border-bottom: 1px solid var(--app-border);
    }
    .header-inner {
        box-sizing: border-box;
        max-width: 1120px;
        height: calc(var(--studio-toolbar-height) - 1px);
        padding: 0 24px;
        margin: auto;
        display: flex;
        align-items: center;
        gap: 32px;
    }
    .studio-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        text-decoration: none;
        color: var(--app-text);
        font-size: 18px;
        font-weight: 700;
        white-space: nowrap;
        letter-spacing: -0.025em;
        padding: 4px;
    }
    .brand-symbol {
        width: 36px;
        height: 36px;
        object-fit: contain;
    }
    .brand-secondary {
        color: var(--app-accent);
    }
    .brand-mark {
        width: 36px;
        height: 36px;
        background: var(--app-accent-light);
        color: var(--app-accent);
        border-radius: 50%;
        display: inline-grid;
        place-items: center;
        flex-shrink: 0;
    }
    .desktop-nav {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .desktop-nav a {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 8px;
        color: var(--app-muted);
        text-decoration: none;
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
    }
    .desktop-nav i {
        font-size: 12px;
    }
    .desktop-nav a.active {
        color: var(--app-accent);
        background: var(--app-accent-light);
        font-weight: 600;
    }
    .desktop-nav .pi-sparkles {
        color: var(--app-warning);
    }
    .header-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-left: auto;
    }
    .header-actions :deep(.p-button) {
        width: 36px;
        height: 36px;
        min-height: 36px;
        min-width: 36px;
        border-radius: 8px;
    }
    .portfolio-header-actions {
        display: flex;
        align-items: center;
    }
    .guide-link {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--app-muted);
        text-decoration: none;
        font-size: 14px;
        padding: 6px 12px;
        white-space: nowrap;
    }
    .shell-body {
        box-sizing: border-box;
        width: 100%;
        max-width: 1280px;
        margin: 0 auto;
        flex: 1;
    }
    .studio-main {
        box-sizing: border-box;
        width: 100%;
        max-width: 1120px;
        margin: auto;
        padding: 24px;
        min-height: calc(100dvh - 180px);
        outline: none;
        min-width: 0;
    }
    .with-submenu {
        display: flex;
        align-items: flex-start;
        gap: 24px;
        padding: 24px;
    }
    .with-submenu .studio-main {
        padding: 0;
    }
    .shell-submenu {
        position: sticky;
        top: 88px;
        box-sizing: border-box;
        width: 224px;
        flex-shrink: 0;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        padding: 12px;
    }
    .submenu-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
    }
    .mobile-submenu-toggle {
        display: none;
    }
    .studio-footer {
        background: var(--app-surface);
        border-top: 1px solid var(--app-border);
        padding: 32px 0;
        font-size: 12px;
        color: var(--app-muted);
    }
    .footer-inner {
        box-sizing: border-box;
        max-width: 1120px;
        margin: auto;
        padding: 0 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }
    .footer-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        white-space: nowrap;
    }
    .footer-brand img {
        width: 24px;
        height: 24px;
        object-fit: contain;
    }
    .footer-brand strong {
        font-size: 14px;
        color: var(--app-text);
    }
    .footer-brand a {
        color: inherit;
        padding-left: 12px;
        border-left: 1px solid var(--app-border);
    }
    .studio-footer p {
        margin: 0;
        text-align: right;
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
    .drawer-public-navigation {
        display: grid;
        gap: 8px;
        padding-bottom: 16px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--app-border);
    }
    .drawer-public-navigation a {
        text-decoration: none;
        color: var(--app-muted);
        padding: 8px 12px;
        font-size: 12px;
        border-radius: 8px;
    }
    .tablet-submenu-panel {
        margin-bottom: 24px;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
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
    @media (min-width: 768px) and (max-width: 1023px) {
        .header-inner {
            max-width: 720px;
            padding: 0 16px;
            gap: 16px;
        }
        .studio-brand {
            font-size: 16px;
            gap: 8px;
        }
        .desktop-nav {
            background: var(--app-surface-muted);
            padding: 4px;
            border-radius: 12px;
        }
        .desktop-nav a {
            padding: 8px;
            font-size: 12px;
        }
        .desktop-nav i {
            display: none;
        }
        .header-actions {
            gap: 4px;
        }
        .guide-link {
            padding: 6px;
        }
        .guide-link span {
            display: none;
        }
        .studio-main,
        .footer-inner {
            max-width: 720px;
        }
        .shell-submenu,
        .desktop-submenu-toggle {
            display: none;
        }
        .mobile-submenu-toggle {
            display: inline-flex;
        }
        .with-submenu {
            display: block;
            padding: 0;
        }
        .with-submenu .studio-main {
            padding: 24px;
        }
        .footer-inner {
            flex-direction: column;
        }
    }
    @media (max-width: 767px) {
        .studio-shell {
            --studio-toolbar-height: 56px;
        }
        .portfolio-header-closed {
            /* 56px toolbar + 29.5px path row + 1px header border. */
            --studio-header-height: calc(var(--studio-toolbar-height) + 30.5px);
        }
        .header-inner {
            padding: 0 16px;
            gap: 8px;
        }
        .studio-brand {
            font-size: 14px;
            gap: 8px;
            padding: 4px 0;
        }
        .brand-symbol {
            width: 28px;
            height: 28px;
        }
        .desktop-nav {
            display: none;
        }
        .header-actions {
            gap: 4px;
        }
        .guide-link {
            width: 44px;
            height: 44px;
            justify-content: center;
            padding: 0;
        }
        .guide-link span {
            display: none;
        }
        .header-actions :deep(.p-button) {
            width: 44px;
            height: 44px;
        }
        .studio-main {
            padding: 16px;
        }
        .shell-submenu,
        .desktop-submenu-toggle {
            display: none;
        }
        .mobile-submenu-toggle {
            display: inline-flex;
        }
        .with-submenu {
            display: block;
            padding: 0;
        }
        .with-submenu .studio-main {
            padding: 16px;
        }
        .studio-footer {
            padding: 20px 0 calc(100px + env(safe-area-inset-bottom, 0px));
        }
        .footer-inner {
            padding: 0 16px;
            flex-direction: column;
            gap: 8px;
        }
        .footer-brand {
            flex-wrap: wrap;
            justify-content: center;
            gap: 8px;
        }
        .footer-brand img {
            width: 16px;
            height: 16px;
        }
        .footer-brand strong {
            font-size: 12px;
        }
        .footer-brand a {
            width: 100%;
            border: 0;
            padding: 0;
            text-align: center;
            font-size: 11px;
        }
        .studio-footer p {
            text-align: center;
            font-size: 10px;
        }
        .mobile-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            width: 100%;
            box-sizing: border-box;
            z-index: 30;
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            background: var(--app-surface);
            border-top: 1px solid var(--app-border);
            height: calc(64px + env(safe-area-inset-bottom, 0px));
            padding: 0 8px env(safe-area-inset-bottom, 0px);
        }
        .mobile-nav a {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            min-width: 0;
            font-size: 10px;
            font-weight: 500;
            text-decoration: none;
            color: var(--app-muted);
            text-align: center;
        }
        .mobile-nav a.active {
            color: var(--app-accent);
            font-weight: 600;
        }
        .mobile-nav i {
            display: grid;
            place-items: center;
            width: 28px;
            height: 28px;
            font-size: 12px;
            border-radius: 8px;
        }
        .mobile-nav a.active i {
            background: var(--app-accent-light);
        }
    }
    @media (max-width: 370px) {
        .header-inner {
            padding-inline: 12px;
        }
        .studio-brand {
            font-size: 12px;
            gap: 4px;
        }
        .header-actions {
            gap: 0;
        }
    }

    .account-admin-group {
        border-top: 1px solid var(--app-border);
        padding-top: 12px;
    }
    .account-admin-group summary {
        cursor: pointer;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 700;
        color: var(--app-muted);
    }
    .account-admin-group :deep(.p-button) {
        display: flex;
        width: 100%;
        justify-content: flex-start;
        font-size: 12px;
    }
    .shell-body[data-content-layout='editor'] {
        max-width: 1504px;
    }
    .studio-main[data-content-layout='catalog'] {
        max-width: 1280px;
        padding: 24px 20px 48px;
    }
    .studio-main[data-content-layout='comparison'] {
        max-width: 1248px;
        padding: 24px;
    }
    .studio-main[data-content-layout='editor'] {
        max-width: 1504px;
        padding: 32px;
    }
    @media (max-width: 768px) {
        .studio-main[data-content-layout='catalog'] {
            padding: 16px 12px 32px;
        }
        .studio-main[data-content-layout='comparison'] {
            padding: 16px;
        }
        .studio-main[data-content-layout='editor'] {
            padding: 16px;
        }
    }
    @media (max-width: 390px) {
        .studio-main[data-content-layout='comparison'] {
            padding: 12px;
        }
    }
    .studio-main[data-content-layout='editor'] > .studio-page {
        max-width: 1440px;
    }
    @media (min-width: 768px) and (max-width: 1023px) {
        .studio-main[data-content-layout='editor'] {
            padding: 24px;
        }
    }
    .portfolio-compact-rail {
        display: none;
    }
    @media (min-width: 1024px) {
        .with-compact-submenu {
            max-width: 1120px;
            display: flex;
            align-items: flex-start;
            gap: 24px;
            padding: 24px 16px;
        }
        .with-compact-submenu .studio-main {
            padding: 0;
        }
        .portfolio-compact-rail {
            display: block;
            box-sizing: border-box;
            width: 56px;
            flex-shrink: 0;
            border: 1px solid var(--app-border);
            border-radius: 16px;
            padding: 10px;
            background: var(--app-surface);
        }
        .portfolio-submenu-closed .header-inner,
        .portfolio-submenu-closed .footer-inner {
            padding-left: 16px;
            padding-right: 16px;
        }
    }
    /* PC submenu source 1170392357232825899 uses its 1280px shell frame. */
    @media (min-width: 1024px) {
        .portfolio-submenu-open .header-inner,
        .portfolio-submenu-open .footer-inner {
            max-width: 1280px;
        }
    }
    /* Tablet content uses full-width main + 24px padding; header stays 720px. */
    @media (min-width: 768px) and (max-width: 1023px) {
        .studio-main[data-content-layout='portfolio'] {
            max-width: none;
        }
    }
</style>
