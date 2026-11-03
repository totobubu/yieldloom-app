// Development-only synthetic UI harness, no listener, broker or cloud access.
import { createApp, h, ref } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import AccountTossLocalUpdate from '../../src/components/portfolio/AccountTossLocalUpdate.vue';
if (import.meta.env.DEV) {
    const selected = ref('demo-1');
    const connector = {
        status: async (accountId) => ({
            accountId,
            connected: true,
            readOnly: true,
        }),
        update: async ({ accountId }) => {
            await new Promise((r) => setTimeout(r, 100));
            if (accountId === 'demo-error')
                throw Error('synthetic-private-details');
            if (accountId === 'demo-limit')
                return {
                    accountId,
                    status: 'observations_saved',
                    canonicalUnchanged: true,
                    cloudSaved: true,
                    saved: 0,
                    collectionPending: true,
                    stopReason: 'OPEN_RESPONSE_LIMIT',
                };
            if (accountId === 'demo-account-timeout')
                return {
                    accountId,
                    status: 'observations_saved',
                    canonicalUnchanged: true,
                    cloudSaved: true,
                    saved: 0,
                    collectionPending: true,
                    stopReason: 'ACCOUNT_LOOKUP_TIMEOUT',
                    failureStage: 'ACCOUNTS',
                };
            return {
                accountId,
                status: 'collected_locally',
                canonicalUnchanged: true,
                cloudSaved: false,
            };
        },
    };
    createApp({
        setup: () => () =>
            h('main', { style: 'max-width:40rem;margin:1rem;padding:1rem' }, [
                h('h1', '개발 전용 모의 업데이트'),
                h(
                    'select',
                    {
                        'aria-label': '모의 계좌',
                        value: selected.value,
                        onChange: (e) => {
                            selected.value = e.target.value;
                        },
                    },
                    [
                        'demo-1',
                        'demo-2',
                        'demo-error',
                        'demo-limit',
                        'demo-account-timeout',
                    ].map((value) => h('option', { value }, value))
                ),
                h(AccountTossLocalUpdate, {
                    accountId: selected.value,
                    connector,
                }),
            ]),
    })
        .use(PrimeVue, { theme: { preset: Aura } })
        .mount('#demo');
}
