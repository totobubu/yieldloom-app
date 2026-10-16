import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref } from 'vue';
import { usePortfolioDashboard } from '../src/composables/usePortfolioDashboard.js';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const portfolio = (owner) => ({
    assets: [{ id: owner }],
    transactions: [],
    summary: {},
});

test('identity changes clear private data immediately and ignore the previous owner response', async () => {
    const user = ref({ uid: 'A' });
    const old = deferred(),
        current = deferred();
    const scope = effectScope();
    const state = scope.run(() =>
        usePortfolioDashboard(user, (uid) =>
            uid === 'A' ? old.promise : current.promise
        )
    );
    try {
        state.dashboard.value = portfolio('A');
        const first = state.refresh();
        user.value = { uid: 'B' };
        assert.deepEqual(state.dashboard.value.assets, []);
        const second = state.refresh();
        old.resolve(portfolio('A'));
        await first;
        assert.equal(state.loading.value, true);
        assert.deepEqual(state.dashboard.value.assets, []);
        current.resolve(portfolio('B'));
        await second;
        assert.equal(state.dashboard.value.assets[0].id, 'B');
        assert.equal(state.loading.value, false);
        user.value = null;
        assert.deepEqual(state.dashboard.value.assets, []);
    } finally {
        scope.stop();
    }
});

test('superseded errors cannot overwrite the latest result or its loading state', async () => {
    const first = deferred(),
        second = deferred();
    let calls = 0;
    const scope = effectScope();
    const state = scope.run(() =>
        usePortfolioDashboard(
            ref({ uid: 'A' }),
            () => (++calls === 1 ? first : second).promise
        )
    );
    try {
        const old = state.refresh(),
            current = state.refresh();
        second.resolve(portfolio('latest'));
        await current;
        first.reject(
            Object.assign(new Error('offline'), { code: 'unavailable' })
        );
        await old;
        assert.equal(state.error.value, '');
        assert.equal(state.dashboard.value.assets[0].id, 'latest');
        assert.equal(state.loading.value, false);
    } finally {
        scope.stop();
    }
});

test('disposing the component scope invalidates pending requests', async () => {
    const pending = deferred();
    const scope = effectScope();
    const state = scope.run(() =>
        usePortfolioDashboard(ref({ uid: 'A' }), () => pending.promise)
    );
    const request = state.refresh();
    scope.stop();
    pending.resolve(portfolio('A'));
    await request;
    assert.deepEqual(state.dashboard.value.assets, []);
    assert.equal(state.loading.value, false);
});
