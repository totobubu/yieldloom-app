import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetLedgerClient } from '../src/services/sheetLedger.js';

const user = { getIdToken: async () => 'synthetic-token' };
const ok = (payload = { rows: [], version: 0 }) => ({
    ok: true,
    status: 200,
    json: async () => payload,
});
test('concurrent ledger reads share a request; mutations are not suppressed', async () => {
    let resolve,
        calls = 0;
    const client = createSheetLedgerClient({
        fetchImpl: async () => {
            calls++;
            return new Promise((r) => {
                resolve = r;
            });
        },
    });
    const first = client.load(user),
        second = client.load(user);
    assert.equal(first, second);
    await Promise.resolve();
    resolve(ok());
    await first;
    assert.equal(calls, 1);
    const mutation = client.mutate(user, 'POST', { action: 'commit' });
    await Promise.resolve();
    resolve(ok());
    await mutation;
    assert.equal(calls, 2);
});
test('timeout, non-JSON, malformed preview and Google expiration produce visible actionable errors', async () => {
    const timed = createSheetLedgerClient({
        timeoutMs: 10,
        fetchImpl: async (_url, { signal }) =>
            new Promise((_resolve, reject) => {
                // Keep the event loop alive while testing AbortSignal.timeout's unref timer.
                const timer = setTimeout(
                    () => reject(new Error('timeout did not fire')),
                    1000
                );
                signal.addEventListener(
                    'abort',
                    () => {
                        clearTimeout(timer);
                        reject(signal.reason);
                    },
                    { once: true }
                );
            }),
    });
    await assert.rejects(timed.load(user), /응답 시간이 초과/);
    const html = createSheetLedgerClient({
        fetchImpl: async () => ({
            ok: false,
            status: 504,
            json: async () => {
                throw Error('html');
            },
        }),
    });
    await assert.rejects(html.load(user), /서버 응답을 읽지 못/);
    const malformed = createSheetLedgerClient({ fetchImpl: async () => ok() });
    await assert.rejects(
        malformed.mutate(user, 'POST', { action: 'preview' }),
        /분석 결과를 읽지 못/
    );
    const expired = createSheetLedgerClient({
        fetchImpl: async () => ({
            ok: false,
            status: 401,
            json: async () => ({
                error: 'expired',
                code: 'google_reconnect_required',
            }),
        }),
    });
    await assert.rejects(
        expired.mutate(user, 'POST', { action: 'preview' }),
        (e) => e.status === 401 && e.code === 'google_reconnect_required'
    );
});
