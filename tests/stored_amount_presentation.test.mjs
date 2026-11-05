import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStoredAmount } from '../src/utils/formatStoredAmount.js';
test('stored money display distinguishes an actual zero from absent, blank and invalid values', () => {
    assert.equal(formatStoredAmount(0, 'USD'), '$0.00');
    for (const missing of [null, undefined, '', NaN, Infinity])
        assert.equal(formatStoredAmount(missing, 'USD'), '미확인');
});
test('stored money display preserves original currency and up to eight decimal places without conversion', () => {
    assert.equal(formatStoredAmount(190000, 'KRW'), '₩190,000');
    assert.equal(formatStoredAmount('0.12345678', 'USD'), '$0.12345678');
    assert.equal(formatStoredAmount(1430, 'USD'), '$1,430.00');
    assert.equal(formatStoredAmount(1430, 'EUR'), '€1,430.00');
});
test('a non-ISO or missing currency stays explicit and cannot become USD or KRW', () => {
    assert.equal(formatStoredAmount(1.25, 'UNKNOWN'), '1.25 UNKNOWN');
    assert.equal(formatStoredAmount(1.25), '1.25 통화 미확인');
});
