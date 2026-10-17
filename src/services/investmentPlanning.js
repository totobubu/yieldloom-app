import {
    recordedDividendRows,
    validCalendarDate,
} from './portfolioCalendar.js';

export function numberIn(value, label, min = 0, max = 1e12) {
    const n =
        typeof value === 'number' || (typeof value === 'string' && value.trim())
            ? Number(value)
            : NaN;
    if (!Number.isFinite(n) || n < min || n > max)
        throw new Error(`${label}: ${min}~${max} 범위의 값을 입력해 주세요.`);
    return n;
}

// A trailing calendar-year window ending at the selected month. Absence is not zero.
export function planningBaseline(entries, positions, currency, month) {
    if (!['USD', 'KRW'].includes(currency) || !validCalendarDate(`${month}-01`))
        return null;
    const end = new Date(`${month}-01T00:00:00Z`);
    const months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(end);
        d.setUTCMonth(d.getUTCMonth() - 11 + i);
        return d.toISOString().slice(0, 7);
    });
    const rows = recordedDividendRows(entries).filter(
        (r) =>
            r.currency === currency &&
            months.includes(r.date.slice(0, 7)) &&
            r.date <= new Date().toISOString().slice(0, 10)
    );
    const symbols = new Map();
    for (const r of rows) {
        if (r.amount != null)
            symbols.set(r.symbol, (symbols.get(r.symbol) || 0) + r.amount);
    }
    const holdings = positions.filter(
        (p) => p.currency === currency && p.symbol !== 'CASH'
    );
    const known = holdings.filter(
        (p) =>
            p.amount != null &&
            p.amount !== '' &&
            typeof p.amount !== 'boolean' &&
            Number.isFinite(Number(p.amount)) &&
            Number(p.amount) >= 0
    );
    return {
        from: months[0],
        to: month,
        annualRecorded:
            rows.length && rows.every((r) => r.amount != null)
                ? rows.reduce((s, r) => s + r.amount, 0)
                : null,
        observedMonths: new Set(rows.map((r) => r.date.slice(0, 7))).size,
        unknown: rows.filter((r) => r.amount == null).length,
        assets: known.length
            ? known.reduce((s, p) => s + Number(p.amount), 0)
            : null,
        excluded: holdings.length - known.length,
        dates: [...new Set(known.map((p) => p.asOf || '미확인'))],
        symbols: [...symbols]
            .map(([symbol, amount]) => ({ symbol, amount }))
            .sort((a, b) => b.amount - a.amount),
        months: months.map((month) => {
            const matches = rows.filter((r) => r.date.startsWith(month));
            const unknown = matches.filter((r) => r.amount == null).length;
            return {
                month,
                count: matches.length,
                unknown,
                amount:
                    matches.length && !unknown
                        ? matches.reduce((s, r) => s + r.amount, 0)
                        : null,
            };
        }),
    };
}

export function projectIncome(input) {
    const initial = numberIn(input.initial, '시작 평가액', 0, 1e12);
    const contribution = numberIn(input.contribution, '월 추가 투자금', 0, 1e9);
    const yieldRate =
        numberIn(input.yieldRate, '시작 세전 배당률', 0, 100) / 100;
    const tax = numberIn(input.tax, '원천징수율', 0, 100) / 100;
    const growth =
        numberIn(input.growth, '연간 주당 배당 변화율', -95, 50) / 100;
    const priceGrowth =
        numberIn(input.priceGrowth, '연간 주가 변화율', -95, 50) / 100;
    const inflation = numberIn(input.inflation, '물가 상승률', -5, 30) / 100;
    const reinvest = numberIn(input.reinvest, '배당 재투자 비율', 0, 100) / 100;
    const target = numberIn(input.target, '월 목표 세후 배당', 0.01, 1e10);
    const years = numberIn(input.years, '기간', 1, 60);
    if (!Number.isInteger(years))
        throw new Error('기간은 정수 연도로 입력해 주세요.');
    if (
        !['USD', 'KRW'].includes(input.currency) ||
        !['USD', 'KRW'].includes(input.targetCurrency)
    )
        throw new Error('통화를 확인해 주세요.');
    if (input.currency === 'KRW' && input.targetCurrency !== 'KRW')
        throw new Error('원화 포트폴리오의 목표 통화는 KRW로 선택해 주세요.');
    const converted = input.currency !== input.targetCurrency;
    let fx = converted
        ? numberIn(input.exchangeRate, 'USD/KRW 환율', 1, 1e5)
        : 1;
    const fxGrowth = converted
        ? numberIn(input.fxGrowth, '연간 환율 변화율', -50, 50) / 100
        : 0;
    let shares = initial,
        price = 1,
        dividendPerShare = yieldRate;
    let cash = 0,
        netTotal = 0,
        reinvestedTotal = 0,
        firstMonth = null;
    const rows = [];
    for (let m = 0; m <= years * 12; m++) {
        if (m > 0) {
            shares += contribution / price;
            price *= (1 + priceGrowth) ** (1 / 12);
            dividendPerShare *= (1 + growth) ** (1 / 12);
            fx *= (1 + fxGrowth) ** (1 / 12);
            const net = (shares * dividendPerShare * (1 - tax)) / 12;
            netTotal += net;
            cash += net * (1 - reinvest);
            reinvestedTotal += net * reinvest;
            shares += (net * reinvest) / price;
        }
        const annualNet = shares * dividendPerShare * (1 - tax);
        const goal = target * (1 + inflation) ** (m / 12);
        const income = (annualNet / 12) * fx;
        const row = {
            month: m,
            income,
            goal,
            wealth: (shares * price + cash) * fx,
            invested: initial + contribution * m,
            cash,
            netTotal,
            reinvestedTotal,
            coverage: (income / goal) * 100,
            currentYield: (dividendPerShare / price) * 100,
        };
        if (
            Object.values(row).some(
                (v) => !Number.isFinite(v) || Math.abs(v) > 1e18
            )
        )
            throw new Error(
                '계산 범위를 초과했습니다. 배당률·성장률·기간을 낮춰 주세요.'
            );
        if (firstMonth == null && income >= goal) firstMonth = m;
        if (m % 12 === 0) rows.push(row);
    }
    return {
        rows,
        firstMonth,
        final: rows.at(-1),
        currency: input.targetCurrency,
        initialMonthly:
            ((initial * yieldRate * (1 - tax)) / 12) *
            (converted ? Number(input.exchangeRate) : 1),
    };
}

export function fireScenarios(input) {
    return [
        { label: '보수적', growth: -2, price: -2, cut: 0.8 },
        { label: '기준', growth: 0, price: 0, cut: 1 },
        { label: '낙관적', growth: 2, price: 2, cut: 1 },
    ].map((s) => ({
        label: s.label,
        result: projectIncome({
            ...input,
            yieldRate: numberIn(input.yieldRate, '배당률', 0, 100) * s.cut,
            growth: Math.max(
                -95,
                Math.min(50, Number(input.growth) + s.growth)
            ),
            priceGrowth: Math.max(
                -95,
                Math.min(50, Number(input.priceGrowth) + s.price)
            ),
        }),
    }));
}

export function recoveryMetrics({
    principal,
    withdrawn,
    dividends,
    monthlyNet,
    withdrawalPercent,
}) {
    const p = numberIn(principal, '누적 외부 납입금', 0.01);
    const w = numberIn(withdrawn, '누적 외부 인출금');
    const d = numberIn(dividends, '누적 확인 세후 배당금');
    const net = numberIn(monthlyNet, '월 세후 배당 가정');
    const portion = numberIn(withdrawalPercent, '배당 인출 비율', 0, 100) / 100;
    const remaining = Math.max(0, p - w);
    const dividendRemaining = Math.max(0, p - d);
    return {
        remaining,
        dividendRemaining,
        cashRate: (w / p) * 100,
        dividendRate: (d / p) * 100,
        cashMonths:
            remaining === 0
                ? 0
                : net * portion > 0
                  ? Math.ceil(remaining / (net * portion))
                  : null,
        dividendMonths:
            dividendRemaining === 0
                ? 0
                : net > 0
                  ? Math.ceil(dividendRemaining / net)
                  : null,
    };
}

export function incomeStress({
    monthlyNet,
    target,
    topShare,
    foreignShare,
    fxShock,
    payoutChange,
    priceChange,
}) {
    const income = numberIn(monthlyNet, '월 세후 배당');
    const goal = numberIn(target, '월 생활비', 0.01);
    const top = numberIn(topShare, '최대 종목 배당 비중', 0, 100) / 100;
    const foreign = numberIn(foreignShare, '환율 영향 배당 비중', 0, 100) / 100;
    const fx = numberIn(fxShock, '환율 충격', -95, 100) / 100;
    const payout = numberIn(payoutChange, '배당금 변화', -100, 100) / 100;
    const price = numberIn(priceChange, '주가 변화', -95, 100) / 100;
    return {
        rows: [
            ...[10, 20, 30].map((c) => ({
                label: `전체 배당 ${c}% 삭감`,
                income: income * (1 - c / 100),
            })),
            {
                label: '최대 배당 기여 종목 지급 중단',
                income: income * (1 - top),
            },
            { label: '환율 충격', income: income * (1 + foreign * fx) },
            {
                label: '배당·환율 동시 충격',
                income: income * (1 + payout) * (1 + foreign * fx),
            },
        ].map((r) => ({
            ...r,
            coverage: (r.income / goal) * 100,
            shortage: Math.max(0, goal - r.income),
        })),
        yieldMultiplier: (1 + payout) / (1 + price),
    };
}

export function compareReinvestment({ amount, months, a, b, saleCost = 0 }) {
    const principal = numberIn(amount, '재투자 금액', 0.01, 1e10);
    const horizon = numberIn(months, '비교 기간', 12, 720);
    if (horizon % 12) throw new Error('비교 기간은 연 단위로 입력해 주세요.');
    const cost = numberIn(saleCost, '교체 세금·비용', 0, principal);
    const run = (label, assumptions, initial) => ({
        label,
        result: projectIncome({
            ...assumptions,
            initial,
            contribution: 0,
            years: horizon / 12,
            target: 1,
            inflation: 0,
            reinvest: 100,
            currency: 'KRW',
            targetCurrency: 'KRW',
        }),
    });
    return [
        run('동일 종목 재투자', a, principal),
        run('다른 종목 신규 투자', b, principal),
        run('매도 후 교체', b, principal - cost),
    ];
}

export const investmentQuestions = [
    {
        id: 'loss',
        title: '주가가 25% 하락하고 배당도 20% 삭감됐습니다. 첫 행동은?',
        kind: 'preference',
        options: [
            '생활비·지급 여력을 확인하고 비중을 줄일 조건을 점검한다',
            '현금 여력 안에서 유지하고 공시를 확인한다',
            '배당률 상승만 보고 대출로 추가 매수한다',
        ],
        scores: [0, 1, 2],
        correct: 0,
        explanation:
            '주가 하락으로 높아진 배당률은 지급 능력 개선을 뜻하지 않습니다. 생활비 의존도와 현금흐름을 먼저 확인하세요.',
    },
    {
        id: 'cash',
        title: '투자 외 비상자금으로 생활비를 얼마나 감당할 수 있나요?',
        kind: 'capacity',
        options: ['3개월 미만', '3~12개월', '12개월 이상'],
        scores: [0, 1, 2],
    },
    {
        id: 'need',
        title: '배당이 중단되면 필수 생활비에 어떤 영향이 있나요?',
        kind: 'capacity',
        options: [
            '즉시 부족해진다',
            '일부 조정하면 버틸 수 있다',
            '다른 소득으로 충당할 수 있다',
        ],
        scores: [0, 1, 2],
    },
    {
        id: 'horizon',
        title: '투자금을 사용해야 하는 시점은 언제인가요?',
        kind: 'capacity',
        options: ['3년 이내', '3~10년', '10년 이후'],
        scores: [0, 1, 2],
    },
    {
        id: 'risk',
        title: '감당하고 싶은 일시적 평가 손실은?',
        kind: 'preference',
        options: ['10% 이내', '10~25%', '25% 이상'],
        scores: [0, 1, 2],
    },
    {
        id: 'concentration',
        title: '높은 배당을 위해 한 종목에 둘 수 있는 비중은?',
        kind: 'preference',
        options: ['10% 이내', '10~25%', '25% 초과'],
        scores: [0, 1, 2],
    },
    {
        id: 'yield',
        title: '주당 배당은 같고 주가만 절반이 됐다면?',
        kind: 'knowledge',
        options: [
            '배당률은 두 배지만 배당금은 그대로다',
            '배당금도 두 배가 된다',
            '기업의 지급 능력이 두 배가 된다',
        ],
        correct: 0,
        explanation:
            '배당률은 주당 배당금 ÷ 주가입니다. 지급 여력은 현금흐름·부채·배당성향을 별도로 확인해야 합니다.',
    },
    {
        id: 'return',
        title: '배당 10을 받고 평가손실이 20이라면 비용 전 성과는?',
        kind: 'knowledge',
        options: ['10 이익', '10 손실', '손익 없음'],
        correct: 1,
        explanation:
            '배당과 평가손익을 합하면 10 손실입니다. 실제 성과에는 세금과 수수료도 반영합니다.',
    },
    {
        id: 'reinvest',
        title: '받은 배당금을 다시 매수했다면 현금 회수인가요?',
        kind: 'knowledge',
        options: [
            '그렇다',
            '외부 인출과 재투자는 구분한다',
            '새로 납입한 원금이다',
        ],
        correct: 1,
        explanation:
            '재투자는 외부 납입금이나 계좌 밖으로 회수한 현금으로 중복 계산하지 않습니다.',
    },
    {
        id: 'tax',
        title: '같은 세전 배당률인 두 상품을 비교할 때 무엇을 보나요?',
        kind: 'knowledge',
        options: [
            '배당률만 비교',
            '지급 횟수만 비교',
            '세후 배당·총수익·지속성·집중도를 함께 비교',
        ],
        correct: 2,
        explanation:
            '세전 배당률만 같아도 세금·비용·기초자산과 분배 구조에 따라 결과는 달라집니다.',
    },
];
export function assessInvestor(answers, largestAssetShare = null) {
    if (
        investmentQuestions.some(
            (q) =>
                !Number.isInteger(answers[q.id]) ||
                answers[q.id] < 0 ||
                answers[q.id] >= q.options.length
        )
    )
        return null;
    const score = (kind) =>
        investmentQuestions
            .filter((q) => q.kind === kind)
            .reduce((s, q) => s + q.scores[answers[q.id]], 0);
    const preference = score('preference'),
        capacity = score('capacity');
    const knowledge = investmentQuestions.filter((q) => q.kind === 'knowledge');
    const correct = knowledge.filter((q) => q.correct === answers[q.id]).length;
    return {
        preference,
        capacity,
        correct,
        total: knowledge.length,
        label:
            preference <= 2
                ? '안정 추구'
                : preference <= 4
                  ? '균형 추구'
                  : '위험 감수',
        warnings: [
            preference > capacity
                ? '선호하는 위험이 현재 투자 여력보다 큽니다. 비상자금과 생활비 의존도를 먼저 점검하세요.'
                : '',
            largestAssetShare > 25
                ? `최대 종목의 확인 평가액 비중이 ${largestAssetShare.toFixed(1)}%입니다. 성향과 별도로 집중 위험을 점검하세요.`
                : '',
            answers.loss === 2
                ? '배당률 상승만으로 차입 매수하면 손실과 현금 부족이 함께 커질 수 있습니다.'
                : '',
        ].filter(Boolean),
        rules: [
            '비상자금과 가까운 시일에 쓸 생활비는 투자금과 구분하기',
            `종목 비중 상한을 ${preference <= 2 ? '10' : '20'}%로 정하는 방안 검토하기`,
            '배당 삭감·현금흐름 악화가 발생하면 재투자 전 지급 여력 점검하기',
            '분기마다 총수익·배당 의존도·분산 상태 점검하기',
        ],
    };
}
