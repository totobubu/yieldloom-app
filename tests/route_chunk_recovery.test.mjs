import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clearRouteChunkRecovery,
    isDynamicImportError,
    recoverRouteChunk,
} from '../src/services/routeChunkRecovery.js';

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
}

test('recognizes browser dynamic import failures', () => {
    assert.equal(
        isDynamicImportError(
            new TypeError(
                'Failed to fetch dynamically imported module: /assets/LegalView-old.js'
            )
        ),
        true
    );
    assert.equal(isDynamicImportError(new Error('permission denied')), false);
});

test('reloads once per route until navigation succeeds', () => {
    const storage = memoryStorage();
    let reloads = 0;
    const error = new Error('Importing a module script failed');
    const options = { storage, reload: () => reloads++ };

    assert.equal(recoverRouteChunk(error, '/legal', options), true);
    assert.equal(recoverRouteChunk(error, '/legal', options), false);
    assert.equal(reloads, 1);

    clearRouteChunkRecovery('/legal', storage);
    assert.equal(recoverRouteChunk(error, '/legal', options), true);
    assert.equal(reloads, 2);
});

test('does not reload for unrelated router errors', () => {
    let reloads = 0;
    assert.equal(
        recoverRouteChunk(new Error('network request failed'), '/legal', {
            storage: memoryStorage(),
            reload: () => reloads++,
        }),
        false
    );
    assert.equal(reloads, 0);
});
