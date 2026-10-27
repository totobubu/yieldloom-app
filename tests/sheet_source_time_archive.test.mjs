import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectVerifiedTimeArchives } from '../lib/sheet-source-time-archive.js';
const encoded = (file, data) => {
    const b = Buffer.from(JSON.stringify(data));
    return {
        file,
        bytes: b.length,
        sha256: createHash('sha256').update(b).digest('hex'),
        content: b.toString('base64'),
    };
};
const input = () => ({
    accountId: 'wife',
    runId: 'synthetic',
    archiveKeys: {
        orders: 'snapshots/synthetic/wife/orders.json',
        transactions: 'snapshots/synthetic/wife/transactions.json',
    },
    orders: {
        accountId: 'wife',
        files: [
            encoded('orders-all-us.json', {
                data: {
                    body: [
                        {
                            stockCode: 'fictional',
                            symbol: 'TEST',
                            tradeType: 'buy',
                            userOrderDate: '2025-01-02',
                            orderedAt: '2025-01-02 22:30',
                            executedQuantity: 0.1,
                        },
                    ],
                },
            }),
        ],
    },
    transactions: {
        accountId: 'wife',
        files: [
            encoded('transaction-details/synthetic.json', {
                data: {
                    transaction: {
                        stockCode: 'fictional',
                        displayType: '13',
                        summaryNo: '1207',
                        dateTime: '2025-01-02 08:51:59.269',
                    },
                },
            }),
        ],
    },
});
test('verified immutable file projection keeps originals, field roles, precision and incomplete scope', async () => {
    const sources = input(),
        before = structuredClone(sources);
    const r = await projectVerifiedTimeArchives(sources);
    assert.deepEqual(sources, before);
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].times[0].value, '2025-01-02 22:30');
    assert.equal(r.coverage.completeFinancialEventCount, false);
});
test('cross-account, altered content and altered byte count fail before serving any projection', async () => {
    for (const change of [
        (i) => {
            i.transactions.accountId = 'husband';
        },
        (i) => {
            i.orders.files[0].sha256 = '0'.repeat(64);
        },
        (i) => {
            i.orders.files[0].bytes++;
        },
    ]) {
        const i = input();
        change(i);
        await assert.rejects(projectVerifiedTimeArchives(i), /mismatch/);
    }
});
test('HOME found text uses its original path and requires a frozen baseline and matching response digest', async () => {
    const sources = input();
    const data = {
        accountRole: 'wife',
        found: [
            {
                accountRole: 'wife',
                ledgerKey: 'baseline-order',
                raw: 'TEST\n구매 완료\n구매 수량0.1주\n구매 시간2025년 1월 2일 23:16',
            },
        ],
    };
    sources.panels = [
        {
            key: 'snapshots/synthetic/wife/home.json',
            sha256: createHash('sha256')
                .update(JSON.stringify(data))
                .digest('hex'),
            data,
        },
    ];
    await assert.rejects(
        projectVerifiedTimeArchives(sources),
        /Frozen baseline/
    );
    sources.frozenSourceLedgerKeys = ['baseline-order'];
    const report = await projectVerifiedTimeArchives(sources);
    assert.equal(report.coverage.projectedPanelRecords, 1);
    assert.equal(report.items.at(-1).source.path, 'found[0].raw');
    assert.equal(report.items.at(-1).directIdentityVerified, false);
    sources.panels[0].sha256 = '0'.repeat(64);
    await assert.rejects(
        projectVerifiedTimeArchives(sources),
        /Panel response hash mismatch/
    );
});
