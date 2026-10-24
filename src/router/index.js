import { createRouter, createWebHistory } from 'vue-router';
import {
    clearRouteChunkRecovery,
    recoverRouteChunk,
} from '@/services/routeChunkRecovery.js';
import { watch } from 'vue';
import { authLoading, firebaseUser } from '@/services/firebaseClient.js';
import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';

async function requirePortfolioAdmin() {
    if (authLoading.value)
        await new Promise((resolve) => {
            const stop = watch(authLoading, (loading) => {
                if (!loading) {
                    stop();
                    resolve();
                }
            });
        });
    return isPortfolioAdmin(firebaseUser.value) || { name: 'thumbnail-home' };
}

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    scrollBehavior(to, from, savedPosition) {
        if (savedPosition) return savedPosition;
        if (to.path !== from.path) return { top: 0 };
    },
    routes: [
        {
            path: '/admin/sheet-ledger',
            name: 'sheet-trial-ledger',
            component: () => import('../pages/SheetTrialLedgerView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/underlying/:symbol',
            name: 'underlying-explorer',
            component: () => import('../pages/UnderlyingExplorerView.vue'),
        },
        {
            path: '/compare',
            name: 'security-compare',
            component: () => import('../pages/UnderlyingExplorerView.vue'),
        },
        {
            path: '/admin/metadata',
            name: 'metadata-review',
            component: () => import('../pages/MetadataReviewView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/admin/feedback',
            name: 'stock-feedback-admin',
            component: () => import('../pages/StockFeedbackAdminView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/admin/portfolio-example',
            name: 'admin-portfolio-example',
            component: () => import('../pages/AdminPortfolioExampleView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/',
            name: 'thumbnail-home',
            component: () => import('../pages/ThumbnailHomeView.vue'),
        },
        {
            path: '/login',
            redirect: '/',
        },
        {
            path: '/admin/login',
            name: 'login',
            component: () => import('../pages/LoginView.vue'),
        },
        {
            path: '/mypage',
            name: 'mypage',
            component: () => import('../pages/FamilyPortfolioView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/mypage/legacy',
            name: 'legacy-mypage',
            component: () => import('../pages/MyPageView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/admin/portfolio-mappings',
            name: 'portfolio-mappings',
            component: () => import('../pages/PortfolioMappingsView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/thumbnail/:ticker',
            redirect: (to) => ({
                path: `/stock/${to.params.ticker}`,
                query: to.query,
                hash: to.hash,
            }),
        },
        {
            path: '/stock/:ticker',
            name: 'ticker-stock',
            component: () => import('../pages/TickerThumbnailView.vue'),
        },
        {
            path: '/simulator',
            name: 'dividend-simulator',
            component: () => import('../pages/DividendSimulatorView.vue'),
            beforeEnter: requirePortfolioAdmin,
        },
        {
            path: '/legal',
            name: 'legal',
            component: () => import('../pages/LegalView.vue'),
        },
        { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
});

router.onError((error, to) => {
    recoverRouteChunk(error, to.fullPath);
});

router.afterEach((to, _from, failure) => {
    if (!failure) clearRouteChunkRecovery(to.fullPath);
});

export default router;
