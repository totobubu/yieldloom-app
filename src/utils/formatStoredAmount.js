// Presentation only: retain the supplied currency/precision; never fill or convert.
export function formatStoredAmount(value, currency = '') {
    if (value == null || value === '' || !Number.isFinite(Number(value)))
        return '미확인';
    if (!/^[A-Z]{3}$/.test(currency))
        return `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 8 })} ${currency || '통화 미확인'}`;
    return new Intl.NumberFormat(currency === 'KRW' ? 'ko-KR' : 'en-US', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: currency === 'KRW' ? 0 : 2,
        maximumFractionDigits: 8,
    }).format(Number(value));
}
