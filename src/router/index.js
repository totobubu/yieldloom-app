import { createRouter, createWebHistory } from 'vue-router';
export default createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'thumbnail-home',
            component: () => import('../pages/ThumbnailHomeView.vue'),
        },
        {
            path: '/login',
            name: 'login',
            component: () => import('../pages/LoginView.vue'),
        },
        {
            path: '/mypage',
            name: 'mypage',
            component: () => import('../pages/FamilyPortfolioView.vue'),
        },
        {
            path: '/mypage/legacy',
            name: 'legacy-mypage',
            component: () => import('../pages/MyPageView.vue'),
        },
        {
            path: '/admin/portfolio-mappings',
            name: 'portfolio-mappings',
            component: () => import('../pages/PortfolioMappingsView.vue'),
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
            path: '/legal',
            name: 'legal',
            component: () => import('../pages/LegalView.vue'),
        },
        { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
});
