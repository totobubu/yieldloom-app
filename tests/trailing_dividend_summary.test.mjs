import test from 'node:test';
import assert from 'node:assert/strict';
import { trailingDividendSummary } from '../src/services/thumbnail/trailingDividendSummary.js';
import { artworkFilename } from '../src/services/thumbnail/cardPresentation.js';
import { createCardShareText } from '../src/services/thumbnail/shareText.js';
const end = '2026-11-03',
    info = { symbol: 'DEMO-A', price: 50, currency: 'USD' };
const rows = Array.from({ length: 24 }, (_, i) => ({
    date: new Date(Date.UTC(2024, i + 11, 1)).toISOString().slice(0, 10),
    amount: i === 23 ? 0.16 : 0.08,
}));
const ticker = () => ({
    symbol: 'DEMO-A',
    backtestData: structuredClone(rows),
    sourceStatus: {
        priceDate: end,
        collectionCoverage: {
            dividends: {
                complete: true,
                start: '2024-12-01',
                end,
                missingIntervals: [],
            },
        },
    },
});
const run = (data = ticker(), quote = info) =>
    trailingDividendSummary(data, quote, { today: '2026-11-04' });
test('verified trailing year uses actual history, not latest event annualized; four rolling intervals exactly partition it', () => {
    const data = ticker(),
        original = structuredClone(data),
        r = run(data);
    assert.equal(r.complete, true);
    assert.ok(Math.abs(r.amount - 1.04) < 1e-12);
    assert.ok(Math.abs(r.yieldPercent - 2.08) < 1e-12);
    assert.equal(r.start, '2025-11-04');
    assert.equal(r.segments.length, 4);
    assert.ok(
        Math.abs(r.segments.reduce((s, x) => s + x.amount, 0) - r.amount) <
            1e-12
    );
    assert.deepEqual(data, original);
    assert.notEqual(r.amount, 0.16 * 12);
});
for (const variant of [
    'absent',
    'false',
    'short',
    'gap',
    'review',
    'split',
    'duplicate',
    'null',
    'negative',
    'currency',
])
    test(`${variant} evidence cannot turn incomplete/conflicting history into zero or complete values`, () => {
        const d = ticker(),
            c = d.sourceStatus.collectionCoverage.dividends;
        if (variant === 'absent') delete d.sourceStatus.collectionCoverage;
        if (variant === 'false') c.complete = false;
        if (variant === 'short') c.start = '2026-01-01';
        if (variant === 'gap')
            c.missingIntervals = [{ start: '2026-05-01', end: '2026-05-31' }];
        if (variant === 'review')
            d.backtestData.at(-1).verificationStatus = 'needs_review';
        if (variant === 'split') d.sourceStatus.corporateActionReview = true;
        if (variant === 'duplicate')
            d.backtestData.push({ ...d.backtestData.at(-1) });
        if (variant === 'null') d.backtestData.at(-1).amount = null;
        if (variant === 'negative') d.backtestData.at(-1).amount = -1;
        if (variant === 'currency') d.backtestData.at(-1).currency = 'KRW';
        const r = run(d);
        assert.equal(r.complete, false);
        assert.equal(r.amount, null);
        assert.equal(r.yieldPercent, null);
        assert.ok(r.segments.every((s) => s.amount === null));
        assert.doesNotMatch(
            createCardShareText('ttm-summary', r),
            /0\.00%|합계 0/
        );
    });
test('zero is displayable only with explicit complete no-payment evidence', () => {
    const d = ticker();
    d.backtestData = [];
    assert.equal(run(d).amount, 0);
    delete d.sourceStatus.collectionCoverage;
    assert.equal(run(d).amount, null);
});
test('forecast/out-of-period rows never enter trailing total; normalized amount has priority', () => {
    const d = ticker();
    d.backtestData.at(-1).amountFixed = 0.2;
    d.backtestData.push(
        { date: '2026-11-02', amount: 99, forecasted: true },
        { date: '2026-11-04', amount: 100 }
    );
    assert.ok(Math.abs(run(d).amount - 1.08) < 1e-12);
});
test('missing quote suppresses yield, missing currency suppresses monetary totals, future as-of is unavailable', () => {
    assert.equal(run(ticker(), { ...info, price: null }).yieldPercent, null);
    assert.equal(run(ticker(), { ...info, currency: null }).amount, null);
    const d = ticker();
    d.sourceStatus.priceDate = '2026-11-05';
    assert.equal(run(d).amount, null);
});
test('leap-year boundary clamps the previous calendar year and has no omitted first day', () => {
    const d = ticker();
    d.sourceStatus.priceDate = '2028-02-29';
    d.sourceStatus.collectionCoverage.dividends.end = '2028-02-29';
    d.backtestData = [{ date: '2027-03-01', amount: 1 }];
    const r = trailingDividendSummary(d, info, { today: '2028-03-01' });
    assert.equal(r.start, '2027-03-01');
    assert.equal(r.amount, 1);
});
test('new filename/copy identify period and do not rename legacy summary', () => {
    assert.equal(
        artworkFilename('DEMO-A', 'ttm-summary', {}),
        'demo-a_ttm-summary.png'
    );
    assert.equal(
        artworkFilename('DEMO-A', 'summary', {}),
        'demo-a_summary.png'
    );
    assert.match(
        createCardShareText('ttm-summary', run()),
        /최근 12개월.*2025-11-04.*2026-11-03/
    );
});

test('both gap aliases and malformed evidence remain unknown rather than throwing or claiming completeness', () => {
    const gap = ticker();
    gap.sourceStatus.collectionCoverage.dividends.gaps = [
        { start: '2026-02-01', end: '2026-02-28' },
    ];
    assert.equal(run(gap).amount, null);
    const malformed = ticker();
    malformed.sourceStatus.collectionCoverage.dividends.missingIntervals = {};
    assert.doesNotThrow(() => run(malformed));
    assert.equal(run(malformed).complete, false);
});
