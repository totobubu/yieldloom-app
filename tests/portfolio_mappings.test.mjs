import test from 'node:test';
import assert from 'node:assert/strict';
import { mappingHandler, validateMapping } from '../lib/portfolio-mappings.js';
const admin = {
    uid: 'admin',
    email: 'jomalkeun@gmail.com',
    email_verified: true,
};
const catalog = [{ symbol: 'FUBO', isin: 'US35953D1046', koName: '푸보TV' }];
const request = {
    isin: 'US35953D4016',
    symbol: 'FUBO',
    canonicalIsin: 'US0000000000',
    name: 'untrusted name',
    evidence: '발행사 ISIN 변경 자료를 확인함',
};
function fixture(claims = admin, lookup) {
    const records = new Map([
        [
            'portfolios/owner/assets/US35953D4016',
            {
                isin: 'US35953D4016',
                name: '푸보티비',
                symbol: null,
                holdingShares: 0,
            },
        ],
        [
            'userAssets/owner/assets/US35953D4016',
            { isin: 'US35953D4016', symbol: null },
        ],
    ]);
    const versions = new Map();
    let counter = 0,
        databaseCalls = 0;
    const ref = (path) => ({
        path,
        id: path.split('/').at(-1),
        get: async () => snapshot(path),
        set: async (data) => {
            records.set(path, data);
            versions.set(path, ++counter);
        },
    });
    const snapshot = (path) => ({
        ...ref(path),
        ref: ref(path),
        exists: records.has(path),
        data: () => records.get(path),
        updateTime: records.has(path)
            ? { toMillis: () => versions.get(path) || 0 }
            : undefined,
    });
    const collection = (name) => ({
        doc: (id) => ref(`${name}/${id || `review${++counter}`}`),
        orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    });
    const db = {
        collection,
        doc: ref,
        collectionGroup: () => ({
            get: async () => ({
                docs: [...records.keys()]
                    .filter((p) => p.includes('/assets/'))
                    .map(snapshot),
            }),
        }),
        runTransaction: async (fn) => {
            const writes = [];
            const result = await fn({
                get: async (r) => snapshot(r.path),
                getAll: async (...refs) => refs.map((r) => snapshot(r.path)),
                set: (r, d) => writes.push([r, d]),
                update: (r, d) =>
                    writes.push([r, { ...records.get(r.path), ...d }]),
            });
            for (const [r, d] of writes) {
                records.set(r.path, d);
                versions.set(r.path, ++counter);
            }
            return result;
        },
    };
    const handler = mappingHandler({
        verify: async () => claims,
        database: () => {
            databaseCalls++;
            return db;
        },
        catalog,
        ...(lookup ? { lookup } : {}),
        timestamp: () => 123,
        now: () => 100,
    });
    async function call(method, body) {
        const res = {
            headers: {},
            setHeader(k, v) {
                this.headers[k] = v;
            },
            status(n) {
                this.code = n;
                return this;
            },
            json(data) {
                this.body = data;
                return this;
            },
        };
        await handler({ method, body }, res);
        return res;
    }
    return {
        call,
        records,
        versions,
        get databaseCalls() {
            return databaseCalls;
        },
    };
}

test('only a verified administrator can read or mutate mappings', async () => {
    for (const claims of [
        { uid: 'other', email: 'other@example.com', email_verified: true },
        { ...admin, email_verified: false },
    ]) {
        const f = fixture(claims);
        assert.equal((await f.call('GET')).code, 403);
        assert.equal((await f.call('POST', request)).code, 403);
        assert.equal(f.databaseCalls, 0);
    }
});
test('catalog validation preserves source ISIN and chooses canonical metadata on the server', () => {
    const result = validateMapping(request, catalog);
    assert.equal(result.isin, 'US35953D4016');
    assert.equal(result.canonicalIsin, 'US35953D1046');
    assert.equal(result.koName, '푸보TV');
    assert.throws(() =>
        validateMapping({ ...request, isin: '../invalid' }, catalog)
    );
    assert.throws(() => validateMapping({ ...request, evidence: '' }, catalog));
});
test('pending list excludes other stores and includes the preserved source identifier', async () => {
    const r = await fixture().call('GET');
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.pending, [
        { isin: 'US35953D4016', names: ['푸보티비'], assetCount: 1 },
    ]);
    assert.equal(r.headers['Cache-Control'], 'private, no-store');
});
test('preview is read-only for the ledger; apply updates metadata atomically and retries are idempotent', async () => {
    const f = fixture();
    const r = await f.call('POST', { action: 'preview', ...request });
    assert.equal(r.code, 200);
    assert.equal(r.body.affectedAssets, 1);
    assert.equal(
        f.records.get('portfolios/owner/assets/US35953D4016').symbol,
        null
    );
    const result = await f.call('POST', {
        action: 'apply',
        reviewId: r.body.reviewId,
    });
    assert.equal(result.code, 200);
    const asset = f.records.get('portfolios/owner/assets/US35953D4016');
    assert.equal(asset.isin, 'US35953D4016');
    assert.equal(asset.symbol, 'FUBO');
    assert.equal(asset.holdingShares, 0);
    assert.equal(asset.canonicalIsin, 'US35953D1046');
    assert.equal(
        f.records.get('userAssets/owner/assets/US35953D4016').symbol,
        null
    );
    assert.ok(f.records.has(`portfolioMappingAudit/${r.body.reviewId}`));
    assert.deepEqual(
        (await f.call('POST', { action: 'apply', reviewId: r.body.reviewId }))
            .body,
        result.body
    );
});
test('stale review is rejected before any mapping writes', async () => {
    const f = fixture();
    const r = await f.call('POST', { action: 'preview', ...request });
    f.records.get('portfolios/owner/assets/US35953D4016').symbol = 'CHANGED';
    assert.equal(
        (await f.call('POST', { action: 'apply', reviewId: r.body.reviewId }))
            .code,
        409
    );
    assert.equal(
        f.records.has('portfolioSecurityMappings/US35953D4016'),
        false
    );
});
test('a changed global ISIN mapping also invalidates the preview', async () => {
    const f = fixture();
    const r = await f.call('POST', { action: 'preview', ...request });
    f.records.set('portfolioSecurityMappings/US35953D4016', {
        symbol: 'OTHER',
    });
    f.versions.set('portfolioSecurityMappings/US35953D4016', 1000);
    assert.equal(
        (await f.call('POST', { action: 'apply', reviewId: r.body.reviewId }))
            .code,
        409
    );
});

test('automatic preview independently verifies providers and retains the exact ISIN over an outdated catalog', async () => {
    const lookup = async () => ({
        isin: request.isin,
        candidates: [
            {
                symbol: 'FUBO',
                name: 'FuboTV',
                crossChecked: true,
                sources: [
                    {
                        name: 'OpenFIGI',
                        url: 'https://www.openfigi.com/id/BBG002CV4Q74',
                    },
                    {
                        name: 'Yahoo',
                        url: 'https://finance.yahoo.com/quote/FUBO/',
                    },
                ],
            },
        ],
    });
    const f = fixture(admin, lookup);
    const r = await f.call('POST', {
        action: 'preview',
        ...request,
        autoLookup: true,
    });
    assert.equal(r.code, 200);
    assert.equal(r.body.mapping.canonicalIsin, request.isin);
    assert.equal(r.body.mapping.verifiedByLookup, true);
    assert.equal(r.body.mapping.lookupSources.length, 2);
    const rejected = await fixture(admin, async () => ({
        isin: request.isin,
        candidates: [],
    })).call('POST', { action: 'preview', ...request, autoLookup: true });
    assert.equal(rejected.code, 409);
});
