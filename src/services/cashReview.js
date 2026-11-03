import {
    cashKinds,
    cashNeedsReview,
    isWithdrawal,
} from '../../lib/portfolio-capital.js';

// DatePicker values are local calendar days, never UTC instants.
export function cashReviewDateKey(value) {
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) return '';
        return `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, '0')}${String(value.getDate()).padStart(2, '0')}`;
    }
    const key = String(value || '').replace(/\D/g, '');
    if (key.length !== 8) return '';
    const year = Number(key.slice(0, 4)),
        month = Number(key.slice(4, 6)),
        day = Number(key.slice(6));
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? key
        : '';
}

export function cashReviewEntries(
    entries,
    classifications,
    {
        status = 'pending',
        currency = 'all',
        type = 'all',
        start = null,
        end = null,
    } = {}
) {
    const annotations = new Map(classifications.map((row) => [row.id, row]));
    const from = cashReviewDateKey(start),
        through = cashReviewDateKey(end);
    return [...entries]
        .filter((entry) => {
            const day = cashReviewDateKey(entry.date);
            const pending = cashNeedsReview(entry, annotations.get(entry.id));
            return (
                (status === 'all' ||
                    (status === 'pending'
                        ? pending
                        : !entry.purchaseExchange && !pending)) &&
                (currency === 'all' || entry.currency === currency) &&
                (!type || type === 'all' || cashReviewType(entry) === type) &&
                (!from || (day && day >= from)) &&
                (!through || (day && day <= through))
            );
        })
        .sort(
            (a, b) =>
                cashReviewDateKey(b.date).localeCompare(
                    cashReviewDateKey(a.date)
                ) || String(a.id).localeCompare(String(b.id))
        );
}

export function cashReviewType(entry) {
    const raw = String(entry.rawType || '').trim();
    return (
        raw.replace(/\s*\([^)]*\)\s*$/, '').trim() ||
        { cash_in: '입금', cash_out: '출금' }[entry.type] ||
        '거래 종류 미등록'
    );
}

export function primaryCashKinds(entry) {
    const candidate = Object.hasOwn(cashKinds, entry.suggestedKind)
        ? entry.suggestedKind
        : 'unknown';
    return [
        ...new Set(
            isWithdrawal(candidate)
                ? [
                      'principal_withdrawal',
                      'dividend_withdrawal',
                      'external_withdrawal',
                  ]
                : candidate === 'unknown'
                  ? ['external_deposit', 'external_withdrawal', 'transfer']
                  : [candidate, 'transfer', 'unknown']
        ),
    ];
}
