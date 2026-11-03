import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEntryIncomeEfficiency } from '../src/services/thumbnail/entryIncomeEfficiency.js';
import { reviewedFundLifecycle } from '../lib/fund-lifecycle.js';

const lifecycle = {
    symbol: 'NEW',
    firstTradeDate: '2026-08-03',
    dateMeaning: 'first_trade',
    verificationStatus: 'official_reviewed',
    sourceUrl: 'https://issuer.example/fund/new',
    reviewedAt: '2026-11-03',
};
const newFund = () => ({
    symbol: 'NEW',
    sourceStatus: { dividends: 'official_projection' },
    collectionCoverage: Object.fromEntries(
        ['market-prices', 'dividends'].map((dataset) => [
            dataset,
            {
                complete: true,
                start: '2026-08-03',
                end: '2026-11-03',
                missingIntervals: [],
            },
        ])
    ),
    backtestData: [
        ...['2026-08-03', '2026-09-01', '2026-10-01', '2026-11-02'].map(
            (date) => ({ date, close: 100 })
        ),
        ...['2026-08-15', '2026-09-15', '2026-10-15'].map((date) => ({
            date,
            amount: 1,
            declaredDate: date,
            dividendVerified: true,
        })),
    ],
});

const monthlyRows = () => {
    const rows = [];
    for (let month = 1; month <= 36; month += 1) {
        const date = new Date(Date.UTC(2023, month - 1, 2))
            .toISOString()
            .slice(0, 10);
        rows.push({ date, close: 100 + month, amount: month <= 24 ? 1 : 10 });
    }
    return rows;
};

test('split review blocks calculations with an explicit reason and analysis date', () => {
    const result = calculateEntryIncomeEfficiency(
        {
            backtestData: monthlyRows(),
            sourceStatus: { corporateActionReview: true },
        },
        { asOfDate: '2025-12-31' }
    );
    assert.equal(result.available, false);
    assert.deepEqual(result.samples, []);
    assert.equal(result.asOfDate, '2025-12-31');
    assert.match(result.reason, /분할·병합/);
    assert.match(result.reason, /개인 보유량 조회와는 별개/);
});

test('entry efficiency only uses distributions known before each entry date', () => {
    const rows = monthlyRows();
    rows.push({
        date: '2026-02-02',
        close: 140,
        amount: 999,
        forecasted: true,
    });
    const result = calculateEntryIncomeEfficiency(
        { symbol: 'TEST', backtestData: rows },
        { asOfDate: '2025-12-31' }
    );

    assert.equal(result.available, true);
    assert.equal(result.samples.length, 24);
    const january2025 = result.samples.find(
        (sample) => sample.date === '2025-01-02'
    );
    assert.equal(january2025.preTaxAnnualDividend, 12);
    assert.equal(january2025.afterTaxAnnualDividend, 10.2);
    assert.ok(Math.abs(january2025.afterTaxYield - (10.2 / 125) * 100) < 1e-12);
});

test('entry efficiency prioritizes fixed amounts and selects the first valid monthly close', () => {
    const rows = monthlyRows();
    rows.unshift({ date: '2023-01-01', close: 0, amount: 1 });
    const fixed = rows.find((row) => row.date === '2025-11-02');
    fixed.amountFixed = 20;
    const result = calculateEntryIncomeEfficiency(
        { symbol: 'TEST', backtestData: rows },
        { asOfDate: '2025-12-31' }
    );

    assert.equal(result.available, true);
    assert.equal(result.samples.at(-1).date, '2025-12-02');
    assert.equal(result.samples.at(-1).preTaxAnnualDividend, 121);
});

test('entry efficiency shows limited history when fewer than six qualified entry months exist', () => {
    const rows = monthlyRows().slice(0, 16);
    const result = calculateEntryIncomeEfficiency(
        { symbol: 'SHORT', backtestData: rows },
        { asOfDate: '2024-04-30' }
    );

    assert.equal(result.available, true);
    assert.equal(result.limitedHistory, true);
    assert.equal(result.samples.length, 4);
});

test('insufficient pre-entry history explains collection coverage, not personal ownership', () => {
    const result = calculateEntryIncomeEfficiency(
        { backtestData: monthlyRows().slice(0, 12) },
        { asOfDate: '2023-12-31' }
    );
    assert.equal(result.available, false);
    assert.match(result.reason, /2023-01-02/);
    assert.match(result.reason, /실제 보유 기간과는 별개/);
    assert.equal(result.asOfDate, '2023-12-31');
});

test('verified new funds use launch-to-entry dividends without annualization or payback-year claims', () => {
    const result = calculateEntryIncomeEfficiency(newFund(), {
        asOfDate: '2026-11-03',
        lifecycleEvidence: lifecycle,
    });
    assert.equal(result.available, true);
    assert.equal(result.basis, 'since_launch');
    assert.equal(result.samples.length, 3);
    assert.equal(result.latest.periodStart, '2026-08-03');
    assert.equal(result.latest.periodEnd, '2026-11-01');
    assert.equal(result.latest.preTaxDividend, 3);
    assert.equal(result.latest.afterTaxAnnualDividend, null);
    assert.equal(result.latest.paybackYears, null);
    assert.ok(Math.abs(result.latest.afterTaxYield - 2.55) < 1e-12);
    assert.equal(
        calculateEntryIncomeEfficiency(
            { ...newFund(), fundLifecycle: lifecycle },
            { asOfDate: '2026-11-03' }
        ).latest.preTaxDividend,
        3
    );
});

test('new funds require explicit full interval coverage and official dividend evidence', () => {
    for (const mutate of [
        (t) => {
            t.collectionCoverage = null;
        },
        (t) => {
            t.collectionCoverage.dividends.missingIntervals = [
                { start: '2026-08-04', end: '2026-11-01' },
            ];
        },
        (t) => {
            t.sourceStatus.dividends = 'reference_observations';
        },
        (t) => {
            t.backtestData
                .filter((r) => r.amount)
                .forEach((r) => {
                    delete r.dividendVerified;
                });
        },
        (t) => {
            t.backtestData
                .filter((r) => r.amount)
                .forEach((r) => {
                    delete r.declaredDate;
                });
        },
        (t) => {
            t.backtestData
                .filter((r) => r.amount)
                .forEach((r) => {
                    delete r.dividendVerified;
                    r.verificationStatus = 'needs_review';
                });
        },
    ]) {
        const ticker = newFund();
        mutate(ticker);
        const result = calculateEntryIncomeEfficiency(ticker, {
            asOfDate: '2026-11-03',
            lifecycleEvidence: lifecycle,
        });
        assert.equal(result.available, false);
        assert.deepEqual(result.samples, []);
    }
});

test('late declarations, same-day, forecast and future distributions do not leak into earlier entries', () => {
    const ticker = newFund();
    ticker.backtestData.push(
        { date: '2026-10-16', amount: 999, declaredDate: '2026-11-03' },
        { date: '2026-11-02', amount: 999, declaredDate: '2026-11-01' },
        {
            date: '2026-10-17',
            amount: 999,
            declaredDate: '2026-10-16',
            forecasted: true,
        },
        { date: '2027-01-01', amount: 999, declaredDate: '2026-10-16' }
    );
    const result = calculateEntryIncomeEfficiency(ticker, {
        asOfDate: '2026-11-03',
        lifecycleEvidence: lifecycle,
    });
    assert.equal(result.latest.preTaxDividend, 3);
    assert.equal(result.samples[0].preTaxDividend, 1);
});

test('unknown launch, formation date and recent collection starts cannot establish a new-fund window', () => {
    const ticker = newFund();
    ticker.tickerInfo = { ipoDate: '2026-08-03' };
    for (const evidence of [
        null,
        { ...lifecycle, dateMeaning: 'formation' },
        { ...lifecycle, symbol: 'OTHER' },
        { ...lifecycle, verificationStatus: 'candidate' },
    ]) {
        const result = calculateEntryIncomeEfficiency(ticker, {
            asOfDate: '2026-11-03',
            lifecycleEvidence: evidence,
        });
        assert.equal(result.available, false);
        assert.match(result.reason, /수집 시작일/);
    }
});

test('an older fund with a recent collection start stays unavailable instead of using a short cumulative window', () => {
    const result = calculateEntryIncomeEfficiency(newFund(), {
        asOfDate: '2026-11-03',
        lifecycleEvidence: { ...lifecycle, firstTradeDate: '2010-08-03' },
    });
    assert.equal(result.available, false);
    assert.match(result.reason, /출시 후 12개월이 지났/);
});

test('TOPW retains WPAY first-trade identity; ticker change is not a new launch', () => {
    const proof = reviewedFundLifecycle('TOPW');
    assert.equal(proof.firstTradeDate, '2025-09-04');
    assert.equal(proof.tickerChanges[0].effectiveAfterClose, '2026-03-20');
    const ticker = newFund();
    ticker.symbol = 'TOPW';
    const result = calculateEntryIncomeEfficiency(ticker, {
        asOfDate: '2026-11-03',
    });
    assert.equal(result.available, false);
    assert.match(result.reason, /WPAY→TOPW/);
    assert.match(result.reason, /재출시가 아닙니다/);
    assert.match(result.reason, /출시 후 12개월이 지났/);
});

test('annual and cumulative samples are not ranked together, and corporate-action guards remain closed', () => {
    const ticker = newFund();
    ticker.backtestData.push(
        { date: '2027-09-01', close: 100 },
        { date: '2027-08-10', amount: 2, declaredDate: '2027-08-09' }
    );
    ticker.collectionCoverage = Object.fromEntries(
        ['market-prices', 'dividends'].map((k) => [
            k,
            { complete: true, start: '2026-08-03', end: '2027-09-01' },
        ])
    );
    const annual = calculateEntryIncomeEfficiency(ticker, {
        asOfDate: '2027-09-02',
        lifecycleEvidence: lifecycle,
    });
    assert.equal(annual.basis, 'trailing_12m');
    assert.ok(annual.samples.every((row) => row.basis === 'trailing_12m'));
    ticker.sourceStatus.corporateActionReview = true;
    const blocked = calculateEntryIncomeEfficiency(ticker, {
        asOfDate: '2027-09-02',
        lifecycleEvidence: lifecycle,
    });
    assert.equal(blocked.available, false);
    assert.match(blocked.reason, /분할·병합/);
});
