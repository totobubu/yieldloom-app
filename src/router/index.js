import { createRouter, createWebHistory } from 'vue-router';
export default createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        { path: '/', name: 'thumbnail-home', component: () => import('../pages/ThumbnailHomeView.vue') },
        { path: '/thumbnail/:ticker', name: 'ticker-thumbnail', component: () => import('../pages/TickerThumbnailView.vue') },
        { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
});
