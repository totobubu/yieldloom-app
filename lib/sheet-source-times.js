// Read-only source candidates, never ledger observations or approval values.
// The archive adapter must verify file hashes before calling this projection.
const precise = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(
        value
    );
export const sourceTimeRoles = {
    reservedAt: '예약 시각',
    orderedAt: '주문 목록 기록 시각',
    lastExecutedAt: '최종 체결 시각',
    executionDateTime: '체결 시각',
    dateTime: '거래내역 기록 시각',
    orderedUiAt: '주문 시각(원문)',
    failedAt: '실패 시각',
    cancelledAt: '취소 시각',
    paidAt: '배당 입금 시각',
    settledAt: '실제 결제 시각',
};
export function buildSourceTimeItems({
    accountId,
    files,
    symbols = {},
    archiveKey,
    kind,
}) {
    if (
        !['wife', 'husband'].includes(accountId) ||
        !['orders', 'transactions'].includes(kind)
    )
        throw Error('Invalid source account/kind');
    const result = [];
    for (const f of files) {
        if (!/^[a-f0-9]{64}$/.test(f.sha256 || ''))
            throw Error('Verified full source hash required');
        const body = f.data?.data?.result || f.data?.data;
        const records =
            kind === 'orders' && /^orders-all-/.test(f.file)
                ? (body?.body || []).map((value, i) => ({
                      value,
                      path: `${f.data.data?.result ? 'data.result' : 'data'}.body[${i}]`,
                  }))
                : kind === 'orders' &&
                    f.file.startsWith('order-details/') &&
                    body?.stockCode
                  ? [
                        {
                            value: body,
                            path: f.data.data?.result ? 'data.result' : 'data',
                        },
                    ]
                  : kind === 'transactions' &&
                      f.file.startsWith('transaction-details/') &&
                      body?.transaction
                    ? [
                          {
                              value: body.transaction,
                              path: f.data.data?.result
                                  ? 'data.result.transaction'
                                  : 'data.transaction',
                          },
                      ]
                    : [];
        for (const { value: v, path } of records) {
            const candidates =
                symbols[v.stockCode] || (v.symbol ? [v.symbol] : []);
            const canonical = [
                ...new Set(candidates.map((s) => (s === 'WPAY' ? 'TOPW' : s))),
            ];
            if (canonical.length !== 1) continue; // Unknown/ambiguous security stays unbound.
            const symbol = v.symbol || candidates[0]; // Preserve the original ticker when present.
            let type;
            if (kind === 'orders')
                type = {
                    buy: 'BUY',
                    sell: 'SELL',
                    BUY: 'BUY',
                    SELL: 'SELL',
                    매수: 'BUY',
                    매도: 'SELL',
                }[v.tradeType];
            else if (
                String(v.displayType) === '13' &&
                String(v.summaryNo) === '1207'
            )
                type = 'DIVIDEND';
            // Cash posting records are not execution records. Other transaction
            // types need their own verified classification before being projected.
            if (!type) continue;
            const day = (value) =>
                typeof value === 'string'
                    ? value.slice(0, 10)
                    : value?.year
                      ? `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
                      : null;
            const eventDate =
                kind === 'orders'
                    ? day(v.userOrderDate || v.orderDate)
                    : day(v.dateTime);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate || '')) continue;
            const fields =
                kind === 'orders'
                    ? [
                          'reservedAt',
                          'orderedAt',
                          'lastExecutedAt',
                          'executionDateTime',
                      ]
                    : ['dateTime'];
            const times = fields
                .filter((field) => precise(v[field]))
                .map((field) => ({
                    field: `${path}.${field}`,
                    role: field,
                    value: v[field],
                    timeZone: null,
                }));
            if (!times.length) continue;
            // Do not deduplicate by date, symbol or displayed time: simultaneous
            // distinct orders must remain distinct source records.
            result.push({
                id: `${f.file}:${path}`,
                accountId,
                symbol,
                type,
                eventDate,
                sourceStatus: typeof v.status === 'string' ? v.status : null,
                quantity:
                    kind === 'orders' ? (v.executedQuantity ?? null) : null,
                times,
                source: { archiveKey, file: f.file, sha256: f.sha256, path },
            });
        }
    }
    return result;
}

const alias = (symbol) => (symbol === 'WPAY' ? 'TOPW' : symbol);
export function indexSourceTimes(items) {
    const index = new Map();
    for (const item of items) {
        for (const date of new Set(item.eventDates || [item.eventDate])) {
            const key = JSON.stringify([
                item.accountId,
                item.type,
                alias(item.symbol),
                date,
            ]);
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(item);
        }
    }
    return index;
}
export function sourceTimesForRow(row, index) {
    // Date/product/account select candidates only, not a financial identity.
    return (
        index.get(
            JSON.stringify([
                row.accountId,
                row.type,
                alias(row.symbol),
                row.date,
            ])
        ) || []
    );
}

export function observationTimeItems(row, observations) {
    const roles = {
        transactionAt: 'dateTime',
        reservedAt: 'reservedAt',
        orderedAt: 'orderedUiAt',
        executedAt: 'executionDateTime',
        settledAt: 'settledAt',
        paidAt: 'paidAt',
    };
    return observations.flatMap((o) => {
        if (
            o.accountId !== row.accountId ||
            o.type !== row.type ||
            alias(o.symbol) !== alias(row.symbol) ||
            o.forecast ||
            o.values?.timePrecision === 'date' ||
            (o.kind === 'TOSS_EXPECTED_DIVIDEND' &&
                (o.values?.confirmationStatus !== 'CONFIRMED' ||
                    o.values?.paymentStatus !== 'PAID'))
        )
            return [];
        const times = Object.entries(roles)
            .filter(([field]) => precise(o.values?.[field]))
            .map(([field, role]) => ({
                role,
                field: `values.${field}`,
                value: o.values[field],
                timeZone: o.values.timeZone || null,
            }));
        if (!times.length) return [];
        return [
            {
                id: `observation:${o.id}`,
                accountId: o.accountId,
                symbol: o.symbol,
                type: o.type,
                eventDate: o.values.date || row.date,
                quantity: o.values.quantity ?? null,
                times,
                source: { label: '기존 대조 자료', location: o.location },
            },
        ];
    });
}

export function validSourceTimeItems(items, accountId) {
    return (
        Array.isArray(items) &&
        items.length <= 10_000 &&
        items.every(
            (item) =>
                item.accountId === accountId &&
                typeof item.id === 'string' &&
                ['BUY', 'SELL', 'DIVIDEND'].includes(item.type) &&
                /^[A-Z][A-Z0-9.-]{0,11}$/.test(item.symbol || '') &&
                /^\d{4}-\d{2}-\d{2}$/.test(item.eventDate || '') &&
                (item.eventDates == null ||
                    (Array.isArray(item.eventDates) &&
                        item.eventDates.length <= 5 &&
                        item.eventDates.includes(item.eventDate) &&
                        item.eventDates.every((d) =>
                            /^\d{4}-\d{2}-\d{2}$/.test(d)
                        ))) &&
                (item.quantity === null ||
                    (Number.isFinite(item.quantity) && item.quantity >= 0)) &&
                typeof item.source?.archiveKey === 'string' &&
                typeof item.source?.file === 'string' &&
                /^[a-f0-9]{64}$/.test(item.source?.sha256 || '') &&
                Array.isArray(item.times) &&
                item.times.length > 0 &&
                item.times.length <= 6 &&
                item.times.every(
                    (time) =>
                        Object.hasOwn(sourceTimeRoles, time.role) &&
                        precise(time.value) &&
                        typeof time.field === 'string' &&
                        time.timeZone === null
                )
        )
    );
}
