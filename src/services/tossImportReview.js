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

export function inferExchangeFunding(rows) {
    // Rebuild evidence after edits; stale suggestions must never survive a changed date/type/currency.
    const clean = rows.map((row) => {
        const copy = { ...row };
        delete copy._fundingStatus;
        delete copy._fundingSuggestion;
        return copy;
    });
    const wonByDate = new Map();
    const dollarsByDateAmount = new Map();
    const amountKey = (date, amount) => `${date}:${Number(amount).toFixed(6)}`;
    clean.forEach((row, index) => {
        if (
            row.symbol !== 'CASH' ||
            row.cashKind !== 'exchange' ||
            !(number(row.amount) > 0)
        )
            return;
        const item = { row, index };
        if (row.type === 'cash_out' && row.currency === 'KRW') {
            if (!wonByDate.has(row.date)) wonByDate.set(row.date, []);
            wonByDate.get(row.date).push(item);
        } else if (row.type === 'cash_in' && row.currency === 'USD') {
            const key = amountKey(row.date, row.amount);
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
            dollarsByDateAmount.get(amountKey(row.date, settlement)) || [];
        if (
            dollars.length !== 1 ||
            !close(number(dollars[0].row.amount), settlement)
        ) {
            candidates.set(index, null);
            return;
        }
        const usd = dollars[0];
        const paidKrw = number(row.settlementAmount);
        const won = (wonByDate.get(row.date) || []).filter(({ row: krw }) => {
            // Prefer observed KRW settlement; a rate-only link tolerates at most one won of rounding.
            if (paidKrw > 0) return close(number(krw.amount), paidKrw);
            const rate = number(krw.exchangeRate) || number(row.exchangeRate);
            return (
                rate > 0 &&
                close(number(krw.amount), number(usd.row.amount) * rate, 1)
            );
        });
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
