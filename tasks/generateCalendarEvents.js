// tasks/generateCalendarEvents.js

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import pLimit from 'p-limit';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const NAV_FILE_PATH = path.join(PUBLIC_DIR, 'nav.json');
const CALENDAR_MONTHLY_DIR = path.join(PUBLIC_DIR, 'calendar', 'monthly');

// Helper to manually load .env files
async function loadEnv() {
    const envFiles = [
        '.env.local',
        '.env.r2',
        '.env.production',
        '.env.development',
        '.env',
    ];
    for (const file of envFiles) {
        try {
            const content = await fs.readFile(
                path.join(process.cwd(), file),
                'utf-8'
            );
            const lines = content.split('\n');
            for (const line of lines) {
                const match = line.match(
                    /^\s*(?:export\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)?\s*$/
                );
                if (match) {
                    const key = match[1];
                    let value = match[2] ? match[2].trim() : '';
                    if (value.startsWith('"') && value.endsWith('"'))
                        value = value.slice(1, -1);
                    else if (value.startsWith("'") && value.endsWith("'"))
                        value = value.slice(1, -1);

                    if (!process.env[key]) {
                        process.env[key] = value;
                    }
                }
            }
        } catch (e) {
            // Ignore missing files
        }
    }
}

// Load envs before using them
await loadEnv();

// Ensure we pick up env var if set (prioritize VITE_ prefixed one if standard one missing)
const R2_PUBLIC_URL =
    process.env.R2_PUBLIC_URL || process.env.VITE_R2_PUBLIC_URL;

const KRX_SUFFIXES = new Set(['.KS', '.KQ', '.KN', '.KO']);

const normalizeYahooSymbol = (symbol) => {
    if (!symbol || typeof symbol !== 'string') return null;
    return symbol.trim().toUpperCase();
};

const extractBaseSymbol = (symbol) => {
    const normalized = normalizeYahooSymbol(symbol);
    if (!normalized) return null;
    for (const suffix of KRX_SUFFIXES) {
        if (normalized.endsWith(suffix)) {
            return normalized.slice(0, -suffix.length);
        }
    }
    return normalized;
};

const MARKET_SUBDIR_ALIASES = {
    KOSPI: 'kospi',
    KOSDAQ: 'kosdaq',
    KONEX: 'konex',
    KRX: 'krx',
    'KRX (KOSPI)': 'kospi',
    'KRX (KOSDAQ)': 'kosdaq',
    'KRX-KOSPI': 'kospi',
    'KRX-KOSDAQ': 'kosdaq',
    'KRX-KOSPI': 'kospi',
    NYSE: 'nyse',
    NYSEARCA: 'nyse',
    NASDAQ: 'nasdaq',
    AMEX: 'amex',
};

const getMarketSubdirectory = (market) => {
    const normalized = String(market || '')
        .trim()
        .toUpperCase();
    if (!normalized) return 'misc';
    return MARKET_SUBDIR_ALIASES[normalized] || normalized.toLowerCase();
};

const sanitizeTickerForFilename = (ticker) => {
    if (!ticker) return '';
    const base = extractBaseSymbol(ticker) || ticker;
    return base.replace(/[./\\]/g, '-').toLowerCase();
};

const fetchDataFromR2 = async (symbol, market) => {
    if (!R2_PUBLIC_URL) return null;
    const filename = `${sanitizeTickerForFilename(symbol)}.json`;
    const subdir = getMarketSubdirectory(market);
    const urls = [
        `${R2_PUBLIC_URL}/data/${subdir}/${filename}`,
        `${R2_PUBLIC_URL}/data/${filename}`,
    ];

    for (const url of urls) {
        let retries = 0;
        const maxRetries = 2;
        while (retries <= maxRetries) {
            try {
                const { data } = await axios.get(url, { timeout: 10000 }); // Increased timeout to 10s
                if (data && data.backtestData) return data;
                break; // If success but no backtestData, don't retry same URL
            } catch (e) {
                retries++;
                if (retries > maxRetries) {
                    // console.warn(`Failed to fetch ${url} after ${maxRetries} retries: ${e.message}`);
                } else {
                    await new Promise((r) => setTimeout(r, 1000 * retries)); // Backoff
                }
            }
        }
    }
    return null;
};

// 한국 ETF 브랜드명 목록
const koreanEtfBrands = [
    'KODEX',
    'TIGER',
    'KBSTAR',
    'ACE',
    'ARIRANG',
    'HANARO',
    'SOL',
    'PLUS',
    'RISE',
    'TIMEFOLIO',
    'KOSEF',
    'KINDEX',
    'TRUE',
    'FOCUS',
    'SMART',
    'QV',
    'TREX',
    'HK ',
    'HERO',
    'WOORI',
];

async function generateCalendarEvents() {
    console.log('--- Generating monthly calendar events ---');

    console.time('GenerationTime');

    // calendar/monthly 디렉토리 생성
    try {
        await fs.mkdir(CALENDAR_MONTHLY_DIR, { recursive: true });
    } catch (e) {
        // 이미 존재하면 무시
    }

    let navData;
    try {
        const rawNav = await fs.readFile(NAV_FILE_PATH, 'utf-8');
        navData = JSON.parse(rawNav);
        // Only log basic stats to keep output clean, but good to know it loaded
        console.log(`Loaded nav.json with ${navData?.nav?.length || 0} items.`);
    } catch (error) {
        console.error(
            '❌ Critical Error: Failed to load nav.json. Aborting.',
            error
        );
        process.exit(1);
    }

    if (!navData || !navData.nav) {
        console.error('❌ Invalid nav.json format.');
        process.exit(1);
    }

    if (!R2_PUBLIC_URL) {
        console.warn(
            '⚠️  Warning: R2_PUBLIC_URL (or VITE_R2_PUBLIC_URL) is not set. Data missing locally will NOT be fetched from R2.'
        );
    } else {
        console.log(`Using R2_PUBLIC_URL: ${R2_PUBLIC_URL}`);
    }

    const tickerInfoMap = new Map(
        navData.nav
            .map((item) => {
                // ETF 판단 로직
                let isEtf = !!(item.company || item.underlying);
                if (!isEtf && item.koName) {
                    isEtf = koreanEtfBrands.some((brand) =>
                        item.koName.startsWith(brand)
                    );
                }

                const baseSymbol = extractBaseSymbol(
                    item.symbol || item.yfSymbol
                );
                if (!baseSymbol) return null;
                return [
                    baseSymbol,
                    {
                        ...item,
                        isEtf,
                        baseSymbol,
                    },
                ];
            })
            .filter(Boolean)
    );

    // 월별 데이터 저장용 맵
    const monthlyData = new Map();

    const fileExists = async (p) => {
        try {
            await fs.access(p);
            return true;
        } catch {
            return false;
        }
    };

    // Concurrency control settings
    const CONCURRENCY_LIMIT = 50; // Reduced for reliability over speed
    const limit = pLimit(CONCURRENCY_LIMIT);
    const totalItems = navData.nav.length;
    let processedCount = 0;
    let r2SuccessCount = 0;
    let localSuccessCount = 0;
    let noDividendsCount = 0; // Track skipped items
    let failCount = 0;
    const startTime = Date.now();

    const failedSymbols = []; // Track failed symbols

    // Helper to process a single item
    const processItem = async (navItem) => {
        let isLocal = false;
        try {
            if (navItem.upcoming) return;
            // 배당 없는 종목 건너뛰기
            if (navItem.noDividends) {
                noDividendsCount++;
                return;
            }

            const baseSymbol = extractBaseSymbol(
                navItem.symbol || navItem.yfSymbol
            );

            if (!baseSymbol) return;

            const tickerInfo = tickerInfoMap.get(baseSymbol);
            if (!tickerInfo) return;

            let data = null;
            const symbol = navItem.symbol || navItem.yfSymbol;
            const filename = `${sanitizeTickerForFilename(symbol)}.json`;

            // Paths candidates
            const marketSlug = getMarketSubdirectory(navItem.market);
            const candidates = [
                path.join(DATA_DIR, marketSlug, filename),
                path.join(DATA_DIR, filename),
            ];

            // Try local files
            for (const p of candidates) {
                try {
                    if (await fileExists(p)) {
                        data = JSON.parse(await fs.readFile(p, 'utf-8'));
                        if (data) {
                            isLocal = true;
                            localSuccessCount++;
                            break;
                        }
                    }
                } catch (e) {}
            }

            // Try R2 if not found locally
            if (!data) {
                data = await fetchDataFromR2(symbol, navItem.market);
                if (data) r2SuccessCount++;
            }

            if (!data) {
                // console.warn(`Failed to fetch data for: ${symbol} (${navItem.market})`);
                failedSymbols.push(`${symbol} (${navItem.market})`);
                failCount++;
                return;
            }

            const backtestData = data.backtestData || [];
            if (backtestData.length === 0) return;

            const currency = tickerInfo.currency || 'USD';
            const isEtf = tickerInfo.isEtf || false;

            // 카테고리 결정
            let categoryKey;
            if (currency === 'USD' && !isEtf) categoryKey = 'UsStock';
            else if (currency === 'USD' && isEtf) categoryKey = 'UsEtf';
            else if (currency === 'KRW' && !isEtf) categoryKey = 'KrStock';
            else if (currency === 'KRW' && isEtf) categoryKey = 'KrEtf';
            else categoryKey = 'UsStock'; // fallback

            // backtestData에서 배당 관련 필드가 있는 날짜만 처리
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // ** CHANGED: Date Range Logic (Past 6 months to Future 6 months) **
            const sixMonthsAgo = new Date(today);
            sixMonthsAgo.setMonth(today.getMonth() - 6);
            sixMonthsAgo.setDate(1); // Start from 1st of the month

            const sixMonthsLater = new Date(today);
            sixMonthsLater.setMonth(today.getMonth() + 7);
            sixMonthsLater.setDate(0); // End at last day of the 6th month ahead

            backtestData.forEach((entry) => {
                if (!entry || !entry.date) return;

                const dateStr = entry.date;
                const entryDate = new Date(dateStr);

                // Filter date range
                if (entryDate < sixMonthsAgo || entryDate > sixMonthsLater) {
                    return;
                }

                const isFuture = entryDate >= today;

                const event = {
                    ticker: baseSymbol,
                    frequency: tickerInfo.frequency,
                    group: tickerInfo.group,
                };

                // 한국 주식/ETF인 경우에만 koName 추가 (미국 주식은 Ticker로 표시하므로 생략)
                if (categoryKey.startsWith('Kr')) {
                    event.koName = tickerInfo.koName;
                }

                let hasEvent = false;

                const amount =
                    entry.amountFixed !== undefined
                        ? entry.amountFixed
                        : entry.amount;

                if (amount !== undefined && amount !== null) {
                    event.amount = amount;
                    hasEvent = true;
                } else if (isFuture && entry.expected === true) {
                    event.isExpected = true;
                    hasEvent = true;
                } else if (isFuture && entry.forecasted === true) {
                    event.isForecast = true;
                    event.isExpected = true;
                    hasEvent = true;
                }

                if (hasEvent) {
                    const [year, month] = dateStr.split('-');
                    const yearMonth = `${year}-${month}`;

                    if (!monthlyData.has(yearMonth)) {
                        monthlyData.set(yearMonth, {
                            UsStock: {},
                            UsEtf: {},
                            KrStock: {},
                            KrEtf: {},
                        });
                    }

                    const monthData = monthlyData.get(yearMonth);
                    if (!monthData[categoryKey][dateStr]) {
                        monthData[categoryKey][dateStr] = [];
                    }

                    if (
                        !monthData[categoryKey][dateStr].some(
                            (e) => e.ticker === baseSymbol
                        )
                    ) {
                        monthData[categoryKey][dateStr].push(event);
                    }
                }
            });
        } finally {
            processedCount++;

            // Log progress
            const elapsed = (Date.now() - startTime) / 1000; // seconds
            const rate = processedCount / elapsed; // items per second
            const remaining = totalItems - processedCount;
            const eta = remaining / rate;

            if (processedCount % 100 === 0 || processedCount >= totalItems) {
                console.log(
                    `[${Math.round((processedCount / totalItems) * 100)}%] ${processedCount}/${totalItems} processed. (Local: ${localSuccessCount}, R2: ${r2SuccessCount}, NoDiv: ${noDividendsCount}, Failed: ${failCount})`
                );
            }
        }
    };

    // Execute with p-limit
    console.log(
        `Processing ${totalItems} items with concurrency ${CONCURRENCY_LIMIT}...`
    );

    await Promise.all(
        navData.nav.map((item) => limit(() => processItem(item)))
    );

    // 월별 파일 저장
    console.log(`\n📅 Generated ${monthlyData.size} monthly blocks\n`);

    let totalFiles = 0;
    let totalEvents = 0;

    for (const [yearMonth, monthData] of monthlyData.entries()) {
        const [year, month] = yearMonth.split('-');
        const yearDir = path.join(CALENDAR_MONTHLY_DIR, year);

        await fs.mkdir(yearDir, { recursive: true });

        const sortedMonthData = {
            UsStock: {},
            UsEtf: {},
            KrStock: {},
            KrEtf: {},
        };

        for (const [category, dates] of Object.entries(monthData)) {
            if (Object.keys(dates).length > 0) {
                sortedMonthData[category] = Object.keys(dates)
                    .sort()
                    .reduce((acc, dateStr) => {
                        acc[dateStr] = dates[dateStr];
                        return acc;
                    }, {});
            }
        }

        const filePath = path.join(yearDir, `${month}.json`);
        await fs.writeFile(filePath, JSON.stringify(sortedMonthData, null, 2));

        let monthEventCount = 0;
        let totalDates = new Set();

        Object.values(monthData).forEach((dates) => {
            Object.entries(dates).forEach(([dateStr, events]) => {
                totalDates.add(dateStr);
                monthEventCount += events.length;
            });
        });

        totalFiles++;
        totalEvents += monthEventCount;

        console.log(
            `  ✓ ${yearMonth}: ${totalDates.size} dates, ${monthEventCount} events → ${year}/${month}.json`
        );
    }

    // 메타데이터 생성 및 저장
    const sortedMonths = Array.from(monthlyData.keys()).sort();
    let minDate = null;
    let maxDate = null;

    if (sortedMonths.length > 0) {
        // 첫 달의 첫 날짜
        const firstMonthData = monthlyData.get(sortedMonths[0]);
        // firstMonthData: { UsStock: { "2024-01-01": [...] }, ... }
        const firstDates = [];
        Object.values(firstMonthData).forEach((cat) => {
            if (cat) Object.keys(cat).forEach((d) => firstDates.push(d));
        });

        if (firstDates.length > 0) {
            minDate = firstDates.sort()[0];
        }

        // 마지막 달의 마지막 날짜
        const lastMonthData = monthlyData.get(
            sortedMonths[sortedMonths.length - 1]
        );
        const lastDates = [];
        Object.values(lastMonthData).forEach((cat) => {
            if (cat) Object.keys(cat).forEach((d) => lastDates.push(d));
        });

        if (lastDates.length > 0) {
            maxDate = lastDates.sort().reverse()[0];
        }
    }

    const metadata = {
        version: Date.now(), // 타임스탬프 버전
        totalMonths: sortedMonths.length,
        totalDates: totalEvents,
        dateRange: {
            start: minDate,
            end: maxDate,
        },
        months: sortedMonths,
    };

    await fs.writeFile(
        path.join(CALENDAR_MONTHLY_DIR, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
    );

    if (failedSymbols.length > 0) {
        console.log('\n⚠️  Failed Symbols List:');
        failedSymbols.forEach((s) => console.log(`   - ${s}`));
    }

    console.timeEnd('GenerationTime');
    console.log(
        `\n🎉 Successfully generated ${totalFiles} monthly calendar files with ${totalEvents} total events.`
    );
    console.log(`Updated metadata.json with version: ${metadata.version}`);
}

generateCalendarEvents();
