// src/main.js

import { createApp } from 'vue';
import { createHead } from '@vueuse/head';

import App from './App.vue';
import router from './router';
import { initSentry } from './utils/sentry';

import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import './styles/style.scss';


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


app.mount('#app');
