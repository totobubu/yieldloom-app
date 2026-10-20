// Presentation totals never convert currencies or change the imported ledger rows.
export function reviewNumber(value, digits = 6) {
    if (
        value === null ||
        value === undefined ||
        value === '' ||
        !Number.isFinite(Number(value))
    )
        return '—';
    return new Intl.NumberFormat('ko-KR', {
        maximumFractionDigits: digits,
    }).format(Number(value));
}
export function reviewMoney(value, currency, signed = 0) {
    if (reviewNumber(value) === '—') return '—';
    const amount = signed ? Math.abs(Number(value)) * signed : Number(value);
    const prefix =
        currency === 'USD'
            ? '$'
            : currency === 'KRW'
              ? '₩'
              : `${currency || ''} `;
    const number = new Intl.NumberFormat('ko-KR', {
        minimumFractionDigits: currency === 'USD' ? 2 : 0,
        maximumFractionDigits: currency === 'USD' ? 2 : 0,
    }).format(Math.abs(amount));
    return `${amount < 0 ? '−' : signed > 0 && amount > 0 ? '+' : ''}${prefix}${number}`;
}
export function reviewDividendSummary(rows) {
    const totals = new Map();
    let missing = 0;
    for (const row of rows) {
        if (!['dividend', 'dividend_reversal'].includes(row.type)) continue;
        if (
            !['USD', 'KRW'].includes(row.currency) ||
            reviewNumber(row.amount) === '—'
        ) {
            missing++;
            continue;
        }
        const value =
            Number(row.amount) * (row.type === 'dividend_reversal' ? -1 : 1);
        const total = totals.get(row.currency) || {
            currency: row.currency,
            amount: 0,
            count: 0,
            months: Array(12).fill(0),
        };
        total.amount += value;
        total.count++;
        if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(row.date || ''))
            total.months[Number(row.date.slice(5, 7)) - 1] += value;
        totals.set(row.currency, total);
    }
    return { totals: [...totals.values()], missing };
}

export function reviewSecurityLabel(row) {
    if (row.symbol === 'CASH') return '현금·환전';
    if (
        /^A?\d{6}$/.test(row.symbol || '') &&
        row.securityName &&
        row.securityName !== row.symbol
    )
        return row.securityName;
    return row.symbol || row.securityName || '미식별 종목';
}
