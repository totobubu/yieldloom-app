// Shared calculation/validation for the API and the purchase funding editor.
export const cashKinds = {
    external_deposit: '외부 입금 (원금)',
    external_withdrawal: '외부 출금',
    exchange: '계좌 내 환전',
    transfer: '계좌 내 이동',
    dividend: '배당금',
    sale: '매도대금',
    interest: '이자',
    unknown: '확인 필요',
};
export const fundingSources = {
    principal: '직접 투자 원금',
    dividend: '배당금 (출처 종목 미확인)',
    own_dividend: '이 종목의 배당금',
    other_dividend: '다른 종목의 배당금',
    sale: '매도대금',
    interest: '이자',
    unknown: '확인 필요',
};
export const fundingMethods = {
    unknown: '결제 구성 확인 필요',
    usd_balance: '기존 달러 잔액',
    krw_conversion: '원화 환전',
    krw_cash: '원화 잔액',
};
const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
};
export const finiteNumber = (value) =>
    (typeof value === 'number' ||
        (typeof value === 'string' && value.trim() !== '')) &&
    Number.isFinite(Number(value))
        ? Number(value)
        : null;
const rounded = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

export function purchaseBasis(transaction) {
    if (
        !/^(buy|매수|구매)$/i.test(transaction.type || '') &&
        !/매수|구매/.test(transaction.rawType || '')
    )
        fail('매수 거래에만 자금을 배분할 수 있습니다.');
    const usd = finiteNumber(transaction.nativeSettlementAmount);
    const won = finiteNumber(transaction.settlementAmount);
    // Exact settlements are required; trade amount omits commissions/taxes.
    const currency =
        usd > 0
            ? 'USD'
            : won > 0 &&
                transaction.currency !== 'USD' &&
                !finiteNumber(transaction.nativeAmount)
              ? 'KRW'
              : null;
    if (!currency) fail('정확한 매수 정산액을 먼저 확인해 주세요.');
    const total = currency === 'USD' ? usd : won;
    const basisKey = JSON.stringify([
        transaction.date,
        transaction.rawType || transaction.type,
        currency,
        total,
        won,
    ]);
    return { currency, total, basisKey };
}

export function validateFunding(input, transaction) {
    const basis = purchaseBasis(transaction);
    if (input.basisKey !== basis.basisKey)
        throw Object.assign(
            new Error('거래 정산액이 변경되었습니다. 다시 열어 확인해 주세요.'),
            { status: 409 }
        );
    if (
        !Array.isArray(input.parts) ||
        !input.parts.length ||
        input.parts.length > 12
    )
        fail('자금 구성을 1~12개로 나눠 입력해 주세요.');
    const parts = input.parts.map((part) => {
        if (!part || typeof part !== 'object')
            fail('자금 구성을 확인해 주세요.');
        const amount = finiteNumber(part.amount),
            paidKrw = finiteNumber(part.paidKrw);
        if (!(amount > 0) || amount > 1e12)
            fail('사용 금액은 0보다 커야 합니다.');
        if (basis.currency === 'KRW' && !Number.isInteger(amount))
            fail('원화 금액은 정수로 입력해 주세요.');
        if (
            basis.currency === 'USD' &&
            Math.abs(amount - rounded(amount)) > 1e-10
        )
            fail('달러 금액은 소수점 여섯 자리까지 입력해 주세요.');
        if (!Object.hasOwn(fundingSources, part.source))
            fail('자금 출처를 선택해 주세요.');
        const sourceSymbol =
            part.source === 'other_dividend'
                ? String(part.sourceSymbol || '')
                      .trim()
                      .toUpperCase()
                : '';
        if (
            part.source === 'other_dividend' &&
            !/^[A-Z0-9.^:_-]{1,40}$/.test(sourceSymbol)
        )
            fail('배당금을 받은 종목 코드를 입력해 주세요.');
        const methods =
            basis.currency === 'USD'
                ? ['usd_balance', 'krw_conversion', 'unknown']
                : ['krw_cash', 'unknown'];
        if (!methods.includes(part.method))
            fail('정산 통화에 맞는 결제 구성을 선택해 주세요.');
        if (
            part.method === 'krw_conversion' &&
            (!(paidKrw > 0) || paidKrw > 1e15 || !Number.isInteger(paidKrw))
        )
            fail('환전에 사용한 원화 금액을 정수로 입력해 주세요.');
        return {
            method: part.method,
            sourceSymbol,
            source: part.source,
            amount: rounded(amount),
            paidKrw:
                part.method === 'krw_conversion'
                    ? Math.round(paidKrw)
                    : part.method === 'krw_cash'
                      ? Math.round(amount)
                      : null,
        };
    });
    const sum = parts.reduce((n, p) => n + p.amount, 0);
    if (
        Math.abs(sum - basis.total) >
        (basis.currency === 'USD' ? 0.0000005 : 0.5)
    )
        fail('자금 구성 합계가 매수 정산액과 일치해야 합니다.');
    const note = String(input.note || '').trim();
    if (note.length > 500) fail('메모는 500자 이하로 입력해 주세요.');
    if (!Array.isArray(input.evidenceIds || []))
        fail('근거 계좌 내역을 확인해 주세요.');
    const evidenceIds = [...new Set(input.evidenceIds || [])];
    if (
        evidenceIds.length > 10 ||
        evidenceIds.some(
            (id) => typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)
        )
    )
        fail('근거 계좌 내역을 확인해 주세요.');
    return {
        ...basis,
        parts,
        note,
        evidenceIds,
        status: parts.some(
            (p) => p.source === 'unknown' || p.method === 'unknown'
        )
            ? 'partial'
            : 'confirmed',
    };
}

export function capitalSummary(entries, classifications) {
    const byId = new Map(classifications.map((row) => [row.id, row]));
    const result = {
        KRW: { deposits: 0, withdrawals: 0, net: 0 },
        USD: { deposits: 0, withdrawals: 0, net: 0 },
        pending: 0,
        dates: [],
    };
    for (const entry of entries) {
        result.dates.push(String(entry.date).replace(/\D/g, ''));
        const classification = byId.get(entry.id)?.classification;
        if (!classification || classification === 'unknown') {
            result.pending++;
            continue;
        }
        if (
            !['external_deposit', 'external_withdrawal'].includes(
                classification
            )
        )
            continue;
        const bucket = result[entry.currency];
        if (!bucket || !(entry.amount > 0)) {
            result.pending++;
            continue;
        }
        bucket[
            classification === 'external_deposit' ? 'deposits' : 'withdrawals'
        ] += entry.amount;
    }
    for (const currency of ['KRW', 'USD']) {
        const b = result[currency];
        b.deposits = rounded(b.deposits);
        b.withdrawals = rounded(b.withdrawals);
        b.net = rounded(b.deposits - b.withdrawals);
    }
    result.dates.sort();
    return result;
}

// Recovery uses gross contributions: subtracting withdrawals from the denominator
// would count the same recovery twice. Only confirmed cash entries are evidence.
export function capitalRecovery(
    entries,
    classifications,
    mode = 'withdrawals'
) {
    const summary = capitalSummary(entries, classifications);
    const byId = new Map(
        classifications.map((row) => [row.id, row.classification])
    );
    const kinds =
        mode === 'withdrawals'
            ? ['external_withdrawal']
            : mode === 'dividends'
              ? ['dividend']
              : ['dividend', 'sale'];
    return ['KRW', 'USD'].map((currency) => {
        const principal = summary[currency].deposits;
        const recovered = rounded(
            entries.reduce(
                (total, entry) =>
                    entry.currency === currency &&
                    entry.amount > 0 &&
                    kinds.includes(byId.get(entry.id))
                        ? total + Number(entry.amount)
                        : total,
                0
            )
        );
        return {
            currency,
            principal,
            recovered,
            remaining: rounded(Math.max(0, principal - recovered)),
            rate: principal > 0 ? (recovered / principal) * 100 : null,
        };
    });
}

// Date proximity is evidence for review, never proof of which purchase used it.
export function fundingCandidates(transaction, entries, accountId) {
    return entries.filter(
        (row) =>
            String(row.date).replaceAll('-', '') ===
                String(transaction.date).replaceAll('-', '') &&
            (!accountId || !row.accountId || row.accountId === accountId)
    );
}

// Namespace account-local IDs before combining independently classified ledgers.
export function combineCapitalStates(states) {
    const result = { entries: [], classifications: [], allocations: [] };
    for (const { accountId, state } of states) {
        for (const kind of ['entries', 'classifications', 'allocations'])
            result[kind].push(
                ...(state[kind] || []).map((row) => ({
                    ...row,
                    id: `${accountId}:${row.id}`,
                    accountId,
                }))
            );
    }
    return result;
}

// A stock's purchase cost includes reinvested money. Funding describes its origin,
// never a reduction of acquisition cost or an addition to external contributions.
export function stockRecovery(trades, allocations = []) {
    const groups = new Map();
    for (const trade of trades) {
        const { symbol, accountId = '' } = trade;
        // Imported overseas rows may label their KRW equivalent as currency.
        // Funding is settled in USD when native amounts are recorded.
        const currency =
            finiteNumber(trade.nativeSettlementAmount) > 0 ||
            finiteNumber(trade.nativeAmount) > 0
                ? 'USD'
                : trade.currency || 'KRW';
        if (!symbol || symbol === 'CASH') continue;
        const key = `${accountId}:${symbol}:${currency}`;
        const item = groups.get(key) || {
            key,
            accountId,
            symbol,
            currency,
            purchaseCost: 0,
            saleProceeds: 0,
            dividends: 0,
            dividendComplete: true,
            complete: true,
            funding: {},
            unknownFunding: 0,
        };
        groups.set(key, item);
        if (
            !['buy', 'sell', 'dividend', 'dividend_reversal'].includes(
                trade.type
            )
        ) {
            item.complete = false;
            continue;
        }
        const dollar = currency === 'USD';
        const amount = finiteNumber(
            dollar
                ? (trade.nativeAmount ?? (accountId ? trade.amount : null))
                : trade.amount
        );
        if (trade.type.startsWith('dividend')) {
            if (amount === null) {
                item.complete = false;
                item.dividendComplete = false;
            } else
                item.dividends +=
                    Math.abs(amount) *
                    (trade.type === 'dividend_reversal' ? -1 : 1);
            continue;
        }
        const settlement = finiteNumber(
            dollar ? trade.nativeSettlementAmount : trade.settlementAmount
        );
        // Never guess fees or use a KRW equivalent as a dollar settlement.
        if (!(settlement > 0)) {
            item.complete = false;
            continue;
        }
        if (trade.type === 'sell') {
            item.saleProceeds += settlement;
            continue;
        }
        item.purchaseCost += settlement;
        const allocation = allocations.find(
            (row) =>
                row.accountId === trade.accountId &&
                row.assetId === trade.assetId &&
                row.transactionId === trade.id
        );
        let valid = false;
        try {
            valid =
                allocation?.status !== 'reset' &&
                allocation?.basisKey === purchaseBasis(trade).basisKey;
        } catch {
            /* incomplete original trade */
        }
        if (!valid) {
            item.unknownFunding += settlement;
            continue;
        }
        for (const part of allocation.parts || []) {
            const label =
                part.source === 'other_dividend'
                    ? `${part.sourceSymbol || '출처 미확인'} 배당금 재투자`
                    : fundingSources[part.source] || fundingSources.unknown;
            item.funding[label] = (item.funding[label] || 0) + part.amount;
        }
    }
    return [...groups.values()].map((item) => ({
        ...item,
        recovered: item.saleProceeds + item.dividends,
        rate:
            item.complete && item.purchaseCost > 0
                ? ((item.saleProceeds + item.dividends) / item.purchaseCost) *
                  100
                : null,
    }));
}
