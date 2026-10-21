import {
    finiteNumber,
    isWithdrawal,
    purchaseBasis,
    validateFunding,
    withdrawalBreakdown,
} from '../../lib/portfolio-capital.js';

const number = (v) => finiteNumber(v);
const day = (v) =>
    String(v || '')
        .replace(/\D/g, '')
        .slice(0, 8);
const sum = (lots) => lots.reduce((n, lot) => n + lot.amount, 0);
const epsilon = 1e-7;
const currencyOf = (t) =>
    number(t.nativeSettlementAmount) > 0 || number(t.nativeAmount) > 0
        ? 'USD'
        : t.currency;

// A deterministic attribution convention, not proof of a banknote's origin.
// Never mixes currencies/accounts or manufactures missing opening balances.
export function tracePortfolioFunding({
    entries = [],
    classifications = [],
    trades = [],
    allocations = [],
    openingLots = [],
} = {}) {
    const annotations = new Map(
        classifications.map((r) => [`${r.accountId || ''}:${r.id}`, r])
    );
    const accounts = new Map();
    const stocks = new Map();
    const warnings = new Set();
    const timelines = { USD: [], KRW: [] };
    const buckets = {
        USD: {
            deposits: 0,
            recovered: 0,
            principalRecovered: 0,
            estimatedPrincipalRecovered: 0,
            dividendRecovered: 0,
            profitRecovered: 0,
            unknownRecovered: 0,
            realizedPnl: 0,
        },
        KRW: {
            deposits: 0,
            recovered: 0,
            principalRecovered: 0,
            estimatedPrincipalRecovered: 0,
            dividendRecovered: 0,
            profitRecovered: 0,
            unknownRecovered: 0,
            realizedPnl: 0,
        },
    };
    const pool = (accountId, currency) => {
        const key = `${accountId || ''}:${currency}`;
        if (!accounts.has(key)) accounts.set(key, { currency, cash: [] });
        return accounts.get(key).cash;
    };
    const stock = (accountId, symbol, currency) => {
        const key = `${accountId || ''}:${symbol}:${currency}`;
        if (!stocks.has(key))
            stocks.set(key, {
                key,
                accountId,
                symbol,
                currency,
                lots: [],
                direct: 0,
                recovered: 0,
                reinvested: 0,
                reinvestmentRealizedPnl: 0,
                sources: new Set(),
            });
        return stocks.get(key);
    };
    const missing = () =>
        warnings.add(
            '기초 잔액·정산액·수량 또는 자금 출처가 부족한 거래가 있습니다. 미확인분은 원금이나 재투자로 확정하지 않습니다.'
        );
    const take = (
        cash,
        amount,
        predicate = () => true,
        proportional = false,
        consumeUnmatched = false
    ) => {
        const result = [];
        const eligible = cash.filter(predicate);
        const available = sum(eligible);
        let left = amount;
        for (const lot of eligible) {
            const used = proportional
                ? Math.min(lot.amount, (amount * lot.amount) / available)
                : Math.min(lot.amount, left);
            if (!(used > epsilon)) continue;
            result.push({ ...lot, amount: used });
            lot.amount -= used;
            left -= used;
        }
        if (left > epsilon) {
            // An annotation cannot create cash. Remove the unmatched balance
            // from the pool but leave its purchase attribution unresolved.
            if (consumeUnmatched) take(cash, left, () => true, true);
            result.push({ kind: 'unknown', origin: '', amount: left });
            missing();
        }
        return result;
    };
    const rank = {
        opening: -1,
        external_deposit: 0,
        dividend: 1,
        interest: 1,
        reward: 1,
        sell: 2,
        buy: 3,
    };
    const events = [];
    for (const entry of entries) {
        const annotation = annotations.get(
            `${entry.accountId || ''}:${entry.id}`
        );
        const kind = annotation?.classification;
        if (!kind || kind === 'unknown') {
            warnings.add(
                '미분류 계좌 내역이 있습니다. 외부 입출금 분류를 먼저 확인해 주세요.'
            );
            continue;
        }
        // Security dividends/sales are authoritative: cash copies must not double them.
        if (['dividend', 'sale'].includes(kind)) {
            warnings.add(
                '계좌 현금 내역의 배당·매도금은 종목 거래 원장에서만 반영합니다. 대응하는 종목 거래가 있는지 확인해 주세요.'
            );
            continue;
        }
        if (['exchange', 'transfer'].includes(kind)) {
            warnings.add(
                '환전·계좌 간 이동은 자동 연결하지 않습니다. 통화별 기초 잔액과 자금 연결을 확인해 주세요.'
            );
            continue;
        }
        events.push({ ...entry, kind, annotation, cashEntry: true });
    }
    const trackingStarts = new Map();
    for (const opening of openingLots) {
        const openingDay = day(opening.trackingStartAt || opening.date);
        const accountKey = opening.accountId || '';
        const previous = trackingStarts.get(accountKey);
        if (!previous || openingDay < previous)
            trackingStarts.set(accountKey, openingDay);
        events.push({
            ...opening,
            id:
                opening.id ||
                `opening:${accountKey}:${opening.currency}:${opening.symbol || 'CASH'}`,
            date: openingDay,
            kind: 'opening',
            opening: true,
        });
    }
    for (const trade of trades)
        events.push({
            ...trade,
            currency: currencyOf(trade),
            kind: trade.type,
        });
    events.sort(
        (a, b) =>
            day(a.date).localeCompare(day(b.date)) ||
            (rank[a.kind] ?? 4) - (rank[b.kind] ?? 4) ||
            String(a.id).localeCompare(String(b.id))
    );
    const seenDays = new Set();
    for (const event of events) {
        const { accountId = '', currency, symbol, kind, annotation } = event;
        const trackingStart = trackingStarts.get(accountId);
        if (!event.opening && trackingStart && day(event.date) <= trackingStart)
            continue;
        if (!buckets[currency] || !/^\d{8}$/.test(day(event.date))) {
            missing();
            continue;
        }
        const dayKey = `${accountId}:${currency}:${day(event.date)}`;
        if (seenDays.has(dayKey) && !event.opening)
            warnings.add(
                '일자만 있는 거래는 같은 날 입금 → 배당 → 매도 → 매수 → 출금 순으로 배분한 추정치입니다.'
            );
        seenDays.add(dayKey);
        const cash = pool(accountId, currency);
        const amount = number(event.amount);
        if (event.opening) {
            const openingAmount = number(event.amount);
            const openingQuantity = number(event.quantity);
            if (!(openingAmount > 0)) {
                missing();
                continue;
            }
            buckets[currency].deposits += openingAmount;
            if (!symbol || symbol === 'CASH') {
                cash.push({
                    kind: 'principal',
                    origin: '',
                    amount: openingAmount,
                });
            } else if (!(openingQuantity > 0)) {
                missing();
                continue;
            } else {
                const item = stock(accountId, symbol, currency);
                item.direct += openingAmount;
                item.sources.add(`기초 원금 → ${symbol}`);
                item.lots.push({
                    kind: 'principal',
                    origin: symbol,
                    amount: openingAmount,
                    quantity: openingQuantity,
                    opening: true,
                });
            }
        } else if (event.cashEntry) {
            if (!(amount > 0)) {
                missing();
                continue;
            }
            if (kind === 'external_deposit') {
                buckets[currency].deposits += amount;
                cash.push({ kind: 'principal', origin: '', amount });
            } else if (isWithdrawal(kind)) {
                buckets[currency].recovered += amount;
                let parts;
                try {
                    parts = withdrawalBreakdown(event, annotation);
                } catch {
                    parts = {
                        principal: 0,
                        dividend: 0,
                        profit: 0,
                        unknown: amount,
                    };
                }
                const inferred = kind === 'external_withdrawal';
                const removed = [];
                if (inferred) {
                    removed.push(...take(cash, amount, () => true, true));
                } else {
                    for (const source of ['principal', 'dividend', 'profit']) {
                        if (parts[source] > epsilon)
                            removed.push(
                                ...take(
                                    cash,
                                    parts[source],
                                    (lot) => lot.kind === source,
                                    false,
                                    true
                                ).map((lot) => ({
                                    ...lot,
                                    withdrawalSource:
                                        lot.kind === source
                                            ? source
                                            : 'unknown',
                                }))
                            );
                    }
                    if (parts.unknown > epsilon)
                        removed.push(
                            ...take(cash, parts.unknown, () => true, true).map(
                                (lot) => ({
                                    ...lot,
                                    withdrawalSource: 'unknown',
                                })
                            )
                        );
                }
                for (const lot of removed) {
                    const attributed = inferred
                        ? lot.kind
                        : lot.withdrawalSource;
                    if (attributed === 'principal') {
                        if (inferred)
                            buckets[currency].estimatedPrincipalRecovered +=
                                lot.amount;
                        else buckets[currency].principalRecovered += lot.amount;
                        if (lot.origin)
                            stock(accountId, lot.origin, currency).recovered +=
                                lot.amount;
                    } else if (attributed === 'dividend')
                        buckets[currency].dividendRecovered += lot.amount;
                    else if (attributed === 'profit')
                        buckets[currency].profitRecovered += lot.amount;
                    else buckets[currency].unknownRecovered += lot.amount;
                }
            } else if (kind === 'interest' || kind === 'reward')
                cash.push({ kind: 'profit', origin: '', amount });
            else if (kind === 'tax') take(cash, amount, () => true, true);
            else missing();
        } else {
            if (!symbol || symbol === 'CASH') {
                missing();
                continue;
            }
            const item = stock(accountId, symbol, currency);
            if (kind === 'dividend') {
                // Only exact net settlements are spendable; gross dividend amounts
                // cannot silently become reinvestable cash before withholding.
                const net = number(
                    currency === 'USD'
                        ? event.nativeSettlementAmount
                        : event.settlementAmount
                );
                if (net === null || net < 0) {
                    warnings.add(
                        '배당의 실제 세후 정산액이 없는 거래는 재투자 가능 현금에 넣지 않습니다.'
                    );
                    continue;
                }
                cash.push({ kind: 'dividend', origin: symbol, amount: net });
            } else if (kind === 'buy') {
                let basis;
                try {
                    basis = purchaseBasis(event);
                } catch {
                    missing();
                    continue;
                }
                const quantity = number(event.quantity);
                if (!(quantity > 0)) {
                    missing();
                    continue;
                }
                const allocation = allocations.find(
                    (r) =>
                        (r.accountId || '') === accountId &&
                        r.assetId === event.assetId &&
                        r.transactionId === event.id &&
                        r.status !== 'reset'
                );
                let components = [];
                if (allocation) {
                    try {
                        const valid = validateFunding(allocation, event);
                        for (const part of valid.parts) {
                            const accepts = (lot) =>
                                part.source === 'principal'
                                    ? lot.kind === 'principal'
                                    : [
                                            'dividend',
                                            'own_dividend',
                                            'other_dividend',
                                        ].includes(part.source)
                                      ? lot.kind === 'dividend' &&
                                        (part.source === 'own_dividend'
                                            ? lot.origin === symbol
                                            : part.source === 'other_dividend'
                                              ? lot.origin === part.sourceSymbol
                                              : true)
                                      : part.source === 'sale'
                                        ? lot.fromSale === true
                                        : part.source === 'interest'
                                          ? lot.kind === 'profit'
                                          : lot.kind === 'unknown';
                            components.push(
                                ...take(cash, part.amount, accepts, false, true)
                            );
                        }
                    } catch {
                        warnings.add(
                            '변경된 매수 정산액의 자금 구성을 다시 확인해 주세요.'
                        );
                    }
                }
                if (!components.length) {
                    for (const source of [
                        'dividend',
                        'profit',
                        'principal',
                        'unknown',
                    ]) {
                        const left = basis.total - sum(components);
                        const available = sum(
                            cash.filter((l) => l.kind === source)
                        );
                        if (left > epsilon && available > epsilon)
                            components.push(
                                ...take(
                                    cash,
                                    Math.min(left, available),
                                    (l) => l.kind === source
                                )
                            );
                    }
                    const left = basis.total - sum(components);
                    if (left > epsilon) {
                        components.push({
                            kind: 'unknown',
                            origin: '',
                            amount: left,
                        });
                        missing();
                    }
                }
                for (const component of components) {
                    if (component.kind === 'principal' && !component.origin) {
                        component.origin = symbol;
                        item.direct += component.amount;
                    }
                    if (['dividend', 'profit'].includes(component.kind))
                        item.reinvested += component.amount;
                    if (component.origin)
                        item.sources.add(`${component.origin} → ${symbol}`);
                    item.lots.push({
                        ...component,
                        quantity: (quantity * component.amount) / basis.total,
                    });
                }
            } else if (kind === 'sell') {
                const quantity = number(event.quantity);
                const settlement = number(
                    currency === 'USD'
                        ? event.nativeSettlementAmount
                        : event.settlementAmount
                );
                const held = item.lots.reduce((n, lot) => n + lot.quantity, 0);
                if (
                    !(quantity > 0) ||
                    !(settlement > 0) ||
                    quantity > held + epsilon
                ) {
                    missing();
                    continue;
                }
                // Select the oldest acquired lots first. A lot may be split when
                // the sale quantity ends in the middle of it.
                let quantityLeft = quantity;
                const sold = [];
                for (const lot of item.lots) {
                    if (quantityLeft <= epsilon) break;
                    const soldQuantity = Math.min(lot.quantity, quantityLeft);
                    if (!(soldQuantity > epsilon)) continue;
                    const portion = soldQuantity / lot.quantity;
                    sold.push({
                        ...lot,
                        amount: lot.amount * portion,
                        quantity: soldQuantity,
                    });
                    lot.amount *= 1 - portion;
                    lot.quantity -= soldQuantity;
                    quantityLeft -= soldQuantity;
                }
                const cost = sum(sold);
                const reinvestedCost = sum(
                    sold.filter((l) => ['dividend', 'profit'].includes(l.kind))
                );
                if (cost > 0)
                    item.reinvestmentRealizedPnl +=
                        ((settlement - cost) * reinvestedCost) / cost;
                buckets[currency].realizedPnl += settlement - cost;
                const retained = Math.min(1, settlement / cost);
                for (const lot of sold) {
                    cash.push({
                        kind: lot.kind,
                        origin: lot.origin,
                        amount: lot.amount * retained,
                        fromSale: true,
                    });
                }
                if (settlement > cost)
                    cash.push({
                        kind: 'profit',
                        origin: symbol,
                        amount: settlement - cost,
                        fromSale: true,
                    });
            } else if (kind === 'dividend_reversal') {
                // Reversal may refer to money already spent: do not guess its provenance.
                missing();
                warnings.add(
                    '배당 취소 내역이 있어 자금 추적을 중단했습니다. 정정된 배당 원장을 확인해 주세요.'
                );
                return {
                    stocks: [],
                    timelines: { USD: [], KRW: [] },
                    currencies: [],
                    warnings: [...warnings],
                    unavailable: true,
                };
            } else {
                missing();
            }
        }
        const totalCash = [...accounts.values()]
            .filter((a) => a.currency === currency)
            .reduce((n, a) => n + sum(a.cash), 0);
        const cost = [...stocks.values()]
            .filter((s) => s.currency === currency)
            .reduce((n, s) => n + sum(s.lots), 0);
        const snapshot = {
            date: day(event.date),
            ...buckets[currency],
            net: buckets[currency].deposits - buckets[currency].recovered,
            cash: totalCash,
            cost,
            trackedAssetsAtCost: totalCash + cost,
            principalRecovered:
                buckets[currency].principalRecovered +
                buckets[currency].estimatedPrincipalRecovered,
            principalAssets:
                [...accounts.values()]
                    .filter((a) => a.currency === currency)
                    .reduce(
                        (n, a) =>
                            n +
                            sum(a.cash.filter((l) => l.kind === 'principal')),
                        0
                    ) +
                [...stocks.values()]
                    .filter((s) => s.currency === currency)
                    .reduce(
                        (n, s) =>
                            n +
                            sum(s.lots.filter((l) => l.kind === 'principal')),
                        0
                    ),
            reinvestedAssets:
                [...accounts.values()]
                    .filter((a) => a.currency === currency)
                    .reduce(
                        (n, a) =>
                            n +
                            sum(
                                a.cash.filter((l) =>
                                    ['dividend', 'profit'].includes(l.kind)
                                )
                            ),
                        0
                    ) +
                [...stocks.values()]
                    .filter((s) => s.currency === currency)
                    .reduce(
                        (n, s) =>
                            n +
                            sum(
                                s.lots.filter((l) =>
                                    ['dividend', 'profit'].includes(l.kind)
                                )
                            ),
                        0
                    ),
        };
        const line = timelines[currency];
        if (line.at(-1)?.date === snapshot.date)
            line[line.length - 1] = snapshot;
        else line.push(snapshot);
    }
    return {
        warnings: [...warnings],
        timelines,
        currencies: Object.entries(buckets).map(([currency, value]) => ({
            currency,
            ...value,
            currentPrincipalAssets:
                timelines[currency].at(-1)?.principalAssets || 0,
            currentReinvestedAssets:
                timelines[currency].at(-1)?.reinvestedAssets || 0,
            unattributedRecovered: Math.max(
                0,
                value.recovered -
                    [...stocks.values()]
                        .filter((s) => s.currency === currency)
                        .reduce((n, s) => n + s.recovered, 0)
            ),
            totalRecoveryRate:
                value.deposits > 0
                    ? (value.recovered / value.deposits) * 100
                    : null,
            principalRate:
                value.deposits > 0
                    ? ((value.principalRecovered +
                          value.estimatedPrincipalRecovered) /
                          value.deposits) *
                      100
                    : null,
            remainingPrincipal: Math.max(
                0,
                value.deposits -
                    value.principalRecovered -
                    value.estimatedPrincipalRecovered
            ),
            // Compatibility: rate now means the primary, principal-only rate.
            rate:
                value.deposits > 0
                    ? ((value.principalRecovered +
                          value.estimatedPrincipalRecovered) /
                          value.deposits) *
                      100
                    : null,
        })),
        stocks: [...stocks.values()].map((s) => ({
            ...s,
            sources: [...s.sources],
            quantity: s.lots.reduce((n, l) => n + l.quantity, 0),
            reinvestedQuantity: s.lots
                .filter((l) => ['dividend', 'profit'].includes(l.kind))
                .reduce((n, l) => n + l.quantity, 0),
            principalHeld: sum(s.lots.filter((l) => l.kind === 'principal')),
            reinvestedHeld: sum(
                s.lots.filter((l) => ['dividend', 'profit'].includes(l.kind))
            ),
            unknownHeld: sum(s.lots.filter((l) => l.kind === 'unknown')),
            rate: s.direct > 0 ? (s.recovered / s.direct) * 100 : null,
        })),
    };
}
