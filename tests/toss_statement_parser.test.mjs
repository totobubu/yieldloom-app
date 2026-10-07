import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTossStatementText } from '../src/services/recovery/localStatementParser.js';

test('uses the KRW settlement column instead of the trailing balance', () => {
    const [entry] = parseTossStatementText(
        '2025.05.07 구매 테스트 ETF (US0000000001) 1,426.60 2.000000 5,000 2,500 10 0 0 2.000000 50,000 ($ 3.50)'
    );

    assert.equal(entry.kind, 'buy');
    assert.equal(entry.currency, 'KRW');
    assert.equal(entry.krwAmount, 5_000);
    assert.equal(entry.feeKrw, 10);
    assert.equal(entry.taxKrw, 0);
    assert.equal(entry.actualFxRate, 1426.6);
    assert.equal(entry.reviewStatus, 'needs_review');
});

test('keeps dividend tax debits separate from dividend income', () => {
    const entries = parseTossStatementText(
        [
            '2025.05.07 외화증권배당금입금 테스트 ETF 1,426.60 1.111861 798 798 0 0 142 0 0 13,780',
            '2025.05.08 배당세출금 테스트 ETF 1,426.60 1.000000 142 142 0 0 0 0 0 13,638',
        ].join(' ')
    );

    assert.equal(entries.length, 2);
    assert.equal(entries[0].kind, 'dividend');
    assert.equal(entries[0].krwAmount, 798);
    assert.equal(entries[0].taxKrw, null);
    assert.equal(entries[1].kind, 'tax');
    assert.equal(entries[1].reviewStatus, 'needs_review');
});

test('does not infer a cash amount when no settlement table is present', () => {
    const [entry] = parseTossStatementText(
        '2025.05.07 오픈뱅킹입금 연결 계좌 거래 내역'
    );

    assert.equal(entry.kind, 'deposit');
    assert.equal(entry.krwAmount, null);
    assert.equal(entry.actualFxRate, null);
});
