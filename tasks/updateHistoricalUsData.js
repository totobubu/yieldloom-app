// tasks\updateHistoricalUsData.js
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { mergeSplits } from '../lib/corporateActions.js';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const NAV_FILE_PATH = path.join(PUBLIC_DIR, 'nav.json');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
const DATA_LAYOUT_MODE = (
    process.env.DATA_LAYOUT_MODE || 'market'
).toLowerCase();
const MARKET_FILTER = 'US'; // 미국 티커만 처리

const MARKET_SUBDIR_ALIASES = {
    KOSPI: 'kospi',
    KOSDAQ: 'kosdaq',
    KONEX: 'konex',
    KRX: 'krx',
    'KRX (KOSPI)': 'kospi',
    'KRX (KOSDAQ)': 'kosdaq',
    'KRX-KOSPI': 'kospi',
    'KRX-KOSDAQ': 'kosdaq',
    NYSE: 'nyse',
    NYSEARCA: 'nyse',
    NASDAQ: 'nasdaq',
    AMEX: 'amex',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 접미사(.KS, .KQ 등) 제거하고 base symbol만 사용
const getBaseSymbol = (symbol) => {
    if (!symbol) return symbol;
    const upper = symbol.toUpperCase();
    const suffixes = ['.KS', '.KQ', '.KN', '.KO'];
    for (const suffix of suffixes) {
        if (upper.endsWith(suffix)) {
            return symbol.slice(0, -suffix.length);
        }
    }
    return symbol;
};

const sanitizeTickerForFilename = (ticker) => {
    const base = getBaseSymbol(ticker);
    return base.replace(/[./\\]/g, '-').toLowerCase();
};

const getMarketSubdirectory = (market) => {
    const normalized = String(market || '')
        .trim()
        .toUpperCase();
    if (!normalized) return 'misc';
    return MARKET_SUBDIR_ALIASES[normalized] || normalized.toLowerCase();
};

const getDataFilePath = (symbol, market) => {
    const filename = `${sanitizeTickerForFilename(symbol)}.json`;
    if (DATA_LAYOUT_MODE === 'market' || DATA_LAYOUT_MODE === 'v2') {
        const subdir = getMarketSubdirectory(market);
        return path.join(DATA_DIR, subdir, filename);
    }
    return path.join(DATA_DIR, filename);
};

const removeFileIfExists = async (filePath) => {
    if (!filePath) return;
    try {
        await fs.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`⚠️  Failed to remove ${filePath}: ${error.message}`);
        }
    }
};

const fileExists = async (filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const fetchDataFromR2 = async (symbolCandidates, market) => {
    if (!R2_PUBLIC_URL) return null;

    for (const candidate of symbolCandidates) {
        const filename = `${sanitizeTickerForFilename(candidate)}.json`;
        const subdir = getMarketSubdirectory(market);
        // R2 경로 구조: data/market/ticker.json (v2/market layout)
        // 주의: R2의 layout이 mixed일 수 있음. 여기서는 표준 v2 layout 시도.
        // 하지만 기존 데이터가 v1(flat)일 수도 있음?
        // 일단 market subfolder 시도
        const urls = [
            `${R2_PUBLIC_URL}/data/${subdir}/${filename}`,
            `${R2_PUBLIC_URL}/data/${filename}`, // Fallback for flat layout
        ];

        for (const url of urls) {
            try {
                const { data } = await axios.get(url, { timeout: 10000 });
                if (data && (data.backtestData || data.tickerInfo)) {
                    // console.log(`ℹ️ Loaded from R2: ${candidate}`);
                    return { data, symbol: candidate };
                }
            } catch (e) {
                // Ignore 404 or network error
            }
        }
    }
    return null;
};

const findExistingDataFile = async (symbolCandidates, market) => {
    // 먼저 새 형식 (접미사 제거) 시도
    for (const candidate of symbolCandidates) {
        const candidatePath = getDataFilePath(candidate, market);
        if (await fileExists(candidatePath)) {
            return { path: candidatePath, symbol: candidate };
        }
    }

    // 기존 형식 (접미사 포함) fallback 시도
    for (const candidate of symbolCandidates) {
        const oldFormatFilename = `${candidate.replace(/[./\\]/g, '-').toLowerCase()}.json`;
        const marketSlug = getMarketSubdirectory(market);
        const oldFormatPath = path.join(
            DATA_DIR,
            marketSlug,
            oldFormatFilename
        );
        if (await fileExists(oldFormatPath)) {
            return { path: oldFormatPath, symbol: candidate };
        }
    }

    return null;
};

const normalizeNumericValue = (value) => {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'number') {
        const parsed = Number(value);
        if (Number.isNaN(parsed)) return value;
        value = parsed;
    }
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value)) return value;
    return Number(value.toFixed(6));
};

const buildSymbolCandidates = (symbol) => {
    // US 티커는 symbol만 사용
    if (!symbol) return [];
    return [symbol];
};

const shouldRetryWithFallback = (error) =>
    Number(error?.response?.status) === 404;

async function fetchWithFallback(symbolCandidates, fetcher, label) {
    let lastError;
    for (let i = 0; i < symbolCandidates.length; i += 1) {
        const candidate = symbolCandidates[i];
        try {
            const data = await fetcher(candidate);
            if (i > 0) {
                console.log(
                    `ℹ️ [${symbolCandidates[0]}] ${label} 요청에 대체 티커 ${candidate} 사용`
                );
            }
            return { data, symbol: candidate };
        } catch (error) {
            lastError = error;
            const hasFallback = i < symbolCandidates.length - 1;
            if (hasFallback && shouldRetryWithFallback(error)) {
                console.warn(
                    `⚠️ [${symbolCandidates[0]}] ${label} 요청이 ${candidate}에서 404 응답. 다음 후보를 시도합니다.`
                );
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

// [핵심] axios를 사용하여 Yahoo Finance API를 직접 호출하는 함수
async function fetchHistoricalData(symbol, fromDate) {
    const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

    const { data } = await axios.get(url, {
        headers: YF_HEADERS,
    });

    if (data.chart.error)
        throw new Error(
            data.chart.error.description || `Unknown error for ${symbol}`
        );

    const result = data.chart.result[0];
    if (!result || !result.timestamp) return [];

    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];

    return timestamps
        .map((ts, i) => ({
            date: new Date(ts * 1000).toISOString().split('T')[0],
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            volume: quotes.volume[i],
        }))
        .filter((p) => p.close != null);
}

async function fetchSplitEvents(symbol, fromDate) {
    const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d&events=div,splits`;

    const { data } = await axios.get(url, {
        headers: YF_HEADERS,
    });

    if (data.chart.error)
        throw new Error(
            data.chart.error.description || `Unknown error for ${symbol}`
        );

    const result = data.chart.result?.[0];
    if (!result || !result.events || !result.events.splits) return [];

    return Object.values(result.events.splits)
        .map((event) => {
            const numerator = Number(event.numerator);
            const denominator = Number(event.denominator);
            if (!numerator || !denominator || numerator === denominator) {
                return null;
            }
            const ratio = `${numerator}:${denominator}`;
            const type = numerator < denominator ? 'reverse-split' : 'split';
            return {
                date: new Date(event.date * 1000).toISOString().split('T')[0],
                ratio,
                type,
            };
        })
        .filter(Boolean);
}

async function mergeSplitEvents(existingData, newSplits) {
    const existingSplits = existingData?.tickerInfo?.events?.splits || [];
    const splitMap = new Map(
        existingSplits.map((event) => [
            `${event.date}|${event.ratio}|${event.type}`,
            event,
        ])
    );

    newSplits.forEach((event) => {
        const signature = `${event.date}|${event.ratio}|${event.type}`;
        if (!splitMap.has(signature)) {
            splitMap.set(signature, event);
        }
    });

    const finalSplits = Array.from(splitMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
    );

    existingData.tickerInfo = {
        ...existingData.tickerInfo,
        events: {
            ...existingData.tickerInfo?.events,
            splits: finalSplits,
        },
    };
}

async function fetchAndMergePriceData(ticker) {
    const { symbol, ipoDate, market } = ticker;
    const symbolCandidates = buildSymbolCandidates(symbol);
    const existingFile = await findExistingDataFile(symbolCandidates, market);

    if (
        existingFile?.symbol &&
        existingFile.symbol !== symbol &&
        DATA_LAYOUT_MODE !== 'flat'
    ) {
        const idx = symbolCandidates.indexOf(existingFile.symbol);
        if (idx > 0) {
            symbolCandidates.splice(idx, 1);
            symbolCandidates.unshift(existingFile.symbol);
        }
    }

    let filePath = existingFile?.path || getDataFilePath(symbol, market);
    let storageSymbol = existingFile?.symbol || symbol;

    try {
        let existingData = {};
        let backtestMap = new Map();
        let lastPriceDate = null;
        let isNewFile = false;

        let loaded = false;
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            existingData = JSON.parse(fileContent);
            loaded = true;
        } catch (error) {
            /* 파일 없으면 R2 시도 */
            if (R2_PUBLIC_URL) {
                const r2Res = await fetchDataFromR2(symbolCandidates, market);
                if (r2Res) {
                    existingData = r2Res.data;
                    loaded = true;
                    console.log(`ℹ️ [${symbol}] Fetched from R2`);
                }
            }
        }

        if (loaded) {
            const backtestData = existingData.backtestData || [];

            backtestData.forEach((item) => backtestMap.set(item.date, item));
            const datesWithPrice = backtestData
                .filter((d) => d.close)
                .map((d) => d.date);
            if (datesWithPrice.length > 0) {
                datesWithPrice.sort();
                lastPriceDate = datesWithPrice[datesWithPrice.length - 1];
            }
        } else {
            /* 파일도 없고 R2에도 없으면 기본 구조로 초기화 */
            isNewFile = true;
            existingData = {
                tickerInfo: {},
                backtestData: [],
            };
        }

        const startDate = new Date(lastPriceDate || ipoDate || '1990-01-01');
        if (lastPriceDate) startDate.setDate(startDate.getDate() + 1);

        const from = startDate.toISOString().split('T')[0];

        const oldBacktestStr = JSON.stringify(existingData.backtestData || []);
        const existingSplits = existingData?.tickerInfo?.events?.splits || [];
        const oldSplitsStr = JSON.stringify(existingSplits);

        let activeSymbol = symbol;

        // 가격 데이터 병합
        let priceResult;
        try {
            priceResult = await fetchWithFallback(
                symbolCandidates,
                (candidate) => fetchHistoricalData(candidate, from),
                '가격'
            );
        } catch (priceError) {
            console.error(`API Error for ${symbol}: ${priceError.message}`);
            return { success: false, symbol, error: priceError.message };
        }
        activeSymbol = priceResult.symbol;
        const newPriceData = priceResult.data.map((p) => ({
            ...p,
            open: normalizeNumericValue(p.open),
            high: normalizeNumericValue(p.high),
            low: normalizeNumericValue(p.low),
            close: normalizeNumericValue(p.close),
            volume: normalizeNumericValue(p.volume),
        }));
        let finalBacktestData = existingData.backtestData || [];

        if (newPriceData.length > 0) {
            newPriceData.forEach((p) => {
                const existingEntry = backtestMap.get(p.date) || {
                    date: p.date,
                };
                backtestMap.set(p.date, { ...existingEntry, ...p });
            });

            finalBacktestData = Array.from(backtestMap.values()).sort((a, b) =>
                a.date.localeCompare(b.date)
            );
        }

        const backtestChanged =
            JSON.stringify(finalBacktestData) !== oldBacktestStr;

        // 분할/병합 데이터 병합
        const splitStartDate = existingSplits.length
            ? existingSplits.reduce(
                  (latest, event) =>
                      event.date > latest ? event.date : latest,
                  existingSplits[0].date
              )
            : ipoDate || '1990-01-01';

        const splitCandidates = [
            activeSymbol,
            ...symbolCandidates.filter(
                (candidate) => candidate !== activeSymbol
            ),
        ];
        let splitEvents = [];
        try {
            const splitResult = await fetchWithFallback(
                splitCandidates,
                (candidate) => fetchSplitEvents(candidate, splitStartDate),
                '분할'
            );
            splitEvents = splitResult.data;
        } catch (splitError) {
            console.error(
                `Split API Error for ${symbol}: ${splitError.message}`
            );
        }

        const splitMap = new Map(
            existingSplits.map((event) => [
                `${event.date}|${event.ratio}|${event.type}`,
                event,
            ])
        );

        splitEvents.forEach((event) => {
            const signature = `${event.date}|${event.ratio}|${event.type}`;
            if (!splitMap.has(signature)) {
                splitMap.set(signature, event);
            }
        });

        const finalSplits = mergeSplits(existingSplits, splitEvents);

        const splitsChanged = JSON.stringify(finalSplits) !== oldSplitsStr;

        const resolvedStorageSymbol =
            DATA_LAYOUT_MODE === 'flat'
                ? symbol
                : activeSymbol || storageSymbol;
        const targetFilePath = getDataFilePath(resolvedStorageSymbol, market);
        const storagePathChanged = targetFilePath !== filePath;
        const previousFilePath = filePath;
        filePath = targetFilePath;

        if (!backtestChanged && !splitsChanged) {
            if (storagePathChanged) {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(
                    filePath,
                    JSON.stringify(existingData, null, 2)
                );
                await removeFileIfExists(previousFilePath);
                console.log(
                    `↺ [${symbol}] Relocated data file to ${
                        DATA_LAYOUT_MODE === 'flat' ? 'flat' : 'market'
                    } layout path`
                );
            }
            return { success: true, symbol };
        }

        const tickerInfo = { ...existingData.tickerInfo };
        tickerInfo.events = {
            ...tickerInfo.events,
            splits: finalSplits,
        };

        existingData.tickerInfo = tickerInfo;
        existingData.backtestData = finalBacktestData;

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(existingData, null, 2));
        if (storagePathChanged) {
            await removeFileIfExists(previousFilePath);
        }
        console.log(
            `✅ [${symbol}] Updated. Prices: ${backtestChanged ? 'Y' : 'N'}, Splits: ${splitsChanged ? 'Y' : 'N'}${
                isNewFile ? ' (NEW FILE)' : ''
            }`
        );

        return { success: true, symbol };
    } catch (error) {
        console.error(`❌ [${symbol}] Error: ${error.message}`);
        return { success: false, symbol, error: error.message };
    }
}

async function main() {
    console.log(
        '--- Starting Incremental Price Data Update (US Market Only) ---'
    );
    await fs.mkdir(DATA_DIR, { recursive: true });

    const navDataContent = await fs.readFile(NAV_FILE_PATH, 'utf-8');
    const navData = JSON.parse(navDataContent);

    // 커맨드라인 인자로 특정 티커 지정 가능
    const targetSymbols = process.argv.slice(2).map((s) => s.toUpperCase());

    // nav.json에 없는 경우를 대비해 기본 티커 추가 (market 정보 포함)
    const navSymbols = new Set(navData.nav.map((t) => t.symbol.toUpperCase()));
    const fallbackTickers = [];
    if (!navSymbols.has('SPY')) {
        fallbackTickers.push({
            symbol: 'SPY',
            ipoDate: '1993-01-22',
            market: 'NYSE',
            currency: 'USD',
        });
    }
    if (!navSymbols.has('QQQ')) {
        fallbackTickers.push({
            symbol: 'QQQ',
            ipoDate: '1999-03-10',
            market: 'NASDAQ',
            currency: 'USD',
        });
    }
    if (!navSymbols.has('DIA')) {
        fallbackTickers.push({
            symbol: 'DIA',
            ipoDate: '1998-01-14',
            market: 'NYSE',
            currency: 'USD',
        });
    }

    let tickersToFetch = [...navData.nav, ...fallbackTickers].filter(
        (item) => !item.upcoming
    );

    // 미국 티커만 필터링
    tickersToFetch = tickersToFetch.filter(
        (t) =>
            t.currency === 'USD' ||
            ['NYSE', 'NASDAQ', 'AMEX'].includes(t.market)
    );
    console.log(`[US Market Filter] Filtering US tickers only`);

    // 특정 티커만 필터링
    if (targetSymbols.length > 0) {
        tickersToFetch = tickersToFetch.filter((t) =>
            targetSymbols.includes(t.symbol.toUpperCase())
        );
        console.log(
            `[Specific Mode] Updating ${targetSymbols.length} symbol(s): ${targetSymbols.join(', ')}`
        );

        // 지정한 티커가 nav.json에 없는 경우 경고
        const foundSymbols = tickersToFetch.map((t) => t.symbol.toUpperCase());
        const notFoundSymbols = targetSymbols.filter(
            (s) => !foundSymbols.includes(s)
        );
        if (notFoundSymbols.length > 0) {
            console.warn(
                `⚠️  Warning: Symbol(s) not found in nav.json: ${notFoundSymbols.join(', ')}`
            );
        }
    } else {
        console.log(`[Full Mode] Updating all US symbols`);
    }

    const uniqueTickers = Array.from(
        new Map(tickersToFetch.map((t) => [t.symbol, t])).values()
    );

    console.log(`Found ${uniqueTickers.length} symbols to update.`);
    const concurrency = 5;
    const chunkDelayMs = 1000;
    let successCount = 0;
    const failedSymbols = [];

    for (let i = 0; i < uniqueTickers.length; i += concurrency) {
        const chunk = uniqueTickers.slice(i, i + concurrency);

        const results = await Promise.all(
            chunk.map((ticker) => fetchAndMergePriceData(ticker))
        );

        results.forEach((r) => {
            if (r.success) successCount++;
            else if (r.symbol) failedSymbols.push(r.symbol);
        });
        await delay(chunkDelayMs);
    }

    console.log(
        `\nUpdate complete. Success: ${successCount}, Failure: ${failedSymbols.length}`
    );
    if (failedSymbols.length > 0) {
        console.log('Failed symbols:', failedSymbols.join(', '));
    }
}

main();
