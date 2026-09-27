// src/utils/tickerRoute.js
const MARKET_SLUG_META = {
    nyse: { market: 'NYSE', suffix: null },
    nasdaq: { market: 'NASDAQ', suffix: null },
    amex: { market: 'AMEX', suffix: null },
    otc: { market: 'OTC', suffix: null },
    global: { market: null, suffix: null },
};

const MARKET_NAME_TO_SLUG = Object.entries(MARKET_SLUG_META).reduce(
    (map, [slug, meta]) => {
        if (meta.market) map[meta.market] = slug;
        return map;
    },
    {}
);

const SYMBOL_SUFFIX_TO_SLUG = {};

const LEGACY_SUFFIX_TO_SLUG = {};

const DEFAULT_MARKET_SLUG = 'global';

export const stripTickerSuffix = (symbol) => {
    const match = symbol.match(/^(.*)\.([A-Z]+)$/);
    if (!match) return symbol;
    const [, base, suffix] = match;
    if (SYMBOL_SUFFIX_TO_SLUG[suffix]) {
        return base;
    }
    return symbol;
};

const sanitizeTickerParam = (ticker) =>
    ticker.replace(/\./g, '-').toLowerCase();

export const getMarketSlugFromMarketName = (market) => {
    if (!market) return null;
    return MARKET_NAME_TO_SLUG[market.toUpperCase()] || null;
};

export const buildSymbolFromRouteParams = (marketSlug, tickerParam) => {
    const normalizedTicker = (tickerParam || '').toString().trim();
    const base = normalizedTicker.replace(/-/g, '.').toUpperCase();
    if (!base) return '';
    return base;
};

export const buildSanitizedTickerFromRouteParams = (
    marketSlug,
    tickerParam
) => {
    const symbol = buildSymbolFromRouteParams(marketSlug, tickerParam);
    return symbol ? symbol.replace(/\./g, '-').toLowerCase() : '';
};

export const getRouteParamsFromSymbol = (symbol, marketName) => {
    if (!symbol) return null;
    const normalizedSymbol = symbol.toUpperCase();
    const suffixMatch = normalizedSymbol.match(/\.([A-Z]+)$/);
    let marketSlug =
        (suffixMatch && SYMBOL_SUFFIX_TO_SLUG[suffixMatch[1]]) || null;

    if (!marketSlug && marketName) {
        marketSlug = getMarketSlugFromMarketName(marketName);
    }

    if (!marketSlug) {
        marketSlug = DEFAULT_MARKET_SLUG;
    }

    const baseSymbol = stripTickerSuffix(normalizedSymbol);
    return {
        market: marketSlug,
        ticker: sanitizeTickerParam(baseSymbol),
    };
};

export const buildRouteParamsFromLegacyTicker = (legacyTicker) => {
    if (!legacyTicker) return null;
    const normalized = legacyTicker.toString().trim().toLowerCase();
    if (!normalized) return null;

    const match = normalized.match(/^(.*?)(?:-([a-z0-9]+))?$/);
    if (!match) {
        return { market: DEFAULT_MARKET_SLUG, ticker: normalized };
    }

    const [, base, suffix] = match;
    const marketSlug =
        (suffix && LEGACY_SUFFIX_TO_SLUG[suffix]) || DEFAULT_MARKET_SLUG;

    return {
        market: marketSlug,
        ticker: base,
    };
};
