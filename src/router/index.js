import { createRouter, createWebHistory } from 'vue-router';
export default createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        { path: '/', name: 'thumbnail-home', component: () => import('../pages/ThumbnailHomeView.vue') },
        { path: '/login', name: 'login', component: () => import('../pages/LoginView.vue') },
        { path: '/mypage', name: 'mypage', component: () => import('../pages/MyPageView.vue') },
        { path: '/thumbnail/:ticker', name: 'ticker-thumbnail', component: () => import('../pages/TickerThumbnailView.vue') },
        { path: '/legal', name: 'legal', component: () => import('../pages/LegalView.vue') },
        { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
});
