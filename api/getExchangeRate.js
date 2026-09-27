// api/getExchangeRate.js (임시 복구 버전)

import yahooFinance from '../lib/yahooFinanceClient.js';

export default async function handler(request, response) {
    // 모든 Origin을 허용하도록 설정 (가장 간단한 해결책)
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const ticker = 'USDKRW=X';

    try {
        const result = await yahooFinance.quote(ticker);

        if (!result || !result.regularMarketPrice) {
            console.error(
                'Unexpected Yahoo Finance response for exchange rate:',
                result
            );
            throw new Error('Exchange rate data not found in response');
        }

        const exchangeRateData = {
            symbol: result.symbol,
            price: result.regularMarketPrice,
            change: result.regularMarketChange,
            changePercent: result.regularMarketChangePercent,
        };

        response.setHeader(
            'Cache-Control',
            's-maxage=600, stale-while-revalidate'
        );
        return response.status(200).json(exchangeRateData);
    } catch (error) {
        console.error('Yahoo Finance exchange rate fetch error:', error);
        return response.status(500).json({
            error: 'Failed to fetch exchange rate data',
            details: error.message,
        });
    }
}
