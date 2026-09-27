import { createRouter, createWebHistory } from 'vue-router';
import { buildRouteParamsFromLegacyTicker } from '@/utils/tickerRoute';
import { isLegacyPortfolioEnabled } from '@/config/appMode';

const HomeView = () => import('../pages/HomeView.vue');
const CalendarView = () => import('../pages/CalendarView.vue');
const BacktesterView = () => import('../pages/BacktesterView.vue');
const StockView = () => import('../pages/StockView.vue');
const SignUpView = () => import('../pages/SignupView.vue');
const LoginView = () => import('../pages/LoginView.vue');
const PasswordResetView = () => import('../pages/PasswordResetView.vue');
const BookmarkView = () => import('../pages/BookmarkView.vue');
const AssetView = () => import('../pages/AssetView.vue');
const PortfolioView = () => import('../pages/PortfolioView.vue');
const AdminView = () => import('../pages/AdminView.vue');
const ProfileView = () => import('../pages/ProfileView.vue');
const ContactView = () => import('../pages/ContactView.vue');
const NotFound = () => import('../pages/NotFound.vue');
const ThumbnailGenerator = () => import('../pages/ThumbnailGenerator.vue');
const StudioHomeView = () => import('../pages/studio/StudioHomeView.vue');
const StudioDataView = () => import('../pages/studio/StudioDataView.vue');
const StudioDistributionsView = () => import('../pages/studio/StudioDistributionsView.vue');
const StudioRendersView = () => import('../pages/studio/StudioRendersView.vue');
const StudioReconciliationView = () => import('../pages/studio/StudioReconciliationView.vue');

const getCurrentUser = async () => {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
        import('../firebase'),
        import('firebase/auth'),
    ]);

    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
            auth,
            (user) => {
                unsubscribe();
                resolve(user);
            },
            reject
        );
    });
};

const contentStudioRoutes = [
    { path: '/', name: 'studio-home', component: StudioHomeView },
    { path: '/distributions', name: 'studio-distributions', component: StudioDistributionsView },
    { path: '/content', name: 'studio-content', component: StudioDataView, meta: { kind: 'content' } },
    { path: '/sources', name: 'studio-sources', component: StudioDataView, meta: { kind: 'sources' } },
    { path: '/reconciliation', name: 'studio-reconciliation', component: StudioReconciliationView },
    { path: '/renders', name: 'studio-renders', component: StudioRendersView },
    { path: '/archive', name: 'studio-archive', component: StudioDataView, meta: { kind: 'archive' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
];

const legacyPortfolioRoutes = [
    { path: '/', name: 'home', component: HomeView },
    { path: '/calendar', name: 'calendar', component: CalendarView },
    {
        path: '/backtester/:ticker?',
        name: 'backtester',
        component: BacktesterView,
        props: true,
    },
    { path: '/signup', name: 'signup', component: SignUpView },
    { path: '/login', name: 'login', component: LoginView },
    {
        path: '/password-reset',
        name: 'password-reset',
        component: PasswordResetView,
    },
    {
        path: '/bookmark-edit',
        name: 'bookmark-edit',
        component: BookmarkView,
        meta: { requiresAuth: true },
    },
    {
        path: '/assets',
        name: 'assets',
        component: AssetView,
        meta: { requiresAuth: true, adminOnly: true },
    },
    {
        path: '/portfolio',
        name: 'portfolio',
        component: PortfolioView,
        meta: { requiresAuth: true },
    },
    {
        path: '/admin',
        name: 'admin',
        component: AdminView,
        meta: { requiresAuth: true, adminOnly: true },
    },
    {
        path: '/profile',
        name: 'profile',
        component: ProfileView,
        meta: { requiresAuth: true },
    },
    {
        path: '/bookmark',
        name: 'bookmark-gallery',
        component: ThumbnailGenerator,
    },
    { path: '/contact', name: 'contact', component: ContactView },
    {
        path: '/stock/:market/:ticker',
        name: 'stock-detail',
        component: StockView,
        props: true,
    },
    {
        path: '/stock/:legacyTicker',
        redirect: (to) => ({
            name: 'stock-detail',
            params: buildRouteParamsFromLegacyTicker(to.params.legacyTicker),
        }),
    },
    {
        path: '/:legacyTicker',
        redirect: (to) => ({
            name: 'stock-detail',
            params: buildRouteParamsFromLegacyTicker(to.params.legacyTicker),
        }),
    },
    {
        path: '/time-machine/:ticker?',
        name: 'time-machine',
        component: () => import('../pages/TimeMachineView.vue'),
    },
    { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound },
];

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: isLegacyPortfolioEnabled
        ? legacyPortfolioRoutes
        : contentStudioRoutes,
});

router.beforeEach(async (to, from, next) => {
    if (!isLegacyPortfolioEnabled) {
        next();
        return;
    }

    const { isAdminEmail } = await import('@/config/admin');
    const requiresAuth = to.matched.some((record) => record.meta.requiresAuth);
    const isAuthPage = ['login', 'signup', 'password-reset'].includes(to.name);
    const user = await getCurrentUser();
    const isAdminUser = !!user && isAdminEmail(user.email || '');
    const requiresAdmin = to.matched.some((record) => record.meta.adminOnly);

    if (requiresAuth && !user) {
        next({ name: 'login', query: { redirect: to.fullPath } });
    } else if (requiresAdmin && !isAdminUser) {
        next({ name: 'bookmark-gallery' });
    } else if (isAuthPage && user) {
        next({ name: 'bookmark-gallery' });
    } else {
        next();
    }
});

export default router;
