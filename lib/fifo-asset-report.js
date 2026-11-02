import { exact, optionalExact, exactSum } from './exact-amount.js';
const decimal = (v, positive = false) => {
    const n = exact(v);
    if (n.cmp('0') < 0 || (positive && !n.cmp('0')))
        throw Error('양수 금액·수량을 확인해 주세요.');
    return v;
};
const dateOnly = (v) =>
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
export function executionInstant(v) {
    if (typeof v !== 'string') return null;
    const m =
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
            v
        );
    if (!m || !dateOnly(m[1].slice(0, 10))) return null;
    const ms = Date.parse(m[1] + m[3]);
    return Number.isFinite(ms)
        ? BigInt(ms) * 1000000n + BigInt((m[2] || '').padEnd(9, '0'))
        : null;
}
const validAt = (v) => dateOnly(v) || executionInstant(v) !== null;
const accountFor = (accounts, id) => {
    const a = accounts.find((a) => a.id === id);
    if (!a) throw Error('계좌 바인딩을 확인해 주세요.');
    return a;
};
const types = [
    'OPENING_LOT',
    'BASIS',
    'FX_COST',
    'EXECUTION_TIME',
    'CASH_MOVEMENT',
    'CASH_COVERAGE',
    'CONFIRM_INTERNAL_TRANSFER',
    'SECURITY_TRANSFER',
    'SPLIT',
    'CASH_IN_LIEU',
];
export const fifoCorrectionKinds = types;
export function validateFifoCorrection(raw, { accounts, events }) {
    if (!raw || !types.includes(raw.kind))
        throw Error('보정 종류를 확인해 주세요.');
    const input = { ...raw };
    const allowed = [
        'kind',
        'accountId',
        'symbol',
        'currency',
        'at',
        'quantity',
        'cost',
        'amount',
        'direction',
        'targetId',
        'peerId',
        'toAccountId',
        'numerator',
        'denominator',
        'from',
        'to',
        'note',
        'singleExecutionConfirmed',
        'funding',
    ];
    if (Object.keys(input).some((k) => !allowed.includes(k)))
        throw Error('허용하지 않는 보정 필드입니다.');
    if (
        typeof input.note !== 'string' ||
        input.note.trim().length < 3 ||
        input.note.length > 500
    )
        throw Error('날짜·원가·확인 자료의 근거를 3~500자로 입력해 주세요.');
    const out = { kind: input.kind, note: input.note.trim() };
    const targetKinds = [
        'BASIS',
        'FX_COST',
        'EXECUTION_TIME',
        'CONFIRM_INTERNAL_TRANSFER',
    ];
    let target;
    if (targetKinds.includes(input.kind)) {
        target = events.find(
            (e) =>
                e.id === input.targetId &&
                e.accountId === input.accountId &&
                !e.excluded
        );
        if (!target) throw Error('현재 장부의 대상 거래를 확인해 주세요.');
        out.targetId = target.id;
    }
    accountFor(accounts, input.accountId);
    out.accountId = input.accountId;
    if (input.kind === 'BASIS') {
        if (!['BUY', 'TRANSFER_IN', 'OPENING'].includes(target.type))
            throw Error('매수·입고 원가만 보정할 수 있습니다.');
        out.cost = decimal(input.cost);
        if (input.funding !== undefined) {
            if (!['external', 'dividend', 'unknown'].includes(input.funding))
                throw Error('매수 재원 구분을 확인해 주세요.');
            out.funding = input.funding;
        }
    } else if (input.kind === 'FX_COST') {
        if (
            !['BUY', 'SELL', 'CASH_IN_LIEU', 'OPENING', 'TRANSFER_IN'].includes(
                target.type
            ) ||
            target.currency !== 'USD'
        )
            throw Error(
                'USD 거래의 실제 원화 원가·수취액만 보정할 수 있습니다.'
            );
        out.amount = decimal(input.amount);
    } else if (input.kind === 'EXECUTION_TIME') {
        if (
            !['BUY', 'SELL'].includes(target.type) ||
            executionInstant(input.at) === null ||
            input.singleExecutionConfirmed !== true
        )
            throw Error('실제 단일 체결의 시각과 근거 확인이 필요합니다.');
        out.at = input.at;
        out.singleExecutionConfirmed = true;
    } else if (input.kind === 'CONFIRM_INTERNAL_TRANSFER') {
        const peers = events.filter(
            (e) => e.id === input.peerId && !e.excluded
        );
        if (peers.length !== 1)
            throw Error('대응 입금의 계좌별 식별자가 모호합니다.');
        const peer = peers[0];
        if (
            target.type !== 'EXTERNAL_WITHDRAWAL' ||
            peer?.type !== 'EXTERNAL_DEPOSIT' ||
            target.accountId === peer.accountId ||
            target.currency !== peer.currency ||
            exact(target.amount).cmp(peer.amount)
        )
            throw Error('같은 통화·금액의 출금과 입금을 선택해 주세요.');
        accountFor(accounts, peer.accountId);
        out.peerId = peer.id;
    } else if (input.kind === 'CASH_COVERAGE') {
        if (
            !['USD', 'KRW'].includes(input.currency) ||
            !dateOnly(input.from) ||
            !dateOnly(input.to) ||
            input.from > input.to
        )
            throw Error('확인한 외부 입출금의 통화·전체 기간을 입력해 주세요.');
        Object.assign(out, {
            currency: input.currency,
            from: input.from,
            to: input.to,
        });
    } else {
        if (!validAt(input.at))
            throw Error('유효한 날짜 또는 시간대가 있는 시각을 입력해 주세요.');
        if (!['USD', 'KRW'].includes(input.currency))
            throw Error('통화를 확인해 주세요.');
        Object.assign(out, { at: input.at, currency: input.currency });
        if (input.kind === 'CASH_MOVEMENT') {
            if (!['deposit', 'withdrawal', 'unknown'].includes(input.direction))
                throw Error('현금 구분을 확인해 주세요.');
            Object.assign(out, {
                direction: input.direction,
                amount: decimal(input.amount, true),
            });
        } else {
            if (
                typeof input.symbol !== 'string' ||
                !/^[A-Z0-9.^:_-]{1,40}$/.test(input.symbol)
            )
                throw Error('종목을 확인해 주세요.');
            out.symbol = input.symbol;
            if (input.kind === 'SPLIT') {
                out.numerator = decimal(input.numerator, true);
                out.denominator = decimal(input.denominator, true);
            } else {
                out.quantity = decimal(input.quantity, true);
                if (input.kind === 'OPENING_LOT')
                    out.cost =
                        input.cost == null || input.cost === ''
                            ? null
                            : decimal(input.cost);
                if (input.kind === 'CASH_IN_LIEU')
                    out.amount = decimal(input.amount);
                if (input.kind === 'SECURITY_TRANSFER') {
                    const from = accountFor(accounts, input.accountId),
                        to = accountFor(accounts, input.toAccountId);
                    if (
                        from.id === to.id ||
                        !from.ownerId ||
                        from.ownerId !== to.ownerId
                    )
                        throw Error(
                            '같은 명의 계좌의 주식 이전만 지원합니다. 가족 증여 원가는 미지원입니다.'
                        );
                    out.toAccountId = to.id;
                }
            }
        }
    }
    return out;
}
export function applyFifoCorrections(events, corrections, accounts) {
    const rows = events.map((e) => ({ ...e })),
        coverage = [];
    for (const correction of corrections) {
        // Stored corrections are revalidated against the current immutable input.
        const { id, ...payload } = correction;
        const c = validateFifoCorrection(payload, { events: rows, accounts });
        const target = rows.find(
            (e) => e.id === c.targetId && e.accountId === c.accountId
        );
        if (c.kind === 'BASIS')
            Object.assign(target, {
                costOverride: c.cost,
                ...(c.funding ? { funding: c.funding } : {}),
            });
        else if (c.kind === 'FX_COST')
            Object.assign(target, {
                fxKrwAmount: c.amount,
                fxBasis: '수기 확인 실제 원화 금액',
            });
        else if (c.kind === 'EXECUTION_TIME')
            Object.assign(target, {
                at: c.at,
                timing: 'execution',
                timingCorrection: id,
            });
        else if (c.kind === 'CONFIRM_INTERNAL_TRANSFER') {
            const peer = rows.find((e) => e.id === c.peerId);
            if (target.internalPeer || peer.internalPeer)
                throw Error(
                    '이미 연결된 가족 이동입니다. 기존 보정을 되돌려 주세요.'
                );
            Object.assign(target, {
                type: 'INTERNAL_OUT',
                internalPeer: peer.accountId,
            });
            Object.assign(peer, {
                type: 'INTERNAL_IN',
                internalPeer: target.accountId,
            });
        } else if (c.kind === 'CASH_COVERAGE') coverage.push(c);
        else
            rows.push({
                ...c,
                id: 'manual:' + id,
                type:
                    {
                        OPENING_LOT: 'OPENING',
                        CASH_MOVEMENT:
                            c.direction === 'deposit'
                                ? 'EXTERNAL_DEPOSIT'
                                : c.direction === 'withdrawal'
                                  ? 'EXTERNAL_WITHDRAWAL'
                                  : 'UNKNOWN_CASH',
                    }[c.kind] || c.kind,
                timing: 'documented',
                manual: true,
                ...(c.kind === 'CASH_IN_LIEU' ? { settlement: c.amount } : {}),
            });
    }
    return { events: rows, coverage };
}
const keyOf = (e) => `${e.accountId}|${e.symbol}|${e.currency}`;
const sumNullable = (values) =>
    values.some((v) => v === null) ? null : exactSum(values);
const text = (v) => (v === null ? null : v.text());
function settlement(e) {
    if (
        e.costOverride != null &&
        ['BUY', 'OPENING', 'TRANSFER_IN'].includes(e.type)
    )
        return exact(e.costOverride);
    if (['OPENING', 'TRANSFER_IN'].includes(e.type))
        return optionalExact(e.cost);
    if (e.settlement != null) return exact(e.settlement);
    if (e.amount == null || e.fee == null || e.tax == null) return null;
    return e.type === 'BUY'
        ? exact(e.amount).add(e.fee).add(e.tax)
        : exact(e.amount).sub(e.fee).sub(e.tax);
}
function krwAmount(e, native) {
    if (e.currency === 'KRW') return native;
    if (e.fxKrwAmount != null) return exact(e.fxKrwAmount);
    return native !== null && e.fxRate != null && e.fxBasis
        ? native.mul(e.fxRate)
        : null;
}
const interval = (e) => {
    const instant = executionInstant(e.at);
    if (instant !== null) return [instant, instant];
    if (!dateOnly(e.at)) return null;
    const day = BigInt(Date.parse(e.at + 'T00:00:00Z')) * 1000000n;
    return [day - 14n * 3600000000000n, day + 36n * 3600000000000n];
};
function ambiguousAcquisitionOrder(lots) {
    if (lots.length < 2) return false;
    if (new Set(lots.map((lot) => lot.sourceId)).size < 2) return false;
    const timed = lots.map((lot) => ({
        lot,
        range: interval({ at: lot.acquiredAt }),
        date: dateOnly(lot.acquiredAt),
    }));
    if (timed.some((item) => !item.range)) return true;
    timed.sort((a, b) =>
        a.range[0] < b.range[0] ? -1 : a.range[0] > b.range[0] ? 1 : 0
    );
    for (let i = 0; i < timed.length; i++) {
        const a = timed[i];
        for (let j = i + 1; j < timed.length; j++) {
            const b = timed[j];
            if (b.range[0] > a.range[1]) break;
            if (
                a.lot.sourceId !== b.lot.sourceId &&
                !(a.date && b.date && a.lot.acquiredAt !== b.lot.acquiredAt)
            )
                return true;
        }
    }
    return false;
}
export function calculateFifoAssets({
    events = [],
    accounts = [],
    corrections = [],
    scope = 'family',
    quotes = {},
    today = new Date().toISOString().slice(0, 10),
}) {
    const applied = applyFifoCorrections(events, corrections, accounts);
    const all = [],
        seen = new Map(),
        conflicts = new Set(),
        conflictedAccounts = new Set();
    for (const e of applied.events) {
        accountFor(accounts, e.accountId);
        if (e.excluded || e.at?.slice(0, 10) > today) continue;
        const identity = e.accountId + ':' + e.id,
            serialized = JSON.stringify(e);
        if (seen.has(identity)) {
            if (seen.get(identity) !== serialized) {
                conflicts.add(keyOf(e));
                conflictedAccounts.add(e.accountId);
            }
            continue;
        }
        seen.set(identity, serialized);
        all.push(e);
    }
    const selected = new Set(
        accounts
            .filter(
                (a) =>
                    scope === 'family' || a.ownerId === scope || a.id === scope
            )
            .map((a) => a.id)
    );
    const positions = new Map();
    const position = (e) => {
        const key = keyOf(e);
        if (!positions.has(key))
            positions.set(key, {
                accountId: e.accountId,
                symbol: e.symbol,
                currency: e.currency,
                lots: [],
                issues: new Set(),
                buys: [],
                reinvested: [],
                realized: [],
                realizedKrw: [],
                fx: new Set(),
                latest: null,
            });
        return positions.get(key);
    };
    const trades = all.filter(
        (e) =>
            e.symbol &&
            [
                'BUY',
                'SELL',
                'OPENING',
                'TRANSFER_IN',
                'SECURITY_TRANSFER',
                'SPLIT',
                'CASH_IN_LIEU',
            ].includes(e.type)
    );
    for (const e of trades) {
        const p = position(e);
        if (conflicts.has(keyOf(e)) || conflictedAccounts.has(e.accountId))
            p.issues.add('동일 사건의 충돌');
        if (!interval(e)) p.issues.add('거래 시각 미확인');
        if (e.timing === 'order_aggregate')
            p.issues.add('누적 주문의 개별 체결 순서 미확인');
        if (e.type === 'SECURITY_TRANSFER')
            position({ ...e, accountId: e.toAccountId });
    }
    // A date-only record is a time interval, not an invented midnight execution.
    const perPosition = new Map();
    for (const e of trades) {
        for (const key of [
            keyOf(e),
            ...(e.toAccountId
                ? [keyOf({ ...e, accountId: e.toAccountId })]
                : []),
        ]) {
            const list = perPosition.get(key) || [];
            list.push(e);
            perPosition.set(key, list);
        }
    }
    for (const [key, list] of perPosition) {
        const sorted = list
            .filter((e) => interval(e))
            .sort((a, b) => (interval(a)[0] < interval(b)[0] ? -1 : 1));
        for (let i = 1; i < sorted.length; i++) {
            const a = interval(sorted[i - 1]),
                b = interval(sorted[i]);
            if (
                !(
                    dateOnly(sorted[i - 1].at) &&
                    dateOnly(sorted[i].at) &&
                    sorted[i - 1].at !== sorted[i].at
                ) &&
                a[1] >= b[0] &&
                (a[0] !== a[1] || b[0] !== b[1] || a[0] === b[0])
            )
                positions.get(key).issues.add('거래 순서 미확정');
        }
    }
    const sorted = trades
        .filter((e) => interval(e))
        .sort((a, b) => {
            const x = interval(a)[0],
                y = interval(b)[0];
            return x < y ? -1 : x > y ? 1 : 0;
        });
    const consume = (p, quantity) => {
        let left = exact(quantity);
        const parts = [];
        const acquired = p.lots.filter((l) => l.q.cmp('0') > 0);
        if (ambiguousAcquisitionOrder(acquired)) {
            p.issues.add('이전 입고 lot의 원 취득 순서 미확정');
            return [{ q: left, cost: null, krw: null, acquiredAt: null }];
        }
        p.lots.sort((a, b) => {
            if (!a.acquiredAt || !b.acquiredAt) return 0;
            const x = interval({ at: a.acquiredAt })[0],
                y = interval({ at: b.acquiredAt })[0];
            return x < y ? -1 : x > y ? 1 : 0;
        });
        for (const lot of p.lots) {
            if (left.cmp('0') <= 0) break;
            if (lot.q.cmp('0') <= 0) continue;
            const used = lot.q.cmp(left) < 0 ? lot.q : left,
                fraction = used.div(lot.q);
            const part = {
                ...lot,
                q: used,
                cost: lot.cost?.mul(fraction) ?? null,
                krw: lot.krw?.mul(fraction) ?? null,
            };
            lot.q = lot.q.sub(used);
            lot.cost = lot.cost === null ? null : lot.cost.sub(part.cost);
            lot.krw = lot.krw === null ? null : lot.krw.sub(part.krw);
            left = left.sub(used);
            parts.push(part);
        }
        if (left.cmp('0') > 0) {
            p.issues.add('과거 보유 수량·매수 이력 누락');
            parts.push({ q: left, cost: null, krw: null, acquiredAt: null });
        }
        return parts;
    };
    for (const e of sorted) {
        const p = position(e);
        p.latest = e.at.slice(0, 10);
        if (e.type === 'BUY') {
            p.buys.push(settlement(e));
            if (e.funding === 'dividend') p.reinvested.push(settlement(e));
        }
        if (p.issues.size) {
            if (e.toAccountId)
                position({ ...e, accountId: e.toAccountId }).issues.add(
                    '이전 출고 계좌의 원가·순서 미확정'
                );
            continue;
        }
        if (['BUY', 'OPENING', 'TRANSFER_IN'].includes(e.type)) {
            const cost = settlement(e);
            p.fx.add(
                e.fxBasis ||
                    (e.currency === 'KRW'
                        ? '원화 거래'
                        : '실제 환전 원가·기록 환율 미상')
            );
            p.lots.push({
                q: exact(e.quantity),
                cost,
                krw: krwAmount(e, cost),
                acquiredAt: e.at,
                sourceId: e.id,
                fxBasis:
                    e.fxBasis ||
                    (e.currency === 'KRW'
                        ? '원화 거래'
                        : '실제 환전 원가·기록 환율 미상'),
            });
        } else if (['SELL', 'CASH_IN_LIEU'].includes(e.type)) {
            const sold = consume(p, e.quantity),
                cost = sumNullable(sold.map((l) => l.cost)),
                krwCost = sumNullable(sold.map((l) => l.krw)),
                net = settlement(e),
                krwNet = krwAmount(e, net);
            p.realized.push(
                net !== null && cost !== null ? net.sub(cost) : null
            );
            p.realizedKrw.push(
                krwNet !== null && krwCost !== null ? krwNet.sub(krwCost) : null
            );
            p.fx.add(
                e.fxBasis ||
                    (e.currency === 'KRW'
                        ? '원화 거래'
                        : '실제 환전 원가·기록 환율 미상')
            );
        } else if (e.type === 'SPLIT') {
            const ratio = exact(e.numerator).div(e.denominator);
            for (const lot of p.lots) lot.q = lot.q.mul(ratio);
        } else if (e.type === 'SECURITY_TRANSFER') {
            const dest = position({ ...e, accountId: e.toAccountId });
            const from = accountFor(accounts, e.accountId),
                to = accountFor(accounts, e.toAccountId);
            if (from.ownerId !== to.ownerId) {
                p.issues.add('가족 주식 증여 원가 미지원');
                dest.issues.add('가족 주식 증여 원가 미지원');
                continue;
            }
            dest.latest = e.at.slice(0, 10);
            const moved = consume(p, e.quantity);
            dest.lots.push(...moved);
            for (const lot of moved) if (lot.fxBasis) dest.fx.add(lot.fxBasis);
            if (p.issues.size) dest.issues.add('이전 출고 계좌의 원가 미확정');
        }
    }
    const exactRows = [];
    const rows = [...positions.values()]
        .filter((p) => selected.has(p.accountId))
        .map((p) => {
            const active = p.lots.filter((l) => l.q.cmp('0') > 0),
                uncertain = p.issues.size > 0;
            const q = uncertain ? null : exactSum(active.map((l) => l.q)),
                cost = uncertain
                    ? null
                    : sumNullable(active.map((l) => l.cost)),
                krw = uncertain ? null : sumNullable(active.map((l) => l.krw));
            const quote = quotes[p.symbol];
            let price = null;
            try {
                if (
                    quote?.currency === p.currency &&
                    dateOnly(quote.date) &&
                    quote.date <= today &&
                    (Date.parse(today) - Date.parse(quote.date)) / 86400000 <=
                        7 &&
                    (!p.latest || quote.date >= p.latest) &&
                    !(quote.splits || []).some(
                        (action) =>
                            action.date > (p.latest || '') &&
                            action.date <= today
                    )
                )
                    price = exact(String(quote.price));
            } catch {
                /* missing or unrepresentable quote remains unknown */
            }
            if (price && price.cmp('0') <= 0) price = null;
            const value =
                q !== null && q.cmp('0') === 0
                    ? exact('0')
                    : q !== null && price !== null
                      ? q.mul(price)
                      : null;
            const issues = [...p.issues];
            if (cost === null && !uncertain)
                issues.push('취득원가·수수료 미상');
            if (value === null)
                issues.push('동일 통화의 유효한 평가 시세·수량 미확인');
            const amounts = {
                remainingCost: cost,
                remainingKrwCost: krw,
                cumulativeBuys: conflictedAccounts.has(p.accountId)
                    ? null
                    : sumNullable(p.buys),
                reinvestedBuys: conflictedAccounts.has(p.accountId)
                    ? null
                    : sumNullable(p.reinvested),
                realizedPnl: uncertain ? null : sumNullable(p.realized),
                realizedKrwPnl: uncertain ? null : sumNullable(p.realizedKrw),
                marketValue: value,
                unrealizedPnl:
                    value !== null && cost !== null ? value.sub(cost) : null,
            };
            exactRows.push({ currency: p.currency, ...amounts });
            return {
                accountId: p.accountId,
                symbol: p.symbol,
                currency: p.currency,
                quantity: text(q),
                ...Object.fromEntries(
                    Object.entries(amounts).map(([key, amount]) => [
                        key,
                        text(amount),
                    ])
                ),
                priceDate: quote?.date ?? null,
                fxBasis: [...p.fx],
                issues,
                lots: active.map((l) => ({
                    quantity: l.q.text(),
                    cost: text(l.cost),
                    krwCost: text(l.krw),
                    acquiredAt: l.acquiredAt,
                    sourceId: l.sourceId,
                })),
            };
        });
    const currencies = ['USD', 'KRW'].map((currency) => {
        const group = exactRows.filter((p) => p.currency === currency),
            cash = all.filter(
                (e) =>
                    selected.has(e.accountId) &&
                    e.currency === currency &&
                    !e.symbol
            );
        const visible = all.filter(
            (e) => selected.has(e.accountId) && e.currency === currency
        );
        const relevantAccounts = accounts.filter((a) => selected.has(a.id));
        const coverageKnown = relevantAccounts.every(
            (a) =>
                a.cashComplete === true ||
                applied.coverage.some(
                    (c) =>
                        c.accountId === a.id &&
                        c.currency === currency &&
                        c.to >= today &&
                        c.from <=
                            (visible
                                .filter((e) => e.accountId === a.id)
                                .map((e) => e.at?.slice(0, 10))
                                .sort()[0] || today)
                )
        );
        const hasUnknown = cash.some((e) => e.type === 'UNKNOWN_CASH');
        const deposits = exactSum(
            cash
                .filter(
                    (e) =>
                        e.type === 'EXTERNAL_DEPOSIT' ||
                        (e.type === 'INTERNAL_IN' &&
                            !selected.has(e.internalPeer))
                )
                .map((e) => e.amount)
        );
        const withdrawals = exactSum(
            cash
                .filter(
                    (e) =>
                        e.type === 'EXTERNAL_WITHDRAWAL' ||
                        (e.type === 'INTERNAL_OUT' &&
                            !selected.has(e.internalPeer))
                )
                .map((e) => e.amount)
        );
        const dividends = visible.filter(
            (e) => e.type === 'DIVIDEND' || e.type === 'DIVIDEND_REVERSAL'
        );
        const netDividend = [...selected].some((id) =>
            conflictedAccounts.has(id)
        )
            ? null
            : sumNullable(
                  dividends.map((e) =>
                      e.net == null
                          ? null
                          : exact(e.net).mul(
                                e.type === 'DIVIDEND_REVERSAL' ? '-1' : '1'
                            )
                  )
              );
        const externalKnown =
            coverageKnown &&
            !hasUnknown &&
            ![...selected].some((id) => conflictedAccounts.has(id));
        const rate =
            externalKnown && deposits.cmp('0') > 0 && netDividend !== null
                ? netDividend.div(deposits).mul('100')
                : null;
        const total = (field) =>
            group.some((r) => r[field] === null)
                ? null
                : exactSum(group.map((r) => r[field])).text();
        return {
            currency,
            remainingCost: total('remainingCost'),
            cumulativeBuys: total('cumulativeBuys'),
            realizedPnl: total('realizedPnl'),
            unrealizedPnl: total('unrealizedPnl'),
            marketValue: total('marketValue'),
            reinvestedBuys: total('reinvestedBuys'),
            netDividends: text(netDividend),
            externalDeposits: externalKnown ? deposits.text() : null,
            externalWithdrawals: externalKnown ? withdrawals.text() : null,
            netExternal: externalKnown
                ? deposits.sub(withdrawals).text()
                : null,
            dividendRecoveryRate: text(rate),
            recoveryReason: !externalKnown
                ? '외부 입출금 전체 범위·분류 미확인'
                : deposits.cmp('0') === 0
                  ? '누적 외부 투입금 0'
                  : netDividend === null
                    ? '세후 배당 미상'
                    : null,
        };
    });
    return {
        schemaVersion: 1,
        rows,
        currencies,
        precision:
            'exact_rational; finite_decimals_exact; repeating_18_decimal_half_up',
        unsupported: [
            '외화 현금 lot의 별도 환차손익',
            '가족 간 주식 증여 원가',
        ],
        excluded: applied.events.filter((e) => e.excluded).length,
        issues: rows.flatMap((r) =>
            r.issues.map((reason) => ({
                accountId: r.accountId,
                symbol: r.symbol,
                reason,
            }))
        ),
    };
}
