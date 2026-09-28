import assert from 'node:assert/strict';
import test from 'node:test';

import {
    fetchHoldings,
    normalizeAccounts,
    normalizeHoldings,
} from '../api/_utils/toss-portfolio.js';

test('normalizes accounts without exposing the full account number', () => {
    assert.deepEqual(
        normalizeAccounts({
            result: [
                {
                    accountSeq: 7,
                    accountNo: '12345678901',
                    accountType: 'BROKERAGE',
                },
            ],
        }),
        [{ accountSeq: 7, accountType: 'BROKERAGE', label: 'BROKERAGE #8901' }]
    );
});

test('keeps only positive, numeric holdings in a Toss snapshot', () => {
    const snapshot = normalizeHoldings(
        {
            result: {
                items: [
                    {
                        symbol: 'tsly',
                        quantity: '3.5',
                        marketCountry: 'US',
                        name: 'YieldMax',
                    },
                    { symbol: 'ZERO', quantity: '0' },
                    { symbol: 'BAD', quantity: 'unknown' },
                ],
            },
        },
        7,
        '2026-09-27T00:00:00.000Z'
    );
    assert.deepEqual(snapshot, {
        source: 'toss',
        accountSeq: 7,
        syncedAt: '2026-09-27T00:00:00.000Z',
        holdings: [
            { ticker: 'TSLY', shares: 3.5, market: 'US', name: 'YieldMax' },
        ],
    });
});

test('uses server-side credentials and returns a normalized holdings snapshot', async () => {
    const previousId = process.env.TOSS_CLIENT_ID;
    const previousSecret = process.env.TOSS_CLIENT_SECRET;
    process.env.TOSS_CLIENT_ID = 'test-client';
    process.env.TOSS_CLIENT_SECRET = 'test-secret';
    const requests = [];
    const fakeFetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (url.endsWith('/oauth2/token'))
            return {
                ok: true,
                json: async () => ({ access_token: 'server-only-token' }),
            };
        return {
            ok: true,
            json: async () => ({
                result: {
                    items: [
                        { symbol: 'TSLY', quantity: '2', marketCountry: 'US' },
                    ],
                },
            }),
        };
    };
    try {
        const snapshot = await fetchHoldings(9, fakeFetch);
        assert.equal(
            requests[0].url,
            'https://openapi.tossinvest.com/oauth2/token'
        );
        assert.match(requests[0].options.body, /client_secret=test-secret/);
        assert.deepEqual(requests[1].options.headers, {
            Authorization: 'Bearer server-only-token',
            'X-Tossinvest-Account': '9',
        });
        assert.deepEqual(snapshot.holdings, [
            { ticker: 'TSLY', shares: 2, market: 'US', name: null },
        ]);
    } finally {
        if (previousId === undefined) delete process.env.TOSS_CLIENT_ID;
        else process.env.TOSS_CLIENT_ID = previousId;
        if (previousSecret === undefined) delete process.env.TOSS_CLIENT_SECRET;
        else process.env.TOSS_CLIENT_SECRET = previousSecret;
    }
});
