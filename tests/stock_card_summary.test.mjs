import test from 'node:test';
import assert from 'node:assert/strict';
import { stockCardSummary } from '../lib/stock-card-summary.js';
test('missing dividends show listing and cadence without claiming no dividends', () => {
    const card = stockCardSummary({
        symbol: 'VBIL',
        company: 'Vanguard',
        ipoDate: '2025-02-12',
        frequency: 'monthly',
        currency: 'USD',
    });
    assert.equal(card.primaryValue, '2025-02-12');
    assert.equal(card.secondaryValue, '매월');
    assert.equal(card.status, '배당 자료 미확인');
});
test('non-payers use trading currency even when old cadence is present', () => {
    const card = stockCardSummary({
        symbol: 'AAAU',
        company: 'Goldman Sachs',
        noDividends: true,
        frequency: 'monthly',
        currency: 'USD',
    });
    assert.equal(card.primaryValue, 'ETF');
    assert.equal(card.secondaryValue, 'USD');
    assert.equal(card.status, '무배당 상품');
});
