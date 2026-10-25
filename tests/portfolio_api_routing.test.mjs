import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import admin from 'firebase-admin';
import handler from '../api/portfolio-capital.js';

const app = admin.initializeApp({ projectId: 'portfolio-routing-test' });
const auth = admin.auth(app);
const db = admin.firestore(app);
const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url))
);
const sheetRewrite = config.rewrites.find(
    (rule) => rule.source === '/api/sheet-ledger'
);
let claims, reads, writes, verifications;

beforeEach((t) => {
    claims = {
        uid: 'routing-admin',
        email: 'jomalkeun@gmail.com',
        email_verified: true,
    };
    reads = [];
    writes = [];
    verifications = [];
    t.mock.method(auth, 'verifyIdToken', async (_token, checkRevoked) => {
        verifications.push(checkRevoked);
        return claims;
    });
    const query = (path) => ({
        async get() {
            reads.push(path);
            return { docs: [] };
        },
        doc: (id) => ({ path: `${path}/${id}` }),
        orderBy() {
            return this;
        },
        startAt() {
            return this;
        },
        endAt() {
            return this;
        },
    });
    t.mock.method(db, 'collection', query);
    t.mock.method(db, 'collectionGroup', query);
    t.mock.method(db, 'doc', (path) => ({ path }));
    t.mock.method(db, 'runTransaction', async (fn) =>
        fn({
            async get(ref) {
                reads.push(ref.path);
                return { exists: false, data: () => undefined };
            },
            set: (...args) => writes.push(args),
        })
    );
    t.mock.method(console, 'info', () => {});
});
after(() => app.delete());

async function invoke(url, { method = 'GET', body, token = true } = {}) {
    const requestUrl = new URL(url, 'https://example.test');
    // Exercise the destination configured for the public compatibility URL.
    if (requestUrl.pathname === sheetRewrite.source) {
        const destination = new URL(sheetRewrite.destination, requestUrl);
        requestUrl.pathname = destination.pathname;
        for (const [key, value] of destination.searchParams)
            requestUrl.searchParams.set(key, value);
    }
    const res = {
        headers: {},
        setHeader(key, value) {
            this.headers[key] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        },
        end() {
            return this;
        },
    };
    await handler(
        {
            method,
            url: requestUrl.pathname + requestUrl.search,
            query: Object.fromEntries(requestUrl.searchParams),
            headers: {
                origin: 'http://localhost:5173',
                ...(token && { authorization: 'Bearer test-token' }),
            },
            body,
        },
        res
    );
    return res;
}

test('the compatibility URL reads only the sheet ledger, once, with private CORS', async () => {
    const res = await invoke('/api/sheet-ledger?accountId=unrelated');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.rows, []);
    assert.equal(res.payload.version, 0);
    assert.deepEqual(reads, ['sheetTrialLedgers/routing-admin']);
    assert.deepEqual(writes, []);
    assert.deepEqual(verifications, [false]);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(
        res.headers['Access-Control-Allow-Origin'],
        'http://localhost:5173'
    );
});

test('POST and PATCH reach sheet validation without capital writes or body changes', async () => {
    const body = {
        version: 99,
        id: 'missing-row',
        patch: { commissionUsd: 1 },
    };
    const res = await invoke('/api/sheet-ledger', { method: 'PATCH', body });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(body, {
        version: 99,
        id: 'missing-row',
        patch: { commissionUsd: 1 },
    });
    const invalid = await invoke('/api/sheet-ledger', {
        method: 'POST',
        body: { action: 'invalid' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.payload.error, /가져오기 작업/);
    assert.deepEqual(reads, Array(2).fill('sheetTrialLedgers/routing-admin'));
    assert.deepEqual(writes, []);
    assert.deepEqual(verifications, [false, false]);
});

test('anonymous and non-admin requests are denied before any database access', async () => {
    assert.equal(
        (await invoke('/api/sheet-ledger', { token: false })).statusCode,
        401
    );
    claims.email = 'member@example.test';
    assert.equal((await invoke('/api/sheet-ledger')).statusCode, 403);
    assert.equal(
        (await invoke('/api/portfolio-capital?view=sheet-ledger')).statusCode,
        403
    );
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
});

test('preflight skips auth and all database work', async () => {
    const res = await invoke('/api/sheet-ledger', {
        method: 'OPTIONS',
        token: false,
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(verifications, []);
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
});

test('capital and dashboard retain their responses and revocation checks', async () => {
    const capital = await invoke('/api/portfolio-capital');
    assert.equal(capital.statusCode, 200);
    assert.deepEqual(capital.payload.entries, []);
    const dashboard = await invoke('/api/portfolio-capital?view=dashboard');
    assert.equal(dashboard.statusCode, 200);
    assert.deepEqual(dashboard.payload.assets, []);
    assert.deepEqual(verifications, [true, true]);
    assert(!reads.some((path) => path.startsWith('sheetTrialLedgers')));
    assert.deepEqual(writes, []);
});

test('the compatibility rewrite does not add a thirteenth API entrypoint', () => {
    assert.equal(
        sheetRewrite.destination,
        '/api/portfolio-capital?view=sheet-ledger'
    );
    const api = new URL('../api/', import.meta.url);
    const files = readdirSync(api);
    assert(!files.includes('sheet-ledger.js'));
    const entrypoints = files.filter(
        (file) =>
            file.endsWith('.js') ||
            (file.endsWith('.py') &&
                /^app\s*=\s*Flask\(/m.test(
                    readFileSync(new URL(file, api), 'utf8')
                ))
    );
    assert.equal(entrypoints.length, 12, entrypoints.join(', '));
});
