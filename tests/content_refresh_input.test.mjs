import assert from 'node:assert/strict';
import test from 'node:test';

import { PROVIDERS, targetKey, validateRefreshInput } from '../api/_utils/content-refresh.js';

test('accepts and keys an ISO ex-date refresh', async () => {
    const input = await validateRefreshInput({ scope: 'ex_date', exDate: '2026-09-25' });
    assert.deepEqual(input, { scope: 'ex_date', exDate: '2026-09-25' });
    assert.equal(targetKey(input), 'ex-date:2026-09-25');
});

test('rejects a calendar-invalid ex-date', async () => {
    await assert.rejects(
        validateRefreshInput({ scope: 'ex_date', exDate: '2026-02-31' }),
        /valid ISO date/
    );
});

test('accepts newly registered official providers', async () => {
    assert.equal(PROVIDERS.has('ishares'), true);
    assert.equal(PROVIDERS.has('statestreet'), true);
    assert.equal(PROVIDERS.has('graniteshares'), true);
    assert.equal(PROVIDERS.has('kurv'), true);
    assert.equal(PROVIDERS.has('proshares'), true);
    assert.deepEqual(
        await validateRefreshInput({ scope: 'provider', provider: 'ishares' }),
        { scope: 'provider', provider: 'ishares' }
    );
});
