import { createApp, h, ref } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import AccountTossLocalSettings from '../../src/components/portfolio/AccountTossLocalSettings.vue';
import AccountEvidencePanel from '../../src/components/portfolio/AccountEvidencePanel.vue';
import CashEntryReview from '../../src/components/portfolio/CashEntryReview.vue';
if (import.meta.env.DEV) {
    let registered = false;
    const review = ref(null);
    const user = {
        uid: 'synthetic-user',
        getIdToken: async () => 'SYNTHETIC-FIREBASE',
    };
    const client = {
        setPairing: () => {},
        prepare: async () =>
            'http://127.0.0.1:43129/register?flow=' + 'a'.repeat(48),
        register: async () => {
            registered = true;
        },
        status: async (accountId) => ({
            accountId,
            connected: registered,
            readOnly: true,
        }),
        issueToken: async () => {},
        disconnect: async () => {
            registered = false;
        },
        update: async ({ accountId }) => ({
            accountId,
            status: 'observations_saved',
            canonicalUnchanged: true,
            cloudSaved: true,
            saved: 2,
        }),
    };
    const state = {
        entries: [
            {
                id: 'W2',
                date: '20260104',
                amount: '2000',
                currency: 'USD',
                source: 'toss-pdf',
            },
            {
                id: 'D',
                date: '20260101',
                amount: '1000',
                currency: 'USD',
                source: 'toss-pdf',
            },
            {
                id: 'W',
                date: '20260103',
                amount: '80',
                currency: 'USD',
                source: 'toss-pdf',
            },
        ],
        classifications: [
            { id: 'D', classification: 'external_deposit' },
            { id: 'W', classification: 'external_withdrawal' },
            { id: 'W2', classification: 'external_withdrawal' },
        ],
        trades: [
            {
                id: 'DIV',
                date: '20260102',
                type: 'dividend',
                symbol: 'TEST',
                nativeSettlementAmount: '30',
                currency: 'USD',
                source: 'toss-pdf',
            },
        ],
    };
    createApp({
        setup: () => () =>
            h('main', { style: 'max-width:45rem;margin:auto;padding:1rem' }, [
                h('h1', '합성 계좌 연결과 근거'),
                h(AccountTossLocalSettings, {
                    accountId: 'demo42',
                    accountLabel: '합성 계좌 · ****0042',
                    client,
                }),
                h(AccountEvidencePanel, {
                    account: {
                        id: 'demo42',
                        source: 'toss-pdf',
                        asOf: '2026-01-03',
                    },
                    state,
                    onReviewCash: (command) =>
                        review.value.openEntry(command.id, command.parts),
                    client: {
                        act: async () => ({
                            observations: [],
                            nextCursor: null,
                        }),
                    },
                }),
                h(CashEntryReview, {
                    ref: review,
                    user,
                    accountId: 'demo42',
                    state,
                }),
            ]),
    })
        .use(PrimeVue, { theme: { preset: Aura } })
        .mount('#demo');
}
