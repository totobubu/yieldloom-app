export const formatShareDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return '날짜 미정';
    const [, month, day] = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return `${Number(month)}/${Number(day)}`;
};

export const formatShareAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0
        ? `$${amount.toFixed(6).replace(/\.?0+$/, '')}`
        : '확정 배당 정보 없음';
};

// Preserve reference status in social text as well as the rendered card.
export const createShareText = ({
    symbol,
    hasDividend,
    currentDividendAmount,
    exDate,
    referenceData = false,
}) =>
    hasDividend
        ? `${symbol} 최신 ${referenceData ? '참고 배당' : '배당'} ${formatShareAmount(currentDividendAmount)} · 배당락일 ${formatShareDate(exDate)} · 토또부부 배당 스튜디오에서 확인`
        : `${symbol} 배당 정보 · 토또부부 배당 스튜디오에서 확인`;

const statusSuffix = (status) =>
    status === 'fresh'
        ? ''
        : status === 'stale'
          ? ' · 가격 갱신 지연'
          : ' · 일부 데이터 확인 필요';
const tonePrefix = (tone) =>
    ({ informative: '배당 데이터', concise: '', friendly: '오늘의 배당 체크' })[
        tone
    ] ?? '배당 데이터';

const formatDividendDifference = (value) => {
    if (value == null || !Number.isFinite(Number(value)))
        return '비교 데이터 준비 중';
    const difference = Number(value);
    if (difference === 0) return '변동 없음 ($0)';
    return `${difference > 0 ? '+' : '-'}${formatShareAmount(Math.abs(difference))}`;
};

export function createCardShareText(
    kind,
    data,
    { tone = 'informative', sourceStatus = 'fresh', asOfDate } = {}
) {
    const prefix = tonePrefix(tone);
    const date = asOfDate ? ` · 기준일 ${asOfDate}` : '';
    const current = formatShareAmount(data.currentDividendAmount);
    const copy =
        {
            summary: `${data.symbol} 최신 ${data.referenceData ? '참고' : '확정'} 배당 ${current} · 배당락일 ${formatShareDate(data.exDate)}`,
            comparison: `${data.symbol} ${data.referenceData ? '참고 ' : ''}직전 대비 배당 ${formatDividendDifference(data.dividendDifference)}`,
            rival: `${data.symbol} 동일 기초자산 ETF 비교 결과`,
            calendar: `${data.symbol} 다음 배당 일정과 국내 영업일 기준 입금 예상`,
            'entry-efficiency': `${data.symbol} 과거 매수 시점별 배당률`,
            'holding-dividend': `${data.symbol} 보유 수량 기준 배당 현황`,
        }[kind] ?? `${data.symbol} 배당 정보`;
    return [
        prefix,
        copy,
        date,
        statusSuffix(sourceStatus),
        ' · 토또부부 배당 스튜디오',
    ]
        .filter(Boolean)
        .join(' ');
}
