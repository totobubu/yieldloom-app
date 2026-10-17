// Nominal, single-currency assumptions. No historical data or account balances.
export const simulationVersion = 'nominal-monthly-v2';
function numeric(value, name, min, max, integer = false) {
    const number =
        value === '' || value === null || value === undefined
            ? NaN
            : Number(value);
    if (
        !Number.isFinite(number) ||
        number < min ||
        number > max ||
        (integer && !Number.isInteger(number))
    )
        throw new Error(`${name} 입력 범위를 확인해 주세요. (${min}~${max})`);
    return number;
}
export function simulateDividends(input) {
    const initial = numeric(input.initial, '최초 투자액', 0, 1e9),
        contribution = numeric(input.contribution, '월 추가 납입', 0, 1e7),
        months = numeric(input.months, '기간', 0, 360, true),
        initialPrice = numeric(input.price, '시작 주가', 0.000001, 1e7),
        dividend = numeric(input.annualDividend, '연간 주당 배당금', 0, 1e7),
        taxRate = numeric(input.taxRate, '원천징수 가정', 0, 100) / 100,
        fee = numeric(input.fee, '매수 건당 수수료', 0, 10000),
        priceGrowth =
            numeric(input.annualPriceChange, '연간 주가 변화율', -95, 100) /
            100;
    if (
        typeof input.reinvest !== 'boolean' ||
        typeof input.fractional !== 'boolean'
    )
        throw new Error('재투자와 소수주 선택을 확인해 주세요.');
    const intervals = {
        weekly: 12 / 52,
        monthly: 1,
        quarterly: 3,
        semiannual: 6,
        annual: 12,
    };
    const interval = intervals[input.frequency];
    if (!interval) throw new Error('배당 지급 주기를 선택해 주세요.');
    if (!['USD', 'KRW'].includes(input.currency))
        throw new Error('계산 통화를 선택해 주세요.');
    let shares = 0,
        cash = initial,
        dividendCash = 0,
        price = initialPrice,
        contributed = initial,
        grossTotal = 0,
        taxTotal = 0,
        netTotal = 0,
        fees = 0;
    const buy = () => {
        if (cash <= fee) return;
        let units = (cash - fee) / price;
        if (!input.fractional) units = Math.floor(units);
        if (units < 1e-12) return;
        cash = Math.max(0, cash - units * price - fee);
        shares += units;
        fees += fee;
    };
    const snapshot = (month, gross = 0, tax = 0, net = 0) => ({
        month,
        price,
        shares,
        contributed,
        gross,
        tax,
        net,
        grossTotal,
        taxTotal,
        netTotal,
        fees,
        stockValue: shares * price,
        cash: cash + dividendCash,
        wealth: shares * price + cash + dividendCash,
        gain: shares * price + cash + dividendCash - contributed,
    });
    buy();
    const start = snapshot(0),
        rows = [];
    const monthlyPriceFactor = (1 + priceGrowth) ** (1 / 12);
    for (let month = 1; month <= months; month++) {
        cash += contribution;
        contributed += contribution;
        buy();
        const monthStartPrice = price;
        let gross = 0,
            tax = 0,
            net = 0;
        const payDividend = (paymentsPerYear) => {
            const payment = (shares * dividend) / paymentsPerYear;
            const withholding = payment * taxRate;
            const afterTax = payment - withholding;
            gross += payment;
            tax += withholding;
            net += afterTax;
            grossTotal += payment;
            taxTotal += withholding;
            netTotal += afterTax;
            if (input.reinvest) {
                cash += afterTax;
                if (payment > 0) buy();
            } else dividendCash += afterTax;
        };
        if (input.frequency === 'weekly') {
            // Equal-length model months: 52 evenly spaced payments per year.
            const firstWeek = Math.floor(((month - 1) * 52) / 12) + 1;
            const lastWeek = Math.floor((month * 52) / 12);
            for (let week = firstWeek; week <= lastWeek; week++) {
                const offset = (week * 12) / 52 - (month - 1);
                price = monthStartPrice * monthlyPriceFactor ** offset;
                payDividend(52);
            }
        }
        price = monthStartPrice * monthlyPriceFactor;
        if (input.frequency !== 'weekly' && month % interval === 0)
            payDividend(12 / interval);
        const row = snapshot(month, gross, tax, net);
        if (
            Object.values(row).some(
                (value) => !Number.isFinite(value) || Math.abs(value) > 1e18
            )
        )
            throw new Error(
                '가정에 따른 결과가 계산 범위를 초과했습니다. 기간·배당금·주가 가정을 조정해 주세요.'
            );
        rows.push(row);
    }
    return {
        version: simulationVersion,
        currency: input.currency,
        start,
        rows,
        summary: rows.at(-1) || start,
        assumptions: {
            interval,
            taxRate,
            fee,
            reinvest: !!input.reinvest,
            fractional: !!input.fractional,
        },
    };
}

export function normalizeSimulationSetup(value) {
    if (value?.version !== 1 || !['strategy', 'tax'].includes(value.comparison))
        throw new Error('저장된 시나리오 형식을 확인해 주세요.');
    const pick = (source, keys) =>
        Object.fromEntries(keys.map((key) => [key, source?.[key]]));
    const common = pick(value.common, [
        'months',
        'currency',
        'annualPriceChange',
    ]);
    const keys = [
        'initial',
        'contribution',
        'price',
        'annualDividend',
        'taxRate',
        'fee',
        'frequency',
        'reinvest',
        'fractional',
    ];
    const a = pick(value.a, keys),
        b = pick(value.b, keys);
    simulateDividends({ ...a, ...common });
    simulateDividends({ ...b, ...common });
    for (const key of ['months', 'annualPriceChange'])
        common[key] = Number(common[key]);
    for (const scenario of [a, b])
        for (const key of [
            'initial',
            'contribution',
            'price',
            'annualDividend',
            'taxRate',
            'fee',
        ])
            scenario[key] = Number(scenario[key]);
    return { version: 1, common, comparison: value.comparison, a, b };
}
