import { createHash } from 'node:crypto';

export const projectionPrefix = 'thumbnail/v1';
export const generatorVersion = 1;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = (value) => Buffer.from(JSON.stringify(value));
export const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const normalizeSymbol = (value) => String(value ?? '').trim().toUpperCase();
export const validSymbol = (value) => /^[A-Z0-9^][A-Z0-9.^=-]{0,29}$/.test(value);
export const symbolKey = (symbol) => Buffer.from(normalizeSymbol(symbol)).toString('base64url');

export function priceFreshness(priceDate, asOf = new Date().toISOString().slice(0, 10)) {
    if (!priceDate) return 'unavailable';
    return (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${priceDate}T00:00:00Z`)) / 86400000 > 4 ? 'stale' : 'fresh';
}

export function actualPrices(payload, asOf) {
    if (!Array.isArray(payload?.backtestData)) throw new Error('Source requires backtestData');
    const byDate = new Map();
    for (const row of payload.backtestData) {
        if (row.forecasted || !validDate(row.date) || row.date > asOf || row.close == null || !Number.isFinite(Number(row.close)) || Number(row.close) <= 0) continue;
        const previous = byDate.get(row.date);
        if (previous && previous.close !== Number(row.close)) throw new Error(`Conflicting close on ${row.date}`);
        byDate.set(row.date, { date: row.date, close: Number(row.close) });
    }
    const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) throw new Error('Source has no actual prices');
    return rows;
}

export function assertNoHistoryLoss(previousDates, rows) {
    if (!previousDates) return;
    const incoming = new Set(rows.map(row => row.date));
    const missing = previousDates.filter(date => !incoming.has(date));
    if (missing.length) throw new Error(`Source history shrank: ${missing.length} price dates disappeared (first: ${missing[0]})`);
}

// Price-only read models. Official dividend amounts are joined by the API; source amounts are never promoted.
export function buildProjection({ symbol, payload, sourceBytes, sourceKey, asOf, previousDates }) {
    symbol = normalizeSymbol(symbol);
    if (!validSymbol(symbol) || !validDate(asOf)) throw new Error('Invalid symbol or asOf date');
    const sourceSymbol = payload.tickerInfo?.Symbol ?? payload.tickerInfo?.symbol;
    const equivalent = value => normalizeSymbol(value).replace(/\.([AB])$/, '-$1');
    if (sourceSymbol && equivalent(sourceSymbol) !== equivalent(symbol)) throw new Error('Source symbol does not match requested ticker');
    const rows = actualPrices(payload, asOf);
    assertNoHistoryLoss(previousDates, rows);
    // 37 complete calendar months preserve the first monthly entry and its preceding 12-month dividend window.
    const cutoff = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 37);
    const yearAgo = new Date(`${asOf}T00:00:00Z`);
    yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
    const firstBeforeYear = [...rows].reverse().find(row => row.date < yearAgo.toISOString().slice(0, 10));
    const latest = rows.at(-1);
    const info = payload.tickerInfo ?? {};
    const source = { key: sourceKey, sha256: sha256(sourceBytes), bytes: sourceBytes.length, firstPriceDate: rows[0].date, lastPriceDate: latest.date, rowCount: rows.length };
    const summary = {
        schemaVersion: 1, symbol, asOf, source,
        tickerInfo: { symbol, longName: info.longName ?? info.koName ?? symbol, currency: info.currency ?? null, market: info.market ?? null, marketCap: info.marketCap ?? [...payload.backtestData].reverse().find(row => !row.forecasted && row.date <= asOf && Number(row.marketCap) > 0)?.marketCap ?? null, price: latest.close, regularMarketPrice: latest.close },
        priceDate: latest.date, freshness: priceFreshness(latest.date, asOf),
        adjustmentBasis: 'upstream_unverified',
        splits: (info.events?.splits ?? []).map(event => ({ date: event.date, ratio: event.ratio })).filter(event => validDate(event.date)),
    };
    return {
        summary,
        'comparison-1y': { schemaVersion: 1, symbol, asOf, backtestData: rows.filter(row => row.date >= (firstBeforeYear?.date ?? yearAgo.toISOString().slice(0, 10))) },
        'entry-efficiency': { schemaVersion: 1, symbol, asOf, backtestData: rows.filter(row => row.date >= cutoff.toISOString().slice(0, 10)) },
        'source-coverage': { schemaVersion: 1, symbol, dates: rows.map(row => row.date) },
    };
}

export function validateProjection(projection) {
    const { summary } = projection;
    if (!summary || !validSymbol(summary.symbol) || !validDate(summary.asOf) || !validDate(summary.priceDate) || !(summary.tickerInfo.price > 0)) throw new Error('Invalid projection summary');
    for (const name of ['comparison-1y', 'entry-efficiency']) {
        const payload = projection[name];
        if (payload?.symbol !== summary.symbol || payload.asOf !== summary.asOf) throw new Error('Projection identity mismatch');
        const rows = actualPrices(payload, summary.asOf);
        if (rows.at(-1).close !== summary.tickerInfo.price || rows.at(-1).date !== summary.priceDate) throw new Error('Projection latest price mismatch');
    }
    return projection;
}
