// api/getStockData.js

import yahooFinance from '../lib/yahooFinanceClient.js';
import { createApiHandler } from './_utils/api-handler.js';

function sanitizeForJSON(data) {
    if (data === null || typeof data !== 'object') {
        if (typeof data === 'number' && isNaN(data)) {
            return null;
        }
        return data;
    }
    if (Array.isArray(data)) {
        return data.map(sanitizeForJSON);
    }
    const newObj = {};
    for (const key of Object.keys(data)) {
        newObj[key] = sanitizeForJSON(data[key]);
    }
    return newObj;
}

async function getStockDataHandler(req, res) {
    const { tickers } = req.query;
    if (!tickers) {
        return res.status(400).json({ error: 'Tickers parameter is required' });
    }

    try {
        const results = await yahooFinance.quote(tickers.split(','));
        
        if (results && results.error) {
            throw new Error(results.error.message || 'Failed to fetch data from Yahoo Finance');
        }
        
        if (!results || (Array.isArray(results) && results.length === 0)) {
             return res.status(200).json([]);
        }

        const sanitizedResults = sanitizeForJSON(results);
        
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        
        return res.status(200).json(sanitizedResults);

    } catch (error) {
        // 에러를 다시 던지면 createApiHandler가 받아서 500 응답을 처리합니다.
        throw new Error(error.message || 'An unknown error occurred in getStockDataHandler');
    }
}

// createApiHandler로 핸들러를 감싸서 최종 export
export default createApiHandler(getStockDataHandler);