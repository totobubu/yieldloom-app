// Local in-memory Flask test server only. No Firebase or production accounts.
import assert from 'node:assert/strict';
import { createFamilyPortfolioClient } from '../src/services/familyPortfolioClient.js';
import { createPortfolioLedgerClient } from '../src/services/portfolioLedgerClient.js';

const uid = `ledger-fixture-${Date.now()}`;
const user = { uid, getIdToken: async () => uid };
const request = createFamilyPortfolioClient({
    getUser: () => user,
    fetcher: (url, options) =>
        fetch(new URL(url, 'http://127.0.0.1:5011'), options),
});
const { familyId } = await request('createFamily', {
    name: 'Fixture',
    profileName: 'Fixture',
});
const overview = await request('', undefined, { familyId });
const ownerId = Object.keys(overview.families[0].profiles)[0];
const { accountId } = await request('createAccount', {
    familyId,
    ownerId,
    institution: 'Fixture',
    alias: 'Fixture',
    type: 'general',
});
for (const [offset, count] of [
    [0, 200],
    [200, 1],
]) {
    const form = new FormData();
    for (const [key, value] of Object.entries({
        accountId,
        ownerId,
        institution: 'Fixture',
        kind: 'transactions',
        asOf: '2026-10-15',
        identityConfirmed: 'true',
    }))
        form.set(key, value);
    const csv =
        'date,symbol,quantity,amount,currency,type,externalId\n' +
        Array.from(
            { length: count },
            (_, i) => `2026-10-15,AAPL,,1,USD,dividend,fixture-${offset + i}\n`
        ).join('');
    form.set('file', new Blob([csv], { type: 'text/csv' }), 'fixture.csv');
    const review = await request('preview', form);
    await request('commit', {
        accountId,
        reviewId: review.reviewId,
        rows: review.rows,
    });
}
const load = createPortfolioLedgerClient({ getUser: () => user, request });
const options = { familyId, accounts: [{ id: accountId }] };
const before = request.metrics();
assert.equal((await load(options)).length, 201);
const initial = request.metrics();
assert.equal((await load(options)).length, 201);
const reused = request.metrics();
const coldRequests = initial.apiRequests - before.apiRequests;
const warmRequests = reused.apiRequests - initial.apiRequests;
const coldReads =
    initial.firestoreDocumentsRead - before.firestoreDocumentsRead;
const warmReads =
    reused.firestoreDocumentsRead - initial.firestoreDocumentsRead;
assert.deepEqual(
    { coldRequests, warmRequests, coldReads, warmReads },
    { coldRequests: 4, warmRequests: 2, coldReads: 211, warmReads: 4 }
);
assert.equal(load.metrics().cacheHits, 2);
console.log(
    'PASS: real Flask API with in-memory Firestore: 201 rows, API calls 4 → 2, observed document reads 211 → 4; access rechecked twice.'
);
