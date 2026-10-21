const finite = (value) =>
    value === null ||
    value === undefined ||
    value === '' ||
    !Number.isFinite(Number(value))
        ? null
        : Number(value);
export const calendarToday = () =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
        new Date()
    );
export function validCalendarDate(value) {
    return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}
export function monthDays(month) {
    if (!validCalendarDate(`${month}-01`)) return [];
    const first = new Date(`${month}-01T00:00:00Z`);
    const length = new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
    ).getUTCDate();
    const start = 1 - first.getUTCDay();
    return Array.from(
        { length: Math.ceil((length + first.getUTCDay()) / 7) * 7 },
        (_, i) => {
            const day = new Date(
                Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), start + i)
            )
                .toISOString()
                .slice(0, 10);
            return {
                date: day,
                inMonth: day.startsWith(month),
                day: Number(day.slice(-2)),
            };
        }
    );
}
// Announced dates establish a schedule, never the holder's entitlement.
export function portfolioScheduleRows(
    positions,
    schedules,
    { basis = 'payable', today = calendarToday(), entries = [] } = {}
) {
    const rows = [],
        undated = [];
    for (const position of positions) {
        if (!(finite(position.quantity) > 0) || position.symbol === 'CASH')
            continue;
        const schedule = schedules[position.symbol];
        if (!schedule) continue;
        for (const [state, events] of [
            ['announced', schedule.history || []],
            ['review', schedule.reviewHistory || []],
        ]) {
            for (const event of events) {
                const date = basis === 'ex' ? event.exDate : event.payableDate;
                if (!validCalendarDate(date)) {
                    undated.push({
                        accountId: position.accountId,
                        symbol: position.symbol,
                        exDate: event.exDate,
                    });
                    continue;
                }
                const amount = finite(event.amount),
                    currency = /^[A-Z]{3}$/.test(event.currency || '')
                        ? event.currency
                        : null;
                const historical = historicalDividendQuantity(
                    position,
                    event,
                    entries
                );
                const eligible =
                    state === 'announced' &&
                    validCalendarDate(event.exDate) &&
                    amount !== null &&
                    amount >= 0 &&
                    currency &&
                    historical.quantity !== null;
                rows.push({
                    id: `${position.accountId}:${position.symbol}:${position.currency}:${state}:${event.id ?? event.exDate}`,
                    accountId: position.accountId,
                    symbol: position.symbol,
                    date,
                    exDate: event.exDate,
                    payableDate: event.payableDate,
                    currency,
                    amount: eligible
                        ? historical.receivedAmount ??
                          amount * historical.quantity
                        : null,
                    perShare: amount,
                    quantity: historical.quantity ?? position.quantity,
                    quantityAsOf:
                        historical.quantityAsOf || position.asOf,
                    amountBasis: historical.basis,
                    status: state,
                    sourceUrl: /^https?:\/\//.test(event.officialUrl || '')
                        ? event.officialUrl
                        : null,
                    notice:
                        state === 'review'
                            ? '공시 대조가 필요한 일정'
                            : !eligible
                                ? '수량 기준일·배당금·통화를 확인해야 합니다.'
                                : historical.basis === 'received'
                                  ? '저장된 실제 배당 입금액과 공시 주당 배당금으로 역산했습니다.'
                                  : historical.basis === 'ledger'
                                    ? '현재 잔고에서 배당락일 이후 매수·매도를 되돌려 계산한 세전 참고액입니다.'
                                    : '자료 기준 수량 × 공시 주당 배당금 · 세전 예상, 지급 자격 미확인',
                });
            }
        }
        if (
            basis === 'ex' &&
            validCalendarDate(schedule.forecastExDate) &&
            schedule.forecastExDate >= today
        )
            rows.push({
                id: `${position.accountId}:${position.symbol}:${position.currency}:forecast`,
                accountId: position.accountId,
                symbol: position.symbol,
                date: schedule.forecastExDate,
                currency: schedule.current?.currency || null,
                amount: null,
                status: 'forecast',
                quantityAsOf: position.asOf,
                notice: '과거 주기에서 추정한 배당락일입니다. 공시 일정·지급일·금액이 아닙니다.',
            });
    }
    return {
        rows: rows.sort(
            (a, b) =>
                a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)
        ),
        undated,
    };
}

const compactDate = (value) => String(value ?? '').replace(/\D/g, '');
const entryRow = (entry) => entry?.row || entry || {};
const dateMillis = (value) => {
    const compact = compactDate(value);
    return compact.length === 8
        ? Date.parse(
              `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}T00:00:00Z`
          )
        : NaN;
};

/** Resolve the shares entitled immediately before the ex-date. */
export function historicalDividendQuantity(position, event, entries = []) {
    const exDate = event?.exDate;
    if (!validCalendarDate(exDate))
        return { quantity: null, quantityAsOf: null, basis: null };
    const ex = compactDate(exDate),
        accountEntries = entries.filter(
            (entry) =>
                entry.accountId === position.accountId &&
                entryRow(entry).symbol === position.symbol
        ),
        received = accountEntries
            .map((entry) => entryRow(entry))
            .filter((row) => row.type === 'dividend')
            .map((row) => {
                const date = compactDate(row.date),
                    paid =
                        /^[A-Z]{3}$/.test(event.currency || '') &&
                        event.currency === 'USD'
                            ? finite(row.nativeAmount) ?? finite(row.amount)
                            : finite(row.amount);
                return {
                    date,
                    amount: paid === null ? null : Math.abs(paid),
                    distance: Math.abs(
                        dateMillis(row.date) - dateMillis(event.payableDate)
                    ),
                };
            })
            .filter(
                (item) =>
                    item.date >= ex &&
                    item.amount !== null &&
                    Number.isFinite(item.distance) &&
                    item.distance <= 3 * 86400000
            )
            .sort((a, b) => a.distance - b.distance)[0];
    const perShare = finite(event.amount);
    if (received && perShare > 0)
        return {
            quantity: Number((received.amount / perShare).toFixed(12)),
            quantityAsOf: received.date.replace(
                /^(\d{4})(\d{2})(\d{2})$/,
                '$1-$2-$3'
            ),
            receivedAmount: received.amount,
            basis: 'received',
        };
    if (!validCalendarDate(position?.asOf))
        return { quantity: null, quantityAsOf: null, basis: null };
    const asOf = compactDate(position.asOf);
    let quantity = finite(position.quantity);
    if (quantity === null)
        return { quantity: null, quantityAsOf: null, basis: null };
    for (const entry of accountEntries) {
        const row = entryRow(entry),
            date = compactDate(row.date),
            traded = finite(row.quantity);
        if (!(traded > 0) || !['buy', 'sell'].includes(row.type)) continue;
        const direction = row.type === 'buy' ? 1 : -1;
        if (ex <= asOf && date >= ex && date <= asOf)
            quantity -= direction * traded;
        else if (ex > asOf && date > asOf && date < ex)
            quantity += direction * traded;
    }
    return quantity >= 0
        ? {
              quantity,
              quantityAsOf: exDate,
              basis: exDate < position.asOf ? 'ledger' : 'snapshot',
          }
        : { quantity: null, quantityAsOf: null, basis: null };
}
export function recordedDividendRows(entries) {
    return entries
        .filter(
            (entry) =>
                ['dividend', 'dividend_reversal'].includes(entry.row?.type) &&
                validCalendarDate(entry.row.date)
        )
        .map((entry) => {
            const row = entry.row,
                native = finite(row.nativeAmount),
                amount = native ?? finite(row.amount);
            return {
                id: `${entry.accountId}:${entry.id}`,
                accountId: entry.accountId,
                symbol: row.symbol,
                date: row.date,
                currency: native !== null ? 'USD' : row.currency,
                amount:
                    amount === null
                        ? null
                        : Math.abs(amount) *
                          (row.type === 'dividend_reversal' ? -1 : 1),
                status:
                    row.type === 'dividend_reversal' ? 'reversal' : 'recorded',
                quantityAsOf: entry.asOf,
                notice: '저장된 배당 거래금액입니다. 세전·세후 실수령액으로 확정하지 않으며 취소 거래는 차감합니다.',
            };
        })
        .sort(
            (a, b) =>
                a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)
        );
}
export function calendarTotals(rows) {
    const groups = new Map();
    for (const row of rows) {
        const currency = row.currency || 'UNKNOWN';
        const group = groups.get(currency) || {
            currency,
            amount: 0,
            known: 0,
            unknown: 0,
        };
        if (row.amount === null || !Number.isFinite(row.amount))
            group.unknown++;
        else {
            group.amount += row.amount;
            group.known++;
        }
        groups.set(currency, group);
    }
    return [...groups.values()];
}
