// src/store/instruments.ts

import { reactive } from 'vue';
import { getDataUrl } from '@/utils/dataUrl';
import type { Currency } from '@/types/common';
import { loadCoreDirectory, loadCoreInstrument, type CoreInstrument } from '@/services/coreRelease';

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

const coreInstrumentToInstrument = (instrument: CoreInstrument): Instrument => ({
    ...instrument,
    symbol: instrument.symbol,
    isin: instrument.isin || undefined,
    currency: instrument.currency as Currency,
    koName: instrument.koName || undefined,
    longName: instrument.longName || undefined,
    upcoming: !instrument.active,
});

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

export const loadInstrumentDetails = async (symbol: string): Promise<Instrument | null> => {
    await ensureInstrumentDirectory();
    const instrument = resolveInstrumentBySymbol(symbol);
    if (!instrument) return null;
    try {
        const detail = await loadCoreInstrument(instrument as CoreInstrument);
        registerInstruments([coreInstrumentToInstrument(detail)]);
        return resolveInstrumentBySymbol(symbol);
    } catch (error) {
        // A directory hit is sufficient for navigation; a detail failure must
        // not force a legacy nav.json request.
        console.warn('[InstrumentDirectory] core instrument detail load failed:', error);
        return instrument;
    }
};

export const ensureInstrumentDirectory = async () => {
    if (instrumentState.hasNavSnapshot) return;

    if (!navLoadPromise) {
        navLoadPromise = (async () => {
            try {
                await loadSymbolIsinSnapshot();
                const coreDirectory = await loadCoreDirectory();
                registerInstruments(
                    coreDirectory.map(coreInstrumentToInstrument),
                    { markInitialized: true }
                );
            } catch (error) {
                console.error(
                    '[InstrumentDirectory] core catalog load failed:',
                    error
                );
                // Keep the small symbol/ISIN snapshot usable in offline and
                // pre-migration environments without falling back to nav.json.
                instrumentState.hasNavSnapshot = true;
            } finally {
                navLoadPromise = null;
            }
        })();
    }

    await navLoadPromise;
};
