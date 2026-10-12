export const formatShareDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return '날짜 미정';
    const [, month, day] = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return `${Number(month)}/${Number(day)}`;
};

export const formatShareAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? `$${amount.toFixed(6).replace(/\.?0+$/, '')}` : '확정 배당 정보 없음';
};

// Keep this short enough for social previews while using only confirmed dividend rows.
export const createShareText = ({ symbol, hasDividend, currentDividendAmount, exDate }) =>
    hasDividend
        ? `${symbol} 최신 배당 ${formatShareAmount(currentDividendAmount)} · 배당락일 ${formatShareDate(exDate)} · Yieldloom에서 확인`
        : `${symbol} 배당 정보 · Yieldloom에서 확인`;
