import assert from 'node:assert/strict';
import test from 'node:test';
import {
    stockFeedbackHandler,
    validateFeedback,
} from '../lib/stock-feedback.js';

class Snapshot {
    constructor(id, value) {
        this.id = id;
        this.value = value;
        this.exists = value !== undefined;
    }
    data() {
        return this.value;
    }
}

function database() {
    const collections = new Map();
    const bucket = (name) => {
        if (!collections.has(name)) collections.set(name, new Map());
        return collections.get(name);
    };
    const ref = (name, id) => ({
        name,
        id,
        async get() {
            return new Snapshot(id, bucket(name).get(id));
        },
        async update(value) {
            bucket(name).set(id, { ...bucket(name).get(id), ...value });
        },
    });
    return {
        collections,
        collection(name) {
            return {
                doc: (id) => ref(name, id),
                orderBy() {
                    return this;
                },
                limit() {
                    return this;
                },
                async get() {
                    const docs = [...bucket(name)]
                        .map(([id, value]) => new Snapshot(id, value))
                        .sort((a, b) =>
                            String(b.data().createdAt).localeCompare(
                                String(a.data().createdAt)
                            )
                        );
                    return { docs };
                },
            };
        },
        async runTransaction(callback) {
            return callback({
                get: (target) => target.get(),
                set: (target, value) =>
                    bucket(target.name).set(target.id, value),
            });
        },
    };
}

function response() {
    return {
        code: 0,
        payload: null,
        headers: {},
        setHeader(name, value) {
            this.headers[name] = value;
        },
        status(code) {
            this.code = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        },
    };
}

const requestId = (index) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const body = (index = 1) => ({
    symbol: 'AAPL',
    category: 'question',
    message: '배당 정보 확인을 부탁드립니다.',
    requestId: requestId(index),
    pageUrl: 'https://example.test/stock/AAPL?tab=details',
    website: '',
});

test('feedback validation rejects traps and malformed public input', () => {
    assert.throws(() => validateFeedback({ ...body(), website: 'spam' }));
    assert.throws(() => validateFeedback({ ...body(), message: '짧음' }));
    assert.throws(() => validateFeedback({ ...body(), category: 'invalid' }));
});

test('anonymous feedback is idempotent, rate limited and privately managed', async () => {
    const db = database();
    let time = Date.parse('2026-10-21T00:00:00Z');
    const handler = stockFeedbackHandler({
        database: () => db,
        verify: async (req) => req.claims,
        salt: () => 'test-salt',
        now: () => new Date(time),
    });
    const post = async (index, origin = 'http://localhost:5173') => {
        const res = response();
        await handler(
            {
                method: 'POST',
                headers: {
                    origin,
                    'x-forwarded-for': '203.0.113.7',
                },
                body: body(index),
            },
            res
        );
        return res;
    };

    assert.equal((await post(1)).code, 201);
    assert.equal((await post(1)).payload.duplicate, true);
    assert.equal((await post(2)).code, 201);
    assert.equal((await post(3)).code, 201);
    assert.equal((await post(4)).code, 429);
    assert.equal((await post(5, 'https://attacker.test')).code, 403);
    assert.equal(db.collections.get('stockFeedback').size, 3);
    assert.equal(
        db.collections.get('stockFeedback').get(requestId(1)).pageUrl,
        'http://localhost:5173/stock/AAPL'
    );

    time += 600_001;
    assert.equal((await post(5)).code, 201);

    const denied = response();
    await handler(
        { method: 'GET', headers: {}, claims: { email: 'user@example.test' } },
        denied
    );
    assert.equal(denied.code, 403);

    const adminClaims = {
        uid: 'admin',
        email: 'jomalkeun@gmail.com',
        email_verified: true,
    };
    const listed = response();
    await handler({ method: 'GET', headers: {}, claims: adminClaims }, listed);
    assert.equal(listed.code, 200);
    assert.equal(listed.payload.feedback.length, 4);

    const updated = response();
    await handler(
        {
            method: 'PATCH',
            headers: {},
            claims: adminClaims,
            body: {
                id: requestId(1),
                status: 'resolved',
                internalNote: '확인 완료',
            },
        },
        updated
    );
    assert.equal(updated.code, 200);
    assert.equal(
        db.collections.get('stockFeedback').get(requestId(1)).status,
        'resolved'
    );
});
