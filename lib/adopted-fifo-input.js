import { createHash } from 'node:crypto';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const field = (detail, name) =>
    detail?.fields?.find((f) => f.field === name)?.value ?? null;
// This adapter only reads the already-adopted projection. It never imports a PDF,
// matches another ledger, calls a broker, or promotes order aggregates into fills.
export function adoptedFifoInput(snapshot) {
    const accounts = new Map(),
        events = [];
    for (const row of snapshot.rows) {
        if (!['wife', 'husband'].includes(row.accountId)) continue;
        const accountId = hash(
            'fifo-account:' +
                (row.ledgerAccountKey || 'legacy:' + row.accountId)
        );
        const account = {
            id: accountId,
            ownerId: row.accountId,
            brokerId: 'toss',
            label:
                (row.accountId === 'wife' ? '아내' : '남편') +
                ' · 토스' +
                (row.ledgerAccountKey ? ' · 프로필' : ' · 기존 장부'),
            cashComplete: false,
        };
        accounts.set(accountId, account);
        const detail = snapshot.details.get(row.id);
        const id = hash(accountId + ':' + row.id);
        const type = row.type;
        if (!['BUY', 'SELL', 'DIVIDEND', 'TAX_REFUND'].includes(type)) continue;
        const at =
            row.timestamp && /^\d{4}-\d{2}-\d{2}T/.test(row.timestamp)
                ? row.timestamp
                : row.date;
        const api = detail?.sourceFamily === 'toss_api';
        events.push({
            id,
            accountId,
            type,
            symbol: row.symbol,
            currency: row.currency,
            at,
            quantity: row.quantity,
            amount: row.amount,
            fee: row.commission,
            tax: row.tax,
            settlement: field(detail, 'statementSettlementAmountNative'),
            net:
                type === 'DIVIDEND' &&
                /세후|실제 입금/.test(row.amountMeaning || '')
                    ? row.amount
                    : null,
            fxRate: field(detail, 'recordedExchangeRate'),
            fxBasis:
                field(detail, 'recordedExchangeRate') !== null
                    ? '채택 장부 기록 환율(실제 환전 원가와 구분)'
                    : null,
            fxKrwAmount: field(detail, 'statementSettlementAmountKrw'),
            timing:
                api && row.executionEvidence !== 'single_fill'
                    ? 'order_aggregate'
                    : 'documented',
            excluded:
                row.isTransaction !== true ||
                row.countInTotals === false ||
                Boolean(row.voidedAt),
            exclusionReason:
                row.isTransaction !== true
                    ? '미체결/취소'
                    : row.countInTotals === false
                      ? '중복·계좌 연결 미확정'
                      : row.voidedAt
                        ? '취소된 거래'
                        : null,
            sourceLabel: row.sourceLabel,
            observationId: row.id,
        });
    }
    return {
        accounts: [...accounts.values()],
        events,
        ledgerRevision: hash(
            JSON.stringify([
                snapshot.releaseId,
                snapshot.incrementRevision || '',
                events,
            ])
        ),
        source: 'adopted_private_snapshot',
        unassignedCount: snapshot.unassignedRows?.length || 0,
        limitations: [
            '주문 누적 체결은 개별 체결 시각 근거가 필요합니다.',
            '외부 입출금 전체 범위를 확인하기 전에는 배당 회수율을 확정하지 않습니다.',
            '계좌 미지정 PDF와 다른 포트폴리오 계산을 자동 병합하지 않습니다.',
        ],
    };
}
