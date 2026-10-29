// A source-role projection of the user-adopted immutable snapshot. No matching or writes.
const value = (o, k) => o.fields?.[k]?.value ?? null;
const sources = {
    toss_api: '토스 주문',
    google_sheet_reference: '시트 배당 기록',
    toss_pdf_saved_parse: '토스 명세서',
};
export const finalTypeLabels = {
    BUY: '매수',
    SELL: '매도',
    DIVIDEND: '배당',
    TAX_REFUND: '세금환급',
    CANCELED: '미체결 취소',
};
export function validFinalRow(row, accountId) {
    return (
        row &&
        row.accountId === accountId &&
        /^[a-f0-9]{64}$/.test(row.id || '') &&
        Object.hasOwn(finalTypeLabels, row.type) &&
        ['USD', 'KRW'].includes(row.currency) &&
        typeof row.isTransaction === 'boolean' &&
        typeof row.symbol === 'string' &&
        ['quantity', 'unitPrice', 'amount', 'commission', 'tax'].every(
            (k) =>
                row[k] === null ||
                (typeof row[k] === 'string' && /^-?\d+(?:\.\d+)?$/.test(row[k]))
        )
    );
}
export function projectFinalLedger(observations) {
    const rows = [],
        unassignedRows = [],
        details = new Map(),
        seen = new Set(),
        orderIds = new Set();
    for (const o of observations) {
        if (
            !/^[a-f0-9]{64}$/.test(o.observationId || '') ||
            seen.has(o.observationId)
        )
            throw new Error('최종 데이터의 관측 식별자가 올바르지 않습니다.');
        seen.add(o.observationId);
        const api = o.sourceFamily === 'toss_api' && o.accountScope === 'wife';
        const dividend =
            o.sourceFamily === 'google_sheet_reference' &&
            o.accountScope === 'wife' &&
            value(o, 'eventType') === 'DIVIDEND';
        const pdf =
            o.sourceFamily === 'toss_pdf_saved_parse' &&
            o.accountScope === 'unbound_pdf';
        if (!api && !dividend && !pdf) continue;
        if (api) {
            const id = value(o, 'providerOrderId');
            if (!id || orderIds.has(id))
                throw new Error('같은 버전의 주문 식별자가 중복됐습니다.');
            orderIds.add(id);
        }
        const type = api
            ? value(o, 'eventType')
            : dividend
              ? 'DIVIDEND'
              : {
                    buy: 'BUY',
                    sell: 'SELL',
                    dividend: 'DIVIDEND',
                    TAX_REFUND: 'TAX_REFUND',
                }[value(o, 'eventType')];
        if (!['BUY', 'SELL', 'DIVIDEND', 'TAX_REFUND'].includes(type))
            throw new Error('최종 거래 유형이 올바르지 않습니다.');
        const active =
            !api || o.executionPresence === 'observed_order_aggregate';
        const currency = dividend ? 'USD' : value(o, 'currency');
        if (!['USD', 'KRW'].includes(currency))
            throw new Error('최종 거래 통화가 올바르지 않습니다.');
        const amountField = api
            ? 'executionAmount'
            : dividend
              ? 'netDividendUsd'
              : value(o, 'statementNativeTransactionAmount') !== null
                ? 'statementNativeTransactionAmount'
                : 'statementTransactionAmount';
        const timestamp = api
            ? value(o, 'finalFilledAt') || value(o, 'orderedAt')
            : value(o, 'recordedDate');
        const row = {
            id: o.observationId,
            accountId: pdf ? 'unassigned' : 'wife',
            type,
            currency,
            symbol: value(o, 'symbol') || value(o, 'securityCode') || '',
            date: timestamp?.slice(0, 10) || '',
            timestamp,
            dateRole: api
                ? value(o, 'finalFilledAt')
                    ? '최종 체결'
                    : '주문'
                : '기록일',
            quantity: value(o, api ? 'filledQuantity' : 'recordedQuantity'),
            unitPrice: value(o, api ? 'averageFilledPrice' : 'detailPrice'),
            amount: active ? value(o, amountField) : null,
            amountMeaning: api
                ? '총 체결 금액'
                : dividend
                  ? '기록된 세후 배당'
                  : '명세서 거래 금액',
            commission: value(o, 'commission'),
            tax: value(o, 'tax'),
            taxDerived: o.fields?.tax?.status === 'derived',
            isTransaction: active,
            state: !active
                ? '미체결 취소'
                : o.partialFillThenCanceled
                  ? '부분 체결 후 취소'
                  : '거래',
            sourceLabel: sources[o.sourceFamily],
        };
        if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date))
            throw new Error('최종 거래 날짜가 올바르지 않습니다.');
        for (const k of [
            'quantity',
            'unitPrice',
            'amount',
            'commission',
            'tax',
        ]) {
            if (
                row[k] !== null &&
                (typeof row[k] !== 'string' ||
                    !/^-?\d+(?:\.\d+)?$/.test(row[k]))
            )
                throw new Error('최종 금액의 정밀도를 확인해 주세요.');
        }
        (pdf ? unassignedRows : rows).push(row);
        details.set(row.id, {
            id: row.id,
            sourceLabel: row.sourceLabel,
            sourceFamily: o.sourceFamily,
            sourceHashReference: o.sourceReference?.source || '',
            fields: Object.entries(o.fields || {})
                .filter(
                    ([k, v]) =>
                        ![
                            'providerOrderId',
                            'brokerOrderNumber',
                            'individualFillId',
                        ].includes(k) && v.value !== null
                )
                .map(([field, v]) => ({
                    field,
                    value: v.value,
                    unit: v.unit || null,
                    calculated: v.status === 'derived',
                    sourceField: v.sourceField,
                })),
            missing: [
                'individualFillId',
                'actualFxRate',
                'actualSettlementAt',
                'actualCashSettlementAmount',
            ].filter((k) => value(o, k) === null),
            accountAssignment: pdf ? '계좌 미지정 명세서 자료' : '아내',
        });
    }
    return { rows, unassignedRows, details };
}
const decimal = (value) => {
    if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))
        return null;
    const [whole, fraction = ''] = value.split('.');
    return { n: BigInt(whole + fraction), scale: fraction.length };
};
function formatted(n, scale) {
    const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
    return `${n < 0n ? '-' : ''}${scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits}`;
}
export function sumFinalDecimals(values) {
    const known = values.map(decimal).filter(Boolean);
    if (!known.length) return null;
    const scale = Math.max(...known.map((v) => v.scale));
    return formatted(
        known.reduce((n, v) => n + v.n * 10n ** BigInt(scale - v.scale), 0n),
        scale
    );
}
export function filterFinalRows(
    rows,
    {
        search = '',
        type = '',
        currency = '',
        from = '',
        to = '',
        sort = 'date',
        direction = -1,
    } = {}
) {
    const needle = search.trim().toLowerCase();
    const numeric = ['quantity', 'unitPrice', 'amount', 'commission', 'tax'];
    if (!['date', 'symbol', 'type', ...numeric].includes(sort)) sort = 'date';
    return rows
        .filter(
            (r) =>
                (type === 'CANCELED'
                    ? !r.isTransaction
                    : r.isTransaction && (!type || r.type === type)) &&
                (!currency || r.currency === currency) &&
                (!from || r.date >= from) &&
                (!to || r.date <= to) &&
                (!needle ||
                    [
                        r.symbol,
                        r.type,
                        finalTypeLabels[r.type],
                        r.date,
                        r.sourceLabel,
                        r.state,
                    ]
                        .join(' ')
                        .toLowerCase()
                        .includes(needle))
        )
        .sort((a, b) => {
            if (a[sort] == null)
                return b[sort] == null ? a.id.localeCompare(b.id) : 1;
            if (b[sort] == null) return -1;
            let result;
            if (numeric.includes(sort)) {
                const x = decimal(a[sort]),
                    y = decimal(b[sort]),
                    scale = Math.max(x.scale, y.scale);
                const d =
                    x.n * 10n ** BigInt(scale - x.scale) -
                    y.n * 10n ** BigInt(scale - y.scale);
                result = d < 0n ? -1 : d > 0n ? 1 : 0;
            } else result = String(a[sort]).localeCompare(String(b[sort]));
            return result * direction || a.id.localeCompare(b.id);
        });
}
export function summarizeFinalRows(rows) {
    const groups = new Map();
    for (const row of rows) {
        if (!row.isTransaction) continue;
        const key = `${row.type}:${row.currency}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return [...groups.entries()].map(([key, values]) => ({
        key,
        type: values[0].type,
        currency: values[0].currency,
        count: values.length,
        amount: sumFinalDecimals(values.map((r) => r.amount)),
        missingAmount: values.filter((r) => r.amount === null).length,
    }));
}
