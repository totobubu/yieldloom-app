// Design review only. Fixed synthetic identities and values never enter the production app.
export const stitchDate = '2026-11-03';
export const stitchRows = [
    [
        'DEMO-A',
        '가상 고배당 인덱스 ETF',
        '예시 운용사',
        0.18,
        '2026-10-20',
        'etf',
    ],
    [
        'DEMO-B',
        '가상 월배당 커버드콜 ETF',
        '알파 인컴 운용',
        0.21,
        '2026-10-15',
        'etf',
    ],
    [
        'DEMO-C',
        '가상 테크 2X 레버리지 인덱스',
        '베타 글로벌',
        0.05,
        '2026-09-28',
        'etf',
    ],
    ['DEMO-D', '가상 테크놀로지스 보통주', '', null, null, 'stock'],
    [
        'DEMO-E',
        '가상 신흥국 반도체 배당성장 포트폴리오',
        '신흥마켓 파트너스',
        null,
        null,
        'etf',
    ],
    ['DEMO-F', '가상 에너지 파트너스 보통주', '', 0.75, '2026-10-12', 'stock'],
].map(
    ([symbol, koName, company, latestAmount, latestExDate, securityType]) => ({
        symbol,
        koName,
        longName: koName,
        company,
        currency: 'USD',
        securityType,
        frequency: 'monthly',
        underlying: securityType === 'etf' ? 'DEMO-BASE' : undefined,
        noDividends: symbol === 'DEMO-D',
        dividendEvidence: { latestAmount, latestExDate },
    })
);
export async function installStitchFixtures(
    page,
    {
        admin = false,
        dividendCoverageComplete = true,
        insightsBySymbol = {},
    } = {}
) {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00Z'));
    await page.route('https://**/*', (route) => route.abort());
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref(${admin ? "{uid:'stitch-review-user',email:'visual@example.test',displayName:'김모음',emailVerified:true,getIdToken:async()=>'stitch-review-token'}" : 'null'}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),auth={},googleProvider={},firebaseReady=true,db=null;`,
        })
    );
    await page.route('**/lib/portfolio-admin.js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: 'export const PORTFOLIO_ADMIN_EMAILS=[];export const isPortfolioAdmin=user=>user?.uid === "stitch-review-user";',
        })
    );
    const directory = {
        rows: stitchRows,
        distributions: {
            tickers: stitchRows
                .filter((r) => r.dividendEvidence.latestAmount)
                .map((r) => ({
                    ticker: r.symbol,
                    latest: {
                        distribution_per_share: r.dividendEvidence.latestAmount,
                        ex_date: r.dividendEvidence.latestExDate,
                        frequency: r.frequency,
                        currency: r.currency,
                    },
                })),
        },
    };
    await page.route('**/src/services/securityDirectory.js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `export async function loadSecurityDirectory(){return ${JSON.stringify(directory)}};export async function loadSecurityInsights(symbol){return (${JSON.stringify(insightsBySymbol)})[symbol] || null}`,
        })
    );
    const family = {
        id: 'stitch-family',
        name: '예시 가족',
        kind: 'personal',
        adminUid: 'stitch-review-user',
        profiles: {
            p: { uid: 'stitch-review-user', name: '김모음' },
            q: { uid: 'stitch-other', name: '이모음' },
        },
    };
    const account = (
        id,
        ownerId,
        institution,
        last4,
        symbol,
        currency,
        quantity,
        amount,
        estimated = false
    ) => ({
        id,
        familyId: 'stitch-family',
        ownerId,
        alias: `${institution} 예시 계좌`,
        institution,
        maskedNumber: `****${last4}`,
        type: 'general',
        authorityUid: 'stitch-review-user',
        permissions: { 'stitch-review-user': id === 'c' ? 'viewer' : 'owner' },
        entriesRevision: 1,
        snapshotRevision: 1,
        calculatedSnapshot: {
            asOf: estimated ? '2026-10-28' : stitchDate,
            entriesRevision: 1,
            snapshotRevision: 1,
            rows: [{ symbol, currency, quantity, amount }],
        },
        asOf: stitchDate,
        snapshot: {
            asOf: estimated ? '2026-10-28' : stitchDate,
            source: estimated ? 'manual-holdings-v1' : 'fixture-snapshot',
            rows: [{ symbol, currency, quantity, amount }],
        },
    });
    const accounts = [
        account('a', 'p', '미래에셋', '0492', 'DEMO-K', 'KRW', 10, 190000),
        account('b', 'p', '토스증권', '0115', 'DEMO-A', 'USD', 20, 980),
        account('c', 'q', '미래에셋', '0884', 'DEMO-M', 'USD', 15, 450, true),
    ];
    const overview = {
        families: [family],
        accounts,
        summary: {
            positions: accounts.flatMap((a) =>
                a.snapshot.rows.map((r) => ({
                    ...r,
                    accountId: a.id,
                    ownerId: a.ownerId,
                    asOf: a.snapshot.asOf,
                    source: a.snapshot.source,
                    calculationMode: a.id === 'c' ? 'estimated' : 'snapshot',
                }))
            ),
            knownValueByCurrency: { KRW: 190000, USD: 1430 },
            missingSnapshotAccounts: [],
            valueComplete: true,
            oldestAsOf: '2026-10-28',
            newestAsOf: stitchDate,
            mixedDates: true,
        },
    };
    const entries = [
        {
            id: 'dividend-1',
            row: {
                date: '2026-11-01',
                type: 'dividend',
                symbol: 'DEMO-A',
                currency: 'USD',
                amount: 4,
            },
        },
        {
            id: 'dividend-2',
            row: {
                date: '2026-10-01',
                type: 'dividend',
                symbol: 'DEMO-A',
                currency: 'USD',
                amount: 3,
            },
        },
        {
            id: 'cancel-1',
            row: {
                date: '2026-11-02',
                type: 'dividend_reversal',
                symbol: 'DEMO-A',
                currency: 'USD',
                amount: 0.4,
            },
        },
    ];
    const history = Array.from({ length: 24 }, (_, i) => ({
        date: new Date(Date.UTC(2024, i + 11, 1)).toISOString().slice(0, 10),
        close: 50,
        amount: i < 23 ? 0.08 : 0.16,
    }));
    await page.route('**/api/**', (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET')
            return route.fulfill({
                status: 409,
                json: { error: '디자인 검토: 저장·전송은 실행하지 않습니다.' },
            });
        if (url.pathname.endsWith('/family-portfolio'))
            return route.fulfill({
                json: url.searchParams.get('accountId')
                    ? {
                          entries:
                              url.searchParams.get('accountId') === 'b'
                                  ? entries
                                  : [],
                          nextCursor: null,
                      }
                    : overview,
            });
        if (url.pathname.endsWith('/thumbnail-data'))
            return route.fulfill({
                json: {
                    catalog: { company: '예시 운용사', securityType: 'etf' },
                    ticker: {
                        symbol: 'DEMO-A',
                        tickerInfo: {
                            symbol: 'DEMO-A',
                            longName: '가상 고배당 인덱스 ETF',
                            company: '예시 운용사',
                            price: 50,
                            currency: 'USD',
                            market: 'NYSE',
                            underlying: 'DEMO-BASE',
                        },
                        backtestData: history,
                        sourceStatus: {
                            priceDate: stitchDate,
                            freshness: 'fresh',
                            source: '고정 합성 스냅샷',
                            collectionCoverage: {
                                dividends: {
                                    complete: dividendCoverageComplete,
                                    start: '2024-12-01',
                                    end: stitchDate,
                                    missingIntervals: [],
                                },
                            },
                        },
                    },
                    series: {},
                    rivals: [],
                    rivalOptions: [],
                    dataStatus: 'fresh',
                },
            });
        if (url.pathname.endsWith('/stock-prices')) {
            const symbol = url.searchParams.get('ticker') || 'DEMO-A';
            if (symbol === 'DEMO-M')
                return route.fulfill({
                    status: 503,
                    json: { error: '합성 시세 미확인' },
                });
            return route.fulfill({
                json: {
                    symbol,
                    currency: symbol === 'DEMO-K' ? 'KRW' : 'USD',
                    source: '고정 합성 스냅샷',
                    candles: Array.from({ length: 307 }, (_, i) => ({
                        date: new Date(Date.UTC(2026, 0, i + 1))
                            .toISOString()
                            .slice(0, 10),
                        open: symbol === 'DEMO-K' ? 19900 : 49.5,
                        high: symbol === 'DEMO-K' ? 20100 : 50.5,
                        low: symbol === 'DEMO-K' ? 19800 : 49,
                        close: symbol === 'DEMO-K' ? 20000 : 50,
                        volume: 10000,
                    })),
                    events: [
                        {
                            date: '2026-10-20',
                            kind: 'dividend',
                            label: '배당락',
                        },
                    ],
                },
            });
        }
        if (url.pathname.includes('portfolio-capital'))
            return route.fulfill({
                json: { entries: [], classifications: [], allocations: [] },
            });
        return route.fulfill({
            status: 404,
            json: { error: '디자인 검토 합성 응답 없음' },
        });
    });
    const distribution = stitchRows
        .filter((r) => r.dividendEvidence.latestAmount)
        .map((r) => ({
            ticker: r.symbol,
            historyUrl: `/content-studio/distribution-ticker-${r.symbol.toLowerCase()}.json`,
        }));
    await page.route('**/distribution-index.json', (r) =>
        r.fulfill({
            json: {
                tickers: [
                    ...distribution,
                    {
                        ticker: 'DEMO-K',
                        historyUrl:
                            '/content-studio/distribution-ticker-demo-k.json',
                    },
                    {
                        ticker: 'DEMO-M',
                        historyUrl:
                            '/content-studio/distribution-ticker-demo-m.json',
                    },
                ],
            },
        })
    );
    await page.route('**/distribution-ticker-*.json', (r) =>
        r.fulfill({
            json: {
                history: [
                    {
                        id: 1,
                        ticker: 'DEMO-A',
                        ex_date: '2026-11-20',
                        payable_date: '2026-11-25',
                        distribution_per_share: 0.18,
                        currency: 'USD',
                        verification_status: 'official',
                        frequency: 'monthly',
                    },
                    {
                        id: 2,
                        ticker: 'DEMO-A',
                        ex_date: '2026-10-20',
                        payable_date: '2026-10-25',
                        distribution_per_share: 0.18,
                        currency: 'USD',
                        verification_status: 'official',
                        frequency: 'monthly',
                    },
                ],
            },
        })
    );
    await page.route('**/security-insights/*.json', (r) =>
        r.fulfill({ json: { securities: {}, asOfDate: stitchDate } })
    );
    await page.route('**/portfolio-classifications.json', (r) =>
        r.fulfill({ json: { securities: {}, asOfDate: stitchDate } })
    );
}
