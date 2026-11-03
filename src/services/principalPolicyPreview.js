import { tracePrincipalPolicy } from '../../lib/principal-funding-policy.js';
import { exact } from '../../lib/exact-amount.js';
import {
    withdrawalBreakdown,
    isWithdrawal,
    validateFunding,
} from '../../lib/portfolio-capital.js';
const date = (row) =>
    row.executedAt ||
    String(row.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
export function principalPolicyPreview(state, accountId) {
    const events = [],
        notes = [],
        annotations = new Map(
            (state.classifications || []).map((a) => [a.id, a])
        );
    for (const e of state.entries || []) {
        if (e.purchaseExchange) continue;
        const a = annotations.get(e.id),
            classification = a?.classification;
        if (['dividend', 'sale'].includes(classification)) {
            notes.push(
                '현금 행의 배당·매도 사본은 종목 원장과 이중 합산하지 않습니다.'
            );
            events.push({
                id: e.id,
                accountId,
                at: date(e),
                currency: e.currency,
                kind: 'unknown',
                amount: String(e.amount ?? ''),
                source: e.source || 'manual-or-imported-cash',
                unverified: true,
                holdReason:
                    '현금 행과 종목 원장의 동일 사건 연결을 확인하세요. 같은 금액을 임의로 두 번 더하거나 제외하지 않습니다.',
            });
            continue;
        }
        const kind =
            classification === 'external_deposit'
                ? 'deposit'
                : isWithdrawal(classification)
                  ? 'withdrawal'
                  : classification || 'unknown';
        const event = {
            id: e.id,
            accountId,
            at: date(e),
            currency: e.currency,
            kind,
            amount: String(e.amount ?? ''),
            source: e.source || 'manual-or-imported-cash',
        };
        if (
            kind === 'withdrawal' &&
            classification !== 'external_withdrawal' &&
            !a.automatic
        ) {
            try {
                const parts = withdrawalBreakdown(e, a);
                event.manualParts = {
                    principal: String(parts.principal),
                    dividend: String(parts.dividend),
                    unknown: exact(String(parts.unknown))
                        .add(String(parts.profit))
                        .text(),
                };
            } catch {
                event.unverified = true;
            }
        }
        events.push(event);
    }
    for (const t of state.trades || []) {
        const usd =
            t.currency === 'USD' ||
            (t.nativeSettlementAmount != null &&
                Number(t.nativeSettlementAmount) > 0);
        const currency = usd ? 'USD' : t.currency;
        const net = usd ? t.nativeSettlementAmount : t.settlementAmount;
        const event = {
            id: t.id,
            accountId,
            at: date(t),
            currency,
            kind: t.type,
            amount: String(net ?? ''),
            quantity: String(t.quantity ?? ''),
            symbol: t.symbol,
            source: t.source || 'adopted-account-ledger',
            unverified:
                net == null || (t.paymentStatus && t.paymentStatus !== 'paid'),
        };
        const allocation = (state.allocations || []).find(
            (a) =>
                a.transactionId === t.id &&
                a.assetId === t.assetId &&
                a.status !== 'reset'
        );
        if (t.type === 'buy' && allocation) {
            try {
                const valid = validateFunding(allocation, t),
                    parts = {
                        principal: exact('0'),
                        dividend: exact('0'),
                        unknown: exact('0'),
                    };
                for (const p of valid.parts) {
                    const key =
                        p.source === 'principal'
                            ? 'principal'
                            : [
                                    'dividend',
                                    'own_dividend',
                                    'other_dividend',
                                ].includes(p.source)
                              ? 'dividend'
                              : 'unknown';
                    parts[key] = parts[key].add(String(p.amount));
                }
                event.manualParts = Object.fromEntries(
                    Object.entries(parts).map(([k, v]) => [k, v.text()])
                );
                if (
                    valid.parts.some(
                        (p) => !['principal', 'dividend'].includes(p.source)
                    )
                ) {
                    event.unverified = true;
                    event.holdReason =
                        '지정한 수동 재원·배당 종목 연결은 기존 확정값에서 확인하세요. 새 FIFO 대조로 대체하지 않습니다.';
                }
            } catch {
                event.unverified = true;
            }
        }
        events.push(event);
    }
    const result = tracePrincipalPolicy({ events }); // Existing API does not prove full cash coverage/opening balances.
    return { ...result, notes: [...new Set(notes)] };
}
