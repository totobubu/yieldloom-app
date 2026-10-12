import test from 'node:test';
import assert from 'node:assert/strict';
import { getTossConnectionStatus } from '../src/services/tossConnection.js';

test('reads only the server-provided Toss connection readiness state', async () => {
    let request;
    const status = await getTossConnectionStatus(
        { getIdToken: async () => 'member-token' },
        async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ provider: 'toss', mode: 'read_only', enabled: false, status: 'awaiting_customer_oauth' }) };
        },
    );
    assert.equal(request.url, '/api/toss-connection');
    assert.equal(request.options.headers.Authorization, 'Bearer member-token');
    assert.equal(status.enabled, false);
    assert.equal(status.mode, 'read_only');
});
