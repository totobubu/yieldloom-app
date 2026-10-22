import test from 'node:test';
import assert from 'node:assert/strict';
import { createTickerSnapshotStore } from '../lib/r2-snapshot.js';

function fixture() {
    let clock = 0;
    const calls = [];
    const objects = new Map();
    let failWrite = false;
    const storage = {
        async send(command) {
            const { Key, Body } = command.input;
            calls.push(command.constructor.name);
            if (Body !== undefined) {
                // Model a committed write with a lost response, too.
                objects.set(Key, Body);
                if (failWrite) throw new Error('timeout');
                return {};
            }
            if (!objects.has(Key))
                throw Object.assign(new Error('missing'), {
                    name: 'NoSuchKey',
                });
            return {
                Body: { transformToString: async () => objects.get(Key) },
            };
        },
    };
    const store = createTickerSnapshotStore({
        getStorage: () => storage,
        getBucket: () => 'fixture',
        now: () => clock,
    });
    return {
        store,
        calls,
        tick: (ms) => {
            clock += ms;
        },
        fail: (value) => {
            failWrite = value;
        },
    };
}

test('ten concurrent and repeated identical snapshots perform one PUT; changes and expiry persist', async () => {
    const f = fixture();
    await Promise.all(
        Array.from({ length: 10 }, () => f.store.write('AAA', { price: 100 }))
    );
    await f.store.write('aaa', { price: 100 });
    assert.equal(f.calls.length, 1);
    await f.store.write('AAA', { price: 101 });
    f.tick(300001);
    await f.store.write('AAA', { price: 101 });
    assert.equal(f.calls.length, 3);
});

test('A then B then A preserve write order, including queued writes', async () => {
    const f = fixture();
    await Promise.all(
        [100, 101, 100].map((price) => f.store.write('AAA', { price }))
    );
    assert.equal(f.calls.length, 3);
    assert.equal((await f.store.read('AAA')).value.price, 100);
});

test('read sharing, missing snapshots and write invalidation avoid repeated GETs', async () => {
    const f = fixture();
    assert.deepEqual(
        await Promise.all([f.store.read('AAA'), f.store.read('AAA')]),
        [null, null]
    );
    assert.equal(f.calls.length, 1);
    await f.store.write('AAA', { price: 100 });
    const a = await f.store.read('AAA');
    a.value.price = 0;
    assert.equal((await f.store.read('AAA')).value.price, 100);
    assert.deepEqual(f.calls, [
        'GetObjectCommand',
        'PutObjectCommand',
        'GetObjectCommand',
    ]);
    f.tick(30001);
    await f.store.read('AAA');
    assert.equal(f.calls.length, 4);
});

test('failed or ambiguous writes are retried and cannot reuse an older success', async () => {
    const f = fixture();
    await f.store.write('AAA', { price: 100 });
    f.fail(true);
    await assert.rejects(f.store.write('AAA', { price: 101 }), /timeout/);
    f.fail(false);
    await f.store.write('AAA', { price: 100 });
    assert.equal((await f.store.read('AAA')).value.price, 100);
    assert.equal(f.calls.filter((c) => c === 'PutObjectCommand').length, 3);
});

test('transient read failures are not retained', async () => {
    let calls = 0;
    const store = createTickerSnapshotStore({
        getStorage: () => ({
            async send() {
                if (++calls === 1) throw new Error('unavailable');
                return {
                    Body: { transformToString: async () => '{"value":1}' },
                };
            },
        }),
        getBucket: () => 'fixture',
    });
    await assert.rejects(store.read('AAA'), /unavailable/);
    assert.deepEqual(await store.read('AAA'), { value: 1 });
    assert.equal(calls, 2);
});

test('bucket boundaries and bounded write history require independent persistence', async () => {
    let bucket = 'first';
    let calls = 0;
    const storage = {
        send: async () => {
            calls++;
            return {};
        },
    };
    const store = createTickerSnapshotStore({
        getStorage: () => storage,
        getBucket: () => bucket,
        maxEntries: 1,
    });
    await store.write('AAA', { price: 1 });
    bucket = 'second';
    await store.write('AAA', { price: 1 });
    bucket = 'first';
    await store.write('AAA', { price: 1 });
    assert.equal(calls, 3);
});

test('an old read finishing after a write cannot refill the read cache', async () => {
    let release;
    let gets = 0;
    const storage = {
        async send(command) {
            if (command.input.Body !== undefined) return {};
            gets++;
            if (gets === 1)
                await new Promise((resolve) => {
                    release = resolve;
                });
            return {
                Body: {
                    transformToString: async () =>
                        JSON.stringify({ value: gets === 1 ? 'old' : 'new' }),
                },
            };
        },
    };
    const store = createTickerSnapshotStore({
        getStorage: () => storage,
        getBucket: () => 'fixture',
    });
    const old = store.read('AAA');
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await store.write('AAA', { value: 'new' });
    release();
    assert.deepEqual(await old, { value: 'old' });
    assert.deepEqual(await store.read('AAA'), { value: 'new' });
    assert.equal(gets, 2);
});
