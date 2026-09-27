// api/searchSymbol.js

import axios from 'axios';
import { createApiHandler } from './_utils/api-handler.js';

const YF_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const YF_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};

async function searchSymbolHandler(req, res) {
    const { query, country } = req.query;
    if (!query) {
        return res.status(400).json({ error: 'Query parameter is required' });
    }

    const { data } = await axios.get(YF_SEARCH_URL, {
        headers: YF_HEADERS,
        params: { q: query, quotesCount: 20, newsCount: 0 },
    });

    if (!data.quotes || data.quotes.length === 0) {
        return res.status(200).json([]);
    }

    let filteredQuotes = data.quotes.filter(
        (q) => q.symbol && !q.symbol.includes('=')
    );

    if (country === 'KR') {
        filteredQuotes = filteredQuotes.filter(
            (q) => q.symbol.endsWith('.KS') || q.symbol.endsWith('.KQ')
        );
    } else if (country === 'US') {
        const usExchanges = ['NMS', 'NYQ', 'PCX', 'OPR'];
        filteredQuotes = filteredQuotes.filter(
            (q) =>
                !q.symbol.endsWith('.KS') &&
                !q.symbol.endsWith('.KQ') &&
                usExchanges.includes(q.exchange)
        );
    }

    const suggestions = filteredQuotes.slice(0, 7).map((q) => ({
        symbol: q.symbol,
        name: q.longname || q.shortname,
        market: q.exchDisp,
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json(suggestions);
}

export default createApiHandler(searchSymbolHandler);
