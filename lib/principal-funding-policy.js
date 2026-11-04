import { exact, exactSum } from './exact-amount.js';
import { executionInstant } from './fifo-asset-report.js';
// Read-only policy candidates. Never writes classifications, adopts API orders,
// treats an order as a fill, or replaces the existing approved principal value.
const zero = () => exact('0');
const min = (a, b) => (a.cmp(b) < 0 ? a : b);
const sum = (lots) => exactSum(lots.map((l) => l.amount));
const display = (parts) =>
    Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.text()]));
export function tracePrincipalPolicy({ events = [], coverage = [] } = {}) {
    const pools = new Map(),
        results = [],
        duplicates = [],
        seen = new Map();
    const pool = (e) => {
        const key = `${e.accountId}:${e.currency}`;
        if (!pools.has(key)) {
            const c = coverage.find(
                (c) => c.accountId === e.accountId && c.currency === e.currency
            );
            let openingPrincipal = zero(),
                openingDividend = zero(),
                openingKnown = false;
            try {
                openingPrincipal = exact(c.openingPrincipal);
                openingDividend = exact(c.openingDividend);
                openingKnown =
                    openingPrincipal.cmp('0') >= 0 &&
                    openingDividend.cmp('0') >= 0;
            } catch {
                /* Missing opening balance is not zero. */
            }
            pools.set(key, {
                accountId: e.accountId,
                currency: e.currency,
                cash: [],
                stocks: new Map(),
                complete:
                    c?.complete === true &&
                    c?.openingVerified === true &&
                    openingKnown,
                tainted: false,
                openingPrincipal,
                deposits: zero(),
                principalWithdrawn: zero(),
                dividendWithdrawn: zero(),
                realizedPnl: zero(),
                warnings: new Set(),
            });
            if (openingKnown && c?.openingVerified === true) {
                pools.get(key).cash.push(
                    {
                        id: 'verified-opening',
                        kind: 'principal',
                        amount: openingPrincipal,
                    },
                    {
                        id: 'verified-opening',
                        kind: 'dividend',
                        amount: openingDividend,
                    }
                );
            }
        }
        return pools.get(key);
    };
    const eligible = events.filter((e) => {
        if (
            !e ||
            !e.id ||
            !e.accountId ||
            !['USD', 'KRW'].includes(e.currency)
        ) {
            if (e)
                results.push({
                    id: e.id,
                    accountId: e.accountId,
                    currency: e.currency || '통화 미확인',
                    at: e.at,
                    amount: e.amount || null,
                    source: e.source || 'unknown',
                    kind: e.kind,
                    mode: 'policy_candidate',
                    manualNeeded: true,
                    reason: '계좌·통화·거래 식별자의 원문을 확인하세요.',
                    evidence: [],
                });
            return false;
        }
        const key = `${e.accountId}:${e.id}`;
        const serialized = JSON.stringify(e, (_, v) =>
            v && typeof v === 'object' && !Array.isArray(v)
                ? Object.fromEntries(
                      Object.keys(v)
                          .sort()
                          .map((key) => [key, v[key]])
                  )
                : v
        );
        if (seen.has(key)) {
            duplicates.push({
                id: e.id,
                accountId: e.accountId,
                conflict: seen.get(key) !== serialized,
            });
            if (seen.get(key) !== serialized) {
                pool(e).tainted = true;
                pool(e).warnings.add(
                    '동일 출처 ID의 서로 다른 원문을 확인하세요.'
                );
            }
            return false;
        }
        seen.set(key, serialized);
        return true;
    });
    const day = (e) =>
        String(e.at || '')
            .replace(/\D/g, '')
            .slice(0, 8);
    const groups = new Map();
    for (const e of eligible) {
        const key = `${e.accountId}:${e.currency}:${day(e)}`;
        const group = groups.get(key) || [];
        group.push(e);
        groups.set(key, group);
    }
    const ambiguous = new Set();
    for (const group of groups.values())
        if (
            group.length > 1 &&
            (group.some((e) => executionInstant(e.at) === null) ||
                new Set(group.map((e) => String(executionInstant(e.at))))
                    .size !== group.length)
        )
            group.forEach((e) => ambiguous.add(e));
    eligible.sort((a, b) => {
        const x = executionInstant(a.at),
            y = executionInstant(b.at);
        return x !== null && y !== null
            ? x < y
                ? -1
                : x > y
                  ? 1
                  : 0
            : day(a).localeCompare(day(b));
    });
    const take = (cash, amount, kind) => {
        let left = amount;
        const used = [];
        for (const lot of cash) {
            if (lot.kind !== kind || left.cmp('0') <= 0) continue;
            const value = min(lot.amount, left);
            if (value.cmp('0') <= 0) continue;
            used.push({ ...lot, amount: value });
            lot.amount = lot.amount.sub(value);
            left = left.sub(value);
        }
        return { used, left };
    };
    for (const e of eligible) {
        const p = pool(e),
            row = {
                id: e.id,
                accountId: e.accountId,
                currency: e.currency,
                source: e.source || 'unknown',
                at: e.at,
                kind: e.kind,
                mode: e.manualParts ? 'manual_preserved' : 'policy_candidate',
                evidence: [],
            };
        results.push(row);
        try {
            const amount = exact(e.amount);
            if (amount.cmp('0') < 0) throw Error('금액 부호를 확인하세요.');
            const date =
                /^(\d{4}-\d{2}-\d{2})$/.test(e.at || '') &&
                new Date(e.at + 'T00:00:00Z').toISOString().slice(0, 10) ===
                    e.at;
            if (!date && executionInstant(e.at) === null)
                throw Error('실제 금융사건 날짜를 확인하세요.');
            row.amount = amount.text();
            if (ambiguous.has(e))
                throw Error('같은 날 거래의 실제 순서를 확인하세요.');
            if (e.unverified)
                throw Error(
                    e.holdReason || '실제 순액·정산·지급 상태를 확인하세요.'
                );
            if (
                [
                    'exchange',
                    'transfer',
                    'unknown',
                    'dividend_reversal',
                    'interest',
                ].includes(e.kind)
            )
                throw Error('환전·이동·기타 자금의 연결 근거를 확인하세요.');
            if (e.kind === 'deposit' || e.kind === 'dividend') {
                const kind = e.kind === 'deposit' ? 'principal' : 'dividend';
                p.cash.push({ id: e.id, kind, amount });
                if (kind === 'principal') p.deposits = p.deposits.add(amount);
                row.parts = display({ [kind]: amount });
                continue;
            }
            if (['buy', 'withdrawal'].includes(e.kind)) {
                const parts = {
                        dividend: zero(),
                        principal: zero(),
                        unknown: zero(),
                    },
                    consumed = [];
                if (e.manualParts) {
                    for (const kind of Object.keys(parts))
                        parts[kind] = exact(e.manualParts[kind] || '0');
                    if (
                        Object.values(parts).some((v) => v.cmp('0') < 0) ||
                        exactSum(Object.values(parts)).cmp(amount)
                    )
                        throw Error('수동 확정 배분 합계를 확인하세요.');
                    for (const kind of ['dividend', 'principal']) {
                        const taken = take(p.cash, parts[kind], kind);
                        consumed.push(...taken.used);
                        if (taken.left.cmp('0') > 0) {
                            p.tainted = true;
                            row.evidenceIncomplete = true;
                            row.reason =
                                '기존 수동 확정은 보존했지만 재원 잔액의 근거가 부족합니다.';
                            p.warnings.add(
                                '수동 확정값의 현금 출처를 추가 확인하세요.'
                            );
                        }
                    }
                } else if (!p.tainted) {
                    let left = amount;
                    for (const kind of ['dividend', 'principal']) {
                        const taken = take(p.cash, left, kind);
                        consumed.push(...taken.used);
                        parts[kind] = left.sub(taken.left);
                        left = taken.left;
                    }
                    parts.unknown = left;
                } else parts.unknown = amount;
                row.parts = display(parts);
                row.evidence = consumed.map((l) => ({
                    id: l.id,
                    source: l.kind,
                    amount: l.amount.text(),
                }));
                row.manualNeeded =
                    parts.unknown.cmp('0') > 0 || !!row.evidenceIncomplete;
                if (row.manualNeeded) {
                    p.tainted = true;
                    p.warnings.add(
                        '추적되지 않는 나머지만 원금 여부를 직접 선택하세요.'
                    );
                }
                if (e.kind === 'withdrawal') {
                    p.principalWithdrawn = p.principalWithdrawn.add(
                        parts.principal
                    );
                    p.dividendWithdrawn = p.dividendWithdrawn.add(
                        parts.dividend
                    );
                } else {
                    const quantity = exact(e.quantity);
                    if (
                        quantity.cmp('0') <= 0 ||
                        amount.cmp('0') <= 0 ||
                        !e.symbol
                    )
                        throw Error('매수 수량·정산액을 확인하세요.');
                    const lots = p.stocks.get(e.symbol) || [];
                    for (const kind of Object.keys(parts))
                        if (parts[kind].cmp('0') > 0)
                            lots.push({
                                id: e.id,
                                kind,
                                amount: parts[kind],
                                quantity: quantity.mul(parts[kind]).div(amount),
                            });
                    p.stocks.set(e.symbol, lots);
                }
                continue;
            }
            if (e.kind === 'sell') {
                let left = exact(e.quantity);
                if (left.cmp('0') <= 0) throw Error('매도 수량을 확인하세요.');
                const lots = p.stocks.get(e.symbol) || [],
                    sold = [];
                if (exactSum(lots.map((l) => l.quantity)).cmp(left) < 0)
                    throw Error('매도 취득원가·기초 수량이 부족합니다.');
                for (const lot of lots) {
                    if (left.cmp('0') <= 0) break;
                    const q = min(lot.quantity, left);
                    if (q.cmp('0') <= 0) continue;
                    const cost = lot.amount.mul(q).div(lot.quantity);
                    sold.push({ ...lot, amount: cost, quantity: q });
                    lot.amount = lot.amount.sub(cost);
                    lot.quantity = lot.quantity.sub(q);
                    left = left.sub(q);
                }
                row.cost = sum(sold).text();
                row.evidence = sold.map((l) => ({
                    id: l.id,
                    source: l.kind,
                    amount: l.amount.text(),
                    quantity: l.quantity.text(),
                }));
                if (sold.some((l) => l.kind !== 'principal'))
                    throw Error(
                        '배당·미확인 재원 주식의 매도대금 처리 규칙을 확인하세요.'
                    );
                const pnl = amount.sub(sum(sold));
                p.realizedPnl = p.realizedPnl.add(pnl);
                p.cash.push({ id: e.id, kind: 'principal', amount });
                row.realizedPnl = pnl.text();
                row.parts = {
                    principal: amount.text(),
                    dividend: '0',
                    unknown: '0',
                };
                continue;
            }
            throw Error('지원하지 않는 금융사건입니다.');
        } catch (error) {
            const reason = /[가-힣]/.test(error.message)
                ? error.message
                : '금액·수량·날짜의 원문을 확인하세요.';
            p.tainted = true;
            p.warnings.add(reason);
            row.reason = reason;
            row.manualNeeded = true;
            row.realizedPnl = null;
        }
    }
    return {
        policy: 'dividend-fifo-principal-pnl/v1',
        readOnly: true,
        rows: results,
        duplicates,
        accounts: [...pools.values()].map((p) => ({
            accountId: p.accountId,
            currency: p.currency,
            knownDeposits: p.deposits.text(),
            principalWithdrawn: p.principalWithdrawn.text(),
            dividendWithdrawn: p.dividendWithdrawn.text(),
            knownRealizedPnl: p.realizedPnl.text(),
            remainingPrincipal:
                p.complete && !p.tainted
                    ? p.openingPrincipal
                          .add(p.deposits)
                          .add(p.realizedPnl)
                          .sub(p.principalWithdrawn)
                          .text()
                    : null,
            warnings: [
                ...p.warnings,
                ...(!p.complete
                    ? [
                          '입출금 전체 범위와 기초 잔액 미확인: 전체 남은 원금은 확정하지 않습니다.',
                      ]
                    : []),
            ],
        })),
    };
}
