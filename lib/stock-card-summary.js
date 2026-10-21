import { inferSecurityType } from './security-filters.js';
const cadence = {
    weekly: '매주',
    monthly: '매월',
    quarterly: '분기',
    semiannual: '반기',
    annual: '매년',
};
export function stockCardSummary(row) {
    const type = inferSecurityType(row) === 'etf' ? 'ETF' : '일반 주식';
    const ipo =
        typeof row.ipoDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.ipoDate)
            ? row.ipoDate
            : null;
    const frequency =
        row.noDividends === true
            ? null
            : cadence[row.frequency] || row.frequency;
    return {
        primaryLabel: ipo ? '상장일' : '상품 유형',
        primaryValue: ipo || type,
        secondaryLabel:
            frequency && frequency !== '미확인'
                ? '등록 지급 주기'
                : row.currency
                  ? '거래 통화'
                  : row.market
                    ? '거래 시장'
                    : '상품 유형',
        secondaryValue:
            frequency && frequency !== '미확인'
                ? frequency
                : row.currency || row.market || type,
        status: row.noDividends === true ? '무배당 상품' : '배당 자료 미확인',
    };
}
