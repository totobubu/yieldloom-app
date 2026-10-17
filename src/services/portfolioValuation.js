import { loadStockPrices } from './stockPrices.js';
import { validCalendarDate } from './portfolioCalendar.js';

const numeric = (value) =>
    value == null || value === '' || typeof value === 'boolean'
        ? null
        : Number.isFinite(Number(value))
          ? Number(value)
          : null;
const daysBetween = (later, earlier) =>
    (Date.parse(later) - Date.parse(earlier)) / 86400000;
export const valuationToday = () => new Date().toISOString().slice(0, 10);
export const valuationSymbol = (value) =>
    String(value ?? '')
        .trim()
        .toUpperCase();
const validSymbol = (value) => /^[A-Z0-9^][A-Z0-9.^=-]{0,29}$/.test(value);

// Public prices only. Quantities, accounts and identities never leave this caller.
export async function loadValuationQuotes(
    symbols,
    { fetcher = fetch, signal, limit = 100, force = false } = {}
) {
    const unique = [...new Set(symbols.map(valuationSymbol))].filter(
        (symbol) => symbol !== 'CASH' && validSymbol(symbol)
    );
    const requested = unique.slice(0, limit);
    const batchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000);
    const quotes = {};
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, requested.length) }, async () => {
            while (cursor < requested.length && !batchSignal.aborted) {
                const symbol = requested[cursor++];
                try {
                    const payload = await loadStockPrices(symbol, {
                        fetcher,
                        force,
                        signal: AbortSignal.any([
                            batchSignal,
                            AbortSignal.timeout(15000),
                        ]),
                    });
                    if (batchSignal.aborted) throw batchSignal.reason;
                    if (valuationSymbol(payload.symbol) !== symbol)
                        throw new Error('시세 종목 불일치');
                    const latest = [...(payload.candles || [])]
                        .filter((row) => validCalendarDate(row.date))
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .at(-1);
                    quotes[symbol] = {
                        price: latest?.close,
                        date: latest?.date,
                        currency: payload.currency,
                        source: payload.source,
                        splits: (payload.events || []).filter(
                            (e) => e.kind === 'split'
                        ),
                    };
                } catch {
                    if (!signal?.aborted)
                        quotes[symbol] = {
                            error: '시세 조회 실패 · 다시 시도해 주세요',
                        };
                }
            }
        })
    );
    return { quotes, omitted: unique.slice(limit) };
}

export function valuePortfolio(
    positions,
    quotes,
    { today = valuationToday() } = {}
) {
    const rows = positions.map((position) => {
        const symbol = valuationSymbol(position.symbol);
        const quote = quotes[symbol];
        const quantity = numeric(position.quantity);
        const baseline = numeric(position.amount);
        const price = numeric(quote?.price);
        let reason = '';
        if (symbol === 'CASH') reason = '현금은 자료 평가액에서 확인';
        else if (quantity == null || quantity < 0)
            reason = '보유 수량 확인 필요';
        else if (!validCalendarDate(position.asOf))
            reason = '잔고 기준일 확인 필요';
        else if (!quote) reason = '시세 미확인 또는 조회 한도 초과';
        else if (quote.error) reason = quote.error;
        else if (
            !/^[A-Z]{3}$/.test(position.currency) ||
            quote.currency !== position.currency
        )
            reason = '시세·잔고 통화 불일치';
        else if (!(price > 0) || !Number.isFinite(price * quantity))
            reason = '유효한 가격 확인 필요';
        else if (!validCalendarDate(quote.date) || quote.date > today)
            reason = '시세 기준일 확인 필요';
        else if (daysBetween(today, quote.date) > 7)
            reason = '7일 초과된 시세 · 평가 제외';
        else if (position.asOf > quote.date)
            reason = '잔고보다 이전 시세 · 평가 제외';
        else if (
            (quote.splits || []).some(
                (event) =>
                    !validCalendarDate(event.date) ||
                    (event.date > position.asOf && event.date <= today)
            )
        )
            reason = '잔고 이후 분할·병합 확인 필요';
        const value = reason ? null : quantity * price;
        return {
            ...position,
            symbol,
            baseline,
            price,
            value,
            reason,
            priceDate: quote?.date || null,
            source: quote?.source || null,
            oldSnapshot:
                validCalendarDate(position.asOf) &&
                daysBetween(today, position.asOf) > 30,
            difference:
                value != null && baseline != null ? value - baseline : null,
        };
    });
    const currencies = new Map();
    for (const row of rows.filter((row) => row.symbol !== 'CASH')) {
        const group = currencies.get(row.currency) || {
            currency: row.currency,
            total: 0,
            valued: 0,
            count: 0,
            baseline: 0,
            pairedValue: 0,
            compared: 0,
            dates: [],
        };
        group.count++;
        if (row.value != null) {
            group.total += row.value;
            group.valued++;
            group.dates.push(row.priceDate);
            if (row.baseline != null) {
                group.baseline += row.baseline;
                group.pairedValue += row.value;
                group.compared++;
            }
        }
        currencies.set(row.currency, group);
    }
    return {
        rows,
        currencies: [...currencies.values()].map((group) => ({
            ...group,
            total: group.valued ? group.total : null,
            difference: group.compared
                ? group.pairedValue - group.baseline
                : null,
            oldestPriceDate: [...group.dates].sort()[0],
            newestPriceDate: [...group.dates].sort().at(-1),
        })),
        excluded: rows.filter(
            (row) => row.value == null && row.symbol !== 'CASH'
        ).length,
        oldSnapshots: rows.filter((row) => row.oldSnapshot).length,
    };
}
