import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import axios from 'axios';
import pLimit from 'p-limit';

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const fetchDataFromR2 = async (candidates) => {
    if (!R2_PUBLIC_URL) return null;

    for (const candidate of candidates) {
        const url = `${R2_PUBLIC_URL}/${candidate.relPath}`;
        try {
            const { data } = await axios.get(url, { timeout: 1500 });
            if (data && (data.backtestData || data.tickerInfo)) {
                return data;
            }
        } catch (e) {
            // ignore
        }
    }
    return null;
};

const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const navDir = path.join(publicDir, 'nav');
const dataDir = path.join(publicDir, 'data');
const logosDir = path.join(publicDir, 'logos');
const logosCompanyDir = path.join(logosDir, 'company');
const logosKoreaDir = path.join(logosDir, 'korea');
const logosBrandDir = path.join(logosDir, 'brand');
const outputFile = path.join(publicDir, 'nav.json');
const missingLogosFile = path.join(publicDir, 'missing-logos.json');

const brandRulesFilePath = path.join(navDir, 'logos-rules.json');
const logosBrandFilePath = path.join(navDir, 'logos-brand.json');

let brandRulesConfig;
try {
    const brandRulesRaw = readFileSync(brandRulesFilePath, 'utf8');
    brandRulesConfig = JSON.parse(brandRulesRaw);
} catch (error) {
    console.error(
        `❌ 브랜드 매칭 규칙 파일(${brandRulesFilePath})을 읽는 중 오류가 발생했습니다: ${error.message}`
    );
    process.exit(1);
}

const {
    koreanEtfBrandByCompany: koreanEtfBrandByCompanyConfig = [],
    globalBrandLogoMap: globalBrandLogoMapConfig = [],
    globalCompanyAliasMap: globalCompanyAliasMapConfig = [],
    koreanEtfCompanyPatterns: koreanEtfCompanyPatternsConfig = [],
} = brandRulesConfig;

let logosBrandConfig;
try {
    const logosBrandRaw = readFileSync(logosBrandFilePath, 'utf8');
    logosBrandConfig = JSON.parse(logosBrandRaw);
} catch (error) {
    console.error(
        `❌ 브랜드 매칭 정보 파일(${logosBrandFilePath})을 읽는 중 오류가 발생했습니다: ${error.message}`
    );
    process.exit(1);
}

let logosBrandEntriesRaw = Array.isArray(logosBrandConfig.brands)
    ? logosBrandConfig.brands
    : [];

const brandPassSymbolsMap = new Map();
logosBrandEntriesRaw.forEach((entry) => {
    if (!entry || !entry.brand) return;
    const passSymbols = Array.isArray(entry.passSymbols)
        ? entry.passSymbols
        : [];
    brandPassSymbolsMap.set(
        entry.brand,
        new Set(
            passSymbols
                .filter((symbol) => typeof symbol === 'string')
                .map((symbol) => symbol.trim().toUpperCase())
                .filter(Boolean)
        )
    );
});

function normalizeKoreanIdentifier(value) {
    if (!value) return '';
    return value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\(주\)/g, '')
        .replace(/㈜/g, '')
        .replace(/주식회사/g, '')
        .replace(/[\s·'"()]/g, '')
        .replace(/[-_/]/g, '');
}

const normalizedKoreanEtfBrandByCompany = new Map(
    koreanEtfBrandByCompanyConfig
        .map(({ company, brandSlug }) => {
            if (!company || !brandSlug) return null;
            return [normalizeKoreanIdentifier(company), brandSlug];
        })
        .filter(Boolean)
);

const logosCorporateBrandPatterns = logosBrandEntriesRaw
    .map((item) => {
        if (!item || !item.pattern || !item.brand) return null;
        const flags = item.flags || '';
        try {
            return {
                regex: new RegExp(item.pattern, flags),
                brandSlug: item.brand,
                passSymbols: brandPassSymbolsMap.get(item.brand) || new Set(),
            };
        } catch (error) {
            console.warn(
                `⚠️ 잘못된 정규식 패턴(${item.pattern})을 건너뜁니다: ${error.message}`
            );
            return null;
        }
    })
    .filter(Boolean);

const globalBrandLogoMap = new Map(
    globalBrandLogoMapConfig
        .map((item) => {
            if (!item || !item.name || !item.logoKey) return null;
            return [item.name.toLowerCase(), item.logoKey];
        })
        .filter(Boolean)
);

const globalCompanyAliasMap = new Map(
    globalCompanyAliasMapConfig
        .map((item) => {
            if (!item || !item.alias || !item.company) return null;
            return [item.alias.toLowerCase(), item.company];
        })
        .filter(Boolean)
);

function resolveCompanyAlias(companyName) {
    if (!companyName) return null;
    return globalCompanyAliasMap.get(companyName.toLowerCase()) || null;
}

const koreanEtfCompanyPatterns = koreanEtfCompanyPatternsConfig
    .map((item) => {
        if (!item || !item.pattern || !item.company) return null;
        const flags = item.flags || '';
        try {
            return {
                regex: new RegExp(item.pattern, flags),
                company: item.company,
            };
        } catch (error) {
            console.warn(
                `⚠️ 잘못된 정규식 패턴(${item.pattern})을 건너뜁니다: ${error.message}`
            );
            return null;
        }
    })
    .filter(Boolean);

function resolveKoreanEtfBrandSlug(name) {
    if (!name) return null;
    const normalized = normalizeKoreanIdentifier(name);
    if (!normalized) return null;
    return normalizedKoreanEtfBrandByCompany.get(normalized) || null;
}

function resolveKoreanCorporateBrandSlug(name, symbol) {
    if (!name) return null;
    const normalized = normalizeKoreanIdentifier(name);
    if (!normalized) return null;

    if (normalizedKoreanEtfBrandByCompany.has(normalized)) {
        return null;
    }

    const trimmedSymbol =
        typeof symbol === 'string' ? symbol.trim().toUpperCase() : null;

    for (const {
        regex,
        brandSlug,
        passSymbols,
    } of logosCorporateBrandPatterns) {
        if (regex.test(normalized)) {
            if (
                trimmedSymbol &&
                passSymbols instanceof Set &&
                passSymbols.has(trimmedSymbol)
            ) {
                continue;
            }
            return brandSlug;
        }
    }

    return null;
}

function resolveGlobalBrandLogoKey(companyName) {
    if (!companyName) return null;
    return globalBrandLogoMap.get(companyName.trim().toLowerCase()) || null;
}

function inferKoreanEtfCompany(ticker) {
    const target = [ticker.company, ticker.koName, ticker.longName]
        .filter(Boolean)
        .join(' ');
    if (!target) return null;

    for (const { regex, company } of koreanEtfCompanyPatterns) {
        if (regex.test(target)) {
            return company;
        }
    }
    return null;
}
// --- // ---

function resolveKoreanEtfBrandSlugFromTicker(ticker) {
    if (!ticker) return null;
    const candidates = [ticker.company, ticker.koName, ticker.longName];

    for (const candidate of candidates) {
        const slug = resolveKoreanEtfBrandSlug(candidate);
        if (slug) {
            return slug;
        }
    }

    const combined = candidates.filter(Boolean).join(' ');
    if (!combined) {
        return null;
    }

    for (const { regex, company } of koreanEtfCompanyPatterns) {
        if (regex.test(combined)) {
            return resolveKoreanEtfBrandSlug(company);
        }
    }

    return null;
}

function resolveKoreanCorporateBrandSlugFromTicker(ticker) {
    if (!ticker) return null;
    const candidates = [ticker.company, ticker.koName, ticker.longName];

    for (const candidate of candidates) {
        const slug = resolveKoreanCorporateBrandSlug(candidate, ticker.symbol);
        if (slug) {
            return slug;
        }
    }

    return null;
}
// --- // ---

function normalizeToFilename(name) {
    if (!name) return null;
    // 접미사(.KS, .KQ 등) 제거하고 base symbol만 사용
    let base = name;
    for (const suffix of KRX_SUFFIXES) {
        if (base.toUpperCase().endsWith(suffix)) {
            base = base.slice(0, -suffix.length);
            break;
        }
    }
    return base.toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, '-');
}

const KRX_SUFFIXES = new Set(['.KS', '.KQ', '.KN', '.KO']);

function normalizeYahooSymbol(symbol) {
    if (!symbol || typeof symbol !== 'string') return null;
    return symbol.trim().toUpperCase();
}

function extractBaseSymbol(symbol) {
    if (!symbol) return null;
    const normalized = normalizeYahooSymbol(symbol);
    if (!normalized) return null;
    for (const suffix of KRX_SUFFIXES) {
        if (normalized.endsWith(suffix)) {
            return normalized.slice(0, -suffix.length);
        }
    }
    return normalized;
}

function ensureTickerSymbols(rawTicker) {
    const ticker = { ...rawTicker };
    const providedYfSymbol =
        typeof ticker.yfSymbol === 'string' && ticker.yfSymbol.trim()
            ? ticker.yfSymbol
            : ticker.symbol;

    const yfSymbol = normalizeYahooSymbol(providedYfSymbol);
    const baseSymbol = extractBaseSymbol(
        ticker.symbol ? normalizeYahooSymbol(ticker.symbol) : yfSymbol
    );

    if (yfSymbol) {
        ticker.yfSymbol = yfSymbol;
    }
    if (baseSymbol) {
        ticker.symbol = baseSymbol;
    }

    return ticker;
}

function getMarketSlug(market) {
    if (!market) return null;
    return market.toString().trim().toLowerCase() || null;
}

function getDataFileCandidates(yfSymbol, market) {
    const slug = normalizeToFilename(yfSymbol);
    if (!slug) return [];

    const candidates = [];
    const marketSlug = getMarketSlug(market);
    if (marketSlug) {
        candidates.push({
            absPath: path.join(dataDir, marketSlug, `${slug}.json`),
            relPath: path.posix.join('data', marketSlug, `${slug}.json`),
        });
    }

    candidates.push({
        absPath: path.join(dataDir, `${slug}.json`),
        relPath: path.posix.join('data', `${slug}.json`),
    });

    return candidates;
}

const MONTH_INITIALS = {
    1: 'J',
    2: 'F',
    3: 'M',
    4: 'A',
    5: 'M',
    6: 'J',
    7: 'J',
    8: 'A',
    9: 'S',
    10: 'O',
    11: 'N',
    12: 'D',
};

const WEEKDAY_LABELS = {
    0: '월',
    1: '화',
    2: '수',
    3: '목',
    4: '금',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseUtcDate(dateString) {
    if (!dateString) return null;
    const parsed = new Date(`${dateString}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
}

function extractDividendDates(backtestData) {
    if (!Array.isArray(backtestData)) return [];
    return backtestData
        .filter((entry) => {
            if (!entry || !entry.date) return false;
            const amountExists =
                typeof entry.amount !== 'undefined' && entry.amount !== null;
            const amountFixedExists =
                typeof entry.amountFixed !== 'undefined' &&
                entry.amountFixed !== null;
            return amountExists || amountFixedExists;
        })
        .map((entry) => parseUtcDate(entry.date))
        .filter(Boolean)
        .sort((a, b) => a - b);
}

function bucketInterval(days) {
    if (days >= 4 && days <= 10) return 7; // weekly
    if (days >= 25 && days <= 35) return 30; // monthly
    if (days >= 81 && days <= 101) return 91; // quarterly
    if (days >= 335 && days <= 395) return 365; // yearly
    return null;
}

function findMode(values) {
    const counts = new Map();
    let mode = null;
    let maxCount = 0;
    values.forEach((value) => {
        const nextCount = (counts.get(value) || 0) + 1;
        counts.set(value, nextCount);
        if (
            nextCount > maxCount ||
            (nextCount === maxCount && (mode === null || value < mode))
        ) {
            mode = value;
            maxCount = nextCount;
        }
    });
    return mode;
}

function analyzeFrequencyAndGroup(dividendDates) {
    if (!Array.isArray(dividendDates) || dividendDates.length < 2) {
        return { frequency: null, group: null };
    }

    const recentDates = dividendDates.slice(-5);
    if (recentDates.length < 2) {
        return { frequency: null, group: null };
    }

    const intervals = [];
    for (let i = 1; i < recentDates.length; i += 1) {
        const diffDays = Math.round(
            (recentDates[i] - recentDates[i - 1]) / MS_PER_DAY
        );
        if (!Number.isNaN(diffDays)) {
            intervals.push(diffDays);
        }
    }

    if (!intervals.length) {
        return { frequency: null, group: null };
    }

    const groupedIntervals = intervals
        .map(bucketInterval)
        .filter((value) => value !== null);

    if (!groupedIntervals.length) {
        return { frequency: null, group: null };
    }

    const modeInterval = findMode(groupedIntervals);
    const frequencyMap = {
        7: '매주',
        30: '매월',
        91: '분기',
        365: '매년',
    };
    const frequency = frequencyMap[modeInterval] || null;

    let group = null;
    if (frequency === '분기' && recentDates.length >= 4) {
        const recentMonths = recentDates
            .slice(-4)
            .map((date) => date.getUTCMonth() + 1);
        const uniqueMonths = Array.from(new Set(recentMonths)).sort(
            (a, b) => a - b
        );
        if (uniqueMonths.length === 4) {
            group = uniqueMonths
                .map((month) => MONTH_INITIALS[month] || '?')
                .join('');
        }
    } else if (frequency === '매주') {
        const weekdayCounts = new Map();
        recentDates.forEach((date) => {
            const weekday = (date.getUTCDay() + 6) % 7; // Monday as 0
            if (weekday >= 0 && weekday <= 4) {
                const nextCount = (weekdayCounts.get(weekday) || 0) + 1;
                weekdayCounts.set(weekday, nextCount);
            }
        });
        if (weekdayCounts.size) {
            const sorted = Array.from(weekdayCounts.entries()).sort(
                (a, b) => b[1] - a[1] || a[0] - b[0]
            );
            const [topWeekday] = sorted[0];
            group = WEEKDAY_LABELS[topWeekday] || null;
        }
    }

    return { frequency, group };
}

function findLogoFile(normalizedName, options = {}) {
    if (!normalizedName) return null;

    let category = 'company';
    let market = null;
    let attemptType = null;

    if (typeof options === 'string') {
        category = options;
    } else if (options && typeof options === 'object') {
        category = options.category || 'company';
        market = options.market || null;
        attemptType = options.type || null;
    }

    const supportedExtensions = [
        '.svg',
        '.png',
        '.webp',
        '.jpg',
        '.jpeg',
        '.ico',
    ];

    const searchTargets = [];

    const addTarget = (dir, relativePrefix) => {
        if (!dir) return;
        try {
            if (!existsSync(dir)) return;
        } catch (error) {
            return;
        }
        if (searchTargets.some((target) => target.dir === dir)) return;
        searchTargets.push({ dir, relativePrefix });
    };

    if (market) {
        const normalizedMarket = market.toString().trim().toLowerCase();
        if (normalizedMarket) {
            const marketRootDir = path.join(logosDir, normalizedMarket);
            addTarget(marketRootDir, `logos/${normalizedMarket}/`);

            if (category === 'brand') {
                addTarget(
                    path.join(marketRootDir, 'brand'),
                    `logos/${normalizedMarket}/brand/`
                );
            } else if (category === 'company') {
                addTarget(
                    path.join(marketRootDir, 'company'),
                    `logos/${normalizedMarket}/company/`
                );
            }
        }
    }

    if (category === 'symbol') {
        if (market) {
            const normalizedMarket = market.toString().trim().toLowerCase();
            if (normalizedMarket) {
                addTarget(
                    path.join(logosDir, normalizedMarket),
                    `logos/${normalizedMarket}/`
                );
            }
        }
        addTarget(logosKoreaDir, 'logos/korea/');
    }

    if (category === 'brand') {
        addTarget(logosBrandDir, 'logos/brand/');
    }

    if (category === 'company') {
        addTarget(logosCompanyDir, 'logos/company/');
    }

    addTarget(logosDir, 'logos/');

    for (const { dir, relativePrefix } of searchTargets) {
        const candidateNames = new Set([normalizedName]);
        if (attemptType === 'symbol') {
            const numericWithSuffix = normalizedName.match(/^(\d+)(ks|kq)$/);
            if (numericWithSuffix) {
                candidateNames.add(numericWithSuffix[1]);
            }
            const upper = normalizedName.toUpperCase();
            const suffixMatch = upper.match(/^([A-Z0-9]+)[._-]?(KS|KQ)$/);
            if (suffixMatch) {
                candidateNames.add(suffixMatch[1].toLowerCase());
            }
        }

        if (
            normalizedName &&
            !normalizedName.startsWith('company-') &&
            (dir === logosCompanyDir || dir === logosDir)
        ) {
            candidateNames.add(`company-${normalizedName}`);
        }

        for (const name of candidateNames) {
            for (const ext of supportedExtensions) {
                const filePath = path.join(dir, `${name}${ext}`);
                if (existsSync(filePath)) {
                    return `${relativePrefix}${name}${ext}`;
                }
            }
        }
    }

    return null;
}

function convertPeriodToYears(periodString) {
    if (!periodString) return 0;
    const value = parseInt(periodString);
    const unit = periodString.slice(-1).toUpperCase();
    if (unit === 'Y') return value;
    if (unit === 'M') return value / 12;
    return 0;
}

async function processAndPushTickers(filePath, market, allTickers) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const tickersRaw = JSON.parse(data);
        if (!Array.isArray(tickersRaw)) {
            return;
        }
        let fileUpdated = false;
        const tickers = tickersRaw.map((ticker) => {
            const normalized = ensureTickerSymbols({
                ...ticker,
                market: ticker.market || market,
            });

            if (normalized.symbol !== ticker.symbol) {
                fileUpdated = true;
            }
            if (normalized.yfSymbol !== ticker.yfSymbol) {
                fileUpdated = true;
            }

            if (
                normalized.market === 'KOSPI' ||
                normalized.market === 'KOSDAQ'
            ) {
                normalized.currency = 'KRW';
            } else if (!normalized.currency) {
                normalized.currency = 'USD';
            }

            return normalized;
        });

        if (fileUpdated) {
            await fs.writeFile(filePath, JSON.stringify(tickers, null, 4));
        }

        allTickers.push(...tickers);
    } catch (error) {
        console.error(`[${filePath}] 파일 읽기 오류: ${error}`);
    }
}

async function generateNavJson() {
    let allTickers = [];
    const failedLogoMatches = [];
    const navEntries = await fs.readdir(navDir, { withFileTypes: true });

    for (const entry of navEntries) {
        if (entry.isDirectory()) {
            const marketPath = path.join(navDir, entry.name);
            const files = (await fs.readdir(marketPath)).filter((f) =>
                f.endsWith('.json')
            );
            for (const file of files) {
                await processAndPushTickers(
                    path.join(marketPath, file),
                    entry.name,
                    allTickers
                );
            }
        } else if (
            entry.isFile() &&
            entry.name.endsWith('.json') &&
            !entry.name.includes('rules')
        ) {
            await processAndPushTickers(
                path.join(navDir, entry.name),
                'NASDAQ',
                allTickers
            );
        }
    }

    const limit = pLimit(100);

    const finalTickersPromises = allTickers.map((ticker) => {
        return limit(async () => {
            let processedTicker = { ...ticker };

            const yfSymbol =
                processedTicker.yfSymbol || processedTicker.originalSymbol;
            const normalizedYfSymbol = normalizeYahooSymbol(yfSymbol);
            const baseSymbol = extractBaseSymbol(normalizedYfSymbol);
            if (normalizedYfSymbol) {
                processedTicker.yfSymbol = normalizedYfSymbol;
            }
            if (baseSymbol) {
                processedTicker.symbol = baseSymbol;
            }

            const alias = resolveCompanyAlias(processedTicker.company);
            if (alias) {
                processedTicker.company = alias;
            }

            const marketUpper = (processedTicker.market || '').toUpperCase();

            if (
                (!processedTicker.company ||
                    processedTicker.company === null) &&
                ['KOSPI', 'KOSDAQ'].includes(marketUpper)
            ) {
                const inferredCompany = inferKoreanEtfCompany(processedTicker);
                if (inferredCompany) {
                    processedTicker.company = inferredCompany;
                }
            }

            const logoAttempts = [];
            const pushAttempt = (name, category = 'company', extra = {}) => {
                if (!name) return;
                logoAttempts.push({ name, category, ...extra });
            };

            const pushBrandAttempt = (brandValue) => {
                if (!brandValue) return;
                const trimmed = brandValue.toString().trim();
                if (!trimmed) return;
                const lower = trimmed.toLowerCase();

                if (lower.startsWith('brand-')) {
                    pushAttempt(lower, 'brand');
                    return;
                }
                if (lower.startsWith('etf-')) {
                    pushAttempt(lower, 'korea');
                    return;
                }
                if (lower.startsWith('company-')) {
                    pushAttempt(lower, 'company');
                    return;
                }

                const normalized = normalizeToFilename(trimmed);
                if (normalized) {
                    pushAttempt(`brand-${normalized}`, 'brand');
                }
            };

            // 1) 브랜드 우선
            pushBrandAttempt(processedTicker.brand);

            if (['KOSPI', 'KOSDAQ'].includes(marketUpper)) {
                const etfBrandSlug =
                    resolveKoreanEtfBrandSlugFromTicker(processedTicker);
                if (etfBrandSlug) {
                    pushAttempt(`etf-${etfBrandSlug}`, 'company');
                }

                const corporateBrandSlug =
                    resolveKoreanCorporateBrandSlugFromTicker(processedTicker);
                if (corporateBrandSlug) {
                    pushAttempt(`brand-${corporateBrandSlug}`, 'brand');
                }
            }

            // 2) 운용사/회사 기반
            const globalBrandKey = resolveGlobalBrandLogoKey(
                processedTicker.company
            );
            if (globalBrandKey) {
                pushAttempt(globalBrandKey, 'company');
            }

            if (processedTicker.company) {
                pushAttempt(processedTicker.company, 'company');
            }

            // 3) 티커 심볼 기반
            if (processedTicker.symbol) {
                let symbolCategory = 'company';
                if (marketUpper === 'KOSPI' || marketUpper === 'KOSDAQ') {
                    symbolCategory = 'symbol';
                }
                pushAttempt(processedTicker.symbol, symbolCategory, {
                    type: 'symbol',
                });
            }

            const fallbackName =
                processedTicker.company || processedTicker.symbol;

            let resolvedLogoPath = null;
            const attemptedKeys = [];
            const attemptDedup = new Set();

            for (const attempt of logoAttempts) {
                const normalizedName = normalizeToFilename(attempt.name);
                if (!normalizedName) continue;

                const dedupKey = `${attempt.category}:${normalizedName}`;
                if (attemptDedup.has(dedupKey)) continue;
                attemptDedup.add(dedupKey);
                attemptedKeys.push(dedupKey);

                const logoPath = findLogoFile(normalizedName, {
                    category: attempt.category,
                    market: processedTicker.market,
                    type: attempt.type,
                });
                if (logoPath) {
                    resolvedLogoPath = logoPath;
                    break;
                }
            }

            if (resolvedLogoPath) {
                processedTicker.logo = resolvedLogoPath;
            } else {
                processedTicker.logo = null;
                if (attemptedKeys.length) {
                    console.log(
                        `🔸 ${process.env.VERBOSE ? ticker.symbol + ': ' : ''}로고 없음.`
                    );
                }

                const failureName =
                    fallbackName ||
                    logoAttempts[logoAttempts.length - 1]?.name ||
                    null;
                const normalizedFailureName = normalizeToFilename(failureName);

                failedLogoMatches.push({
                    symbol: ticker.symbol,
                    company: ticker.company || null,
                    market: ticker.market || null,
                    searchName: failureName,
                    normalizedSearchName: normalizedFailureName,
                });
            }

            const dataCandidates = getDataFileCandidates(
                processedTicker.yfSymbol,
                processedTicker.market
            );
            const candidateWithFile =
                dataCandidates.find((candidate) =>
                    existsSync(candidate.absPath)
                ) || dataCandidates[0];
            const dataFilePath = candidateWithFile?.absPath;
            const resolvedDataPath = candidateWithFile?.relPath || null;
            const availableDataPaths = dataCandidates
                .filter((candidate) => existsSync(candidate.absPath))
                .map((candidate) => candidate.relPath);

            if (availableDataPaths.length) {
                processedTicker.dataPaths = Array.from(
                    new Set(availableDataPaths.concat(resolvedDataPath || []))
                );
            }

            let stockData = null;
            try {
                if (dataFilePath && existsSync(dataFilePath)) {
                    const dataFileContent = await fs.readFile(
                        dataFilePath,
                        'utf8'
                    );
                    stockData = JSON.parse(dataFileContent);
                } else {
                    throw new Error('File not found locally');
                }
            } catch (error) {
                // Skip R2 fetch for performance. Fallback will handle it.
                stockData = null;
            }

            if (!stockData) {
                // Fallback: Calculate periods based on IPO date if local/R2 data is missing
                // This ensures symbols like JEPI, BRKC get periods assigned optimistically
                const startDateStr = ticker.ipoDate;
                if (startDateStr) {
                    const startDate = new Date(startDateStr);
                    const today = new Date();
                    const yearsOfHistory =
                        (today - startDate) / (1000 * 60 * 60 * 24 * 365.25);

                    let masterPeriods = [
                        '6M',
                        '1Y',
                        '3Y',
                        '5Y',
                        '10Y',
                        '15Y',
                        '20Y',
                    ];

                    if (processedTicker.frequency === '매주') {
                        masterPeriods = ['6M', '1Y'];
                    } else if (processedTicker.frequency === '매월') {
                        masterPeriods = ['1Y', '2Y', '3Y', '5Y', '10Y'];
                    } else if (processedTicker.frequency === '분기') {
                        masterPeriods = ['5Y', '10Y', '15Y', '20Y'];
                    } else if (processedTicker.frequency === '매년') {
                        masterPeriods = ['10Y', '15Y', '20Y'];
                    }

                    const calculatedPeriods = masterPeriods.filter(
                        (p) => yearsOfHistory >= convertPeriodToYears(p)
                    );

                    // Add 'dataPaths' optimistic guess if missing
                    if (
                        !processedTicker.dataPaths &&
                        processedTicker.market &&
                        processedTicker.yfSymbol
                    ) {
                        const guessPath = `data/${processedTicker.market.toLowerCase()}/${processedTicker.yfSymbol.toLowerCase()}.json`;
                        processedTicker.dataPaths = [guessPath];
                    }

                    processedTicker.periods = calculatedPeriods;
                } else {
                    processedTicker.periods = [];
                }
                return processedTicker;
            }

            try {
                // const stockData is already loaded above
                const backtestData = stockData.backtestData || [];
                const tickerInfoFromData =
                    (stockData && stockData.tickerInfo) || {};

                // 소스 파일에 frequency가 없을 때만 배당 데이터 분석 수행
                if (!processedTicker.frequency) {
                    const dividendDates = extractDividendDates(backtestData);
                    const { frequency: analyzedFrequency, group: analyzedGroup } =
                        analyzeFrequencyAndGroup(dividendDates);

                    if (analyzedFrequency) {
                        processedTicker.frequency = analyzedFrequency;
                    } else if (tickerInfoFromData.frequency) {
                        processedTicker.frequency = tickerInfoFromData.frequency;
                    }

                    if (analyzedGroup) {
                        processedTicker.group = analyzedGroup;
                    } else if (tickerInfoFromData.group) {
                        processedTicker.group = tickerInfoFromData.group;
                    }
                }

                const firstDividendEntry = backtestData.find(
                    (d) => d.amount !== null && typeof d.amount !== 'undefined'
                );
                const startDateStr = firstDividendEntry
                    ? firstDividendEntry.date
                    : ticker.ipoDate;

                if (startDateStr) {
                    const startDate = new Date(startDateStr);
                    const today = new Date();
                    const yearsOfHistory =
                        (today - startDate) / (1000 * 60 * 60 * 24 * 365.25);

                    let masterPeriods = [
                        '6M',
                        '1Y',
                        '3Y',
                        '5Y',
                        '10Y',
                        '15Y',
                        '20Y',
                    ];

                    // --- [핵심 수정] ---
                    if (processedTicker.frequency === '매주') {
                        masterPeriods = ['6M', '1Y']; // '매주' 배당은 '월' 단위 옵션만 사용
                    } else if (processedTicker.frequency === '매월') {
                        masterPeriods = ['1Y', '2Y', '3Y', '5Y', '10Y'];
                    } else if (processedTicker.frequency === '분기') {
                        masterPeriods = ['5Y', '10Y', '15Y', '20Y'];
                    } else if (processedTicker.frequency === '매년') {
                        masterPeriods = ['10Y', '15Y', '20Y'];
                    }
                    // --- // ---

                    const calculatedPeriods = masterPeriods.filter(
                        (p) => yearsOfHistory >= convertPeriodToYears(p)
                    );
                    processedTicker.periods = calculatedPeriods;
                } else {
                    processedTicker.periods = [];
                }
            } catch (error) {
                processedTicker.periods = [];
            }

            return processedTicker;
        });
    });

    let finalTickers = await Promise.all(finalTickersPromises);

    finalTickers.sort((a, b) => a.symbol.localeCompare(b.symbol));

    const navJson = JSON.stringify({ nav: finalTickers }, null, 2);
    await fs.writeFile(outputFile, navJson);

    console.log(
        `\n🎉 nav.json 파일 생성 완료! (총 ${finalTickers.length}개 티커, periods 재생성 완료)`
    );

    try {
        const failedSummary = {
            generatedAt: new Date().toISOString(),
            count: failedLogoMatches.length,
            items: failedLogoMatches,
        };
        await fs.writeFile(
            missingLogosFile,
            JSON.stringify(failedSummary, null, 2)
        );
        console.log(
            failedLogoMatches.length
                ? `⚠️ 매칭 실패 로고 ${failedLogoMatches.length}건이 ${missingLogosFile} 에 기록되었습니다.`
                : `✅ 모든 로고가 성공적으로 매칭되어 ${missingLogosFile} 에 빈 목록이 저장되었습니다.`
        );
    } catch (error) {
        console.error(
            `❌ 로고 매칭 실패 내역 저장 중 오류 발생: ${error.message}`
        );
    }
}

generateNavJson();
