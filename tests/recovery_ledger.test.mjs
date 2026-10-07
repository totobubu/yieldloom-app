import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFundingPreview,
    calculateRecoverySummary,
} from '../src/services/recovery/ledgerEngine.js';

const applied = (entry) => ({ reviewStatus: 'applied', currency: 'KRW', ...entry });

test('recovery counts net income once and excludes sale principal', () => {
    const summary = calculateRecoverySummary([
        applied({ occurredAt: '2024-01-01', kind: 'deposit', krwAmount: 1_000_000 }),
        applied({ occurredAt: '2024-02-01', kind: 'dividend', krwAmount: 20_000, taxKrw: 3_000 }),
        applied({ occurredAt: '2024-03-01', kind: 'sell', krwAmount: 500_000 }),
        applied({ occurredAt: '2024-04-01', kind: 'withdrawal', krwAmount: 100_000 }),
    ]);

    assert.equal(summary.externalContributionsKrw, 1_000_000);
    assert.equal(summary.netIncomeKrw, 17_000);
    assert.equal(summary.externalWithdrawalsKrw, 100_000);
    assert.equal(summary.incomeRecoveryRate, 0.017);
});

test('funding consumes dividend cash before sale proceeds and principal', () => {
    const rows = buildFundingPreview([
        applied({ occurredAt: '2024-01-01', kind: 'deposit', krwAmount: 1_000 }),
        applied({ occurredAt: '2024-01-02', kind: 'dividend', krwAmount: 100 }),
        applied({ occurredAt: '2024-01-03', kind: 'sell', krwAmount: 200 }),
        applied({ occurredAt: '2024-01-04', kind: 'buy', krwAmount: 250 }),
    ]);

    assert.deepEqual(rows[0].funding, { income: 100, proceeds: 150 });
    assert.equal(rows[0].unreconciledKrw, 0);
});

test('USD entries without a supplied settlement rate are flagged', () => {
    const summary = calculateRecoverySummary([
        { reviewStatus: 'applied', occurredAt: '2024-01-01', kind: 'deposit', currency: 'KRW', krwAmount: 1_000 },
        { reviewStatus: 'applied', occurredAt: '2024-01-02', kind: 'dividend', currency: 'USD', usdAmount: 10 },
    ]);
    assert.equal(summary.missingFxCount, 1);
    assert.equal(summary.netIncomeKrw, 0);
});
