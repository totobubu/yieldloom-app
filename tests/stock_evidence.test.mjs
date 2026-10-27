import { collectionFailure } from '../lib/stock-collection-diagnostics.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateStockEvidence,
    mergeStockReference,
} from '../lib/stock-evidence.js';
import { createStockEvidenceLoader } from '../lib/load-stock-evidence.js';
import { loadTicker } from '../api/thumbnail-data.js';
const article =
    'https://newsroom.bankofamerica.com/content/newsroom/press-releases/2026/10/stock-dividends.html';
const evidence = () => ({
    schemaVersion: 1,
    symbol: 'BAC',
    currency: 'USD',
    candles: [{ date: '2026-10-22', close: '51' }],
    splits: [],
    history: [
        {
            ticker: 'BAC',
            ex_date: '2026-09-04',
            distribution_per_share: '0.32',
            currency: 'USD',
            verification_status: 'needs_review',
            source_class: 'public_aggregator',
        },
    ],
    announcements: [
        {
            ticker: 'BAC',
            currency: 'USD',
            amountRaw: '0.32',
            declaredDate: '2026-10-21',
            exDate: null,
            recordDate: '2026-12-04',
            payableDate: '2026-12-24',
            sourceClass: 'issuer_official',
            sourceUrl: article,
        },
    ],
    sourceUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/BAC',
    result: {
        status: 'partial',
        requestId: 'BAC_fixture',
        steps: [],
        message: '배당락일 미확인',
    },
});
const index = [
    { ticker: 'BAC', historyUrl: '/content-studio/stock-evidence-bac.json' },
];
test('stock snapshot validation preserves absent dates and rejects fake official reference data', () => {
    assert(validateStockEvidence(evidence(), 'BAC'));
    const invalid = evidence();
    invalid.history[0].verification_status = 'official';
    assert(!validateStockEvidence(invalid, 'BAC'));
    assert(!validateStockEvidence(evidence(), 'AAPL'));
    const ref = mergeStockReference([], evidence().history);
    assert.equal(ref[0].official_url, null);
    assert.equal(ref[0].verification_status, 'needs_review');
    assert.equal(
        mergeStockReference(
            [
                {
                    ex_date: '2026-09-04',
                    distribution_per_share: '0.30',
                    verification_status: 'official',
                },
            ],
            ref
        ).length,
        1
    );
});
test('stock evidence requests are shared and unrelated tickers do not fetch', async () => {
    let reads = 0;
    const fetcher = async () => {
        reads++;
        return new Response(JSON.stringify(evidence()));
    };
    const load = createStockEvidenceLoader(index);
    const [a, b] = await Promise.all([
        load('BAC', 'https://app.example', fetcher),
        load('BAC', 'https://app.example', fetcher),
    ]);
    assert.equal(reads, 1);
    assert.deepEqual(a, b);
    await load('BAC', 'https://app.example', fetcher);
    assert.equal(reads, 1);
    assert.equal(await load('CONY', 'https://app.example', fetcher), null);
    assert.equal(reads, 1);
});
test('BAC API receives stock evidence without manufacturing an ex-date or verified dividend', async () => {
    const fetcher = async (url) => {
        if (url.includes('stock-evidence-bac.json'))
            return new Response(JSON.stringify(evidence()));
        if (url.includes('query1.finance.yahoo.com'))
            return new Response(
                JSON.stringify({
                    chart: {
                        result: [
                            {
                                meta: {
                                    symbol: 'BAC',
                                    regularMarketPrice: 50,
                                    regularMarketTime: 1792530000,
                                    currency: 'USD',
                                    exchangeTimezoneName: 'America/New_York',
                                },
                            },
                        ],
                    },
                })
            );
        return new Response('{}', { status: 404 });
    };
    const value = await loadTicker('BAC', 'https://app.example', {
        fetcher,
        stockEvidenceLoader: createStockEvidenceLoader(index),
        priceDataBaseUrl: '',
        projectionBaseUrl: '',
        asOfDate: '2026-10-26',
    });
    assert.equal(value.tickerInfo.price, 51);
    assert.equal(value.sourceStatus.price, 'stock_reference');
    assert.equal(value.sourceStatus.freshness, 'partial');
    assert.equal(value.issuerAnnouncements[0].exDate, null);
    assert(
        value.backtestData.some(
            (row) =>
                row.date === '2026-09-04' &&
                row.verificationStatus === 'needs_review'
        )
    );
    assert(
        !value.backtestData.some(
            (row) => row.date === '2026-12-04' || row.date === '2026-12-24'
        )
    );
});

test('general-stock failures keep curated actionable reasons without returning logs', () => {
    const result = collectionFailure(
        'failure',
        'SECRET_TEST_VALUE "officialAnnouncements": 0, "marketUpdated": false, "code": "market_identity_mismatch"'
    );
    assert.equal(result.code, 'stock_collection_failed');
    assert.match(result.reason, /종목 또는 통화/);
    assert(!JSON.stringify(result).includes('SECRET_TEST_VALUE'));
});
