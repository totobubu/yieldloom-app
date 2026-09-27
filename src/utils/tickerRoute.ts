// src/utils/tickerRoute.ts

interface MarketMeta {
    market: string | null;
    suffix: string | null;
}

type MarketSlugMeta = Record<string, MarketMeta>;
type MarketNameToSlug = Record<string, string>;
type SuffixToSlug = Record<string, string>;

const MARKET_SLUG_META: MarketSlugMeta = {
    nyse: { market: 'NYSE', suffix: null },
    nasdaq: { market: 'NASDAQ', suffix: null },
    amex: { market: 'AMEX', suffix: null },
    otc: { market: 'OTC', suffix: null },
    global: { market: null, suffix: null },
};

const MARKET_NAME_TO_SLUG: MarketNameToSlug = Object.entries(
    MARKET_SLUG_META
).reduce((map, [slug, meta]) => {
    if (meta.market) map[meta.market] = slug;
    return map;
}, {} as MarketNameToSlug);

const SYMBOL_SUFFIX_TO_SLUG: SuffixToSlug = {};

const LEGACY_SUFFIX_TO_SLUG: SuffixToSlug = {};

const DEFAULT_MARKET_SLUG = 'global';

/**
 * 티커 심볼에서 접미사 제거
 */
export const stripTickerSuffix = (symbol: string): string => {
    const match = symbol.match(/^(.*)\.([A-Z]+)$/);
    if (!match) return symbol;
    const [, base, suffix] = match;
    if (SYMBOL_SUFFIX_TO_SLUG[suffix]) {
        return base;
    }
    return symbol;
};

/**
 * 티커 파라미터 정규화
 */
const sanitizeTickerParam = (ticker: string): string =>
    ticker.replace(/\./g, '-').toLowerCase();

/**
 * 마켓 이름으로 마켓 슬러그 조회
 */
export const getMarketSlugFromMarketName = (
    market: string | null | undefined
): string | null => {
    if (!market) return null;
    return MARKET_NAME_TO_SLUG[market.toUpperCase()] || null;
};

/**
 * 라우트 파라미터에서 심볼 구성
 */
export const buildSymbolFromRouteParams = (
    _marketSlug: string,
    tickerParam: string
): string => {
    const normalizedTicker = (tickerParam || '').toString().trim();
    const base = normalizedTicker.replace(/-/g, '.').toUpperCase();
    if (!base) return '';
    return base;
};

/**
 * 라우트 파라미터에서 정규화된 티커 구성
 */
export const buildSanitizedTickerFromRouteParams = (
    marketSlug: string,
    tickerParam: string
): string => {
    const symbol = buildSymbolFromRouteParams(marketSlug, tickerParam);
    return symbol ? symbol.replace(/\./g, '-').toLowerCase() : '';
};

/**
 * 라우트 파라미터 타입
 */
export interface RouteParams {
    market: string;
    ticker: string;
}

/**
 * 심볼에서 라우트 파라미터 생성
 */
export const getRouteParamsFromSymbol = (
    symbol: string,
    marketName?: string
): RouteParams | null => {
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

/**
 * 레거시 티커에서 라우트 파라미터 구성
 */
export const buildRouteParamsFromLegacyTicker = (
    legacyTicker: string
): RouteParams | null => {
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
