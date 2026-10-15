import {
    cashKinds,
    cashNeedsReview,
    isWithdrawal,
    withdrawalBreakdown,
    withdrawalSources,
} from '../../lib/portfolio-capital.js';
import { transactionMoney } from './transactionAmount.js';

const day = (value) => String(value ?? '').replace(/\D/g, '');
export function accountActivities(state) {
    const annotations = new Map(
        state.classifications.map((row) => [row.id, row])
    );
    return state.entries.map((entry) => {
        const annotation = annotations.get(entry.id);
        const kind =
            annotation?.classification || entry.suggestedKind || 'unknown';
        const withdrawal =
            isWithdrawal(kind) ||
            (kind === 'unknown' &&
                (isWithdrawal(entry.suggestedKind) ||
                    /출금|cash_out/.test(entry.rawType || '')));
        const deposit =
            kind === 'external_deposit' ||
            kind === 'dividend' ||
            kind === 'interest' ||
            kind === 'sale' ||
            (kind === 'unknown' && /입금|cash_in/.test(entry.rawType || ''));
        let parts = null;
        if (annotation && isWithdrawal(kind)) {
            try {
                parts = withdrawalBreakdown(entry, annotation);
            } catch {
                parts = {
                    principal: 0,
                    dividend: 0,
                    profit: 0,
                    unknown: entry.amount,
                };
            }
        }
        const signed =
            entry.amount == null
                ? null
                : Number(entry.amount) * (withdrawal ? -1 : 1);
        const rate = entry.exchangeRate > 0 ? Number(entry.exchangeRate) : null;
        const pending = cashNeedsReview(entry, annotation);
        const details = parts
            ? Object.entries(parts)
                  .filter(([, amount]) => amount > 0)
                  .map(
                      ([source, amount]) =>
                          `${withdrawalSources[source]} ${transactionMoney(amount, entry.currency)}`
                  )
                  .join(' · ')
            : entry.rawType;
        return {
            id: `cash:${entry.id}`,
            cashEntryId: entry.id,
            cashCurrency: entry.currency || 'UNKNOWN',
            cashAmount: signed,
            date: day(entry.date),
            type: withdrawal
                ? isWithdrawal(kind)
                    ? kind
                    : 'external_withdrawal'
                : kind === 'exchange'
                  ? 'exchange'
                  : kind === 'transfer'
                    ? 'cash_transfer'
                    : deposit
                      ? 'cash_in'
                      : 'cash_unknown',
            cashDirection: withdrawal ? 'out' : deposit ? 'in' : null,
            cashKind: kind,
            cashDetail: details,
            withdrawalParts: parts,
            cashNote: pending
                ? withdrawal && annotation
                    ? '출금 출처 확인 필요'
                    : '계좌 분류 확인 필요'
                : '',
            amount:
                entry.currency === 'USD'
                    ? rate && signed != null
                        ? signed * rate
                        : null
                    : signed,
            nativeAmount: entry.currency === 'USD' ? signed : null,
            exchangeRate: rate,
            quantity: null,
            commission: null,
            tax: null,
            asset: null,
        };
    });
}

export function portfolioActivity(
    transactions,
    state,
    { start = '', end = '', ticker = '', type = '' } = {}
) {
    return [...transactions, ...accountActivities(state)]
        .filter((row) => {
            const date = day(row.date);
            if (
                date.length !== 8 ||
                (start && date < day(start)) ||
                (end && date > day(end))
            )
                return false;
            if (ticker && row.asset?.ticker !== ticker) return false;
            if (!type) return true;
            if (type === 'cash_out') return row.cashDirection === 'out';
            const source = {
                principal_withdrawal: 'principal',
                dividend_withdrawal: 'dividend',
                profit_withdrawal: 'profit',
            }[type];
            if (source && row.cashEntryId)
                return row.withdrawalParts?.[source] > 0;
            return row.type === type;
        })
        .sort(
            (a, b) =>
                day(b.date).localeCompare(day(a.date)) ||
                String(a.id).localeCompare(String(b.id))
        );
}

export function activityTypeLabel(type) {
    return (
        {
            cash_in: '계좌 입금',
            exchange: '환전',
            cash_transfer: '계좌 내 이동',
            cash_unknown: '계좌 내역 확인 필요',
        }[type] || cashKinds[type]
    );
}
