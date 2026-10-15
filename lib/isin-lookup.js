const validIsin = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const validSymbol = /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/;
const validFigi = /^BBG[A-Z0-9]{9}$/;

export function combineIsinResults(isin, figi, yahoo, statuses = {}) {
    const candidates = new Map();
    for (const row of Array.isArray(figi) ? figi : []) {
        if (!row) continue;
        const symbol = String(row.ticker || '')
            .replaceAll('/', '-')
            .toUpperCase();
        if (
            !validSymbol.test(symbol) ||
            !validFigi.test(row.figi || '') ||
            row.exchCode !== 'US' ||
            row.marketSector !== 'Equity'
        )
            continue;
        candidates.set(symbol, {
            symbol,
            name: row.name || symbol,
            canonicalIsin: isin,
            exactIsin: true,
            figi: row.figi,
            compositeFigi: validFigi.test(row.compositeFIGI || '')
                ? row.compositeFIGI
                : null,
            shareClassFigi: validFigi.test(row.shareClassFIGI || '')
                ? row.shareClassFIGI
                : null,
            sources: [
                {
                    name: 'OpenFIGI · ISIN 일치',
                    url: `https://www.openfigi.com/id/${encodeURIComponent(row.figi)}`,
                },
            ],
        });
    }
    const yahooSymbols = new Set();
    for (const row of Array.isArray(yahoo) ? yahoo : []) {
        if (!row) continue;
        const symbol = String(row.symbol || '').toUpperCase();
        if (
            !validSymbol.test(symbol) ||
            !['EQUITY', 'ETF'].includes(row.quoteType)
        )
            continue;
        yahooSymbols.add(symbol);
        if (!candidates.has(symbol))
            candidates.set(symbol, {
                symbol,
                name: row.longname || row.shortname || symbol,
                canonicalIsin: isin,
                exactIsin: false,
                sources: [],
            });
        candidates.get(symbol).sources.push({
            name: 'Yahoo Finance · ISIN 검색',
            url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,
        });
    }
    const figiSymbols = new Set(
        [...candidates.values()]
            .filter((row) => row.exactIsin)
            .map((row) => row.symbol)
    );
    return {
        isin,
        statuses,
        candidates: [...candidates.values()].map((row) => ({
            ...row,
            crossChecked:
                row.exactIsin &&
                figiSymbols.size === 1 &&
                yahooSymbols.size === 1 &&
                yahooSymbols.has(row.symbol),
        })),
    };
}

export function createIsinLookup({
    fetcher = fetch,
    now = () => Date.now(),
} = {}) {
    const cache = new Map();
    async function json(url, options = {}) {
        const response = await fetcher(url, {
            ...options,
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
    return async function lookup(value) {
        const isin = String(value || '')
            .trim()
            .toUpperCase();
        if (!validIsin.test(isin)) {
            const error = new Error('PDF의 12자리 ISIN을 확인해 주세요.');
            error.status = 400;
            throw error;
        }
        const saved = cache.get(isin);
        if (saved && saved.expiresAt > now()) return saved.result;
        const [figi, yahoo] = await Promise.allSettled([
            json('https://api.openfigi.com/v3/mapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([
                    { idType: 'ID_ISIN', idValue: isin, exchCode: 'US' },
                ]),
            }),
            json(
                `https://query1.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q: isin, quotesCount: '5', newsCount: '0' })}`,
                { headers: { 'User-Agent': 'Mozilla/5.0' } }
            ),
        ]);
        const result = combineIsinResults(
            isin,
            figi.status === 'fulfilled' ? figi.value?.[0]?.data : [],
            yahoo.status === 'fulfilled' ? yahoo.value?.quotes : [],
            {
                openfigi:
                    figi.status === 'fulfilled' && !figi.value?.[0]?.error
                        ? 'ok'
                        : 'unavailable',
                yahoo: yahoo.status === 'fulfilled' ? 'ok' : 'unavailable',
            }
        );
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(isin, {
            result,
            expiresAt:
                now() +
                (result.candidates.some((row) => row.crossChecked)
                    ? 6 * 60 * 60 * 1000
                    : 60000),
        });
        return result;
    };
}

export const lookupIsin = createIsinLookup();
