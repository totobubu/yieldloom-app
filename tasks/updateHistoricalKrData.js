// tasks\updateHistoricalKrData.js
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
const MARKET_FILTER = 'KR'; // 한국 티커만 처리

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
    // null/undefined는 그대로 반환 (0으로 변환하지 않음)
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number') {
        const parsed = Number(value);
        if (Number.isNaN(parsed)) return null;
        value = parsed;
    }
    if (!Number.isFinite(value)) return null;
    // 0은 유효한 값이지만, 원본이 null/undefined였으면 null 유지
    if (Number.isInteger(value)) return value;
    return Number(value.toFixed(6));
};

const buildSymbolCandidates = (symbol, yfSymbol = null) => {
    const candidates = [];

    // yfSymbol이 있으면 가장 먼저 사용 (우선순위 1)
    if (yfSymbol && yfSymbol.trim()) {
        candidates.push(yfSymbol.trim());
    }

    // 원본 symbol 추가 (yfSymbol이 없거나 다른 경우)
    if (symbol) {
        candidates.push(symbol);
    }

    return candidates.filter(Boolean);
};

const shouldRetryWithFallback = (error) => {
    const status = Number(error?.response?.status);
    // 404, 429 (Too Many Requests), 503 (Service Unavailable) 등 재시도 가능한 에러
    return status === 404 || status === 429 || status === 503 || status === 500;
};

async function fetchWithFallback(
    symbolCandidates,
    fetcher,
    label,
    maxRetries = 3
) {
    let lastError;
    for (let i = 0; i < symbolCandidates.length; i += 1) {
        const candidate = symbolCandidates[i];

        // 각 후보에 대해 재시도 로직
        for (let retry = 0; retry < maxRetries; retry += 1) {
            try {
                // 재시도 시 딜레이 추가 (지수 백오프)
                if (retry > 0) {
                    const backoffMs = Math.min(
                        1000 * Math.pow(2, retry - 1),
                        5000
                    );
                    await delay(backoffMs);
                }

                const data = await fetcher(candidate);
                if (i > 0) {
                    console.log(
                        `ℹ️ [${symbolCandidates[0]}] ${label} 요청에 대체 티커 ${candidate} 사용`
                    );
                }
                if (retry > 0) {
                    console.log(
                        `✅ [${symbolCandidates[0]}] ${label} 요청 성공 (재시도 ${retry}회 후)`
                    );
                }
                return { data, symbol: candidate };
            } catch (error) {
                lastError = error;
                const status = Number(error?.response?.status);
                const hasFallback = i < symbolCandidates.length - 1;
                const isRetryable = shouldRetryWithFallback(error);

                // 재시도 가능하고 아직 재시도 횟수가 남았으면 재시도
                if (isRetryable && retry < maxRetries - 1) {
                    const backoffMs = Math.min(1000 * Math.pow(2, retry), 5000);
                    console.warn(
                        `⚠️ [${symbolCandidates[0]}] ${label} 요청이 ${candidate}에서 ${status} 응답. ${backoffMs}ms 후 재시도 (${retry + 1}/${maxRetries})...`
                    );
                    await delay(backoffMs);
                    continue;
                }

                // 재시도 불가능하거나 모든 재시도 실패 시 다음 후보로
                if (hasFallback && isRetryable) {
                    console.warn(
                        `⚠️ [${symbolCandidates[0]}] ${label} 요청이 ${candidate}에서 ${status} 응답. 다음 후보를 시도합니다.`
                    );
                    // 다음 후보로 넘어가기 전에 짧은 딜레이
                    await delay(200);
                    break; // 다음 후보로
                }

                // 재시도 불가능한 에러면 즉시 throw
                if (!isRetryable) {
                    throw error;
                }
            }
        }
    }
    throw lastError;
}

// [핵심] axios를 사용하여 Yahoo Finance API를 직접 호출하는 함수
async function fetchHistoricalData(symbol, fromDate, retryCount = 0) {
    const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

    try {
        const { data } = await axios.get(url, {
            headers: YF_HEADERS,
            timeout: 30000, // 30초 타임아웃
        });

        if (data.chart.error) {
            const errorCode = data.chart.error.code;
            // 일시적 에러인 경우 재시도
            if ((errorCode === 404 || errorCode === 429) && retryCount < 2) {
                await delay(1000 * (retryCount + 1));
                return fetchHistoricalData(symbol, fromDate, retryCount + 1);
            }
            throw new Error(
                data.chart.error.description || `Unknown error for ${symbol}`
            );
        }

        const result = data.chart.result[0];
        if (!result || !result.timestamp) return [];

        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];

        return timestamps
            .map((ts, i) => {
                const open = quotes.open[i];
                const high = quotes.high[i];
                const low = quotes.low[i];
                const close = quotes.close[i];
                const volume = quotes.volume[i];

                // null/undefined를 0으로 변환하지 않음 (데이터가 없는 경우 null로 유지)
                return {
                    date: new Date(ts * 1000).toISOString().split('T')[0],
                    open: open != null ? open : null,
                    high: high != null ? high : null,
                    low: low != null ? low : null,
                    close: close != null ? close : null,
                    volume: volume != null ? volume : null,
                };
            })
            .filter((p) => p.close != null); // close가 null이 아닌 것만 유지
    } catch (error) {
        // 네트워크 에러나 타임아웃인 경우 재시도
        if (
            (error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.response?.status === 429) &&
            retryCount < 2
        ) {
            await delay(1000 * (retryCount + 1));
            return fetchHistoricalData(symbol, fromDate, retryCount + 1);
        }
        throw error;
    }
}

async function fetchSplitEvents(symbol, fromDate, retryCount = 0) {
    const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d&events=div,splits`;

    try {
        const { data } = await axios.get(url, {
            headers: YF_HEADERS,
            timeout: 30000, // 30초 타임아웃
        });

        if (data.chart.error) {
            const errorCode = data.chart.error.code;
            // 일시적 에러인 경우 재시도
            if ((errorCode === 404 || errorCode === 429) && retryCount < 2) {
                await delay(1000 * (retryCount + 1));
                return fetchSplitEvents(symbol, fromDate, retryCount + 1);
            }
            throw new Error(
                data.chart.error.description || `Unknown error for ${symbol}`
            );
        }

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
                const type =
                    numerator < denominator ? 'reverse-split' : 'split';
                return {
                    date: new Date(event.date * 1000)
                        .toISOString()
                        .split('T')[0],
                    ratio,
                    type,
                };
            })
            .filter(Boolean);
    } catch (error) {
        // 네트워크 에러나 타임아웃인 경우 재시도
        if (
            (error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.response?.status === 429) &&
            retryCount < 2
        ) {
            await delay(1000 * (retryCount + 1));
            return fetchSplitEvents(symbol, fromDate, retryCount + 1);
        }
        throw error;
    }
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
    const { symbol, ipoDate, market, yfSymbol } = ticker;
    const symbolCandidates = buildSymbolCandidates(symbol, yfSymbol);
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
            /* 파일 없으면 기본 구조로 초기화 */
            isNewFile = true;
            existingData = {
                tickerInfo: {},
                backtestData: [],
            };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let startDate = new Date(lastPriceDate || ipoDate || '1990-01-01');
        if (lastPriceDate) {
            const lastDate = new Date(lastPriceDate);
            // 마지막 날짜가 미래인 경우 현재 날짜로 조정
            if (lastDate > today) {
                startDate = new Date(ipoDate || '1990-01-01');
            } else {
                startDate.setDate(startDate.getDate() + 1);
            }
        }

        // 시작 날짜가 현재 날짜보다 미래인 경우 현재 날짜로 조정
        if (startDate > today) {
            startDate = today;
        }

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
            const status = priceError?.response?.status;
            const statusText = priceError?.response?.statusText;
            const errorMessage = priceError?.message || 'Unknown error';

            // 디버그 정보 상세 출력
            console.error(`❌ [${symbol}] API Error: ${errorMessage}`);
            if (status) {
                console.error(`   Status: ${status} ${statusText || ''}`);
            }
            if (symbolCandidates.length > 1) {
                console.error(
                    `   Tried symbols: ${symbolCandidates.join(', ')}`
                );
            }
            if (priceError?.response?.data) {
                console.error(
                    `   Response data: ${JSON.stringify(priceError.response.data).substring(0, 200)}`
                );
            }

            return { success: false, symbol, error: errorMessage, status };
        }
        activeSymbol = priceResult.symbol;
        const newPriceData = priceResult.data.map((p) => {
            // null/undefined 값은 그대로 유지 (0으로 변환하지 않음)
            const open = p.open != null ? normalizeNumericValue(p.open) : null;
            const high = p.high != null ? normalizeNumericValue(p.high) : null;
            const low = p.low != null ? normalizeNumericValue(p.low) : null;
            const close =
                p.close != null ? normalizeNumericValue(p.close) : null;
            const volume =
                p.volume != null ? normalizeNumericValue(p.volume) : null;

            return {
                ...p,
                open,
                high,
                low,
                close,
                volume,
            };
        });
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
            const status = splitError?.response?.status;
            console.error(
                `⚠️  [${symbol}] Split API Error: ${splitError.message}${status ? ` (Status: ${status})` : ''}`
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
        console.error(`❌ [${symbol}] Unexpected Error: ${error.message}`);
        console.error(
            `   Stack: ${error.stack?.split('\n').slice(0, 3).join('\n')}`
        );
        return { success: false, symbol, error: error.message };
    }
}

async function main() {
    console.log(
        '--- Starting Incremental Price Data Update (KR Market Only) ---'
    );
    await fs.mkdir(DATA_DIR, { recursive: true });

    const navDataContent = await fs.readFile(NAV_FILE_PATH, 'utf-8');
    const navData = JSON.parse(navDataContent);

    // 커맨드라인 인자로 특정 티커 지정 가능
    const targetSymbols = process.argv.slice(2).map((s) => s.toUpperCase());

    let tickersToFetch = [...navData.nav].filter((item) => !item.upcoming);

    // 한국 티커만 필터링
    tickersToFetch = tickersToFetch.filter(
        (t) =>
            t.currency === 'KRW' ||
            ['KOSPI', 'KOSDAQ', 'KONEX'].includes(t.market)
    );
    console.log(`[KR Market Filter] Filtering Korean tickers only`);

    // 영문자 포함 티커 필터링 및 경고 (우선주 등 - Yahoo Finance에서 인식하지 못할 수 있음)
    const tickersWithLetters = tickersToFetch.filter((t) => {
        const baseSymbol = getBaseSymbol(t.symbol || t.yfSymbol || '');
        return /[A-Z]/.test(baseSymbol);
    });

    if (tickersWithLetters.length > 0) {
        console.warn(
            `⚠️  [WARNING] ${tickersWithLetters.length} tickers with letters found (may fail): ${tickersWithLetters
                .slice(0, 10)
                .map((t) => t.symbol)
                .join(', ')}${tickersWithLetters.length > 10 ? '...' : ''}`
        );
        console.warn(
            `⚠️  These tickers (preferred shares, etc.) may not be recognized by Yahoo Finance API`
        );
    }

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
        console.log(`[Full Mode] Updating all Korean symbols`);
    }

    const uniqueTickers = Array.from(
        new Map(tickersToFetch.map((t) => [t.symbol, t])).values()
    );

    console.log(`Found ${uniqueTickers.length} symbols to update.`);
    // API 과부하 방지를 위해 동시성과 딜레이 조정
    const concurrency = 3; // 5 -> 3으로 감소
    const chunkDelayMs = 2000; // 1000ms -> 2000ms로 증가
    const requestDelayMs = 100; // 각 요청 간 추가 딜레이
    let successCount = 0;
    const failedSymbols = [];

    for (let i = 0; i < uniqueTickers.length; i += concurrency) {
        const chunk = uniqueTickers.slice(i, i + concurrency);

        // 순차적으로 처리하여 API 과부하 방지
        const results = [];
        for (const ticker of chunk) {
            try {
                const result = await fetchAndMergePriceData(ticker);
                results.push(result);
                // 각 요청 후 짧은 딜레이
                await delay(requestDelayMs);
            } catch (error) {
                results.push({
                    success: false,
                    symbol: ticker.symbol,
                    error: error.message,
                });
            }
        }

        results.forEach((r) => {
            if (r.success) successCount++;
            else if (r.symbol) failedSymbols.push(r.symbol);
        });

        // 청크 간 딜레이
        if (i + concurrency < uniqueTickers.length) {
            await delay(chunkDelayMs);
        }
    }

    console.log(
        `\nUpdate complete. Success: ${successCount}, Failure: ${failedSymbols.length}`
    );
    if (failedSymbols.length > 0) {
        console.log('Failed symbols:', failedSymbols.join(', '));
    }
}

main();
