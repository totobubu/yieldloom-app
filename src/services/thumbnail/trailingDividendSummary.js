import { calculationCoverage } from './calculationCoverage.js';
const dateKey = (date) => date.toISOString().slice(0, 10);
const validDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) &&
    Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
    dateKey(new Date(value + 'T12:00:00Z')) === value;
const shiftMonths = (value, months) => {
    const date = new Date(value + 'T12:00:00Z');
    const month = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
    );
    const last = new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)
    ).getUTCDate();
    return dateKey(
        new Date(
            Date.UTC(
                month.getUTCFullYear(),
                month.getUTCMonth(),
                Math.min(date.getUTCDate(), last)
            )
        )
    );
};
const nextDay = (value) =>
    dateKey(new Date(Date.parse(value + 'T12:00:00Z') + 86400000));
// Never infer completeness from first/last rows. Collection evidence must cover the requested dividend interval.
export function trailingDividendSummary(
    ticker,
    info = {},
    { today = dateKey(new Date()) } = {}
) {
    const end = ticker?.sourceStatus?.priceDate;
    const base = {
        symbol: info?.symbol || ticker?.symbol || '',
        currency: info?.currency || '',
        start: null,
        end: end || null,
        amount: null,
        yieldPercent: null,
        price: null,
        priceDate: end || null,
        complete: false,
        status: 'partial',
        segments: [],
        message:
            '12개월 전체 배당 이력을 확인하지 못해 합계와 연 배당률을 표시하지 않습니다.',
    };
    if (!validDate(end) || end > today)
        return {
            ...base,
            status: 'unavailable',
            message: '유효한 기준일을 확인하지 못했습니다.',
        };
    if (!/^[A-Z]{3}$/.test(info?.currency || ''))
        return {
            ...base,
            message:
                '통화를 확인하지 못해 배당 합계와 연 배당률을 표시하지 않습니다.',
        };
    const boundaries = [12, 9, 6, 3, 0].map((months) =>
        shiftMonths(end, -months)
    );
    const start = nextDay(boundaries[0]);
    const segments = boundaries.slice(1).map((date, i) => ({
        start: nextDay(boundaries[i]),
        end: date,
        amount: null,
    }));
    const evidence = (
        ticker?.collectionCoverage ?? ticker?.sourceStatus?.collectionCoverage
    )?.dividends;
    const unresolved = () => ({ ...base, start, segments });
    for (const field of ['missingIntervals', 'gaps']) {
        const gaps = evidence?.[field];
        if (
            gaps != null &&
            (!Array.isArray(gaps) ||
                gaps.some(
                    (gap) =>
                        !validDate(gap.start) ||
                        !validDate(gap.end) ||
                        gap.start > gap.end ||
                        (gap.start <= end && gap.end >= start)
                ))
        )
            return unresolved();
    }
    if (
        evidence?.complete &&
        (!validDate(evidence.start) || !validDate(evidence.end))
    )
        return unresolved();
    let coverage;
    try {
        coverage = calculationCoverage(ticker, start, end, ['dividends']);
    } catch {
        return unresolved();
    }

    const rows = [];
    const dates = new Set();
    let invalid = false;
    for (const row of ticker?.backtestData || []) {
        if (
            row.forecasted ||
            (!Object.hasOwn(row, 'amount') &&
                !Object.hasOwn(row, 'amountFixed'))
        )
            continue;
        if (!validDate(row.date)) {
            invalid = true;
            continue;
        }
        if (row.date < start || row.date > end) continue;
        const raw = row.amountFixed ?? row.amount;
        const amount = raw == null || raw === '' ? NaN : Number(raw);
        if (
            !Number.isFinite(amount) ||
            amount < 0 ||
            dates.has(row.date) ||
            (row.currency && row.currency !== info?.currency)
        )
            invalid = true;
        dates.add(row.date);
        rows.push({ ...row, amount });
    }
    const common = {
        ...base,
        start,
        segments,
        referenceData: rows.some((row) => row.isReference),
    };
    if (invalid || coverage.status === 'conflict')
        return {
            ...common,
            status: 'conflict',
            message:
                '기간 내 배당금·중복·통화 또는 분할 조정 검토가 필요해 계산을 보류합니다.',
        };
    if (!coverage.complete || ticker?.sourceStatus?.dividends === 'unavailable')
        return common;
    const amount = rows.reduce((sum, row) => sum + row.amount, 0);
    const rawPrice = info?.price;
    const price = rawPrice == null || rawPrice === '' ? NaN : Number(rawPrice);
    const hasPrice = Number.isFinite(price) && price > 0;
    return {
        ...common,
        complete: true,
        status: 'complete',
        amount,
        price: hasPrice ? price : null,
        yieldPercent: hasPrice ? (amount / price) * 100 : null,
        segments: segments.map((segment) => ({
            ...segment,
            amount: rows
                .filter(
                    (row) =>
                        row.date >= segment.start && row.date <= segment.end
                )
                .reduce((sum, row) => sum + row.amount, 0),
        })),
        message: hasPrice
            ? ''
            : '배당 합계는 확인됐지만 기준 시세가 없어 연 배당률은 표시하지 않습니다.',
    };
}
