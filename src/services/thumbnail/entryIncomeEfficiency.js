import { calculationCoverage } from './calculationCoverage.js';
import { reviewedFundLifecycle } from '../../../lib/fund-lifecycle.js';
const TAX_RATE = 0.15;
const MAX_SAMPLES = 24;
const MIN_SAMPLES = 1;
const validDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const previousDay = (value) =>
    dateKey(new Date(asDate(value).getTime() - 86400000));

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
                validDate(row?.date) &&
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
    if (ticker?.sourceStatus?.corporateActionReview) {
        return {
            available: false,
            reason: '조회 기간에 주식 분할·병합 이력이 있어 과거 매수 시점별 배당률을 제공하지 않습니다. 가격과 배당금의 조정 기준 검증이 필요합니다. 개인 보유량 조회와는 별개입니다.',
            asOfDate,
            samples: [],
        };
    }
    const rows = ticker?.backtestData ?? [];
    const prices = usablePriceRows(rows, asOfDate);
    const dividends = (rows ?? [])
        .filter(
            (row) =>
                validDate(row?.date) &&
                row.date <= asOfDate &&
                !row.forecasted &&
                (!row.declaredDate ||
                    (validDate(row.declaredDate) &&
                        row.declaredDate <= asOfDate)) &&
                finitePositive(amount(row))
        )
        .sort((left, right) => left.date.localeCompare(right.date));

    if (!prices.length) {
        return {
            available: false,
            reason: '유효한 실제 종가 이력이 없습니다.',
            samples: [],
        };
    }

    const firstPriceDate = prices[0].date;
    const symbol = ticker?.symbol ?? ticker?.tickerInfo?.symbol ?? '';
    // fundLifecycle/options.lifecycleEvidence are reviewed API-adapter contracts.
    // Never use an unqualified catalog ipoDate or collection start here.
    const candidate =
        options.lifecycleEvidence ??
        ticker?.fundLifecycle ??
        reviewedFundLifecycle(symbol);
    const lifecycle =
        candidate?.symbol === symbol &&
        candidate.dateMeaning === 'first_trade' &&
        candidate.verificationStatus === 'official_reviewed' &&
        validDate(candidate.firstTradeDate) &&
        validDate(candidate.reviewedAt) &&
        /^https:\/\//.test(candidate.sourceUrl ?? '')
            ? candidate
            : null;
    const launchDate = lifecycle?.firstTradeDate;
    const anniversary = launchDate
        ? (() => {
              const d = asDate(launchDate);
              d.setUTCFullYear(d.getUTCFullYear() + 1);
              return dateKey(d);
          })()
        : null;
    const availableDividendRange = dividends.length
        ? { start: dividends[0].date, end: dividends.at(-1).date }
        : null;
    const skipped = { incompleteLaunchHistory: 0, noPriorDividend: 0 };
    let conflictQuality;
    const qualified = monthlyEntryRows(prices)
        .map((entry) => {
            if (launchDate && entry.date < launchDate) return null;
            const cumulative = Boolean(launchDate && entry.date < anniversary);
            const cutoff = cumulative
                ? launchDate
                : oneCalendarYearEarlier(entry.date);
            if (!cumulative && firstPriceDate > cutoff) return null;
            const periodEnd = previousDay(entry.date);
            const quality = calculationCoverage(ticker, cutoff, periodEnd);
            if (quality.status === 'conflict') {
                conflictQuality = quality;
                return null;
            }
            if (
                cumulative &&
                (!quality.complete ||
                    ticker?.sourceStatus?.dividends !== 'official_projection')
            ) {
                skipped.incompleteLaunchHistory++;
                return null;
            }
            const eligible = dividends.filter(
                (row) =>
                    row.date >= cutoff &&
                    row.date < entry.date &&
                    (!row.declaredDate ||
                        (validDate(row.declaredDate) &&
                            row.declaredDate < entry.date))
            );
            if (
                cumulative &&
                eligible.some(
                    (row) =>
                        row.isReference ||
                        !(
                            row.dividendVerified === true ||
                            ['official', 'cross_checked'].includes(
                                row.verificationStatus
                            )
                        ) ||
                        !validDate(row.declaredDate)
                )
            )
                return null;
            const total = eligible.reduce((sum, row) => sum + amount(row), 0);
            if (!finitePositive(total)) {
                skipped.noPriorDividend++;
                return null;
            }
            const price = Number(entry.close);
            const afterTaxDividend = total * (1 - TAX_RATE);
            return {
                date: entry.date,
                month: entry.date.slice(2, 7).replace('-', '.'),
                price,
                basis: cumulative ? 'since_launch' : 'trailing_12m',
                periodStart: cutoff,
                periodEnd,
                periodDays: Math.round(
                    (asDate(entry.date) - asDate(cutoff)) / 86400000
                ),
                preTaxDividend: total,
                afterTaxDividend,
                preTaxAnnualDividend: cumulative ? null : total,
                afterTaxAnnualDividend: cumulative ? null : afterTaxDividend,
                afterTaxYield: (afterTaxDividend / price) * 100,
                paybackYears: cumulative ? null : price / afterTaxDividend,
                quality,
            };
        })
        .filter(Boolean);
    // Never rank a short cumulative interval against a twelve-month interval.
    const annual = qualified.filter((row) => row.basis === 'trailing_12m');
    const samples = annual.length ? annual : qualified;
    const basis = annual.length ? 'trailing_12m' : 'since_launch';
    const lifecycleNote =
        lifecycle?.tickerChanges
            ?.map(
                (change) =>
                    `${change.from}→${change.to} 변경(${change.effectiveAfterClose})은 재출시가 아닙니다.`
            )
            .join(' ') ?? '';
    const context = {
        asOfDate,
        symbol,
        firstPriceDate,
        launchDate,
        lifecycle,
        lifecycleNote,
        availableDividendRange,
        skipped,
    };
    if (samples.length < MIN_SAMPLES) {
        if (conflictQuality)
            return {
                ...context,
                available: false,
                quality: conflictQuality,
                reason: conflictQuality.message,
                samples: [],
            };
        const age =
            anniversary && asOfDate >= anniversary
                ? '분석일에는 출시 후 12개월이 지났습니다. '
                : '';
        const known = launchDate
            ? `공식 최초 거래일 ${launchDate}. ${age}${lifecycleNote} `
            : '공식 최초 거래일은 미확인입니다. 수집 시작일을 출시일로 취급하지 않습니다. ';
        const observed = availableDividendRange
            ? `수집된 배당 범위 ${availableDividendRange.start}~${availableDividendRange.end}. `
            : '확인된 배당 이력이 없습니다. ';
        return {
            ...context,
            available: false,
            reason: `${known}${observed}수집된 시세 이력(${firstPriceDate}~${prices.at(-1).date})만으로 매수일 이전 12개월 또는 출시 이후 전체 배당 범위를 검증할 수 없습니다. 누락 이력을 짧은 신규 펀드 이력이나 0으로 대신하지 않습니다. 실제 보유 기간과는 별개입니다.`,
            samples,
        };
    }
    const quality = calculationCoverage(
        ticker,
        samples[0].periodStart,
        samples.at(-1).periodEnd
    );
    if (quality.status === 'conflict')
        return {
            ...context,
            available: false,
            quality,
            reason: quality.message,
            samples: [],
        };
    const best = samples.reduce((winner, sample) =>
        sample.afterTaxYield > winner.afterTaxYield ? sample : winner
    );
    return {
        launchDate,
        lifecycle,
        lifecycleNote,
        available: true,
        basis,
        quality,
        limitedHistory: samples.length < 6,
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
