import test from 'node:test';
import assert from 'node:assert/strict';
import { tracePrincipalPolicy } from '../lib/principal-funding-policy.js';
import { principalPolicyPreview } from '../src/services/principalPolicyPreview.js';
const event = (id, at, kind, amount, more = {}) => ({
    id,
    at,
    kind,
    amount,
    accountId: 'a',
    currency: 'USD',
    source: 'synthetic-adopted-pdf',
    ...more,
});
const complete = [
    {
        accountId: 'a',
        currency: 'USD',
        complete: true,
        openingVerified: true,
        openingPrincipal: '0',
        openingDividend: '0',
    },
];
const trace = (events, coverage = complete) =>
    tracePrincipalPolicy({ events, coverage });
test('dividend FIFO reinvestment consumes oldest dividends; withdrawal uses remaining dividend then known principal', () => {
    const r = trace([
        event('deposit', '2026-01-01', 'deposit', '1000'),
        event('div1', '2026-01-02', 'dividend', '60'),
        event('div2', '2026-01-03', 'dividend', '40'),
        event('buy', '2026-01-04', 'buy', '70', {
            symbol: 'TEST',
            quantity: '7',
        }),
        event('withdraw', '2026-01-05', 'withdrawal', '80'),
    ]);
    assert.deepEqual(r.rows[3].evidence, [
        { id: 'div1', source: 'dividend', amount: '60' },
        { id: 'div2', source: 'dividend', amount: '10' },
    ]);
    assert.deepEqual(r.rows[4].parts, {
        dividend: '30',
        principal: '50',
        unknown: '0',
    });
    assert.equal(r.accounts[0].remainingPrincipal, '950');
    assert.equal(r.readOnly, true);
});
test('principal-funded stock gains/losses enter principal, never dividend; FIFO partial sale uses acquisition basis', () => {
    const r = trace([
        event('D', '2026-01-01', 'deposit', '100'),
        event('B', '2026-01-02', 'buy', '100', {
            symbol: 'TEST',
            quantity: '10',
        }),
        event('S1', '2026-01-03', 'sell', '60', {
            symbol: 'TEST',
            quantity: '5',
        }),
        event('S2', '2026-01-04', 'sell', '40', {
            symbol: 'TEST',
            quantity: '5',
        }),
        event('W', '2026-01-05', 'withdrawal', '30'),
    ]);
    assert.equal(r.rows[2].cost, '50');
    assert.equal(r.rows[2].realizedPnl, '10');
    assert.equal(r.rows[3].realizedPnl, '-10');
    assert.equal(r.accounts[0].knownRealizedPnl, '0');
    assert.equal(r.accounts[0].remainingPrincipal, '70');
    assert.equal(r.accounts[0].dividendWithdrawn, '0');
});
test('dividend-funded sale is held for rule clarification; missing lots/settlement and unmatched FX never become principal', () => {
    for (const events of [
        [
            event('D', '2026-01-01', 'dividend', '10'),
            event('B', '2026-01-02', 'buy', '10', {
                symbol: 'TEST',
                quantity: '1',
            }),
            event('S', '2026-01-03', 'sell', '12', {
                symbol: 'TEST',
                quantity: '1',
            }),
        ],
        [
            event('S', '2026-01-03', 'sell', '12', {
                symbol: 'TEST',
                quantity: '1',
            }),
        ],
        [event('X', '2026-01-03', 'exchange', '100')],
        [event('D', '2026-01-03', 'dividend', '', { unverified: true })],
    ]) {
        const r = trace(events);
        assert.equal(r.accounts[0].remainingPrincipal, null);
        assert.equal(r.rows.at(-1).manualNeeded, true);
    }
});
test('only unresolved remainder is manual; existing confirmed splits survive different automatic policy', () => {
    const r = trace([
        event('D', '2026-01-01', 'deposit', '5'),
        event('DIV', '2026-01-02', 'dividend', '2'),
        event('W', '2026-01-03', 'withdrawal', '10'),
    ]);
    assert.deepEqual(r.rows[2].parts, {
        dividend: '2',
        principal: '5',
        unknown: '3',
    });
    assert.equal(r.rows[2].manualNeeded, true);
    assert.equal(r.accounts[0].remainingPrincipal, null);
    const manual = trace([
        event('D', '2026-01-01', 'deposit', '20'),
        event('DIV', '2026-01-02', 'dividend', '10'),
        event('W', '2026-01-03', 'withdrawal', '5', {
            manualParts: { dividend: '0', principal: '5', unknown: '0' },
        }),
    ]);
    assert.equal(manual.rows[2].mode, 'manual_preserved');
    assert.equal(manual.rows[2].parts.principal, '5');
    assert.equal(manual.accounts[0].remainingPrincipal, '15');
    const insufficient = trace([
        event('D', '2026-01-01', 'deposit', '1'),
        event('W', '2026-01-02', 'withdrawal', '10', {
            manualParts: { principal: '10', dividend: '0', unknown: '0' },
        }),
    ]);
    assert.equal(insufficient.rows[1].parts.principal, '10');
    assert.equal(insufficient.rows[1].evidenceIncomplete, true);
    assert.equal(insufficient.accounts[0].remainingPrincipal, null);
});
test('currencies/accounts, exact decimals, duplicate source IDs, ambiguous time and unknown coverage stay separate', () => {
    const d = event(
        'D',
        '2026-01-01',
        'deposit',
        '0.1234567890123456789012345678'
    );
    const r = trace([
        d,
        { ...d },
        event(
            'W',
            '2026-01-02',
            'withdrawal',
            '0.0234567890123456789012345678'
        ),
        event('OTHER', '2026-01-01', 'withdrawal', '10', { currency: 'KRW' }),
    ]);
    assert.equal(r.accounts[0].remainingPrincipal, '0.1');
    assert.equal(r.duplicates.length, 1);
    assert.equal(r.accounts[1].remainingPrincipal, null);
    assert.equal(trace([d], []).accounts[0].remainingPrincipal, null);
    assert.equal(
        trace([d, { ...d, amount: '1' }]).accounts[0].remainingPrincipal,
        null
    );
    const ambiguous = trace([
        event('D', '2026-01-01', 'deposit', '20'),
        event('W', '2026-01-01', 'withdrawal', '10'),
    ]);
    assert.equal(ambiguous.accounts[0].remainingPrincipal, null);
    assert.match(ambiguous.rows[0].reason, /실제 순서/);
});
test('capital adapter preserves source/manual choices; API observations and duplicate cash dividends are not added as trades', () => {
    const state = {
        entries: [
            {
                id: 'D',
                date: '20260101',
                amount: 100,
                currency: 'USD',
                source: 'toss-pdf',
            },
            { id: 'C', date: '20260102', amount: 10, currency: 'USD' },
            { id: 'W', date: '20260103', amount: 10, currency: 'USD' },
        ],
        classifications: [
            { id: 'D', classification: 'external_deposit' },
            { id: 'C', classification: 'dividend' },
            { id: 'W', classification: 'principal_withdrawal' },
        ],
        trades: [],
        apiObservations: [{ original: { orderId: 'not-adopted' } }],
    };
    const original = structuredClone(state),
        result = principalPolicyPreview(state, 'a');
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0].source, 'toss-pdf');
    assert.equal(result.rows.at(-1).mode, 'manual_preserved');
    assert.equal(result.rows[1].manualNeeded, true);
    assert.equal(result.accounts[0].remainingPrincipal, null);
    assert.deepEqual(state, original);
});
