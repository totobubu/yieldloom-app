import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../data-v2/security-underlyings.json' with { type: 'json' };
import {
    reviewDataset,
    validateDecision,
    metadataReviewHandler,
} from '../lib/metadata/reviews.js';
import { PORTFOLIO_ADMIN_EMAILS } from '../lib/portfolio-admin.js';
const claims = {
    uid: 'admin-test',
    email: PORTFOLIO_ADMIN_EMAILS[0],
    email_verified: true,
};
const dataset = reviewDataset(
    registry,
    {
        generatedAt: '2026-10-17',
        summary: {},
        instruments: [{ symbol: 'AAPY', status: 'needs-review' }],
        unregisteredOfficialProducts: [],
    },
    [{ symbol: 'AAPY', market: 'NYSE', currency: 'USD' }]
);
const body = {
    symbol: 'AAPY',
    action: 'approve',
    underlying: 'AAPL',
    expectedRevision: 0,
    datasetRevision: dataset.revision,
    requestId: 'test-request-00001',
    note: '공식 투자 목적에서 AAPL을 확인했습니다.',
};
function fakeDb() {
    const values = new Map(),
        reads = [];
    const collection = (name) => {
        const query = {
            where(field, _op, value) {
                this.filter = [field, value];
                return this;
            },
            orderBy() {
                return this;
            },
            limit() {
                return this;
            },
            async get() {
                reads.push(name);
                return {
                    docs: [...values]
                        .filter(
                            ([key, row]) =>
                                key.startsWith(name + '/') &&
                                (!this.filter ||
                                    row[this.filter[0]] === this.filter[1])
                        )
                        .map(([key, row]) => ({
                            id: key.split('/')[1],
                            data: () => row,
                        })),
                };
            },
            doc(id) {
                return { path: name + '/' + id };
            },
        };
        return query;
    };
    return {
        values,
        reads,
        collection,
        async runTransaction(fn) {
            return fn({
                get: async (ref) => ({
                    exists: values.has(ref.path),
                    data: () => values.get(ref.path),
                }),
                set(ref, row) {
                    values.set(ref.path, row);
                },
            });
        },
    };
}
const response = () => ({
    headers: {},
    setHeader(key, value) {
        this.headers[key] = value;
    },
    status(value) {
        this.code = value;
        return this;
    },
    json(value) {
        this.body = value;
        return this;
    },
});
test('only evidence-matched decisions can be approved; amendments stay pending verification', () => {
    assert.equal(validateDecision(body, dataset).approved.underlying, 'AAPL');
    assert.throws(
        () => validateDecision({ ...body, underlying: 'AMD' }, dataset),
        /공식/
    );
    assert.throws(
        () => validateDecision({ ...body, datasetRevision: 'old' }, dataset),
        /변경/
    );
    assert.equal(
        validateDecision(
            { ...body, action: 'amend', underlying: 'AMD' },
            dataset
        ).status,
        'needs-verification'
    );
});
test('admin checks precede database reads and unverified accounts are rejected', async () => {
    const db = fakeDb(),
        res = response();
    await metadataReviewHandler({
        verify: async () => ({ ...claims, email_verified: false }),
        database: () => db,
        dataset,
    })({ method: 'GET' }, res);
    assert.equal(res.code, 403);
    assert.equal(db.reads.length, 0);
});
test('reviews keep append-only history, idempotency, and optimistic concurrency', async () => {
    const db = fakeDb(),
        handler = metadataReviewHandler({
            verify: async () => claims,
            database: () => db,
            dataset,
        });
    for (let i = 0; i < 2; i++) {
        const res = response();
        await handler({ method: 'POST', body }, res);
        assert.equal(res.code, 200);
        assert.equal(res.body.revision, 1);
    }
    assert.equal(db.values.size, 2);
    const stale = response();
    await handler(
        { method: 'POST', body: { ...body, requestId: 'test-request-00002' } },
        stale
    );
    assert.equal(stale.code, 409);
    const reused = response();
    await handler(
        {
            method: 'POST',
            body: { ...body, note: '다른 내용으로 요청을 재사용합니다.' },
        },
        reused
    );
    assert.equal(reused.code, 409);
    const res = response();
    await handler({ method: 'GET' }, res);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(res.body.history.length, 1);
    assert.equal(res.body.history[0].actor, undefined);
});
test('public approved export shares concurrent reads and never exposes notes or reviewer identifiers', async () => {
    const db = fakeDb();
    db.values.set('metadataReviews/AAPY', {
        ...validateDecision(body, dataset),
        revision: 1,
        actor: 'secret-uid',
        note: 'private review note',
    });
    const handler = metadataReviewHandler({
        verify: async () => {
            throw Error('should not authenticate public market metadata');
        },
        database: () => db,
        dataset,
    });
    const a = response(),
        b = response();
    await Promise.all([
        handler({ method: 'GET', query: { action: 'export' } }, a),
        handler({ method: 'GET', query: { action: 'export' } }, b),
    ]);
    assert.equal(db.reads.length, 1);
    assert.equal(a.body.decisions[0].approved.underlying, 'AAPL');
    assert.ok(!JSON.stringify(a.body).includes('secret-uid'));
    assert.ok(!JSON.stringify(a.body).includes('private review note'));
});
