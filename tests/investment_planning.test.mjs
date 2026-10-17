import test from 'node:test';
import assert from 'node:assert/strict';
import {
    projectIncome,
    fireScenarios,
    recoveryMetrics,
    incomeStress,
    compareReinvestment,
    planningBaseline,
    assessInvestor,
    investmentQuestions,
} from '../src/services/investmentPlanning.js';
import {
    buildBlogDraft,
    monthlyChartSvg,
    blogTemplates,
} from '../src/services/investmentEditorial.js';
const base = {
    initial: 1200,
    contribution: 0,
    yieldRate: 10,
    tax: 0,
    growth: 0,
    priceGrowth: 0,
    inflation: 0,
    reinvest: 0,
    target: 10,
    years: 1,
    currency: 'USD',
    targetCurrency: 'USD',
    exchangeRate: 1400,
    fxGrowth: 0,
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test('cash retained and reinvestment do not double count dividends', () => {
    const cash = projectIncome(base),
        reinvested = projectIncome({ ...base, reinvest: 100 });
    near(cash.final.wealth, 1320);
    near(cash.final.cash, 120);
    near(cash.final.netTotal, 120);
    near(reinvested.final.wealth, 1200 * (1 + 0.1 / 12) ** 12);
    near(reinvested.final.cash, 0);
    near(reinvested.final.wealth - 1200, reinvested.final.netTotal);
    assert.equal(cash.firstMonth, 0);
});
test('monthly contribution, taxes, dividend growth and price growth remain distinct', () => {
    const r = projectIncome({
        ...base,
        initial: 0,
        contribution: 100,
        tax: 100,
    });
    near(r.final.wealth, 1200);
    near(r.final.income, 0);
    assert.equal(r.firstMonth, null);
    const cut = projectIncome({ ...base, growth: -50 });
    near(cut.final.income, 5);
    const price = projectIncome({ ...base, priceGrowth: 50 });
    near(price.final.income, 10);
    near(price.final.wealth, 1920);
    near(price.final.currentYield, 10 / 1.5);
});
test('inflation and currency conversion apply to targets and income consistently', () => {
    const usd = projectIncome({ ...base, target: 11, inflation: 10 });
    assert.equal(usd.firstMonth, null);
    near(usd.final.goal, 12.1);
    const krw = projectIncome({
        ...base,
        targetCurrency: 'KRW',
        target: 15000,
        fxGrowth: 10,
    });
    near(krw.initialMonthly, 14000);
    near(krw.final.income, 15400);
    assert.ok(krw.firstMonth > 0);
    assert.throws(() =>
        projectIncome({ ...base, currency: 'KRW', targetCurrency: 'USD' })
    );
});
test('scenario ordering with constant base and zero-income no-achievement', () => {
    const r = fireScenarios(base);
    assert.equal(r[0].label, '보수적');
    assert.ok(r[0].result.final.income < r[1].result.final.income);
    assert.ok(r[2].result.final.income > r[1].result.final.income);
    assert.equal(
        projectIncome({ ...base, initial: 0, contribution: 0 }).firstMonth,
        null
    );
});
test('invalid and incomplete numbers never become a zero-income result', () => {
    for (const v of [null, '', false, NaN, Infinity, -1])
        assert.throws(() => projectIncome({ ...base, initial: v }));
    assert.throws(() => projectIncome({ ...base, years: 1.5 }));
    assert.throws(() => projectIncome({ ...base, growth: 100 }));
    assert.throws(() =>
        projectIncome({
            ...base,
            initial: 1e12,
            yieldRate: 100,
            growth: 50,
            priceGrowth: -95,
            reinvest: 100,
            years: 60,
        })
    );
});
test('cash recovery is distinct from dividend receipts; zero withdrawal never repays', () => {
    const r = recoveryMetrics({
        principal: 1000,
        withdrawn: 200,
        dividends: 600,
        monthlyNet: 100,
        withdrawalPercent: 50,
    });
    assert.equal(r.remaining, 800);
    assert.equal(r.cashMonths, 16);
    assert.equal(r.dividendMonths, 4);
    assert.equal(r.dividendRate, 60);
    assert.equal(r.cashRate, 20);
    assert.equal(
        recoveryMetrics({
            principal: 1000,
            withdrawn: 0,
            dividends: 1200,
            monthlyNet: 100,
            withdrawalPercent: 0,
        }).cashMonths,
        null
    );
    assert.equal(
        recoveryMetrics({
            principal: 1000,
            withdrawn: 1200,
            dividends: 0,
            monthlyNet: 0,
            withdrawalPercent: 0,
        }).cashMonths,
        0
    );
});
test('stress handles concentration, combined shocks and price-driven yield increases', () => {
    const r = incomeStress({
        monthlyNet: 100,
        target: 100,
        topShare: 60,
        foreignShare: 50,
        fxShock: -20,
        payoutChange: -20,
        priceChange: -50,
    });
    near(r.rows[3].income, 40);
    near(r.rows[4].income, 90);
    near(r.rows[5].income, 72);
    near(r.yieldMultiplier, 1.6);
});
test('reinvestment comparisons charge selling cost only to switch strategy', () => {
    const r = compareReinvestment({
        amount: 1000,
        months: 12,
        a: base,
        b: base,
        saleCost: 100,
    });
    near(r[0].result.final.wealth, r[1].result.final.wealth);
    near(r[2].result.final.wealth, r[1].result.final.wealth * 0.9);
    assert.throws(() =>
        compareReinvestment({
            amount: 100,
            months: 12,
            a: base,
            b: base,
            saleCost: 101,
        })
    );
});
test('baseline separates currency and cancellations without annualizing missing months', () => {
    const entries = [
        {
            id: '1',
            row: {
                date: '2025-12-01',
                symbol: 'A',
                currency: 'USD',
                amount: 100,
                type: 'dividend',
            },
        },
        {
            id: '2',
            row: {
                date: '2025-12-02',
                symbol: 'A',
                currency: 'USD',
                amount: 20,
                type: 'dividend_reversal',
            },
        },
        {
            id: '3',
            row: {
                date: '2025-12-01',
                symbol: 'B',
                currency: 'KRW',
                amount: 90000,
                type: 'dividend',
            },
        },
    ];
    const r = planningBaseline(
        entries,
        [
            { symbol: 'A', currency: 'USD', amount: 1000 },
            { symbol: 'B', currency: 'USD', amount: null },
        ],
        'USD',
        '2025-12'
    );
    assert.equal(r.annualRecorded, 80);
    assert.equal(r.observedMonths, 1);
    assert.equal(r.months[0].amount, null);
    assert.equal(r.assets, 1000);
    assert.equal(r.excluded, 1);
    const unknown = planningBaseline(
        [
            ...entries,
            {
                id: '4',
                row: {
                    date: '2025-11-01',
                    symbol: 'A',
                    currency: 'USD',
                    amount: null,
                    type: 'dividend',
                },
            },
        ],
        [],
        'USD',
        '2025-12'
    );
    assert.equal(unknown.annualRecorded, null);
    assert.equal(
        unknown.months.find((r) => r.month === '2025-11').amount,
        null
    );
    assert.equal(unknown.months.find((r) => r.month === '2025-11').unknown, 1);
});
test('exam requires complete answers and separates capacity, preference, learning', () => {
    assert.equal(assessInvestor({}), null);
    const answers = Object.fromEntries(
        investmentQuestions.map((q) => [q.id, q.kind === 'preference' ? 2 : 0])
    );
    const r = assessInvestor(answers, 60);
    assert.equal(r.preference, 6);
    assert.equal(r.capacity, 0);
    assert.ok(r.warnings.length >= 2);
    assert.equal(r.label, '위험 감수');
});
test('all five blog drafts redact values, symbols and quantitative assumptions by default', () => {
    const ctx = {
        month: '2026-01',
        currency: 'USD',
        fireCurrency: 'KRW',
        baseline: {
            annualRecorded: 98765,
            symbols: [{ symbol: 'PRIVATE', amount: 98765 }],
            dates: [],
            months: [{ month: '2026-01', amount: 98765 }],
        },
        fire: projectIncome({ ...base, targetCurrency: 'KRW', target: 100 }),
        recovery: { cashRate: 53 },
        assumptions: '배당률: 7.89123',
    };
    for (const t of blogTemplates) {
        const draft = buildBlogDraft(t.id, ctx);
        assert.ok(!draft.includes('98,765'));
        assert.ok(!draft.includes('PRIVATE'));
        assert.ok(!draft.includes('7.89123'));
    }
    const open = buildBlogDraft('fire', ctx, { amounts: true });
    assert.ok(open.includes('14,000 KRW'));
    assert.ok(!monthlyChartSvg(ctx.baseline).includes('98765'));
    assert.ok(
        monthlyChartSvg(
            { months: [{ month: 'xx<script>', amount: 1 }] },
            { amounts: true }
        ).includes('&lt;script&gt;')
    );
});
