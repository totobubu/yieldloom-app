import { validCalendarDate } from './portfolioCalendar.js';
const number = (v) =>
    v == null ||
    v === '' ||
    typeof v === 'boolean' ||
    !Number.isFinite(Number(v))
        ? null
        : Number(v);
const unavailable = (reason) => ({ available: false, reason });
// ACT/365, bounded log-rate bisection. More than one sign transition can have
// multiple roots; deliberately decline rather than select an arbitrary answer.
export function calculateXirr(flows) {
    if (
        !Array.isArray(flows) ||
        flows.some(
            (f) => !validCalendarDate(f.date) || number(f.amount) === null
        )
    )
        return unavailable('현금흐름 날짜·금액을 확인하세요.');
    const days = new Map();
    for (const f of flows)
        days.set(f.date, (days.get(f.date) || 0) + number(f.amount));
    const sorted = [...days]
        .filter(([, amount]) => amount !== 0)
        .sort(([a], [b]) => a.localeCompare(b));
    if (sorted.length < 2 || sorted[0][1] >= 0 || sorted.at(-1)[1] <= 0)
        return unavailable(
            '서로 다른 날짜의 투자 유출과 회수 유입이 필요합니다.'
        );
    if (
        sorted
            .slice(1)
            .filter((f, i) => Math.sign(f[1]) !== Math.sign(sorted[i][1]))
            .length !== 1
    )
        return unavailable(
            '현금흐름 부호가 여러 번 바뀌어 복수 해 가능성이 있습니다.'
        );
    const base = Date.parse(sorted[0][0]),
        scale = Math.max(...sorted.map(([, amount]) => Math.abs(amount)));
    if (!Number.isFinite(scale))
        return unavailable('현금흐름 합계 범위를 확인하세요.');
    const data = sorted.map(([date, amount]) => ({
        t: (Date.parse(date) - base) / 86400000 / 365,
        amount: amount / scale,
    }));
    const npv = (x) => {
        const shift = Math.max(...data.map((f) => -f.t * x));
        return data.reduce(
            (sum, f) => sum + f.amount * Math.exp(-f.t * x - shift),
            0
        );
    };
    let lo = Math.log(0.000001),
        hi = Math.log(1000000);
    if (!(npv(lo) >= 0 && npv(hi) <= 0))
        return unavailable('계산 범위 안에서 수익률을 찾지 못했습니다.');
    for (let i = 0; i < 180; i++) {
        const middle = (lo + hi) / 2;
        if (npv(middle) > 0) lo = middle;
        else hi = middle;
    }
    return {
        available: true,
        percent: Math.expm1((lo + hi) / 2) * 100,
        start: sorted[0][0],
        end: sorted.at(-1)[0],
    };
}

export function accountXirr(
    entries,
    account,
    { currency, today, confirmed = false } = {}
) {
    if (!confirmed)
        return unavailable('계좌 개설부터의 전체 기록을 확인하세요.');
    const snapshot = account.snapshot;
    if (
        !snapshot ||
        !validCalendarDate(snapshot.asOf) ||
        !validCalendarDate(today) ||
        snapshot.asOf > today ||
        !snapshot.rows?.length
    )
        return unavailable('유효한 잔고 기준일이 필요합니다.');
    if (
        snapshot.rows.some(
            (r) =>
                r.currency !== currency ||
                number(r.amount) === null ||
                number(r.amount) < 0
        )
    )
        return unavailable('한 통화로 구성된 전체 잔고의 평가액이 필요합니다.');
    const selected = entries.filter((e) => e.accountId === account.id);
    const flows = [];
    for (const { row } of selected) {
        if (!row || !validCalendarDate(row.date))
            return unavailable('거래일 미확인 기록이 있습니다.');
        if (row.date > snapshot.asOf) continue;
        if (
            row.currency !== currency ||
            ['transfer_in', 'transfer_out'].includes(row.type)
        )
            return unavailable(
                '통화 혼재·증권 입출고가 있어 계산을 보류합니다.'
            );
        if (!['cash_in', 'cash_out'].includes(row.type)) continue;
        const kind = row.cashKind;
        if (kind === 'external_deposit' || kind === 'external_withdrawal') {
            const amount = number(row.amount);
            if (
                amount === null ||
                amount <= 0 ||
                (kind === 'external_deposit') !== (row.type === 'cash_in')
            )
                return unavailable('외부 입출금 방향·금액을 확인하세요.');
            flows.push({
                date: row.date,
                amount: amount * (kind === 'external_deposit' ? -1 : 1),
            });
        } else if (
            ![
                'dividend',
                'sale',
                'buy',
                'interest',
                'reward',
                'tax',
                'fee',
            ].includes(kind)
        )
            return unavailable(
                '미분류·환전·계좌 간 이동 기록을 먼저 확인하세요.'
            );
    }
    const terminalValue = snapshot.rows.reduce(
        (sum, r) => sum + number(r.amount),
        0
    );
    const result = calculateXirr([
        ...flows,
        { date: snapshot.asOf, amount: terminalValue },
    ]);
    return { ...result, terminalValue, flows: flows.length };
}
