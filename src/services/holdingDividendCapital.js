import { tracePortfolioFunding } from './portfolioFundingTrace.js';

const finite = (value) => {
    if (
        value == null ||
        value === '' ||
        typeof value === 'boolean' ||
        !Number.isFinite(Number(value))
    )
        return null;
    return Number(value);
};

const normalizedSymbol = (value) =>
    String(value || '')
        .trim()
        .toUpperCase();
const day = (value) =>
    String(value || '')
        .replace(/\D/g, '')
        .slice(0, 8);
const tradeCurrency = (trade) =>
    finite(trade.nativeSettlementAmount) > 0 || finite(trade.nativeAmount) > 0
        ? 'USD'
        : trade.currency;

export function holdingDividendCapital(
    states,
    positions,
    { currency, today = new Date().toISOString().slice(0, 10) } = {}
) {
    const combined = Object.fromEntries(
        ['entries', 'classifications', 'trades', 'allocations'].map((key) => [
            key,
            states.flatMap(({ accountId, state }) =>
                (state?.[key] || []).map((row) => ({
                    ...row,
                    accountId,
                }))
            ),
        ])
    );
    const trace = tracePortfolioFunding(combined);
    const held = new Set(
        positions
            .filter(
                (position) =>
                    position.symbol !== 'CASH' &&
                    position.currency === currency &&
                    finite(position.quantity) > 0
            )
            .map(
                (position) =>
                    `${position.accountId}:${normalizedSymbol(position.symbol)}`
            )
    );
    const traceRows = new Map(
        (trace.stocks || []).map((row) => [
            `${row.accountId}:${normalizedSymbol(row.symbol)}`,
            row,
        ])
    );
    const dividends = new Map();
    for (const trade of combined.trades) {
        if (
            !['dividend', 'dividend_reversal'].includes(trade.type) ||
            tradeCurrency(trade) !== currency
        )
            continue;
        const key = `${trade.accountId}:${normalizedSymbol(trade.symbol)}`;
        if (!held.has(key)) continue;
        const item = dividends.get(key) || { amount: 0, unknown: 0 };
        const date = day(trade.date);
        const settlement = finite(
            currency === 'USD'
                ? trade.nativeSettlementAmount
                : trade.settlementAmount
        );
        if (!/^\d{8}$/.test(date) || date > day(today) || settlement === null)
            item.unknown++;
        else
            item.amount +=
                Math.abs(settlement) *
                (trade.type === 'dividend_reversal' ? -1 : 1);
        dividends.set(key, item);
    }

    const grouped = new Map();
    for (const key of held) {
        const symbol = key.slice(key.indexOf(':') + 1);
        const funding = traceRows.get(key);
        const dividend = dividends.get(key) || { amount: 0, unknown: 0 };
        const row = grouped.get(symbol) || {
            symbol,
            principalHeld: 0,
            reinvestedHeld: 0,
            unknownHeld: 0,
            initialPrincipal: 0,
            dividends: 0,
            dividendUnknown: 0,
            fundingUnknown: false,
        };
        if (!funding) row.fundingUnknown = true;
        else {
            row.principalHeld += funding.principalHeld;
            row.reinvestedHeld += funding.reinvestedHeld;
            row.unknownHeld += funding.unknownHeld;
            row.initialPrincipal += funding.direct;
        }
        row.dividends += dividend.amount;
        row.dividendUnknown += dividend.unknown;
        grouped.set(symbol, row);
    }

    const rows = [...grouped.values()]
        .map((row) => {
            const knownCost = row.principalHeld + row.reinvestedHeld;
            return {
                ...row,
                knownCost,
                totalCost: knownCost + row.unknownHeld,
                reinvestmentRate:
                    knownCost > 0
                        ? (row.reinvestedHeld / knownCost) * 100
                        : null,
                dividendRate:
                    !row.fundingUnknown &&
                    row.dividendUnknown === 0 &&
                    row.initialPrincipal > 0
                        ? (row.dividends / row.initialPrincipal) * 100
                        : null,
            };
        })
        .sort(
            (a, b) =>
                b.totalCost - a.totalCost || a.symbol.localeCompare(b.symbol)
        );
    const initialPrincipal = rows.reduce(
        (sum, row) => sum + row.initialPrincipal,
        0
    );
    const dividendAmount = rows.reduce((sum, row) => sum + row.dividends, 0);
    const investedCost = rows.reduce((sum, row) => sum + row.totalCost, 0);
    const complete = rows.every(
        (row) => !row.fundingUnknown && row.dividendUnknown === 0
    );
    return {
        rows,
        initialPrincipal,
        investedCost,
        dividends: dividendAmount,
        dividendRate:
            complete && initialPrincipal > 0
                ? (dividendAmount / initialPrincipal) * 100
                : null,
        complete,
        unavailable: trace.unavailable === true,
        warnings: trace.warnings || [],
    };
}
