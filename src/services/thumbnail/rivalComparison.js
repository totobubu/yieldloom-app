const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_INVESTMENT = 10_000;

const toDate = (value) => new Date(`${value}T12:00:00Z`);
const dateKey = (value) => value.toISOString().slice(0, 10);
const finitePositive = (value) =>
    Number.isFinite(Number(value)) && Number(value) > 0;

const cadenceDays = (frequency) => {
    if (frequency === '매주') return 7;
    if (frequency === '매월') return 30.4375;
    if (frequency === '분기') return 91.3125;
    if (frequency === '반기') return 182.625;
    if (frequency === '매년') return 365.25;
    return null;
};

const buildSeries = (ticker) => {
    const rows = (ticker.backtestData ?? [])
        .filter((row) => row.date && !row.forecasted && finitePositive(row.close))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        symbol: ticker.symbol,
        frequency: ticker.tickerInfo?.frequency,
        ipoDate: ticker.tickerInfo?.ipoDate,
        prices: new Map(rows.map((row) => [row.date, Number(row.close)])),
        dividends: new Map(
            rows
                .filter((row) =>
                    finitePositive(row.amountFixed ?? row.amount)
                )
                .map((row) => [
                    row.date,
                    Number(row.amountFixed ?? row.amount),
                ])
        ),
    };
};

const commonDates = (series) => {
    const [first, ...rest] = series;
    return [...first.prices.keys()]
        .filter((date) => rest.every((item) => item.prices.has(date)))
        .sort();
};

const calculateMetric = (series, startDate, endDate) => {
    const startPrice = series.prices.get(startDate);
    const endPrice = series.prices.get(endDate);
    if (!finitePositive(startPrice) || !finitePositive(endPrice)) return null;

    const initialShares = INITIAL_INVESTMENT / startPrice;
    const dividendEntries = [...series.dividends.entries()].filter(
        ([date]) => date > startDate && date <= endDate
    );
    const cumulativeDividends = dividendEntries.reduce(
        (total, [, perShare]) => total + initialShares * perShare,
        0
    );

    let reinvestedShares = initialShares;
    for (const [date, perShare] of dividendEntries) {
        const reinvestmentPrice = series.prices.get(date);
        if (finitePositive(reinvestmentPrice)) {
            reinvestedShares += (reinvestedShares * perShare) / reinvestmentPrice;
        }
    }

    const periodDays = Math.max(
        1,
        Math.round((toDate(endDate) - toDate(startDate)) / DAY_MS)
    );
    const cadence = cadenceDays(series.frequency);
    const expectedPayments = cadence
        ? Math.max(1, Math.round(periodDays / cadence))
        : null;

    return {
        symbol: series.symbol,
        frequency: series.frequency,
        ipoDate: series.ipoDate,
        startPrice,
        endPrice,
        priceReturn: endPrice / startPrice - 1,
        cumulativeDividends,
        totalReturn: (reinvestedShares * endPrice) / INITIAL_INVESTMENT - 1,
        finalValue: reinvestedShares * endPrice,
        actualPayments: dividendEntries.length,
        expectedPayments,
    };
};

const crownWinners = (items, key) => {
    const values = items
        .map((item) => item[key])
        .filter((value) => Number.isFinite(value));
    if (!values.length) return new Set();
    const winner = Math.max(...values);
    return new Set(
        items.filter((item) => item[key] === winner).map((item) => item.symbol)
    );
};

/**
 * Calculates a like-for-like comparison for a focal fund, one to three rivals,
 * and their common underlying asset. All inputs must already be split-adjusted.
 */
export function calculateRivalComparison(tickers, underlyingTicker, asOfDate) {
    if (
        !Array.isArray(tickers) ||
        tickers.length < 2 ||
        tickers.length > 4 ||
        !underlyingTicker ||
        !asOfDate
    ) {
        return null;
    }

    const series = [...tickers, underlyingTicker].map(buildSeries);
    const dates = commonDates(series);
    if (dates.length < 2) return null;

    const oneYearAgo = new Date(`${asOfDate}T12:00:00Z`);
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    const startDate =
        dates.find((date) => date >= dateKey(oneYearAgo)) ?? dates[0];
    const endDate =
        [...dates].reverse().find((date) => date <= asOfDate) ?? dates.at(-1);
    if (!startDate || !endDate || startDate >= endDate) return null;

    const calculated = series
        .map((item) => calculateMetric(item, startDate, endDate))
        .filter(Boolean);
    if (calculated.length !== series.length) return null;

    const underlying = calculated.at(-1);
    const metrics = calculated.slice(0, -1).map((metric) => ({
        ...metric,
        vsUnderlying: metric.totalReturn - underlying.priceReturn,
    }));

    return {
        initialInvestment: INITIAL_INVESTMENT,
        startDate,
        endDate,
        usesFullYear:
            Math.round((toDate(endDate) - toDate(startDate)) / DAY_MS) >= 358,
        metrics,
        underlying: {
            ...underlying,
            finalValue: INITIAL_INVESTMENT * (1 + underlying.priceReturn),
        },
        crowns: {
            priceReturn: crownWinners(metrics, 'priceReturn'),
            cumulativeDividends: crownWinners(metrics, 'cumulativeDividends'),
            totalReturn: crownWinners(metrics, 'totalReturn'),
        },
    };
}
