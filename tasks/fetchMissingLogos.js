// tasks/fetchMissingLogos.js
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { load } from 'cheerio';
import { imageSize } from 'image-size';

const { ReadableStream: PolyfillReadableStream } = await import('web-streams-polyfill');

if (typeof globalThis.ReadableStream === 'undefined') {
    globalThis.ReadableStream = PolyfillReadableStream;
}

const { default: axios } = await import('axios');

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const LOGOS_DIR = path.join(PUBLIC_DIR, 'logos');
const MISSING_LOGOS_PATH = path.join(PUBLIC_DIR, 'missing-logos.json');
const REPORT_PATH = path.join(PUBLIC_DIR, 'missing-logos-fetch-report.json');

const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 150;
const MAX_CONCURRENT_DOWNLOADS = 5;
const INVESTING_BASE_URL = 'https://www.investing.com';
const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};
const US_MARKETS = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSEARCA', 'NYSE ARCA']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureLogosDirectory() {
    if (!existsSync(LOGOS_DIR)) {
        await fs.mkdir(LOGOS_DIR, { recursive: true });
    }
}

async function loadMissingLogoItems() {
    const raw = await fs.readFile(MISSING_LOGOS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error('missing-logos.json 형식이 올바르지 않습니다. items 배열이 필요합니다.');
    }
    return parsed.items;
}

async function loadExistingLogoNames() {
    if (!existsSync(LOGOS_DIR)) {
        return new Set();
    }
    const filenames = await fs.readdir(LOGOS_DIR);
    const normalized = filenames.map((file) => path.parse(file).name.toLowerCase());
    return new Set(normalized);
}

function buildSymbolVariants(symbol) {
    if (!symbol) return [];
    const base = symbol.toUpperCase();
    const variants = new Set([base]);

    if (base.includes('.')) {
        variants.add(base.replace(/\./g, '-'));
        variants.add(base.replace(/\./g, ''));
    }

    if (base.includes('-')) {
        variants.add(base.replace(/-/g, ''));
    }

    return Array.from(variants).filter(Boolean);
}

function buildSourceCandidates(item) {
    const symbolVariants = buildSymbolVariants(item.symbol);
    const sources = [];
    const appendedUrls = new Set();

    const appendSource = (provider, url, ext) => {
        const key = `${provider}:${url}`;
        if (appendedUrls.has(key)) return;
        appendedUrls.add(key);
        sources.push({ provider, url, ext });
    };

    if (US_MARKETS.has((item.market || '').toUpperCase())) {
        for (const variant of symbolVariants) {
            appendSource(
                'IEX (PNG)',
                `https://storage.googleapis.com/iex/api/logos/${variant}.png`,
                'png'
            );
        }
    }

    for (const variant of symbolVariants) {
        appendSource(
            'FinancialModelingPrep (PNG)',
            `https://financialmodelingprep.com/image-stock/${variant}.png`,
            'png'
        );
    }

    return sources;
}

function resolveExtension(contentType, fallbackExt) {
    if (contentType) {
        const type = contentType.toLowerCase();
        if (type.includes('svg')) return 'svg';
        if (type.includes('png')) return 'png';
        if (type.includes('webp')) return 'webp';
        if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
        if (type.includes('ico')) return 'ico';
    }
    return fallbackExt;
}

function buildInvestingSearchUrl(query) {
    return `${INVESTING_BASE_URL}/search/?q=${encodeURIComponent(query)}`;
}

function normalizeInvestingUrl(href) {
    if (!href) return null;
    if (href.startsWith('http://') || href.startsWith('https://')) {
        return href;
    }
    try {
        return new URL(href, INVESTING_BASE_URL).toString();
    } catch (error) {
        return null;
    }
}

async function fetchInvestingLogo(item) {
    const symbol = (item.symbol || '').trim();
    if (!symbol) {
        return null;
    }

    const searchUrl = buildInvestingSearchUrl(symbol);
    const searchResponse = await axios.get(searchUrl, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
            ...DEFAULT_HEADERS,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        validateStatus: (status) => status >= 200 && status < 500,
    });

    if (searchResponse.status >= 400 || !searchResponse.data) {
        throw new Error(`검색 응답 오류 (HTTP ${searchResponse.status})`);
    }

    const $ = load(searchResponse.data);
    const firstAnchor = $('.searchSectionMain a').first();
    const href = normalizeInvestingUrl(firstAnchor.attr('href'));

    if (!href) {
        throw new Error('검색 결과 링크 없음');
    }

    const detailResponse = await axios.get(href, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
            ...DEFAULT_HEADERS,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        validateStatus: (status) => status >= 200 && status < 500,
    });

    if (detailResponse.status >= 400 || !detailResponse.data) {
        throw new Error(`상세 페이지 응답 오류 (HTTP ${detailResponse.status})`);
    }

    const $$ = load(detailResponse.data);
    const candidateContainers = $$('div.font-sans-v2').filter((_, el) => {
        const className = $$(el).attr('class') || '';
        return className.includes('md:flex');
    });

    let svgHtml = candidateContainers.first().find('svg').first().toString();

    if (!svgHtml) {
        svgHtml = $$('div.font-sans-v2 svg').first().toString();
    }

    if (!svgHtml) {
        svgHtml = $$('svg').first().toString();
    }

    if (!svgHtml) {
        throw new Error('SVG 요소를 찾을 수 없습니다.');
    }

    const buffer = Buffer.from(svgHtml, 'utf8');

    let width;
    let height;
    let isSquare = false;
    try {
        const dimension = imageSize(buffer);
        width = dimension?.width;
        height = dimension?.height;
        if (width && height) {
            const ratio = width / height;
            isSquare = Math.abs(ratio - 1) < 0.02;
        }
    } catch (error) {
        // SVG 크기 파악 실패는 치명적 오류가 아니므로 무시
    }

    return {
        buffer,
        ext: 'svg',
        provider: 'Investing.com (SVG)',
        width,
        height,
        isSquare,
    };
}

async function downloadLogo(candidate) {
    const response = await axios.get(candidate.url, {
        responseType: 'arraybuffer',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
            ...DEFAULT_HEADERS,
            Accept: 'image/svg+xml,image/png,image/webp,image/*;q=0.8,*/*;q=0.5',
        },
        validateStatus: (status) => status >= 200 && status < 500,
    });

    if (response.status >= 400 || !response.data) {
        throw new Error(`HTTP ${response.status}`);
    }

    const ext = resolveExtension(response.headers['content-type'], candidate.ext);
    if (!ext) {
        throw new Error('파일 확장자를 결정할 수 없습니다.');
    }

    const buffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data);

    let isSquare = false;
    let width;
    let height;
    try {
        const dimension = imageSize(buffer);
        width = dimension?.width;
        height = dimension?.height;
        if (width && height) {
            const ratio = width / height;
            isSquare = Math.abs(ratio - 1) < 0.02;
        }
    } catch (error) {
        // 이미지 크기 파악 실패는 치명적 오류가 아니므로 무시하고 진행
    }

    return { buffer, ext, isSquare, width, height };
}

async function processItem(item, existingLogoNames) {
    const normalizedName = (item.normalizedSearchName || '').toLowerCase();
    if (!normalizedName) {
        return {
            symbol: item.symbol,
            status: 'failed',
            reason: 'normalizedSearchName 누락',
        };
    }

    if (existingLogoNames.has(normalizedName)) {
        return {
            symbol: item.symbol,
            normalizedName,
            status: 'skipped',
            reason: '이미 로고 파일 존재',
        };
    }

    const candidates = buildSourceCandidates(item);
    if (candidates.length === 0) {
        return {
            symbol: item.symbol,
            normalizedName,
            status: 'failed',
            reason: '사용 가능한 소스 없음',
        };
    }

    let fallback = null;
    for (const candidate of candidates) {
        try {
            const { buffer, ext, isSquare, width, height } = await downloadLogo(
                candidate
            );
            const fileName = `${normalizedName}.${ext}`;
            const filePath = path.join(LOGOS_DIR, fileName);

            if (isSquare) {
                await fs.writeFile(filePath, buffer);
                existingLogoNames.add(normalizedName);

                return {
                    symbol: item.symbol,
                    normalizedName,
                    status: 'downloaded_square',
                    provider: candidate.provider,
                    file: `logos/${fileName}`,
                    meta: {
                        width,
                        height,
                        isSquare,
                    },
                };
            }

            if (!fallback) {
                fallback = {
                    buffer,
                    ext,
                    provider: candidate.provider,
                    width,
                    height,
                };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
                `⚠️  ${item.symbol} (${candidate.provider}) 다운로드 실패: ${message}`
            );
            await sleep(REQUEST_DELAY_MS);
        }
    }

    if (fallback) {
        const fileName = `${normalizedName}.${fallback.ext}`;
        const filePath = path.join(LOGOS_DIR, fileName);
        await fs.writeFile(filePath, fallback.buffer);
        existingLogoNames.add(normalizedName);

        return {
            symbol: item.symbol,
            normalizedName,
            status: 'downloaded_non_square',
            provider: fallback.provider,
            file: `logos/${fileName}`,
            meta: {
                width: fallback.width,
                height: fallback.height,
                isSquare: false,
            },
        };
    }

    try {
        const investingLogo = await fetchInvestingLogo(item);
        if (investingLogo) {
            const fileName = `${normalizedName}.${investingLogo.ext}`;
            const filePath = path.join(LOGOS_DIR, fileName);
            await fs.writeFile(filePath, investingLogo.buffer);
            existingLogoNames.add(normalizedName);

            return {
                symbol: item.symbol,
                normalizedName,
                status: investingLogo.isSquare
                    ? 'downloaded_square'
                    : 'downloaded_non_square',
                provider: investingLogo.provider,
                file: `logos/${fileName}`,
                meta: {
                    width: investingLogo.width,
                    height: investingLogo.height,
                    isSquare: investingLogo.isSquare,
                },
            };
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  ${item.symbol} (Investing.com) 다운로드 실패: ${message}`);
        await sleep(REQUEST_DELAY_MS);
    }

    return {
        symbol: item.symbol,
        normalizedName,
        status: 'failed',
        reason: '모든 소스 시도 실패',
    };
}

async function chunkedProcess(items, handler) {
    const results = [];
    for (let i = 0; i < items.length; i += MAX_CONCURRENT_DOWNLOADS) {
        const slice = items.slice(i, i + MAX_CONCURRENT_DOWNLOADS);
        const chunkResults = await Promise.all(slice.map(handler));
        results.push(...chunkResults);
        if (i + MAX_CONCURRENT_DOWNLOADS < items.length) {
            await sleep(REQUEST_DELAY_MS);
        }
    }
    return results;
}

async function main() {
    await ensureLogosDirectory();

    const missingItems = await loadMissingLogoItems();
    const existingLogoNames = await loadExistingLogoNames();

    console.log(
        `📂 현재 보유 로고: ${existingLogoNames.size}개, 수집 대상: ${missingItems.length}개`
    );

    const results = await chunkedProcess(missingItems, (item) =>
        processItem(item, existingLogoNames)
    );

    const downloadedSquare = results.filter((r) => r.status === 'downloaded_square');
    const downloadedNonSquare = results.filter(
        (r) => r.status === 'downloaded_non_square'
    );
    const skipped = results.filter((r) => r.status === 'skipped');
    const failed = results.filter((r) => r.status === 'failed');
    const downloaded = [...downloadedSquare, ...downloadedNonSquare];

    console.log('');
    console.log(`✅ 새로 저장된 로고: ${downloaded.length}개`);
    if (downloadedNonSquare.length) {
        console.log(
            `   └─ ⚠️  비정사각형 로고: ${downloadedNonSquare.length}개 (추후 교체 권장)`
        );
    }
    console.log(`⏭️  이미 존재해서 건너뜀: ${skipped.length}개`);
    console.log(`❌ 실패: ${failed.length}개`);

    if (downloaded.length) {
        console.log('\n📥 다운로드된 파일 목록:');
        downloaded.slice(0, 20).forEach((entry) => {
            console.log(`  - ${entry.symbol} → ${entry.file} (${entry.provider})`);
        });
        if (downloaded.length > 20) {
            console.log(`  ... 외 ${downloaded.length - 20}개`);
        }
    }

    if (failed.length) {
        console.log('\n⚠️  실패한 티커 요약:');
        failed.slice(0, 20).forEach((entry) => {
            console.log(`  - ${entry.symbol}: ${entry.reason}`);
        });
        if (failed.length > 20) {
            console.log(`  ... 외 ${failed.length - 20}개`);
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        stats: {
            total: results.length,
            downloaded: downloaded.length,
            downloadedSquare: downloadedSquare.length,
            downloadedNonSquare: downloadedNonSquare.length,
            skipped: skipped.length,
            failed: failed.length,
        },
        downloaded,
        failed,
    };

    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\n📝 보고서 저장 완료: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
}

main().catch((error) => {
    console.error('🚨 로고 수집 스크립트 실행 중 오류 발생:', error);
    process.exitCode = 1;
});

