// Read-only reference aggregates. These never establish current holdings or FIFO basis.
import { exact, exactSum } from './exact-amount.js';
const keyOf = (e) => `${e.accountId}|${e.symbol}|${e.currency}`;
const hex = (value) =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const dayOf = (at) => {
    if (typeof at !== 'string') return null;
    const day = at.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        Number.isFinite(Date.parse(day + 'T00:00:00Z')) &&
        new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day
        ? day
        : null;
};
const reasons = {
    NO_RECORDED_TRADES: '집계할 채택 매매 기록이 없습니다.',
    ORDER_IDENTITY_UNVERIFIED:
        '최종 누적 주문 버전의 연결 근거를 확인하지 못했습니다.',
    ORDER_CONFLICT:
        '동일 주문·사건의 상충하는 버전이 있어 합산하지 않았습니다.',
    QUANTITY_UNKNOWN: '체결 수량이 없거나 유효한 정확 소수가 아닙니다.',
    RECORD_DATE_UNKNOWN: '기록일을 확인하지 못해 집계 범위를 정할 수 없습니다.',
    SHARE_MOVEMENT:
        '기업행사·주식 이전·단주 처분이 있어 같은 주식 단위의 순매수를 확정하지 않았습니다.',
};
export const unavailableRecordedQuantity = () => ({
    schemaVersion: 1,
    status: 'unknown',
    buys: null,
    sells: null,
    net: null,
    includedOrders: 0,
    excludedOrders: 0,
    from: null,
    to: null,
    reasons: [
        { code: 'NO_RECORDED_TRADES', message: reasons.NO_RECORDED_TRADES },
    ],
});
const movements = new Set([
    'SPLIT',
    'SECURITY_TRANSFER',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'CASH_IN_LIEU',
]);

export function recordedTradeQuantities({
    events,
    appliedEvents,
    evidence,
    today,
    conflictedAccounts,
}) {
    const groups = new Map(),
        seen = new Map(),
        unsafeAccounts = new Set(conflictedAccounts);
    const group = (e) => {
        const key = keyOf(e);
        if (!groups.has(key))
            groups.set(key, {
                accountId: e.accountId,
                buys: [],
                sells: [],
                days: [],
                included: 0,
                excluded: 0,
                issues: new Set(),
            });
        return groups.get(key);
    };
    for (const e of events) {
        if (!e.symbol || !['BUY', 'SELL'].includes(e.type)) continue;
        const day = dayOf(e.at);
        if (day && day > today) continue;
        const p = group(e),
            proof = evidence?.schemaVersion === 1 && evidence.orders?.[e.id];
        if (
            !proof ||
            proof.kind !== 'canonical_order_cumulative' ||
            !hex(proof.orderKey)
        ) {
            // Ineligible records remain excluded, but cannot prove that a conflicting
            // eligible cumulative version was removed. Fail closed for that group.
            if (!e.excluded) p.issues.add('ORDER_IDENTITY_UNVERIFIED');
        }
        const identity = e.accountId + ':' + (proof?.orderKey || e.id);
        const fingerprint = JSON.stringify([
            e.type,
            e.symbol,
            e.currency,
            e.quantity,
            e.amount,
            e.fee,
            e.tax,
            e.settlement,
            e.excluded,
        ]);
        if (seen.has(identity)) {
            if (seen.get(identity) !== fingerprint)
                unsafeAccounts.add(e.accountId);
            continue;
        }
        seen.set(identity, fingerprint);
        if (e.excluded) {
            p.excluded++;
            continue;
        }
        if (!day) p.issues.add('RECORD_DATE_UNKNOWN');
        else p.days.push(day);
        try {
            if (
                typeof e.quantity !== 'string' ||
                !/^\d+(?:\.\d+)?$/.test(e.quantity) ||
                exact(e.quantity).cmp('0') <= 0
            )
                throw Error('unknown quantity');
            p[e.type === 'BUY' ? 'buys' : 'sells'].push(exact(e.quantity));
            p.included++;
        } catch {
            p.issues.add('QUANTITY_UNKNOWN');
        }
    }
    for (const e of appliedEvents) {
        if (e.excluded || !e.symbol || !movements.has(e.type)) continue;
        const day = dayOf(e.at);
        if (day && day > today) continue;
        group(e).issues.add('SHARE_MOVEMENT');
        if (e.toAccountId)
            group({ ...e, accountId: e.toAccountId }).issues.add(
                'SHARE_MOVEMENT'
            );
    }
    return new Map(
        [...groups].map(([key, p]) => {
            if (unsafeAccounts.has(p.accountId)) p.issues.add('ORDER_CONFLICT');
            if (!p.included) p.issues.add('NO_RECORDED_TRADES');
            const known = p.issues.size === 0,
                buys = exactSum(p.buys),
                sells = exactSum(p.sells);
            return [
                key,
                {
                    schemaVersion: 1,
                    status: known ? 'reference' : 'unknown',
                    buys: known ? buys.text() : null,
                    sells: known ? sells.text() : null,
                    net: known ? buys.sub(sells).text() : null,
                    includedOrders: p.included,
                    excludedOrders: p.excluded,
                    from: p.days.length
                        ? p.days.reduce((a, b) => (a < b ? a : b))
                        : null,
                    to: p.days.length
                        ? p.days.reduce((a, b) => (a > b ? a : b))
                        : null,
                    reasons: [...p.issues].map((code) => ({
                        code,
                        message: reasons[code],
                    })),
                },
            ];
        })
    );
}

export function positionEvidenceStatus({ position, events }) {
    const relevant = events.filter((e) => e.accountId === position.accountId);
    const findings = [];
    const add = (category, message) => findings.push({ category, message });
    const timing = [...position.issues].filter((reason) =>
        /순서|시각/.test(reason)
    );
    if (timing.length) add('order', timing.join(' · '));
    const opening =
        relevant.some((e) => ['OPENING', 'TRANSFER_IN'].includes(e.type)) ||
        events.some(
            (e) =>
                e.type === 'SECURITY_TRANSFER' &&
                e.toAccountId === position.accountId
        );
    add(
        'coverage',
        opening
            ? '기초 lot·입고 입력이 있으나 주식 이력 전체 범위·기준일 잔고는 미확인입니다.'
            : '명시적 기초 lot·주식 이력 전체 범위·기준일 잔고는 미확인입니다.'
    );
    const moved = events.some((e) => movements.has(e.type));
    if (moved)
        add(
            'movement',
            '기업행사·주식 이전·단주 처분 입력이 있습니다. 관측 순매수와 보유 수량을 구분합니다.'
        );
    const costs = relevant.filter((e) =>
        ['BUY', 'OPENING', 'TRANSFER_IN'].includes(e.type)
    );
    if (
        costs.some(
            (e) =>
                e.costOverride == null &&
                (['OPENING', 'TRANSFER_IN'].includes(e.type)
                    ? e.cost == null
                    : e.settlement == null &&
                      [e.amount, e.fee, e.tax].some((v) => v == null))
        )
    )
        add(
            'cost',
            '원통화 취득원가·수수료·세금 또는 정산액에 미상 값이 있습니다.'
        );
    if (
        position.currency === 'USD' &&
        (position.fx.has('실제 환전 원가·기록 환율 미상') ||
            relevant.some(
                (e) =>
                    [
                        'BUY',
                        'SELL',
                        'OPENING',
                        'TRANSFER_IN',
                        'CASH_IN_LIEU',
                    ].includes(e.type) &&
                    e.fxKrwAmount == null &&
                    !(e.fxRate != null && e.fxBasis)
            ))
    )
        add(
            'fx',
            '원화 환전 원가·수취액 또는 적용 환율 근거가 미상입니다. 원통화와 구분합니다.'
        );
    if (position.issues.has('동일 사건의 충돌'))
        add('conflict', '동일 사건에 상충하는 기록이 있습니다.');
    return findings;
}
