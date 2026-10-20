import {
    purchaseBasis,
    MAX_FUNDING_EVIDENCE,
} from '../../lib/portfolio-capital.js';
export const transactionTypeOptions = [
    { label: '매수', value: 'buy' },
    { label: '매도', value: 'sell' },
    { label: '배당', value: 'dividend' },
    { label: '배당 취소', value: 'dividend_reversal' },
    { label: '입고', value: 'transfer_in' },
    { label: '출고', value: 'transfer_out' },
    { label: '입금', value: 'cash_in' },
    { label: '출금', value: 'cash_out' },
    { label: '분할', value: 'split' },
];

export const transactionTypeLabel = (value) =>
    transactionTypeOptions.find((option) => option.value === value)?.label ||
    '확인 필요';

const isinPattern = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const number = (value) =>
    value !== null && value !== '' && Number.isFinite(Number(value))
        ? Number(value)
        : null;
const close = (a, b, tolerance = 0.000001) =>
    a !== null && b !== null && Math.abs(a - b) <= tolerance;

export function unresolvedIsins(rows) {
    return [
        ...new Set(
            rows
                .filter(
                    (row) =>
                        isinPattern.test(row.originalCode || '') &&
                        row.symbol === row.originalCode
                )
                .map((row) => row.originalCode)
        ),
    ];
}

export function applyIsinResolutions(rows, results) {
    const resolved = new Map(results.map((item) => [item.isin, item]));
    return rows.map((row) => {
        const isin = row.originalCode;
        if (!isinPattern.test(isin || '')) return row;
        if (row.symbol !== isin)
            return { ...row, _mappingStatus: 'saved', _mappingIsin: isin };
        const result = resolved.get(isin);
        if (result?.confirmed)
            return {
                ...row,
                symbol: result.confirmed.symbol,
                securityName: result.confirmed.name || row.securityName,
                _mappingStatus: 'verified',
                _mappingIsin: isin,
                _mappingSources: result.confirmed.sources || [],
                _mappingCandidates: result.candidates || [],
            };
        return {
            ...row,
            _mappingStatus: result ? 'unresolved' : 'unavailable',
            _mappingIsin: isin,
            _mappingCandidates: result?.candidates || [],
        };
    });
}

function inferExactExchangeFunding(rows) {
    // Rebuild evidence after edits; stale suggestions must never survive a changed date/type/currency.
    const clean = rows.map((row) => {
        const copy = { ...row };
        delete copy._fundingStatus;
        delete copy._fundingSuggestion;
        delete copy._exchangePeerIndex;
        delete copy._exchangeStatus;
        return copy;
    });
    const wonByDate = new Map();
    const dollarsByDateAmount = new Map();
    const amountKey = (row, amount) =>
        `${dayKey(row)}:${Number(amount).toFixed(6)}`;
    clean.forEach((row, index) => {
        if (
            row.symbol !== 'CASH' ||
            row.cashKind !== 'exchange' ||
            !(number(row.amount) > 0)
        )
            return;
        const item = { row, index };
        if (row.type === 'cash_out' && row.currency === 'KRW') {
            if (!wonByDate.has(dayKey(row))) wonByDate.set(dayKey(row), []);
            wonByDate.get(dayKey(row)).push(item);
        } else if (row.type === 'cash_in' && row.currency === 'USD') {
            const key = amountKey(row, row.amount);
            if (!dollarsByDateAmount.has(key)) dollarsByDateAmount.set(key, []);
            dollarsByDateAmount.get(key).push(item);
        }
    });
    const candidates = new Map();
    const wonUsage = new Map();
    const dollarUsage = new Map();
    clean.forEach((row, index) => {
        const settlement = number(row.nativeSettlementAmount);
        if (row.type !== 'buy' || row.currency !== 'USD' || !(settlement > 0))
            return;
        const dollars =
            dollarsByDateAmount.get(amountKey(row, settlement)) || [];
        if (
            dollars.length !== 1 ||
            !close(number(dollars[0].row.amount), settlement)
        ) {
            candidates.set(index, null);
            return;
        }
        const usd = dollars[0];
        const paidKrw = number(row.settlementAmount);
        const won = (wonByDate.get(dayKey(row)) || []).filter(
            ({ row: krw }) => {
                // Prefer observed KRW settlement; a rate-only link tolerates at most one won of rounding.
                if (paidKrw > 0) return close(number(krw.amount), paidKrw);
                const rate =
                    number(krw.exchangeRate) || number(row.exchangeRate);
                return (
                    rate > 0 &&
                    close(number(krw.amount), number(usd.row.amount) * rate, 1)
                );
            }
        );
        candidates.set(index, {
            usd,
            won,
            settlement,
            basis: paidKrw > 0 ? 'settlement' : 'rate',
        });
        if (won.length)
            dollarUsage.set(usd.index, (dollarUsage.get(usd.index) || 0) + 1);
        won.forEach((item) =>
            wonUsage.set(item.index, (wonUsage.get(item.index) || 0) + 1)
        );
    });
    return clean.map((row, index) => {
        if (!candidates.has(index)) return row;
        const candidate = candidates.get(index);
        if (
            !candidate ||
            candidate.won.length !== 1 ||
            dollarUsage.get(candidate.usd.index) !== 1 ||
            wonUsage.get(candidate.won[0].index) !== 1
        )
            return { ...row, _fundingStatus: 'needs_review' };
        return {
            ...row,
            _fundingStatus: 'matched_exchange',
            _fundingSuggestion: {
                buyIndex: index,
                krwIndex: candidate.won[0].index,
                usdIndex: candidate.usd.index,
                amount: candidate.settlement,
                paidKrw: number(candidate.won[0].row.amount),
                basis: candidate.basis,
            },
        };
    });
}

const rounded = (value) => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
const dayKey = (row) =>
    `${row.accountId || ''}:${String(row.date).replace(/\D/g, '')}`;
const conversionKey = (row, amount, rate) =>
    `${dayKey(row)}:${Number(rate).toFixed(6)}:${Number(amount).toFixed(2)}`;

export function fundingEvidenceIndices(suggestion) {
    return suggestion?.legs
        ? [
              ...new Set(
                  suggestion.legs.flatMap((leg) => [leg.krwIndex, leg.usdIndex])
              ),
          ]
        : suggestion
          ? [suggestion.krwIndex, suggestion.usdIndex]
          : [];
}

export function purchaseExchangeWithdrawalIndices(rows) {
    return new Set(
        rows.flatMap((row) =>
            row._fundingStatus === 'matched_exchange'
                ? row._fundingSuggestion.legs?.map((leg) => leg.krwIndex) || [
                      row._fundingSuggestion.krwIndex,
                  ]
                : []
        )
    );
}

export function inferExchangeFunding(rows) {
    const result = inferExactExchangeFunding(rows);
    const seen = new Set();
    const duplicateIndices = new Set();
    result.forEach((row, index) => {
        if (!row.externalId) return;
        const key = `${row.accountId || ''}:${row.externalId}`;
        if (seen.has(key)) {
            duplicateIndices.add(index);
            delete row._fundingSuggestion;
            delete row._fundingStatus;
        }
        seen.add(key);
    });
    const won = new Map(),
        dollars = new Map(),
        cancellations = new Map();
    const add = (map, key, item) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    };
    result.forEach((row, index) => {
        if (duplicateIndices.has(index)) return;
        const rate = number(row.exchangeRate),
            amount = number(row.amount);
        if (row.symbol !== 'CASH' || !(rate > 0) || !(amount > 0)) return;
        if (
            row.currency === 'USD' &&
            row.type === 'cash_out' &&
            /환전.*취소/.test(row.rawType || '')
        ) {
            const key = conversionKey(row, amount, rate);
            cancellations.set(key, (cancellations.get(key) || 0) + 1);
        }
        if (row.cashKind !== 'exchange') return;
        if (row.currency === 'KRW' && row.type === 'cash_out')
            add(
                won,
                conversionKey(
                    row,
                    Math.round((amount / rate) * 100) / 100,
                    rate
                ),
                { row, index }
            );
        if (
            row.currency === 'USD' &&
            row.type === 'cash_in' &&
            close(amount, Math.round(amount * 100) / 100)
        )
            add(dollars, conversionKey(row, amount, rate), { row, index });
    });
    const pools = new Map();
    for (const [key, deposits] of dollars) {
        if (!pools.has(dayKey(deposits[0].row)))
            pools.set(dayKey(deposits[0].row), []);
        const withdrawals = won.get(key) || [];
        // Repeated equal amounts are fungible only when both cash-leg counts balance.
        if (withdrawals.length !== deposits.length) continue;
        if (
            withdrawals.some(
                (item, index) =>
                    !close(
                        number(item.row.amount),
                        number(deposits[index].row.amount) *
                            number(deposits[index].row.exchangeRate),
                        1
                    )
            )
        )
            continue;
        const cancelled = cancellations.get(key) || 0;
        deposits.forEach((usd, index) => {
            const krw = withdrawals[index];
            usd.row._exchangePeerIndex = krw.index;
            krw.row._exchangePeerIndex = usd.index;
            usd.row._exchangeStatus = krw.row._exchangeStatus =
                index < cancelled ? 'cancelled' : 'matched';
            if (index < cancelled) return;
            add(pools, dayKey(usd.row), {
                usd,
                krw,
                remaining: number(usd.row.amount),
                used: 0,
                paid: 0,
            });
        });
    }
    // Pair reverse conversions too; they remain cash-review records, not purchase funding.
    const reverseWon = new Map(),
        reverseUsd = new Map();
    result.forEach((row, index) => {
        if (
            duplicateIndices.has(index) ||
            row.symbol !== 'CASH' ||
            !(number(row.amount) > 0) ||
            !(number(row.exchangeRate) > 0)
        )
            return;
        if (
            row.cashKind !== 'exchange' &&
            !/환전.*취소/.test(row.rawType || '')
        )
            return;
        if (row.type === 'cash_in' && row.currency === 'KRW')
            add(
                reverseWon,
                conversionKey(
                    row,
                    Math.round(
                        (number(row.amount) / number(row.exchangeRate)) * 100
                    ) / 100,
                    row.exchangeRate
                ),
                { row, index }
            );
        if (row.type === 'cash_out' && row.currency === 'USD')
            add(reverseUsd, conversionKey(row, row.amount, row.exchangeRate), {
                row,
                index,
            });
    });
    for (const [key, withdrawals] of reverseUsd) {
        const deposits = reverseWon.get(key) || [];
        if (
            withdrawals.length !== deposits.length ||
            withdrawals.some(
                (usd, index) =>
                    !close(
                        number(deposits[index].row.amount),
                        number(usd.row.amount) * number(usd.row.exchangeRate),
                        1
                    )
            )
        )
            continue;
        withdrawals.forEach((usd, index) => {
            const krw = deposits[index];
            usd.row._exchangePeerIndex = krw.index;
            krw.row._exchangePeerIndex = usd.index;
            usd.row._exchangeStatus = krw.row._exchangeStatus = /취소/.test(
                usd.row.rawType || ''
            )
                ? 'cancelled'
                : 'matched';
        });
    }
    // A same-day pool is an explicit allocation convention; it does not prove
    // which order caused a conversion or identify the original principal.
    const ordered = result
        .map((row, index) => ({ row, index }))
        .sort((a, b) =>
            String(a.row.externalId || a.row.id || a.index).localeCompare(
                String(b.row.externalId || b.row.id || b.index)
            )
        );
    for (const pool of pools.values())
        pool.sort((a, b) =>
            String(
                a.usd.row.externalId || a.usd.row.id || a.usd.index
            ).localeCompare(
                String(b.usd.row.externalId || b.usd.row.id || b.usd.index)
            )
        );
    ordered.forEach(({ row, index: buyIndex }) => {
        if (duplicateIndices.has(buyIndex)) return;
        const total = number(row.nativeSettlementAmount);
        const pool = pools.get(dayKey(row));
        if (
            !pool ||
            row.type !== 'buy' ||
            row.currency !== 'USD' ||
            !(total > 0)
        )
            return;
        let left = total;
        const legs = [];
        for (const pair of pool) {
            if (left <= 0.000001 || legs.length === MAX_FUNDING_EVIDENCE / 2)
                break; // Keep proposals editable within the evidence limit.
            if (pair.remaining <= 0.000001) continue;
            const amount = rounded(Math.min(left, pair.remaining));
            const cumulativePaid = Math.round(
                (number(pair.krw.row.amount) * (pair.used + amount)) /
                    number(pair.usd.row.amount)
            );
            legs.push({
                krwIndex: pair.krw.index,
                usdIndex: pair.usd.index,
                amount,
                paidKrw: cumulativePaid - pair.paid,
            });
            pair.paid = cumulativePaid;
            pair.used = rounded(pair.used + amount);
            pair.remaining = rounded(pair.remaining - amount);
            left = rounded(left - amount);
        }
        delete row._fundingSuggestion;
        row._fundingStatus = legs.length ? 'matched_exchange' : 'needs_review';
        if (legs.length)
            row._fundingSuggestion = {
                buyIndex,
                krwIndex: legs[0].krwIndex,
                usdIndex: legs[0].usdIndex,
                amount: total,
                convertedAmount: rounded(total - left),
                unconfirmedAmount: left,
                paidKrw: legs.reduce((sum, leg) => sum + leg.paidKrw, 0),
                basis: 'date_pool',
                legs,
            };
    });
    return result;
}

export function markPurchaseExchangeCash(state) {
    if (!state.importedCash?.length || !state.trades?.length) return state;
    const trades = state.trades || [];
    const cash = state.importedCash || [];
    const rows = inferExchangeFunding([
        ...trades,
        ...cash.map((entry) => ({
            ...entry,
            symbol: 'CASH',
            cashKind: entry.suggestedKind,
            type:
                (entry.rawType === 'cash_out' ||
                    /출금/.test(entry.rawType || '')) !==
                /취소/.test(entry.rawType || '')
                    ? 'cash_out'
                    : 'cash_in',
        })),
    ]);
    const excluded = new Set(
        [...purchaseExchangeWithdrawalIndices(rows)]
            .filter((index) => index >= trades.length)
            .map((index) => rows[index].id)
    );
    const annotate = (entries) =>
        entries.map((entry) => {
            const rest = { ...entry };
            delete rest.purchaseExchange;
            return excluded.has(entry.id)
                ? { ...rest, purchaseExchange: true }
                : rest;
        });
    const allocations = (state.allocations || []).filter(
        (allocation) => !allocation.derived
    );
    const existing = new Set(
        allocations.map(
            (allocation) => `${allocation.assetId}:${allocation.transactionId}`
        )
    );
    rows.slice(0, trades.length).forEach((row) => {
        const suggestion = row._fundingSuggestion;
        if (
            !row.id ||
            suggestion?.basis !== 'date_pool' ||
            existing.has(`ACCOUNT:${row.id}`)
        )
            return;
        const basis = purchaseBasis(row);
        allocations.push({
            id: `ACCOUNT.${row.id}`,
            assetId: 'ACCOUNT',
            transactionId: row.id,
            ...basis,
            revision: 0,
            derived: true,
            status: 'partial',
            parts: [
                {
                    method: 'krw_conversion',
                    source: 'unknown',
                    amount: suggestion.convertedAmount,
                    paidKrw: suggestion.paidKrw,
                },
                ...(suggestion.unconfirmedAmount > 0
                    ? [
                          {
                              method: 'unknown',
                              source: 'unknown',
                              amount: suggestion.unconfirmedAmount,
                          },
                      ]
                    : []),
            ],
            evidenceIds: fundingEvidenceIndices(suggestion).map(
                (index) => rows[index].id
            ),
            note: '같은 날짜 환전 자금을 거래 고유번호 순으로 배분한 제안입니다. 원화의 최초 출처와 부족분은 확인이 필요합니다.',
        });
    });
    return {
        ...state,
        entries: annotate(state.entries || []),
        importedCash: annotate(cash),
        allocations,
    };
}

export function importReviewGroups(rows, errors = []) {
    const errorRows = new Set(errors.map((error) => Number(error.row) - 1));
    const indexed = rows.map((row, index) => ({ row, index }));
    const unresolved = indexed.filter(
        ({ row, index }) =>
            errorRows.has(index) ||
            row.type === 'unknown' ||
            ['unresolved', 'unavailable'].includes(row._mappingStatus)
    );
    const cash = indexed.filter(({ row }) => row.symbol === 'CASH');
    const symbols = new Map();
    for (const item of indexed) {
        if (
            item.row.symbol === 'CASH' ||
            unresolved.some(({ index }) => index === item.index)
        )
            continue;
        if (!symbols.has(item.row.symbol)) symbols.set(item.row.symbol, []);
        symbols.get(item.row.symbol).push(item);
    }
    return {
        all: indexed,
        cash,
        unresolved,
        symbols: [...symbols.entries()].map(([symbol, items]) => ({
            symbol,
            items,
        })),
    };
}
