import { finiteNumber, validateFunding } from '../../lib/portfolio-capital.js';
import { transactionExchangeRate } from './portfolioPerformance.js';

export function transactionMoney(value, currency = 'KRW') {
    const amount = finiteNumber(value);
    if (
        amount == null ||
        amount === 0 ||
        (currency === 'KRW' && Math.round(amount) === 0)
    )
        return '-';
    if (currency !== 'USD' && currency !== 'KRW') {
        if (/^[A-Z]{3}$/.test(currency || ''))
            return new Intl.NumberFormat('ko-KR', {
                style: 'currency',
                currency,
                maximumFractionDigits: 6,
            }).format(amount);
        return `${amount.toLocaleString('ko-KR', { maximumFractionDigits: 6 })} (통화 확인 필요)`;
    }
    return currency === 'USD'
        ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
        : `₩${Math.round(amount).toLocaleString('ko-KR')}`;
}

export function transactionRate(rate) {
    if (!(rate?.value > 0)) return '-';
    const suffix =
        {
            reference: ' (참고)',
            confirmed: ' (입력 기준)',
            weighted: ' (가중)',
        }[rate.kind] || '';
    return `${rate.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${suffix}`;
}

export function transactionAmountRows(transaction, allocation) {
    const fx = transactionExchangeRate(transaction);
    const rate = fx
        ? { value: fx.value, kind: fx.recorded ? 'statement' : 'reference' }
        : null;
    if (transaction.cashEntryId)
        return [
            {
                currency: transaction.cashCurrency,
                amount: transaction.cashAmount,
                secondary:
                    transaction.cashCurrency === 'USD' && rate
                        ? { currency: 'KRW', amount: transaction.amount }
                        : null,
                rate: transaction.cashCurrency === 'USD' ? rate : null,
                label: '',
                note: transaction.cashNote || '',
            },
        ];
    if (
        transaction.type === 'buy' &&
        ['confirmed', 'partial'].includes(allocation?.status)
    ) {
        try {
            // An old, incomplete or stale annotation must never invent a split.
            const verified = validateFunding(allocation, transaction);
            if (verified.parts.every((part) => part.method !== 'unknown')) {
                let dollars = 0,
                    convertedUsd = 0,
                    convertedKrw = 0,
                    won = 0,
                    conversions = 0;
                for (const part of verified.parts) {
                    if (part.method === 'usd_balance') dollars += part.amount;
                    if (part.method === 'krw_conversion') {
                        convertedUsd += part.amount;
                        convertedKrw += part.paidKrw;
                        conversions++;
                    }
                    if (part.method === 'krw_cash') won += part.amount;
                }
                const note =
                    verified.status === 'partial' ? '자금 출처 확인 필요' : '';
                const rows = [];
                if (dollars > 0)
                    rows.push({
                        currency: 'USD',
                        amount: dollars,
                        secondary: rate
                            ? { currency: 'KRW', amount: dollars * rate.value }
                            : null,
                        rate,
                        label: '달러 잔액 · 정산액',
                        note,
                    });
                if (convertedKrw > 0)
                    rows.push({
                        currency: 'KRW',
                        amount: convertedKrw,
                        secondary: { currency: 'USD', amount: convertedUsd },
                        rate: {
                            value: convertedKrw / convertedUsd,
                            kind: conversions > 1 ? 'weighted' : 'confirmed',
                        },
                        label: '원화 환전 · 정산액',
                        note,
                    });
                if (won > 0)
                    rows.push({
                        currency: 'KRW',
                        amount: won,
                        secondary: null,
                        rate: null,
                        label: '원화 잔액 · 정산액',
                        note,
                    });
                if (rows.length) return rows;
            }
        } catch {
            /* Show the original statement amount until reconfirmed. */
        }
    }
    const native = finiteNumber(transaction.nativeAmount);
    const won = finiteNumber(transaction.amount);
    return [
        {
            currency: native !== null && native !== 0 ? 'USD' : 'KRW',
            amount: native !== null && native !== 0 ? native : won,
            secondary:
                native !== null && native !== 0
                    ? { currency: 'KRW', amount: won }
                    : null,
            rate: native !== null && native !== 0 ? rate : null,
            label: '',
            note:
                transaction.type === 'buy'
                    ? '결제 구성 확인 필요'
                    : transaction.cashNote || '',
        },
    ];
}
