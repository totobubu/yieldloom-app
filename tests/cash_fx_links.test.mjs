import test from 'node:test';
import assert from 'node:assert/strict';
import {
    projectCashFxLinks,
    internalFxLinkId,
    fxEntryFingerprint,
    FX_LINK_ORIGIN,
} from '../lib/cash-fx-links.js';
import { cashNeedsReview } from '../lib/portfolio-capital.js';
const row = (id, currency) => ({
    id,
    accountId: 'AC',
    source: 'toss-pdf',
    date: '2026-10-17',
    currency,
    amount: currency === 'KRW' ? 140000 : 100,
    exchangeRate: 1400,
    rawType: currency === 'KRW' ? '환전원화입금' : '환전외화출금',
    type: currency === 'KRW' ? 'cash_in' : 'cash_out',
    externalId: 'source-' + id,
});
const state = (
    entries = [row('K', 'KRW'), row('U', 'USD')],
    classifications = []
) => ({ entries, classifications, trades: [], allocations: [], fxLinks: [] });
test('internal shared ID is deterministic, account-scoped and independent of input order, never a new broker ID', async () => {
    const s = state(),
        before = structuredClone(s),
        out = await projectCashFxLinks(s, 'AC');
    assert.equal(out.fxLinkViews.length, 1);
    const id = out.fxLinkViews[0].id;
    assert.match(id, /^ylfx_[a-f0-9]{64}$/);
    assert.equal(out.classifications[0].internalFxLinkId, id);
    assert.equal(out.classifications[1].internalFxLinkId, id);
    assert.equal(id, await internalFxLinkId('AC', ['U', 'K']));
    assert.notEqual(id, await internalFxLinkId('OTHER', ['K', 'U']));
    assert.equal((await projectCashFxLinks(out, 'AC')).fxLinkViews[0].id, id);
    assert.deepEqual(s, before);
});
test('ambiguous matches stay pending until explicit pair approval; notes and stored classifications remain intact', async () => {
    const entries = [
        row('K', 'KRW'),
        row('U', 'USD'),
        row('K2', 'KRW'),
        row('U2', 'USD'),
    ];
    const s = state(entries, [
        { id: 'K', classification: 'unknown', revision: 1, note: 'preserved' },
    ]);
    const before = structuredClone(s),
        unlinked = await projectCashFxLinks(s, 'AC');
    assert.equal(unlinked.fxLinkViews.length, 0);
    assert.equal(
        unlinked.fxPairCandidates.find((x) => x.entryId === 'K').peerIds.length,
        2
    );
    const id = await internalFxLinkId('AC', ['K', 'U']);
    s.fxLinks = [
        {
            id,
            accountId: 'AC',
            origin: FX_LINK_ORIGIN,
            state: 'active',
            revision: 1,
            entryIds: ['K', 'U'],
            entryFingerprints: {
                K: await fxEntryFingerprint(entries[0]),
                U: await fxEntryFingerprint(entries[1]),
            },
            annotations: {
                K: { classification: 'unknown', revision: 1 },
                U: { classification: null, revision: 0 },
            },
        },
    ];
    const out = await projectCashFxLinks(s, 'AC');
    assert.equal(
        out.classifications.find((x) => x.id === 'K').note,
        'preserved'
    );
    assert.equal(out.fxLinkViews[0].status, 'active');
    assert.equal(
        out.classifications.filter((x) => x.internalFxLinkId === id).length,
        2
    );
    assert.deepEqual(out.storedClassifications, before.classifications);
    assert.deepEqual(s.entries, before.entries);
    assert(!out.classifications.some((x) => ['K2', 'U2'].includes(x.id)));
    s.classifications = [
        {
            id: 'K',
            classification: 'exchange',
            revision: 2,
            note: 'updated note',
        },
    ];
    assert.equal(
        (await projectCashFxLinks(s, 'AC')).fxLinkViews[0].status,
        'active'
    );
    s.classifications = [
        {
            id: 'K',
            classification: 'unknown',
            revision: 2,
            note: 'explicit undo',
        },
    ];
    assert.equal(
        (await projectCashFxLinks(s, 'AC')).fxLinkViews[0].status,
        'stale'
    );
});
test('detach suppresses automatic reassignment; evidence changes and missing legs suspend approved links', async () => {
    const s = state();
    const id = await internalFxLinkId('AC', ['K', 'U']);
    s.fxLinks = [
        {
            id,
            accountId: 'AC',
            origin: FX_LINK_ORIGIN,
            state: 'active',
            revision: 1,
            entryIds: ['K', 'U'],
            entryFingerprints: {
                K: await fxEntryFingerprint(s.entries[0]),
                U: await fxEntryFingerprint(s.entries[1]),
            },
            annotations: {
                K: { classification: null, revision: 0 },
                U: { classification: null, revision: 0 },
            },
        },
    ];
    assert.equal(
        (await projectCashFxLinks(s, 'AC')).fxLinkViews[0].status,
        'active'
    );
    const detached = structuredClone(s);
    detached.fxLinks[0].state = 'detached';
    const out = await projectCashFxLinks(detached, 'AC');
    assert.equal(out.classifications.length, 0);
    assert.equal(out.fxLinkViews[0].status, 'detached');
    const changed = structuredClone(s);
    changed.entries[0].amount = 140001;
    const stale = await projectCashFxLinks(changed, 'AC');
    assert.equal(stale.fxLinkViews[0].status, 'stale');
    assert(
        cashNeedsReview(
            changed.entries[0],
            stale.classifications.find((x) => x.id === 'K')
        )
    );
    s.entries.pop();
    assert.equal(
        (await projectCashFxLinks(s, 'AC')).fxLinkViews[0].status,
        'stale'
    );
});
