import { apiUrl } from './apiUrl.js';
import { publicJsonFor } from './publicJson.js';

// Quotes and candles share one public response; no account or position enters this key.
export function loadStockPrices(
    symbol,
    { signal, force = false, fetcher = fetch } = {}
) {
    const ticker = String(symbol).trim().toUpperCase();
    return publicJsonFor(fetcher)(
        apiUrl(`/api/stock-prices?ticker=${encodeURIComponent(ticker)}`),
        {
            signal,
            force,
            ttlMs: 60_000,
            validate: (payload) =>
                String(payload?.symbol).toUpperCase() === ticker &&
                Array.isArray(payload.candles),
        }
    );
}
