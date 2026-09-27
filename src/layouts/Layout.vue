<!-- src/layouts/Layout.vue -->
<script setup>
import { ref, watch, computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useBreakpoint } from '@/composables/shared/useBreakpoint';
import { handleSignOut, user } from '../store/auth'; // handleSignOut import
import { useAdmin } from '@/composables/asset/useAdmin';
import { useStockData } from '@/composables/data/useStockData';
import { useLayout } from '@/composables/shared/useLayout';

import Drawer from 'primevue/drawer';
import Button from 'primevue/button';
import Breadcrumb from 'primevue/breadcrumb';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import ScrollTop from 'primevue/scrolltop';
import TieredMenu from 'primevue/tieredmenu';
import AppSidebar from './AppSidebar.vue';

const route = useRoute();
const router = useRouter();
const { isDesktop, isMobile } = useBreakpoint();
const { tickerInfo } = useStockData();
const { isDarkMode, toggleDarkMode } = useLayout();
const visible = ref(false);

// 관리자 여부 확인 (이메일 기반)
const { isAdmin } = useAdmin();

const isStandalonePage = computed(() => {
    return ['/', '/thumbnail-generator'].includes(route.path);
});

const menu = ref();
const toggleMenu = (event) => {
    menu.value.toggle(event);
};

const menuItems = computed(() => [
    {
        label: '배당달력',
        icon: 'pi pi-calendar',
        command: () => router.push('/calendar'),
    },
    {
        label: '백테스터', // [수정] 이름 변경
        icon: 'pi pi-history',
        command: () => router.push('/backtester'),
    },
    {
        label: '문의하기',
        icon: 'pi pi-envelope',
        command: () => router.push('/contact'),
    },
    { separator: true },
    ...(!user.value
        ? [
            {
                label: '로그인',
                icon: 'pi pi-sign-in',
                command: () => router.push('/login'),
            },
        ]
        : [
            {
                label: '북마크',
                icon: 'pi pi-bookmark',
                command: () => router.push('/bookmark'),
            },
            ...(isAdmin.value
                ? [
                    {
                        label: '자산관리',
                        icon: 'pi pi-wallet',
                        command: () => router.push('/assets'),
                    },
                    {
                        label: '관리자',
                        icon: 'pi pi-check-circle',
                        command: () => router.push('/admin'),
                    },
                ]
                : []),
            {
                label: '회원정보 수정',
                icon: 'pi pi-user-edit',
                command: () => router.push('/profile'),
            },
            {
                label: '로그아웃',
                icon: 'pi pi-sign-out',
                command: handleSignOut, // [핵심 수정] store의 함수를 직접 연결
            },
        ]),
]);

const breadcrumbItems = computed(() => {
    const home = { icon: 'pi pi-home', to: '/' };
    const items = [];

    if (route.name === 'calendar') items.push({ label: '배당달력' });
    else if (route.name === 'bookmarks')
        items.push({ label: '북마크 관리' }); // [수정]
    else if (route.name === 'assets') {
        items.push({ label: '자산관리' });
        // query에 memberId가 있으면 사용자명 표시 (이후 구현)
    } else if (route.name === 'profile')
        items.push({ label: '회원정보 수정' }); // [수정]
    else if (route.name === 'contact') items.push({ label: '문의하기' });
    else if (route.name === 'backtester') items.push({ label: '백테스터' });
    else if (route.name === 'stock-detail' && tickerInfo.value) {
        const info = tickerInfo.value;
        if (info.market) {
            items.push({ label: info.market.toUpperCase() });
        }

        if (isMobile.value && info.koName && info.koName !== 'N/A') {
            items.push({ label: info.koName });
        } else {
            const baseSymbol = info.symbol.split('.')[0];
            items.push({ label: baseSymbol.toUpperCase() });
        }

        const displayName =
            info.koName || info.longName || info.englishName;

        if (isDesktop.value && displayName && displayName !== 'N/A') {
            items.push({ label: displayName });
        }
    }
    return [home, ...items];
});

const mobileTitle = computed(() => {
    if (route.name === 'stock-detail' && tickerInfo.value) {
        const info = tickerInfo.value;
        return (
            info.koName || info.longName || info.englishName || info.symbol
        );
    }
    return null;
});

watch(
    () => route.path,
    () => {
        visible.value = false;
    }
);
</script>

<template>
    <Toast />
    <ConfirmDialog />
    <div v-if="isStandalonePage" id="t-standalone">
        <RouterView />
    </div>
    <div v-else id="t-layout">
        <main id="t-grid">
            <header id="t-header">
                <div class="flex items-center gap-4 min-w-0">
                    <Breadcrumb v-if="!isMobile" :model="breadcrumbItems" id="t-breadcrumb">
                        <template #item="{ item, props }">
                            <router-link v-if="item.to" :to="item.to" v-bind="props.action">
                                <span v-if="item.icon" :class="item.icon" />
                                <span class="font-semibold">{{
                                    item.label
                                    }}</span>
                            </router-link>
                            <span v-else>{{ item.label }}</span>
                        </template>
                    </Breadcrumb>
                </div>
                <!-- [핵심 수정 2] Top Bar UI 통일 -->
                <div id="t-topbar" class="topbar-actions">
                    <Button type="button" severity="secondary" :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'"
                        @click="toggleDarkMode" :style="{ marginRight: '0.5rem' }" />
                    <Button type="button" icon="pi pi-ellipsis-v" severity="secondary" @click="toggleMenu"
                        aria-haspopup="true" aria-controls="overlay_tmenu" variant="text" />
                    <TieredMenu ref="menu" id="overlay_tmenu" :model="menuItems" popup />
                    <Button v-if="!isDesktop" icon="pi pi-bars" variant="text" @click="visible = true" />
                </div>
            </header>
            <section id="t-content">
                <div v-if="isMobile && mobileTitle" class="text-center px-3">
                    <h1 class="text-xl font-bold m-0">{{ mobileTitle }}</h1>
                </div>
                <RouterView />
                <ScrollTop target="parent" :threshold="100" icon="pi pi-arrow-up" />
            </section>
        </main>
        <aside id="t-sidebar" v-if="isDesktop">
            <AppSidebar />
        </aside>
        <Drawer v-else v-model:visible="visible" :position="isMobile ? 'full' : 'right'" modal id="t-search">
            <AppSidebar />
        </Drawer>
    </div>
</template>
