import { corporateActionReviewForPeriod } from '../../../lib/corporate-action-review.js';
// Coverage is evidence for a requested interval, never inferred from first/last rows.
export function calculationCoverage(ticker, start, end, datasets = ['market-prices', 'dividends']) {
    const coverage = ticker?.collectionCoverage ?? ticker?.sourceStatus?.collectionCoverage ?? {};
    const conflicts = new Set([
        ...(ticker?.coverage?.conflictingDates ?? []),
        ...Object.values(coverage).flatMap(value => value?.conflictingDates ?? []),
    ]);
    const conflict = [...conflicts].some(date => date >= start && date <= end)
        || corporateActionReviewForPeriod(ticker?.sourceStatus, start, end)
        || (ticker?.backtestData ?? []).some(row => row.date >= start && row.date <= end && row.verificationStatus === 'needs_review');
    const complete = !conflict && datasets.every(dataset => {
        const item = coverage[dataset];
        return item?.complete === true && item.start <= start && item.end >= end
            && !(item.missingIntervals ?? item.gaps)?.some(gap => gap.start <= end && gap.end >= start);
    });
    return { start, end, complete, status: conflict ? 'conflict' : complete ? 'complete' : 'partial',
        message: conflict ? '요청 기간의 데이터 충돌·분할 조정 검토가 필요해 계산을 보류합니다.'
            : complete ? '' : '참고 계산 · 요청 기간의 시세·배당 전체 이력은 검증되지 않았습니다. 누락된 배당은 결과에 포함되지 않습니다.' };
}
