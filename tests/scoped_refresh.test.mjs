import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedRefresh } from '../src/services/scopedRefresh.js';

test('initial load and family watcher share one refresh but completed requests are revalidated', async () => {
    const user = {};
    let calls = 0,
        release;
    const held = new Promise((resolve) => {
        release = resolve;
    });
    const refresh = createScopedRefresh({
        getScope: () => [user, 'family'],
        load: async () => {
            calls++;
            await held;
            return 1;
        },
    });
    const a = refresh(),
        b = refresh();
    assert.equal(a, b);
    release();
    await Promise.all([a, b]);
    assert.equal(calls, 1);
    await refresh();
    assert.equal(calls, 2);
});

test('user/family changes and writes detach old refreshes before they can publish', async () => {
    let user = {},
        family = 'a',
        release;
    const held = new Promise((resolve) => {
        release = resolve;
    });
    const published = [];
    const refresh = createScopedRefresh({
        getScope: () => [user, family],
        load: async ({ scope, isCurrent, signal }) => {
            if (scope[1] === 'a') await held;
            if (isCurrent()) published.push(scope[1]);
            return signal.aborted;
        },
    });
    const old = refresh();
    await new Promise((resolve) => setImmediate(resolve));
    family = 'b';
    await refresh();
    user = {};
    refresh.invalidate();
    release();
    assert.equal(await old, true);
    assert.deepEqual(published, ['b']);
});
