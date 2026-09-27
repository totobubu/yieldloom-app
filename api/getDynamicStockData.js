import yahooFinance from '../lib/yahooFinanceClient.js';
import { createApiHandler } from './_utils/api-handler.js';

async function getDynamicStockDataHandler(req, res) {
    const { ticker } = req.query;
    if (!ticker) {
        return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    try {
        const symbol = ticker.toUpperCase();

        // 1. Get Quote Info
        const quoteInfo = await yahooFinance.quote(symbol);
        if (!quoteInfo) {
             throw new Error(`Failed to fetch quote for ${symbol}`);
        }

        const tickerInfo = {
            symbol: quoteInfo.symbol || symbol,
            longName: quoteInfo.longName || quoteInfo.shortName,
            currency: quoteInfo.currency,
            market: quoteInfo.exchange,
            regularMarketPrice: quoteInfo.regularMarketPrice,
            price: quoteInfo.regularMarketPrice
        };

        // 2. Get Historical Prices (Let's fetch from 2020 to be safe, or 5 years)
        const fiveYearsAgo = new Date();
        fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
        const period1 = fiveYearsAgo.toISOString().split('T')[0];

        let prices = [];
        try {
            prices = await yahooFinance.historical(symbol, { period1, interval: '1d' });
        } catch (e) {
            console.warn(`No historical price data for ${symbol}:`, e.message);
        }

        // 3. Get Historical Dividends
        let dividends = [];
        try {
            dividends = await yahooFinance.historical(symbol, { period1, events: 'dividends' });
        } catch (e) {
            console.warn(`No historical dividend data for ${symbol}:`, e.message);
        }

        // Merge dividends into prices
        const backtestData = prices.map(p => {
            const dateStr = p.date.toISOString().split('T')[0];
            const div = dividends.find(d => d.date.toISOString().split('T')[0] === dateStr);
            
            const result = {
                date: p.date.toISOString(),
                open: p.open,
                high: p.high,
                low: p.low,
                close: p.close,
                volume: p.volume
            };

            if (div) {
                result.amount = div.dividends;
                result.amountFixed = div.dividends;
            }

            return result;
        });

        const responseData = {
            tickerInfo,
            backtestData,
            holdings: [] // Dynamic fetching of holdings requires another API/scraper which is complex, we leave it empty for now
        };

        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        return res.status(200).json(responseData);

    } catch (error) {
        console.error(`[getDynamicStockData] Error:`, error.message);
        throw new Error(error.message || 'An unknown error occurred');
    }
}

export default createApiHandler(getDynamicStockDataHandler);
