import test from 'node:test';
import assert from 'node:assert/strict';
import { internalFxLinkId } from '../lib/cash-fx-links.js';
import { fxLinkFixture } from './support/fx-link-fixture.mjs';
async function input(state, ids = ['K', 'U'], action = 'approveFxPair') {
    const linkId = await internalFxLinkId('AC', ids);
    const stored = new Map(state.storedClassifications.map((a) => [a.id, a]));
    return {
        action,
        accountId: 'AC',
        entryIds: ids,
        linkId,
        revision: state.fxLinks.find((l) => l.id === linkId)?.revision || 0,
        annotationRevisions: Object.fromEntries(
            ids.map((id) => [id, stored.get(id)?.revision || 0])
        ),
        entryFingerprints: Object.fromEntries(
            ids.map((id) => [id, state.fxEntryFingerprints[id]])
        ),
        ledgerVersion: state.ledgerVersion,
    };
}
test('approve and detach store only private link/bindings/audit atomically, preserving originals and manual notes', async () => {
    const f = fxLinkFixture('owner', true);
    f.records.set('investmentAccounts/AC/cashClassifications/K', {
        classification: 'unknown',
        revision: 2,
        note: 'keep original note',
    });
    const ledgerBefore = [...f.records].filter(
        ([k]) => k.includes('/entries/') || k.includes('/cashClassifications/')
    );
    const before = await f.read(),
        body = await input(before);
    assert.equal(before.fxLinkViews.length, 0);
    assert.equal((await f.call(body)).status, 200);
    const after = await f.read();
    assert.equal(after.fxLinkViews[0].status, 'active');
    assert.equal(
        after.classifications.find((a) => a.id === 'K').note,
        'keep original note'
    );
    assert.equal(
        f.records.get(`investmentAccounts/AC/cashFxBindings/K`).pairId,
        body.linkId
    );
    assert(
        f.records.has(
            `investmentAccounts/AC/cashFxLinks/${body.linkId}/history/1`
        )
    );
    assert.deepEqual(
        [...f.records].filter(
            ([k]) =>
                k.includes('/entries/') || k.includes('/cashClassifications/')
        ),
        ledgerBefore
    );
    assert.equal((await f.call(body)).status, 409);
    const detach = await input(after, ['K', 'U'], 'detachFxPair');
    assert.equal((await f.call(detach)).status, 200);
    const final = await f.read();
    assert.equal(final.fxLinkViews[0].status, 'detached');
    assert.equal(
        final.classifications.find((a) => a.id === 'K').classification,
        'unknown'
    );
    assert.equal(
        final.classifications.find((a) => a.id === 'K').note,
        'keep original note'
    );
    assert.equal(
        f.records.get('investmentAccounts/AC/cashFxBindings/K').pairId,
        null
    );
    assert.equal(
        f.records.get('investmentAccounts/AC/cashFxBindings/U').pairId,
        null
    );
    assert(
        f.records.has(
            `investmentAccounts/AC/cashFxLinks/${body.linkId}/history/2`
        )
    );
});
test('overlapping concurrent approvals cannot claim the same entry; unrelated manual decisions and revisions are protected', async () => {
    const f = fxLinkFixture('owner', true),
        before = await f.read();
    const [a, b] = await Promise.all([
        input(before),
        input(before, ['K', 'U2']),
    ]);
    const results = await Promise.all([f.call(a), f.call(b)]);
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
    const links = [...f.records].filter(
        ([k, v]) =>
            k.startsWith('investmentAccounts/AC/cashFxLinks/') &&
            !k.includes('/history/') &&
            v.state === 'active'
    );
    assert.equal(links.length, 1);
    const g = fxLinkFixture();
    const state = await g.read(),
        request = await input(state);
    g.records.set('investmentAccounts/AC/cashClassifications/K', {
        classification: 'external_deposit',
        revision: 1,
        note: 'manual',
    });
    assert.equal((await g.call(request)).status, 409);
    assert(![...g.records.keys()].some((k) => k.includes('/cashFxLinks/')));
});
test('ACL, stale ledger/evidence, spoofed IDs and amount mismatches fail without writes; reimports retain a valid ID', async () => {
    for (const role of ['viewer', 'admin']) {
        const f = fxLinkFixture(role),
            template = await fxLinkFixture().read();
        const before = structuredClone([...f.records]);
        assert.equal((await f.call(await input(template))).status, 403);
        assert.deepEqual([...f.records], before);
    }
    for (const mutate of [
        (b) => (b.accountId = 'MISSING'),
        (b) => (b.linkId = 'ylfx_fake'),
        (b) => (b.ledgerVersion = 'v4:0'),
        (b) => (b.entryFingerprints.K = 'incorrect'),
    ]) {
        const f = fxLinkFixture(),
            b = await input(await f.read());
        mutate(b);
        const before = structuredClone([...f.records]);
        assert([404, 409].includes((await f.call(b)).status));
        assert.deepEqual([...f.records], before);
    }
    const f = fxLinkFixture(),
        initial = await f.read();
    const b = await input(initial);
    assert.equal((await f.call(b)).status, 200);
    f.records.get('investmentAccounts/AC').entriesRevision = 2;
    const reload = await f.read();
    assert.equal(reload.fxLinkViews[0].id, b.linkId);
    assert.equal(reload.fxLinkViews[0].status, 'active');
    f.records.get('investmentAccounts/AC/entries/U').row.amount = 101;
    f.records.get('investmentAccounts/AC').entriesRevision = 3;
    const changed = await f.read();
    assert.equal(changed.fxLinkViews[0].status, 'stale');
});

test('note-only saves preserve automatic IDs and approved mappings; a deliberate unknown still invalidates the pair', async () => {
    const f = fxLinkFixture();
    const initial = await f.read();
    const id = initial.fxLinkViews[0].id;
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                accountId: 'AC',
                id: 'K',
                revision: 0,
                classification: 'exchange',
                noteOnly: true,
                note: 'auto note',
            })
        ).status,
        200
    );
    let current = await f.read();
    assert.equal(current.fxLinkViews[0].id, id);
    assert.equal(current.fxLinkViews[0].mode, 'automatic');
    assert.equal(
        current.classifications.find((a) => a.id === 'K').note,
        'auto note'
    );
    assert.equal(
        f.records.get('investmentAccounts/AC/cashClassifications/K').noteOnly,
        true
    );
    assert.equal((await f.call(await input(current))).status, 200);
    current = await f.read();
    assert.equal(current.fxLinkViews[0].mode, 'approved');
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                accountId: 'AC',
                id: 'K',
                revision: 1,
                classification: 'exchange',
                noteOnly: true,
                note: 'approved note',
            })
        ).status,
        200
    );
    current = await f.read();
    assert.equal(current.fxLinkViews[0].status, 'active');
    assert.equal(
        current.classifications.find((a) => a.id === 'K').note,
        'approved note'
    );
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                accountId: 'AC',
                id: 'K',
                revision: 2,
                classification: 'unknown',
                note: 'deliberate undo',
            })
        ).status,
        200
    );
    assert.equal((await f.read()).fxLinkViews[0].status, 'stale');
});
test('automatic detach is paired and reversible without creating financial annotations', async () => {
    const f = fxLinkFixture(),
        first = await f.read(),
        id = first.fxLinkViews[0].id;
    assert.equal(
        (await f.call(await input(first, ['K', 'U'], 'detachFxPair'))).status,
        200
    );
    let current = await f.read();
    assert.equal(current.fxLinkViews[0].status, 'detached');
    assert.equal(current.classifications.length, 0);
    assert(
        ![...f.records.keys()].some((k) => k.includes('/cashClassifications/'))
    );
    assert.equal((await f.call(await input(current))).status, 200);
    current = await f.read();
    assert.equal(current.fxLinkViews[0].id, id);
    assert.equal(current.fxLinkViews[0].status, 'active');
});

test('typed notes are committed with both link bindings, unchanged notes cause no writes, invalid notes roll back all changes', async () => {
    const f = fxLinkFixture('owner', true),
        s = await f.read(),
        b = await input(s);
    b.notes = { K: 'typed K', U: 'typed U' };
    assert.equal((await f.call(b)).status, 200);
    const after = await f.read();
    assert.equal(after.fxLinkViews[0].status, 'active');
    assert.equal(
        after.classifications.find((a) => a.id === 'K').note,
        'typed K'
    );
    assert.equal(
        after.classifications.find((a) => a.id === 'U').note,
        'typed U'
    );
    assert.equal(
        f.records.get('investmentAccounts/AC/cashClassifications/K').noteOnly,
        true
    );
    for (const invalid of ['x'.repeat(501), {}]) {
        const g = fxLinkFixture(),
            req = await input(await g.read());
        req.notes = { K: invalid };
        const original = structuredClone([...g.records]);
        assert.equal((await g.call(req)).status, 400);
        assert.deepEqual([...g.records], original);
    }
});
