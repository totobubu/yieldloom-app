import { dividendAvailability } from './dividend-availability.js';
import { verifiedUnderlying } from './security-underlyings.js';
const cadence = {
    weekly: '매주',
    monthly: '매월',
    quarterly: '분기',
    semiannual: '반기',
    annual: '매년',
};
export function underlyingProducts(rows, underlying, distributions = {}) {
    return comparisonProducts(
        rows.filter(
            (row) => row.underlying === underlying && row.symbol !== underlying
        ),
        distributions
    );
}
export function comparisonProducts(rows, distributions = {}) {
    const events = new Map(
        (distributions?.tickers || []).map((row) => [row.ticker, row.latest])
    );
    return rows.map((row) => {
        const link = verifiedUnderlying(row.symbol),
            event = events.get(row.symbol);
        const dividendStatus = dividendAvailability({
            security: row,
            distribution: event || {},
        });
        return {
            ...row,
            verified: Boolean(link),
            strategy: link?.strategy || 'unknown',
            direction: link?.direction || 'unknown',
            leverage: link?.leverage ?? null,
            dividendStatus,
            frequency:
                dividendStatus === 'none'
                    ? '해당 없음'
                    : cadence[event?.frequency || row.frequency] ||
                      row.frequency ||
                      '미확인',
            dividend:
                event?.distribution_per_share ??
                row.dividendEvidence?.latestAmount ??
                null,
            exDate:
                event?.ex_date || row.dividendEvidence?.latestExDate || null,
            source: link?.evidence || null,
        };
    });
}
export function comparableMetric(metric) {
    if (
        !metric ||
        !['available', 'provider_adjusted_estimate'].includes(metric.status) ||
        metric.value == null ||
        metric.value === '' ||
        !Number.isFinite(Number(metric.value))
    )
        return null;
    return {
        value: Number(metric.value),
        asOfDate: metric.asOfDate || null,
        startDate: metric.actualStartDate || metric.windowStart || null,
        estimated: metric.status === 'provider_adjusted_estimate',
    };
}
export function candleRisk(
    payload,
    asOf = new Date().toISOString().slice(0, 10)
) {
    const from = new Date(`${asOf}T00:00:00Z`);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    const start = from.toISOString().slice(0, 10);
    if (
        (payload.events || []).some(
            (row) =>
                row.kind === 'split' && row.date >= start && row.date <= asOf
        )
    )
        return { unavailable: '기간 중 분할 보정 확인 필요' };
    const rows = (payload.candles || [])
        .filter(
            (row) =>
                row.date >= start &&
                row.date <= asOf &&
                typeof row.close === 'number' &&
                Number.isFinite(row.close) &&
                row.close > 0
        )
        .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) return { unavailable: '가격 이력 부족' };
    let peak = rows[0].close,
        drawdown = 0;
    for (const row of rows) {
        peak = Math.max(peak, row.close);
        drawdown = Math.min(drawdown, row.close / peak - 1);
    }
    return {
        priceReturn: (rows.at(-1).close / rows[0].close - 1) * 100,
        maxDrawdown: drawdown * 100,
        startDate: rows[0].date,
        endDate: rows.at(-1).date,
    };
}
