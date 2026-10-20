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
    const exchanges = [];
    const won = rows
        .map((row, index) => ({ row, index }))
        .filter(
            ({ row }) =>
                row.symbol === 'CASH' &&
                row.type === 'cash_out' &&
                row.currency === 'KRW' &&
                row.cashKind === 'exchange' &&
                number(row.amount) > 0 &&
                number(row.exchangeRate) > 0
        );
    const dollars = rows
        .map((row, index) => ({ row, index }))
        .filter(
            ({ row }) =>
                row.symbol === 'CASH' &&
                row.type === 'cash_in' &&
                row.currency === 'USD' &&
                row.cashKind === 'exchange'
        );
    for (const krw of won) {
        const expected = number(krw.row.amount) / number(krw.row.exchangeRate);
        const matches = dollars.filter(
            (usd) =>
                usd.row.date === krw.row.date &&
                close(number(usd.row.amount), expected)
        );
        if (matches.length === 1)
            exchanges.push({ krw, usd: matches[0], receivedUsd: expected });
    }
    return rows.map((row, index) => {
        if (row.type !== 'buy') return row;
        const settlement = number(row.nativeSettlementAmount);
        if (!(settlement > 0)) return row;
        const matches = exchanges.filter(
            ({ krw, receivedUsd }) =>
                krw.row.date === row.date && close(receivedUsd, settlement)
        );
        const competingBuys = rows.filter(
            (candidate) =>
                candidate !== row &&
                candidate.type === 'buy' &&
                candidate.date === row.date &&
                close(number(candidate.nativeSettlementAmount), settlement)
        );
        if (matches.length !== 1 || competingBuys.length)
            return { ...row, _fundingStatus: 'needs_review' };
        const match = matches[0];
        return {
            ...row,
            _fundingStatus: 'matched_exchange',
            _fundingSuggestion: {
                buyIndex: index,
                krwIndex: match.krw.index,
                usdIndex: match.usd.index,
                amount: settlement,
                paidKrw: number(match.krw.row.amount),
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
