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

const statusSuffix = (status) => status === 'fresh' ? '' : status === 'stale' ? ' · 가격 갱신 지연' : ' · 일부 데이터 확인 필요';
const tonePrefix = (tone) => ({ informative: '배당 데이터', concise: '', friendly: '오늘의 배당 체크' }[tone] ?? '배당 데이터');

export function createCardShareText(kind, data, { tone = 'informative', sourceStatus = 'fresh', asOfDate } = {}) {
    const prefix = tonePrefix(tone);
    const date = asOfDate ? ` · 기준일 ${asOfDate}` : '';
    const current = formatShareAmount(data.currentDividendAmount);
    const copy = {
        summary: `${data.symbol} 최신 확정 배당 ${current} · 배당락일 ${formatShareDate(data.exDate)}`,
        comparison: `${data.symbol} 직전 대비 배당 ${data.dividendDifference == null ? '비교 데이터 준비 중' : `${data.dividendDifference >= 0 ? '+' : ''}${formatShareAmount(Math.abs(data.dividendDifference))}`}`,
        rival: `${data.symbol} 동일 기초자산 ETF 비교 결과`,
        calendar: `${data.symbol} 다음 배당 일정과 국내 영업일 기준 입금 예상`,
        'entry-efficiency': `${data.symbol} 과거 시점별 배당 진입 효율`,
        'holding-dividend': `${data.symbol} 보유 수량 기준 배당 현황`,
    }[kind] ?? `${data.symbol} 배당 정보`;
    return [prefix, copy, date, statusSuffix(sourceStatus), ' · Yieldloom'].filter(Boolean).join(' ');
}
