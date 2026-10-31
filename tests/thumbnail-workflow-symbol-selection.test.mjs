import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SYMBOLS, resolveSymbols } from '../scripts/thumbnail_pipeline/resolve-symbols.mjs';

test('empty and whitespace values use the reviewed default', () => {
    assert.equal(resolveSymbols({ eventName: 'schedule' }), DEFAULT_SYMBOLS);
    assert.equal(resolveSymbols({ configuredSymbols: '   \t\n', eventName: 'schedule' }), DEFAULT_SYMBOLS);
});

test('repository ALL stays bounded for scheduled and blank manual runs', () => {
    assert.equal(resolveSymbols({ configuredSymbols: 'ALL', eventName: 'schedule' }), DEFAULT_SYMBOLS);
    assert.equal(resolveSymbols({ inputSymbols: '   ', configuredSymbols: 'ALL', eventName: 'workflow_dispatch' }), DEFAULT_SYMBOLS);
});

test('only an explicit manual ALL requests the full refresh, case-insensitively', () => {
    assert.equal(resolveSymbols({ inputSymbols: 'ALL', configuredSymbols: 'TSLY', eventName: 'workflow_dispatch' }), 'ALL');
    assert.equal(resolveSymbols({ inputSymbols: ' all ', configuredSymbols: 'TSLY', eventName: 'workflow_dispatch' }), 'ALL');
});

test('manual ticker lists override repository settings and normalize safely', () => {
    assert.equal(resolveSymbols({ inputSymbols: ' tsly, AAPL ', configuredSymbols: 'ALL', eventName: 'workflow_dispatch' }), 'TSLY,AAPL');
});

test('blank manual input uses a configured ticker list', () => {
    assert.equal(resolveSymbols({ inputSymbols: '', configuredSymbols: 'tsly, aapl', eventName: 'workflow_dispatch' }), 'TSLY,AAPL');
});

test('scheduled runs never use dispatch-only full refresh semantics', () => {
    assert.equal(resolveSymbols({ inputSymbols: 'ALL', configuredSymbols: 'ALL', eventName: 'schedule' }), DEFAULT_SYMBOLS);
});
