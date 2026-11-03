// Vite development harness only; not a router entry or production build input.
import { createApp, ref, h } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import AccountTossConnection from '../../src/components/portfolio/AccountTossConnection.vue';
import { createAccountTossClient } from '../../src/services/accountTossClient.js';
if (import.meta.env.DEV) {
    const users = Object.fromEntries(
        ['wife', 'husband'].map((owner) => [
            owner,
            { uid: `demo-${owner}`, getIdToken: async () => `demo-${owner}` },
        ])
    );
    const owner = ref('wife');
    const client = createAccountTossClient({
        getUser: () => users[owner.value],
        endpoint: '/__dev/toss-connection',
    });
    createApp({
        setup: () => () =>
            h(
                'main',
                { style: 'max-width:46rem;margin:2rem auto;padding:1rem' },
                [
                    h('h1', '계좌별 토스 연결 · 모의 확인'),
                    h(
                        'p',
                        '실제 API·개인 장부·비밀정보를 사용하지 않는 개발 화면입니다.'
                    ),
                    h('label', [
                        '모의 계좌 ',
                        h(
                            'select',
                            {
                                'aria-label': '모의 계좌',
                                value: owner.value,
                                onChange: (event) => {
                                    owner.value = event.target.value;
                                },
                            },
                            [
                                h('option', { value: 'wife' }, '아내'),
                                h('option', { value: 'husband' }, '남편'),
                            ]
                        ),
                    ]),
                    h(AccountTossConnection, {
                        accountId: 'demo-' + owner.value,
                        client,
                    }),
                ]
            ),
    })
        .use(PrimeVue, { theme: { preset: Aura } })
        .mount('#demo');
}
