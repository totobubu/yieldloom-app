const TAX_RATE = 0.15;
const MAX_SAMPLES = 24;
const MIN_SAMPLES = 6;

const asDate = (value) => new Date(`${value}T12:00:00Z`);
const dateKey = (value) => value.toISOString().slice(0, 10);
const finitePositive = (value) =>
    Number.isFinite(Number(value)) && Number(value) > 0;
const amount = (row) => Number(row.amountFixed ?? row.amount ?? 0);
const oneCalendarYearEarlier = (value) => {
    const date = asDate(value);
    date.setUTCFullYear(date.getUTCFullYear() - 1);
    return dateKey(date);
};

const usablePriceRows = (rows, asOfDate) =>
    (rows ?? [])
        .filter(
            (row) =>
                row?.date &&
                row.date <= asOfDate &&
                !row.forecasted &&
                finitePositive(row.close)
        )
        .sort((left, right) => left.date.localeCompare(right.date));

const monthlyEntryRows = (rows) => {
    const firstByMonth = new Map();
    rows.forEach((row) => {
        const month = row.date.slice(0, 7);
        if (!firstByMonth.has(month)) firstByMonth.set(month, row);
    });
    return [...firstByMonth.values()].slice(-MAX_SAMPLES);
};

/**
 * Builds an entry-yield series without using distributions that were unknown
 * at the hypothetical purchase date. Returns null-like availability metadata
 * rather than extrapolating when the history is too short.
 */
export function calculateEntryIncomeEfficiency(ticker, options = {}) {
    const asOfDate = options.asOfDate ?? dateKey(new Date());
    const rows = ticker?.backtestData ?? [];
    const prices = usablePriceRows(rows, asOfDate);
    const dividends = (rows ?? [])
        .filter(
            (row) =>
                row?.date &&
                row.date <= asOfDate &&
                !row.forecasted &&
                finitePositive(amount(row))
        )
        .sort((left, right) => left.date.localeCompare(right.date));

    if (!prices.length) {
        return { available: false, reason: '유효한 실제 종가 이력이 없습니다.', samples: [] };
    }

    const firstPriceDate = prices[0].date;
    const samples = monthlyEntryRows(prices)
        .map((entry) => {
            const cutoff = oneCalendarYearEarlier(entry.date);
            if (firstPriceDate > cutoff) return null;
            const trailingDividend = dividends
                .filter((row) => row.date >= cutoff && row.date < entry.date)
                .reduce((total, row) => total + amount(row), 0);
            if (!finitePositive(trailingDividend)) return null;

            const price = Number(entry.close);
            const afterTaxAnnualDividend = trailingDividend * (1 - TAX_RATE);
            return {
                date: entry.date,
                month: entry.date.slice(2, 7).replace('-', '.'),
                price,
                preTaxAnnualDividend: trailingDividend,
                afterTaxAnnualDividend,
                afterTaxYield: (afterTaxAnnualDividend / price) * 100,
                paybackYears: price / afterTaxAnnualDividend,
            };
        })
        .filter(Boolean);

    if (samples.length < MIN_SAMPLES) {
        return {
            available: false,
            reason: '최근 24개월 중 1년 배당 이력이 확인된 매수 시점이 부족합니다.',
            samples,
        };
    }

    const best = samples.reduce((winner, sample) =>
        sample.afterTaxYield > winner.afterTaxYield ? sample : winner
    );
    return {
        available: true,
        symbol: ticker?.symbol ?? ticker?.tickerInfo?.symbol ?? '',
        asOfDate,
        taxRate: TAX_RATE,
        samples,
        best,
        latest: samples.at(-1),
        maxYield: Math.max(...samples.map((sample) => sample.afterTaxYield)),
        minYield: Math.min(...samples.map((sample) => sample.afterTaxYield)),
    };
}
