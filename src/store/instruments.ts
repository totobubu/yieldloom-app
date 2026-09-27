// src/store/instruments.ts

import { reactive } from 'vue';
import { getDataUrl } from '@/utils/dataUrl';
import type { Currency } from '@/types/common';

export interface Instrument {
    symbol: string;
    isin?: string;
    market?: string;
    currency?: Currency;
    koName?: string;
    longName?: string;
    company?: string;
    isEtf?: boolean;
    [key: string]: any;
}

const normalizeSymbol = (symbol: any): string | null =>
    typeof symbol === 'string' ? symbol.trim().toUpperCase() : null;
const normalizeIsin = (isin: any): string | null =>
    typeof isin === 'string' ? isin.trim().toUpperCase() : null;

export const instrumentState = reactive<{
    bySymbol: Record<string, Instrument>;
    byIsin: Record<string, Instrument>;
    hasNavSnapshot: boolean;
}>({
    bySymbol: {},
    byIsin: {},
    hasNavSnapshot: false,
});

let navLoadPromise: Promise<void> | null = null;

const loadSymbolIsinSnapshot = async () => {
    try {
        const response = await fetch(getDataUrl('symbol-to-isin.json'));
        if (!response.ok) return;
        const snapshot = await response.json();
        if (Array.isArray(snapshot)) {
            registerInstruments(snapshot);
        } else if (snapshot && typeof snapshot === 'object') {
            const entries = Object.entries(snapshot).map(([symbol, value]: [string, any]) => {
                if (typeof value === 'string') {
                    return { symbol, isin: value };
                }
                return {
                    symbol,
                    isin: value?.isin,
                    market: value?.market,
                    currency: value?.currency,
                };
            });
            registerInstruments(entries);
        }
    } catch (error) {
        console.warn(
            '[InstrumentDirectory] symbol-to-isin.json 로드 실패:',
            error
        );
    }
};

const mergeInstrument = (existing: Instrument | undefined, incoming: Partial<Instrument>): Instrument => {
    const merged = { ...existing, ...incoming } as Instrument;
    // symbol/isin는 항상 대문자로 유지
    if (merged.symbol) merged.symbol = normalizeSymbol(merged.symbol) || merged.symbol;
    if (merged.isin) merged.isin = normalizeIsin(merged.isin) || merged.isin;
    return merged;
};

export const registerInstruments = (
    tickers: any[] = [],
    { markInitialized = false } = {}
) => {
    if (!Array.isArray(tickers)) return;

    tickers.forEach((ticker) => {
        if (!ticker) return;

        const symbol = normalizeSymbol(ticker.symbol);
        const isin = normalizeIsin(ticker.isin);

        const payload: Partial<Instrument> = {
            ...ticker,
            symbol: symbol || ticker.symbol,
            isin: isin || ticker.isin,
        };

        if (symbol) {
            instrumentState.bySymbol[symbol] = mergeInstrument(
                instrumentState.bySymbol[symbol],
                payload
            );
        }

        if (isin) {
            instrumentState.byIsin[isin] = mergeInstrument(instrumentState.byIsin[isin], payload);
            if (symbol) {
                instrumentState.bySymbol[symbol] = mergeInstrument(
                    instrumentState.bySymbol[symbol],
                    {
                        isin,
                    }
                );
            }
        }
    });

    if (markInitialized) {
        instrumentState.hasNavSnapshot = true;
    }
};

export const resolveInstrumentBySymbol = (symbol: string): Instrument | null => {
    const normalized = normalizeSymbol(symbol);
    return normalized ? instrumentState.bySymbol[normalized] || null : null;
};

export const resolveInstrumentByIsin = (isin: string): Instrument | null => {
    const normalized = normalizeIsin(isin);
    return normalized ? instrumentState.byIsin[normalized] || null : null;
};

export const resolveInstrument = ({ symbol, isin }: { symbol?: string; isin?: string } = {}): Instrument | null => {
    const byIsin = isin ? resolveInstrumentByIsin(isin) : null;
    if (byIsin) return byIsin;
    return symbol ? resolveInstrumentBySymbol(symbol) : null;
};

export const ensureInstrumentDirectory = async () => {
    if (instrumentState.hasNavSnapshot) return;

    if (!navLoadPromise) {
        navLoadPromise = (async () => {
            try {
                await loadSymbolIsinSnapshot();
                const response = await fetch(getDataUrl('nav.json'));
                if (!response.ok) {
                    throw new Error(
                        `nav.json fetch 실패 (status: ${response.status})`
                    );
                }

                const navData = await response.json();
                const navTickers = Array.isArray(navData?.nav)
                    ? navData.nav
                    : [];
                registerInstruments(navTickers, { markInitialized: true });
            } catch (error) {
                console.error(
                    '[InstrumentDirectory] nav.json 로드 실패:',
                    error
                );
            } finally {
                navLoadPromise = null;
            }
        })();
    }

    await navLoadPromise;
};
