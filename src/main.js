// src/main.js

import { createApp } from 'vue';
import { createHead } from '@vueuse/head';

import App from './App.vue';
import router from './router';
import { isLegacyPortfolioEnabled } from './config/appMode';
import { initSentry } from './utils/sentry';

import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import './styles/style.scss';

// --- [핵심 수정 1] ECharts 전역 등록 ---
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import {
    BarChart,
    LineChart,
    CandlestickChart,
    PieChart,
} from 'echarts/charts';
import {
    TitleComponent,
    TooltipComponent,
    LegendComponent,
    GridComponent,
    DataZoomComponent,
    VisualMapComponent,
    MarkPointComponent,
} from 'echarts/components';

// ECharts에 필요한 모든 모듈을 등록합니다.
use([
    CanvasRenderer,
    BarChart,
    LineChart,
    CandlestickChart,
    PieChart,
    TitleComponent,
    TooltipComponent,
    LegendComponent,
    GridComponent,
    DataZoomComponent,
    VisualMapComponent,
    MarkPointComponent,
]);
// --- // ---

import { MyPreset } from '@/config/theme';
import ko from '@/config/locale/ko';

const app = createApp(App);
const head = createHead();

// Sentry 초기화 (프로덕션 환경에서만)
initSentry(app, router);

app.use(router);
app.use(head);
app.use(PrimeVue, {
    theme: {
        preset: MyPreset,
        options: {
            darkModeSelector: '.p-dark',
        },
    },
    locale: ko,
});
app.use(ToastService);
app.use(ConfirmationService);
app.directive('tooltip', Tooltip);

router.afterEach(async () => {
    if (!isLegacyPortfolioEnabled) return;
    const { isRecentlyAuthenticated } = await import('./store/auth');
    isRecentlyAuthenticated.value = false;
});

app.mount('#app');
