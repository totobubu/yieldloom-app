import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountLedgerCache } from '../lib/account-ledger-cache.js';

test('concurrent scans share a query; failures are retryable; accounts and revisions stay separate', async () => {
    const read = createAccountLedgerCache();
    let release,
        calls = 0;
    const load = () => {
        calls++;
        return new Promise((resolve) => {
            release = resolve;
        });
    };
    const a = read('account/A', '1', load);
    const b = read('account/A', '1', load);
    release([{ id: 'a' }]);
    assert.deepEqual((await a).rows, (await b).rows);
    assert.equal(calls, 1);
    assert.equal((await b).cache, 'shared');
    assert.equal((await read('account/A', '1', load)).cache, 'hit');
    const fail = async () => {
        throw new Error('quota');
    };
    await assert.rejects(read('account/A', '2', fail), /quota/);
    assert.equal(
        (await read('account/A', '2', async () => [{ id: 'new' }])).rows[0].id,
        'new'
    );
    assert.equal(
        (await read('account/B', '2', async () => [{ id: 'other' }])).rows[0]
            .id,
        'other'
    );
});

test('cache expires, bypasses missing revisions, and bounds retained rows', async () => {
    let now = 0,
        calls = 0;
    const read = createAccountLedgerCache({
        now: () => now,
        ttlMs: 10,
        maxRows: 2,
    });
    const load = async () => {
        calls++;
        return [{ id: 'a' }, { id: 'b' }];
    };
    await read('A', '1', load);
    now = 11;
    await read('A', '1', load);
    assert.equal(calls, 2);
    await read('B', '1', load); // Evicts A to keep at most two rows.
    assert.equal((await read('A', '1', load)).cache, 'miss');
    assert.equal((await read('A', null, load)).cache, 'bypass');
    assert.equal((await read('A', null, load)).cache, 'bypass');
});
