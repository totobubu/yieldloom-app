import {
    recordedDividendRows,
    validCalendarDate,
} from './portfolioCalendar.js';
import { simulateDividends } from './dividendSimulation.js';
const finite = (value) =>
    value != null &&
    value !== '' &&
    typeof value !== 'boolean' &&
    Number.isFinite(Number(value))
        ? Number(value)
        : null;
export function holdingSimulationBaseline(
    positions,
    entries,
    currency,
    month,
    today = new Date().toISOString().slice(0, 10)
) {
    if (
        !['USD', 'KRW'].includes(currency) ||
        !validCalendarDate(`${month}-01`) ||
        month > today.slice(0, 7)
    )
        throw Error('기준 통화와 분석 월을 확인해 주세요.');
    const from = new Date(`${month}-01T00:00:00Z`);
    from.setUTCMonth(from.getUTCMonth() - 11);
    const groups = new Map();
    let excluded = 0;
    for (const row of positions) {
        if (row.currency !== currency || row.symbol === 'CASH') continue;
        const quantity = finite(row.quantity),
            amount = finite(row.amount);
        if (
            !row.symbol ||
            !(quantity > 0) ||
            !(amount > 0) ||
            !validCalendarDate(row.asOf) ||
            row.asOf > today
        ) {
            excluded++;
            continue;
        }
        const group = groups.get(row.symbol) || {
            symbol: row.symbol,
            quantity: 0,
            amount: 0,
            dates: new Set(),
            accounts: new Set(),
        };
        group.quantity += quantity;
        group.amount += amount;
        group.dates.add(row.asOf);
        group.accounts.add(row.accountId);
        groups.set(row.symbol, group);
    }
    const dividends = recordedDividendRows(entries).filter(
        (row) =>
            row.currency === currency &&
            row.date >= from.toISOString().slice(0, 10) &&
            row.date.slice(0, 7) <= month &&
            row.date <= today
    );
    return {
        currency,
        from: from.toISOString().slice(0, 10),
        to: month,
        excluded,
        rows: [...groups.values()].map((group) => {
            const rows = dividends.filter(
                (row) =>
                    row.symbol === group.symbol &&
                    group.accounts.has(row.accountId)
            );
            return {
                symbol: group.symbol,
                currency,
                quantity: group.quantity,
                initial: group.amount,
                price: group.amount / group.quantity,
                dates: [...group.dates].sort(),
                recordedNet:
                    rows.length && rows.every((row) => row.amount != null)
                        ? rows.reduce((sum, row) => sum + row.amount, 0)
                        : null,
                observedMonths: new Set(rows.map((row) => row.date.slice(0, 7)))
                    .size,
            };
        }),
    };
}
export function estimateHoldingDividend(row, taxRate, confirmed) {
    const tax = finite(taxRate);
    if (
        !confirmed ||
        tax == null ||
        tax < 0 ||
        tax >= 100 ||
        row.recordedNet == null ||
        row.recordedNet < 0 ||
        !(row.quantity > 0)
    )
        return null;
    return row.recordedNet / row.quantity / (1 - tax / 100);
}
export function simulateHeldPortfolio(models, setup) {
    if (!Array.isArray(models) || !models.length || models.length > 30)
        throw Error('비교할 종목을 1~30개 선택해 주세요.');
    if (new Set(models.map((row) => row.symbol)).size !== models.length)
        throw Error('같은 종목이 중복 선택됐습니다.');
    if (models.some((row) => row.currency !== setup.currency))
        throw Error('서로 다른 통화의 종목을 합산할 수 없습니다.');
    const total = models.reduce((sum, row) => sum + Number(row.initial), 0);
    const contribution = finite(setup.contribution),
        reduction = finite(setup.reduction);
    if (
        !(total > 0) ||
        contribution == null ||
        contribution < 0 ||
        reduction == null ||
        reduction < 0 ||
        reduction > 100
    )
        throw Error('추가 납입액과 배당 감소 가정을 확인해 주세요.');
    const scenarios = [
        { key: 'cash', label: '배당 현금 보관', reinvest: false, factor: 1 },
        { key: 'reinvest', label: '배당 재투자', reinvest: true, factor: 1 },
        {
            key: 'reduced',
            label: `배당 ${reduction}% 감소 후 재투자`,
            reinvest: true,
            factor: 1 - reduction / 100,
        },
    ].map((scenario) => {
        const securities = models.map((model) => ({
            symbol: model.symbol,
            result: simulateDividends({
                initial: model.initial,
                startingShares: model.quantity,
                price: model.price,
                contribution: (contribution * model.initial) / total,
                annualDividend:
                    finite(model.annualDividend) == null
                        ? null
                        : finite(model.annualDividend) * scenario.factor,
                frequency: model.frequency,
                months: setup.months,
                currency: setup.currency,
                taxRate: setup.taxRate,
                fee: setup.fee,
                annualPriceChange: setup.annualPriceChange,
                fractional: true,
                reinvest: scenario.reinvest,
            }),
        }));
        const fields = [
            'contributed',
            'gross',
            'tax',
            'net',
            'grossTotal',
            'taxTotal',
            'netTotal',
            'fees',
            'stockValue',
            'cash',
            'wealth',
            'gain',
        ];
        const sum = (values) =>
            Object.fromEntries(
                fields.map((key) => [
                    key,
                    values.reduce((total, row) => total + row[key], 0),
                ])
            );
        return {
            ...scenario,
            securities,
            summary: sum(securities.map((row) => row.result.summary)),
            rows: Array.from({ length: Number(setup.months) }, (_, i) => ({
                month: i + 1,
                ...sum(securities.map((row) => row.result.rows[i])),
            })),
        };
    });
    return { currency: setup.currency, initial: total, scenarios };
}
