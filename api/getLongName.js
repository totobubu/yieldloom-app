// api/getLongName.js

import yahooFinance from '../lib/yahooFinanceClient.js';
import { createApiHandler } from './_utils/api-handler.js';

function normalizeSymbols(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    return String(input)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

async function fetchLongName(symbol) {
    try {
        const quote = await yahooFinance.quote(symbol);
        if (!quote) {
            return {
                symbol,
                longName: null,
                shortName: null,
                displayName: null,
                error: 'Symbol not found',
            };
        }

        const { longName, shortName, displayName } = quote;
        return {
            symbol,
            longName: longName || displayName || shortName || null,
            shortName: shortName || null,
            displayName: displayName || null,
            raw: {
                longName: longName || null,
                shortName: shortName || null,
                displayName: displayName || null,
            },
        };
    } catch (error) {
        return {
            symbol,
            longName: null,
            shortName: null,
            displayName: null,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

async function getLongNameHandler(req, res) {
    const symbols =
        req.method === 'POST'
            ? normalizeSymbols(req.body?.symbol || req.body?.symbols)
            : normalizeSymbols(req.query.symbol || req.query.symbols);

    if (!symbols.length) {
        return res.status(400).json({
            error: 'symbol parameter is required. Use ?symbol=MSFT or ?symbols=MSFT,AAPL',
        });
    }

    const uniqueSymbols = [...new Set(symbols)].slice(0, 20);

    const results = await Promise.all(uniqueSymbols.map(fetchLongName));

    const responsePayload = results.length === 1 ? results[0] : results;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(responsePayload);
}

export default createApiHandler(getLongNameHandler);

