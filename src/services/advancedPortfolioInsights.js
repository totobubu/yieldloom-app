import { validCalendarDate } from './portfolioCalendar.js';
import { closedPositionPerformance } from './portfolioPerformance.js';

const number = (value) =>
    value == null ||
    value === '' ||
    typeof value === 'boolean' ||
    !Number.isFinite(Number(value))
        ? null
        : Number(value);
const amountFor = (row, currency) =>
    currency === 'USD' && number(row.nativeAmount) !== null
        ? number(row.nativeAmount)
        : row.currency === currency
          ? number(row.amount)
          : null;
function summarize(rows) {
    const known = rows.filter((r) => r.amount !== null);
    return {
        count: rows.length,
        unknown: rows.length - known.length,
        amount: known.length
            ? known.reduce((sum, r) => sum + r.amount, 0)
            : null,
    };
}

export function advancedLedgerInsights(entries, { month, currency, today }) {
    if (
        !validCalendarDate(`${month}-01`) ||
        !validCalendarDate(today) ||
        month > today.slice(0, 7)
    )
        throw new Error('분석 월을 확인하세요.');
    const valid = entries.filter(
        (entry) => validCalendarDate(entry.row?.date) && entry.row.date <= today
    );
    const excludedDates = entries.length - valid.length;
    const selected = valid.filter((entry) => entry.row.date.startsWith(month));
    const kinds = new Map();
    for (const entry of selected) {
        const row = entry.row;
        if (
            row.currency !== currency &&
            !(currency === 'USD' && number(row.nativeAmount) !== null)
        )
            continue;
        const type = row.type === 'dividend_reversal' ? 'dividend' : row.type;
        if (!kinds.has(type)) kinds.set(type, []);
        const amount = amountFor(row, currency);
        kinds
            .get(type)
            .push({
                amount:
                    amount === null
                        ? null
                        : Math.abs(amount) *
                          (row.type === 'dividend_reversal' ? -1 : 1),
            });
    }
    const months = Array.from({ length: 6 }, (_, index) => {
        const d = new Date(`${month}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - 5 + index);
        const key = d.toISOString().slice(0, 7);
        const rows = valid
            .filter(
                (entry) =>
                    entry.row.date.startsWith(key) &&
                    ['dividend', 'dividend_reversal'].includes(
                        entry.row.type
                    ) &&
                    (entry.row.currency === currency ||
                        (currency === 'USD' &&
                            number(entry.row.nativeAmount) !== null))
            )
            .map(({ row }) => {
                const amount = amountFor(row, currency);
                return {
                    amount:
                        amount === null
                            ? null
                            : Math.abs(amount) *
                              (row.type === 'dividend_reversal' ? -1 : 1),
                };
            });
        return { month: key, ...summarize(rows) };
    });
    const complete =
        excludedDates === 0 &&
        month < today.slice(0, 7) &&
        months.every((r) => r.count > 0 && r.unknown === 0);
    const before = complete
        ? months.slice(0, 3).reduce((sum, r) => sum + r.amount, 0)
        : null;
    const recent = complete
        ? months.slice(3).reduce((sum, r) => sum + r.amount, 0)
        : null;
    const mean = complete
        ? months.reduce((sum, r) => sum + r.amount, 0) / 6
        : null;
    const deviation = complete
        ? Math.sqrt(
              months.reduce((sum, r) => sum + (r.amount - mean) ** 2, 0) / 6
          )
        : null;
    return {
        flows: [...kinds].map(([type, rows]) => ({ type, ...summarize(rows) })),
        months,
        excludedDates,
        trend: {
            before,
            recent,
            percent: before > 0 ? (recent / before - 1) * 100 : null,
            deviation,
            coefficient: mean > 0 ? (deviation / mean) * 100 : null,
        },
        transfers: selected.filter(({ row }) =>
            ['transfer_in', 'transfer_out'].includes(row.type)
        ).length,
        exchanges: selected.filter(({ row }) => row.cashKind === 'exchange')
            .length,
    };
}

export function closedLedgerResults(
    entries,
    positions,
    accounts,
    { currency, today, confirmed = false }
) {
    if (!confirmed) return [];
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const current = new Set(
        positions
            .filter((p) => number(p.quantity) > 0)
            .map((p) => `${p.accountId}:${p.symbol}`)
    );
    const invalidAccounts = new Set(
        entries
            .filter((e) => !validCalendarDate(e.row?.date))
            .map((e) => e.accountId)
    );
    const grouped = new Map();
    for (const entry of entries) {
        const account = accountMap.get(entry.accountId),
            row = entry.row;
        if (
            !row ||
            !row.symbol ||
            row.symbol === 'CASH' ||
            !account?.snapshot ||
            !validCalendarDate(account.snapshot.asOf) ||
            account.snapshot.asOf > today ||
            !validCalendarDate(row.date) ||
            row.date > account.snapshot.asOf
        )
            continue;
        const key = `${entry.accountId}:${row.symbol}`;
        if (!grouped.has(key))
            grouped.set(key, { account, symbol: row.symbol, transactions: [] });
        grouped.get(key).transactions.push(row);
    }
    return [...grouped.values()]
        .filter((g) =>
            g.transactions.some((r) => ['buy', 'sell'].includes(r.type))
        )
        .map(({ account, symbol, transactions }) => {
            let result;
            if (invalidAccounts.has(account.id))
                result = {
                    available: false,
                    reason: '날짜가 불명인 거래가 있어 확인이 필요합니다.',
                };
            else if (current.has(`${account.id}:${symbol}`))
                result = {
                    available: false,
                    reason: '기준일 잔고에 보유 중인 종목입니다.',
                };
            else if (
                transactions.some((r) =>
                    ['transfer_in', 'transfer_out', 'split'].includes(r.type)
                )
            )
                result = {
                    available: false,
                    reason: '입출고·분할 기록의 취득원가 확인이 필요합니다.',
                };
            else if (
                transactions.some(
                    (r) =>
                        ['buy', 'sell'].includes(r.type) &&
                        number(
                            currency === 'USD'
                                ? r.nativeSettlementAmount
                                : r.settlementAmount
                        ) === null
                )
            )
                result = {
                    available: false,
                    reason: '매수·매도 정산액이 필요합니다. 수수료·세금을 0으로 추정하지 않습니다.',
                };
            else {
                const adapted = transactions.map((r) =>
                    currency === 'USD' &&
                    r.currency === 'USD' &&
                    number(r.nativeAmount) === null
                        ? { ...r, nativeAmount: r.amount }
                        : currency === 'KRW' && r.currency !== 'KRW'
                          ? { ...r, amount: null }
                          : r
                );
                result = closedPositionPerformance(
                    { portfolioPriority: 'closed', transactions: adapted },
                    currency
                );
            }
            return {
                accountId: account.id,
                account: account.alias,
                symbol,
                asOf: account.snapshot.asOf,
                ...result,
            };
        });
}
