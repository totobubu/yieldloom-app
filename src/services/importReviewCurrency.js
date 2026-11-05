// Read-only preview sums of the supplied standard transaction amount, by currency.
// Uses the existing exact decimal engine; never changes rows or classifies capital.
import { exact } from '../../lib/exact-amount.js';
const labels = {
    buy: '매수 합계',
    sell: '매도 합계',
    cash_in: '입금 합계',
    cash_out: '출금 합계',
    dividend: '추출 배당 합계',
    dividend_reversal: '배당 취소 기록 합계',
};
function previewAmount(value) {
    if (
        !['string', 'number'].includes(typeof value) ||
        value === '' ||
        !Number.isFinite(Number(value)) ||
        Number(value) < 0
    )
        return null;
    const m = String(value)
        .trim()
        .match(/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    if (!m) return null;
    const digits = m[2] + (m[3] || ''),
        at = m[2].length + Number(m[4] || 0);
    if (at > 40 || digits.length - at > 30 || at < -30) return null;
    const text =
        at <= 0
            ? '0.' + '0'.repeat(-at) + digits
            : at >= digits.length
              ? digits.padEnd(at, '0')
              : digits.slice(0, at) + '.' + digits.slice(at);
    try {
        const result = exact((m[1] === '-' ? '-' : '') + text);
        return result.cmp(exact('1000000000000000')) <= 0 ? result : null;
    } catch {
        return null;
    }
}
export function reviewCurrencyBreakdown(rows) {
    const currencies = new Map();
    let unknownCurrencyCount = 0;
    for (const row of rows) {
        if (
            typeof row.currency !== 'string' ||
            !/^[A-Z]{3}$/.test(row.currency)
        ) {
            unknownCurrencyCount++;
            continue;
        }
        if (!currencies.has(row.currency))
            currencies.set(row.currency, {
                currency: row.currency,
                count: 0,
                groups: new Map(),
                otherCount: 0,
            });
        const currency = currencies.get(row.currency);
        currency.count++;
        if (!Object.hasOwn(labels, row.type)) {
            currency.otherCount++;
            continue;
        }
        if (!currency.groups.has(row.type))
            currency.groups.set(row.type, {
                type: row.type,
                label: labels[row.type],
                count: 0,
                unknown: 0,
                total: exact('0'),
            });
        const group = currency.groups.get(row.type);
        group.count++;
        const amount = previewAmount(row.amount);
        if (amount === null) group.unknown++;
        else group.total = group.total.add(amount);
    }
    return {
        unknownCurrencyCount,
        currencies: [...currencies.values()].map((currency) => {
            const incoming = currency.groups.get('cash_in'),
                outgoing = currency.groups.get('cash_out');
            const unknown = (incoming?.unknown || 0) + (outgoing?.unknown || 0);
            const netCash =
                incoming || outgoing
                    ? {
                          unknown,
                          amount: unknown
                              ? null
                              : (incoming?.total || exact('0'))
                                    .sub(outgoing?.total || exact('0'))
                                    .text(),
                      }
                    : null;
            return {
                currency: currency.currency,
                count: currency.count,
                otherCount: currency.otherCount,
                netCash,
                lines: [...currency.groups.values()].map((group) => ({
                    type: group.type,
                    label: group.label,
                    count: group.count,
                    unknown: group.unknown,
                    amount: group.unknown ? null : group.total.text(),
                })),
            };
        }),
    };
}
