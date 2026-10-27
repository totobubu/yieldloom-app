import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSourceTimeItems,
    indexSourceTimes,
    sourceTimesForRow,
    observationTimeItems,
} from '../lib/sheet-source-times.js';

const file = (body, overrides = {}) => ({
    file: 'orders-all-us.json',
    sha256: 'a'.repeat(64),
    data: { data: { body } },
    ...overrides,
});
const order = (overrides = {}) => ({
    stockCode: 'fictional',
    symbol: 'QDTE',
    tradeType: 'buy',
    userOrderDate: '2025-05-30',
    executedQuantity: 0.02,
    orderedAt: '2025-05-30 20:30:16.123',
    ...overrides,
});
const build = (files) =>
    buildSourceTimeItems({
        accountId: 'wife',
        archiveKey: 'private/synthetic.json',
        kind: 'orders',
        files,
    });
test('simultaneous separate orders remain separate candidates, never adopt into the row', () => {
    const row = {
        accountId: 'wife',
        type: 'BUY',
        symbol: 'QDTE',
        date: '2025-05-30',
        quantity: 0.03,
        purchaseUsd: 1,
    };
    const before = structuredClone(row);
    const items = build([file([order(), order({ executedQuantity: 0.19 })])]);
    assert.equal(sourceTimesForRow(row, indexSourceTimes(items)).length, 2);
    assert.notEqual(items[0].id, items[1].id);
    assert.deepEqual(row, before);
    assert.equal(
        sourceTimesForRow(
            { ...row, accountId: 'husband' },
            indexSourceTimes(items)
        ).length,
        0
    );
});
test('order-list timestamp keeps its actual role; no execution time or zone is invented', () => {
    const [item] = build([file([order()])]);
    assert.deepEqual(item.times, [
        {
            field: 'data.body[0].orderedAt',
            role: 'orderedAt',
            value: '2025-05-30 20:30:16.123',
            timeZone: null,
        },
    ]);
    assert.equal(build([file([order({ orderedAt: '2025-05-30' })])]).length, 0);
});
test('cash posting timestamp is not execution time and malformed amount text is not parsed', () => {
    const items = buildSourceTimeItems({
        accountId: 'wife',
        archiveKey: 'private/synthetic.json',
        kind: 'transactions',
        symbols: { fictional: ['TEST'] },
        files: [
            file(null, {
                file: 'transaction-details/synthetic.json',
                data: {
                    data: {
                        transaction: {
                            stockCode: 'fictional',
                            displayType: '13',
                            summaryNo: '1207',
                            dateTime: '2025-11-26 08:30:53.776',
                            amount: '$3.5211월 26일 출금',
                        },
                    },
                },
            }),
        ],
    });
    assert.equal(items[0].times[0].role, 'dateTime');
    assert.equal(items[0].times[0].value, '2025-11-26 08:30:53.776');
    assert.equal(Object.hasOwn(items[0], 'amount'), false);
});
test('known ticker alias selects candidates but keeps original spelling; unknown mapping stays unbound', () => {
    const input = {
        accountId: 'wife',
        archiveKey: 'private/synthetic.json',
        kind: 'orders',
        files: [file([order({ symbol: 'WPAY' })])],
    };
    const items = buildSourceTimeItems({
        ...input,
        symbols: { fictional: ['WPAY', 'TOPW'] },
    });
    assert.equal(items[0].symbol, 'WPAY');
    assert.equal(
        sourceTimesForRow(
            {
                accountId: 'wife',
                type: 'BUY',
                date: '2025-05-30',
                symbol: 'TOPW',
            },
            indexSourceTimes(items)
        ).length,
        1
    );
    assert.equal(
        buildSourceTimeItems({ ...input, symbols: { fictional: ['X', 'Y'] } })
            .length,
        0
    );
});
test('already stored observation times are visible without mapping executed/paid times into transactionAt', () => {
    const row = {
        accountId: 'wife',
        symbol: 'TEST',
        type: 'BUY',
        date: '2025-01-02',
        transactionAt: null,
    };
    const obs = {
        id: 'synthetic',
        accountId: 'wife',
        symbol: 'TEST',
        type: 'BUY',
        values: { executedAt: '2025-01-02 23:16', timeZone: 'Asia/Seoul' },
    };
    const before = structuredClone([row, obs]);
    const [item] = observationTimeItems(row, [obs]);
    assert.equal(item.times[0].role, 'executionDateTime');
    assert.equal(item.times[0].value, '2025-01-02 23:16');
    assert.equal(item.times[0].timeZone, 'Asia/Seoul');
    assert.equal(
        observationTimeItems(row, [{ ...obs, forecast: true }]).length,
        0
    );
    assert.equal(
        observationTimeItems(row, [{ ...obs, accountId: 'husband' }]).length,
        0
    );
    assert.equal(
        observationTimeItems(row, [
            { ...obs, values: { executedAt: '2025-01-02' } },
        ]).length,
        0
    );
    assert.deepEqual([row, obs], before);
});
