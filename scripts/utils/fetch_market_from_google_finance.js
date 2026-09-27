// scripts/utils/fetch_market_from_google_finance.js
/**
 * Google Finance에서 정확한 거래소 정보를 수집하는 스크립트
 *
 * Playwright를 사용하여 Google Finance에서 심볼을 검색하고
 * 정확한 거래소 정보를 추출하여 nav.json과 data 파일을 업데이트합니다.
 *
 * 사용법:
 *   # 단일 심볼
 *   node scripts/utils/fetch_market_from_google_finance.js AAPW
 *
 *   # 여러 심볼
 *   node scripts/utils/fetch_market_from_google_finance.js AAPW NFLW TSLW
 *
 *   # nav.json의 모든 티커 (변경 감지)
 *   node scripts/utils/fetch_market_from_google_finance.js --all
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const NAV_DIR = path.join(PUBLIC_DIR, 'nav');
const NAV_JSON_PATH = path.join(PUBLIC_DIR, 'nav.json');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');

// 거래소 매핑 (Google Finance → 내부 표기)
const EXCHANGE_MAP = {
    NASDAQ: 'NASDAQ',
    NYSE: 'NYSE',
    NYSEARCA: 'NYSEARCA',
    BATS: 'BATS',
    AMEX: 'AMEX',
    OTC: 'OTC',
    KOSPI: 'KOSPI',
    KOSDAQ: 'KOSDAQ',
    KONEX: 'KONEX',
    KRX: 'KRX', // 한국거래소 (KOSPI/KOSDAQ/KONEX로 구분 필요)
    // 추가 매핑
    NMS: 'NASDAQ',
    NYQ: 'NYSE',
    PCX: 'NYSE',
    OPR: 'NYSE',
    KSC: 'KOSPI', // KOSPI 별칭
    KOE: 'KOSDAQ', // KOSDAQ 별칭
};

// 거래소 → 디렉토리 매핑
const MARKET_TO_DIR = {
    NASDAQ: 'nasdaq',
    NYSE: 'nyse',
    NYSEARCA: 'nysearca',
    BATS: 'bats',
    AMEX: 'amex',
    OTC: 'otc',
    KOSPI: 'kospi',
    KOSDAQ: 'kosdaq',
    KONEX: 'konex',
};

/**
 * 새로운 거래소를 EXCHANGE_MAP과 MARKET_TO_DIR에 추가
 */
function addNewExchange(exchange) {
    const upperExchange = exchange.toUpperCase();
    if (!EXCHANGE_MAP[upperExchange]) {
        EXCHANGE_MAP[upperExchange] = upperExchange;
        MARKET_TO_DIR[upperExchange] = upperExchange.toLowerCase();
        console.log(`\n⚠️  새로운 거래소 발견: ${upperExchange}`);
        console.log(`   EXCHANGE_MAP과 MARKET_TO_DIR에 추가되었습니다.`);
        console.log(`   스크립트를 수정하여 영구적으로 추가하세요.`);
    }
}

/**
 * Google Finance에서 거래소 정보 추출
 */
async function fetchMarketFromGoogleFinance(symbol, page) {
    const searchUrl = `https://www.google.com/finance/?hl=ko&q=${encodeURIComponent(symbol)}`;

    console.log(`\n[${symbol}] 검색 중: ${searchUrl}`);

    try {
        await page.goto(searchUrl, {
            waitUntil: 'networkidle',
            timeout: 30000,
        });

        // 페이지가 로드될 때까지 대기
        await page.waitForTimeout(2000);

        // 방법 1: URL에서 거래소 추출 (예: /quote/AAPW:BATS 또는 /quote/000100:KRX)
        const currentUrl = page.url();
        const urlMatch = currentUrl.match(/\/quote\/[^:]+:([^?/]+)/);
        if (urlMatch) {
            let exchange = urlMatch[1].toUpperCase();
            console.log(`[${symbol}] URL에서 거래소 발견: ${exchange}`);
            
            // 한국 주식의 경우: KRX를 KOSPI/KOSDAQ으로 구분
            if (exchange === 'KRX') {
                // URL에서 .KS 또는 .KQ 접미사 확인
                const symbolMatch = currentUrl.match(/\/quote\/([^:]+):/);
                if (symbolMatch) {
                    const urlSymbol = symbolMatch[1];
                    if (urlSymbol.includes('.KS') || urlSymbol.endsWith('.KS')) {
                        exchange = 'KOSPI';
                        console.log(`[${symbol}] KRX → KOSPI로 매핑 (URL에서 .KS 확인)`);
                    } else if (urlSymbol.includes('.KQ') || urlSymbol.endsWith('.KQ')) {
                        exchange = 'KOSDAQ';
                        console.log(`[${symbol}] KRX → KOSDAQ로 매핑 (URL에서 .KQ 확인)`);
                    } else {
                        // 페이지에서 추가 정보 확인
                        const pageContent = await page.content();
                        if (pageContent.includes('KOSPI') || pageContent.includes('코스피')) {
                            exchange = 'KOSPI';
                            console.log(`[${symbol}] KRX → KOSPI로 매핑 (페이지에서 KOSPI 확인)`);
                        } else if (pageContent.includes('KOSDAQ') || pageContent.includes('코스닥')) {
                            exchange = 'KOSDAQ';
                            console.log(`[${symbol}] KRX → KOSDAQ로 매핑 (페이지에서 KOSDAQ 확인)`);
                        }
                    }
                }
            }
            
            return normalizeExchange(exchange);
        }

        // 방법 2: 검색 결과에서 첫 번째 결과 클릭하여 상세 페이지로 이동
        try {
            // 검색 결과의 첫 번째 링크 찾기
            const firstResult = await page
                .locator('a[href*="/quote/"]')
                .first();
            if ((await firstResult.count()) > 0) {
                const href = await firstResult.getAttribute('href');
                const hrefMatch = href.match(/\/quote\/[^:]+:([^?/]+)/);
                if (hrefMatch) {
                    const exchange = hrefMatch[1].toUpperCase();
                    console.log(
                        `[${symbol}] 검색 결과 링크에서 거래소 발견: ${exchange}`
                    );
                    return normalizeExchange(exchange);
                }

                // 링크 클릭하여 상세 페이지로 이동
                await firstResult.click();
                await page.waitForTimeout(2000);

                // 상세 페이지 URL에서 거래소 추출
                const detailUrl = page.url();
                const detailMatch = detailUrl.match(/\/quote\/[^:]+:([^?/]+)/);
                if (detailMatch) {
                    const exchange = detailMatch[1].toUpperCase();
                    console.log(
                        `[${symbol}] 상세 페이지 URL에서 거래소 발견: ${exchange}`
                    );
                    return normalizeExchange(exchange);
                }
            }
        } catch (e) {
            console.warn(`[${symbol}] 검색 결과 클릭 실패: ${e.message}`);
        }

        // 방법 3: 페이지에서 거래소 정보 추출
        // "BATS·면책조항" 같은 패턴 찾기
        try {
            const pageContent = await page.content();
            // "BATS·면책조항" 또는 "NASDAQ·면책조항" 패턴
            const exchangeMatch = pageContent.match(
                /([A-Z]{2,})\s*·\s*면책조항/i
            );
            if (exchangeMatch) {
                const exchange = exchangeMatch[1].toUpperCase();
                console.log(
                    `[${symbol}] 페이지 텍스트에서 거래소 발견: ${exchange}`
                );
                return normalizeExchange(exchange);
            }

            // "Exchange: BATS" 같은 패턴
            const exchangeMatch2 = pageContent.match(
                /Exchange[:\s]+([A-Z]{2,})/i
            );
            if (exchangeMatch2) {
                const exchange = exchangeMatch2[1].toUpperCase();
                console.log(
                    `[${symbol}] Exchange 텍스트에서 거래소 발견: ${exchange}`
                );
                return normalizeExchange(exchange);
            }
        } catch (e) {
            console.warn(`[${symbol}] 페이지 텍스트 파싱 실패: ${e.message}`);
        }

        // 방법 4: 구조화된 데이터에서 추출
        try {
            const pageContent = await page.content();
            // JSON-LD나 메타 태그에서 거래소 정보 찾기
            const jsonLdMatch = pageContent.match(/"exchange":"([^"]+)"/i);
            if (jsonLdMatch) {
                const exchange = jsonLdMatch[1].toUpperCase();
                console.log(`[${symbol}] JSON-LD에서 거래소 발견: ${exchange}`);
                return normalizeExchange(exchange);
            }
        } catch (e) {
            console.warn(`[${symbol}] JSON-LD 파싱 실패: ${e.message}`);
        }

        console.warn(`[${symbol}] 거래소 정보를 찾을 수 없습니다.`);
        return null;
    } catch (error) {
        console.error(`[${symbol}] 오류 발생: ${error.message}`);
        return null;
    }
}

/**
 * 거래소 이름 정규화
 */
function normalizeExchange(exchange) {
    if (!exchange) return null;
    const upper = exchange.toUpperCase().trim();
    
    // SHE는 상하이 증권거래소 코드이므로 필터링 (한국 주식에서 잘못 추출된 경우)
    if (upper === 'SHE' || upper === 'SSE') {
        console.warn(`[경고] ${upper}는 중국 거래소 코드입니다. 파싱 오류일 수 있습니다.`);
        return null;
    }
    
    const normalized = EXCHANGE_MAP[upper];

    // 새로운 거래소인 경우 추가
    if (!normalized) {
        addNewExchange(upper);
        return upper;
    }

    return normalized;
}

/**
 * nav.json 파일에서 티커 찾기
 */
function findTickerInNav(navData, symbol) {
    return navData.nav.find(
        (ticker) => ticker.symbol.toUpperCase() === symbol.toUpperCase()
    );
}

/**
 * nav 디렉토리에서 티커 파일 찾기
 */
async function findNavFile(symbol) {
    const firstLetter = symbol[0].toLowerCase();
    const marketDirs = await fs.readdir(NAV_DIR);

    for (const market of marketDirs) {
        const marketPath = path.join(NAV_DIR, market);
        const stats = await fs.stat(marketPath);
        if (!stats.isDirectory()) continue;

        const filePath = path.join(marketPath, `${firstLetter}.json`);
        if (existsSync(filePath)) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const tickers = JSON.parse(content);
                const ticker = tickers.find(
                    (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
                );
                if (ticker) {
                    return { filePath, ticker, tickers };
                }
            } catch (e) {
                // 파일 읽기 실패, 다음 파일 시도
            }
        }
    }

    return null;
}

/**
 * nav 파일을 새 market 디렉토리로 이동
 */
async function moveNavFile(symbol, oldMarket, newMarket) {
    const firstLetter = symbol[0].toLowerCase();

    // 기존 파일 찾기
    const oldMarketDir = MARKET_TO_DIR[oldMarket] || oldMarket.toLowerCase();
    const oldFilePath = path.join(NAV_DIR, oldMarketDir, `${firstLetter}.json`);

    if (!existsSync(oldFilePath)) {
        console.warn(
            `  [${symbol}] 기존 nav 파일을 찾을 수 없습니다: ${oldFilePath}`
        );
        return null;
    }

    // 새 파일 경로
    const newMarketDir = MARKET_TO_DIR[newMarket] || newMarket.toLowerCase();
    const newFilePath = path.join(NAV_DIR, newMarketDir, `${firstLetter}.json`);

    // 기존 파일 읽기
    const oldContent = await fs.readFile(oldFilePath, 'utf-8');
    const oldTickers = JSON.parse(oldContent);

    // 이동할 티커 찾기 및 업데이트
    const tickerToMove = oldTickers.find(
        (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
    );

    if (!tickerToMove) {
        console.warn(
            `  [${symbol}] 기존 nav 파일에서 티커를 찾을 수 없습니다.`
        );
        return null;
    }

    const updatedTicker = { ...tickerToMove, market: newMarket };
    console.log(`  [${symbol}] nav 파일: ${oldMarket} → ${newMarket}`);

    // 새 디렉토리 생성
    await fs.mkdir(path.dirname(newFilePath), { recursive: true });

    // 새 파일 읽기 (이미 존재하는 경우)
    let newTickers = [];
    if (existsSync(newFilePath)) {
        try {
            const newContent = await fs.readFile(newFilePath, 'utf-8');
            newTickers = JSON.parse(newContent);
        } catch (e) {
            console.warn(
                `  [${symbol}] 새 nav 파일 읽기 실패, 새로 생성합니다.`
            );
            newTickers = [];
        }
    }

    // 새 파일에 티커 추가 또는 업데이트
    const existingIndex = newTickers.findIndex(
        (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
    );

    if (existingIndex >= 0) {
        newTickers[existingIndex] = updatedTicker;
    } else {
        newTickers.push(updatedTicker);
        // 심볼 순서로 정렬
        newTickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }

    await fs.writeFile(
        newFilePath,
        JSON.stringify(newTickers, null, 4),
        'utf-8'
    );

    // 기존 파일에서 티커 제거
    const remaining = oldTickers.filter(
        (t) => t.symbol.toUpperCase() !== symbol.toUpperCase()
    );

    if (remaining.length > 0) {
        await fs.writeFile(
            oldFilePath,
            JSON.stringify(remaining, null, 4),
            'utf-8'
        );
    } else {
        // 파일이 비어있으면 삭제
        await fs.unlink(oldFilePath);
        console.log(`  [${symbol}] 빈 nav 파일 삭제: ${oldFilePath}`);
    }

    console.log(
        `  [${symbol}] nav 파일 이동: ${oldMarketDir}/${firstLetter}.json → ${newMarketDir}/${firstLetter}.json`
    );

    return { newFilePath, updated: newTickers };
}

/**
 * data 파일 업데이트 및 이동
 */
async function updateDataFile(symbol, newMarket, oldMarket) {
    // 기존 파일 찾기
    const oldMarketDirs = Object.values(MARKET_TO_DIR);
    let foundFile = null;
    let oldMarketDir = null;

    for (const dir of oldMarketDirs) {
        const filePath = path.join(
            DATA_DIR,
            dir,
            `${symbol.toLowerCase()}.json`
        );
        if (existsSync(filePath)) {
            foundFile = filePath;
            oldMarketDir = dir;
            break;
        }
    }

    if (!foundFile) {
        console.log(`  [${symbol}] data 파일을 찾을 수 없습니다.`);
        return;
    }

    // 새 디렉토리 경로
    const newMarketDir = MARKET_TO_DIR[newMarket] || newMarket.toLowerCase();
    const newFilePath = path.join(
        DATA_DIR,
        newMarketDir,
        `${symbol.toLowerCase()}.json`
    );

    // 파일 내용 읽기 및 업데이트
    const content = await fs.readFile(foundFile, 'utf-8');
    const data = JSON.parse(content);

    // tickerInfo의 market 업데이트
    if (data.tickerInfo) {
        const dataOldMarket = data.tickerInfo.market;
        if (dataOldMarket !== newMarket) {
            console.log(
                `  [${symbol}] data 파일 tickerInfo: ${dataOldMarket} → ${newMarket}`
            );
            data.tickerInfo.market = newMarket;
        }
    }

    // 디렉토리가 다르면 파일 이동
    if (oldMarketDir !== newMarketDir) {
        await fs.mkdir(path.dirname(newFilePath), { recursive: true });
        await fs.writeFile(newFilePath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.unlink(foundFile);
        console.log(
            `  [${symbol}] data 파일 이동: ${oldMarketDir}/ → ${newMarketDir}/`
        );
    } else {
        await fs.writeFile(foundFile, JSON.stringify(data, null, 2), 'utf-8');
    }
}

/**
 * 단일 심볼 처리
 */
async function processSymbol(symbol, page) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`처리 중: ${symbol}`);
    console.log('='.repeat(60));

    // Google Finance에서 거래소 정보 가져오기
    const market = await fetchMarketFromGoogleFinance(symbol, page);

    if (!market) {
        console.warn(`[${symbol}] 거래소 정보를 가져올 수 없습니다.`);
        return { symbol, success: false, reason: '거래소 정보 없음' };
    }

    console.log(`[${symbol}] 거래소: ${market}`);

    // nav.json 읽기
    const navContent = await fs.readFile(NAV_JSON_PATH, 'utf-8');
    const navData = JSON.parse(navContent);

    // nav.json에서 티커 찾기
    const ticker = findTickerInNav(navData, symbol);
    if (!ticker) {
        console.warn(`[${symbol}] nav.json에서 티커를 찾을 수 없습니다.`);
        return { symbol, success: false, reason: 'nav.json에 없음' };
    }

    const oldMarket = ticker.market;
    if (oldMarket === market) {
        console.log(`[${symbol}] 거래소가 동일합니다: ${market}`);
        return { symbol, success: true, market, changed: false };
    }

    console.log(`[${symbol}] 거래소 변경: ${oldMarket} → ${market}`);

    // nav 파일을 새 market 디렉토리로 이동
    await moveNavFile(symbol, oldMarket, market);

    // nav.json 업데이트 (dataPaths 포함)
    const updatedNav = navData.nav.map((t) => {
        if (t.symbol.toUpperCase() === symbol.toUpperCase()) {
            const updatedTicker = { ...t, market };

            // dataPaths 업데이트
            const newMarketDir = MARKET_TO_DIR[market] || market.toLowerCase();
            const symbolLower = symbol.toLowerCase();
            updatedTicker.dataPaths = [
                `data/${newMarketDir}/${symbolLower}.json`,
            ];

            return updatedTicker;
        }
        return t;
    });
    await fs.writeFile(
        NAV_JSON_PATH,
        JSON.stringify({ nav: updatedNav }, null, 2),
        'utf-8'
    );
    console.log(`[${symbol}] nav.json 업데이트 완료 (dataPaths 포함)`);

    // data 파일 업데이트 및 이동
    await updateDataFile(symbol, market, oldMarket);

    return { symbol, success: true, market, changed: true, oldMarket };
}

/**
 * 마켓 정보만 조회 (nav.json 업데이트 없이)
 */
async function queryMarketOnly(symbol, page) {
    const market = await fetchMarketFromGoogleFinance(symbol, page);
    if (market) {
        console.log(`[${symbol}] 거래소: ${market}`);
        return market;
    }
    return null;
}

/**
 * 메인 함수
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error(
            '사용법: node fetch_market_from_google_finance.js <SYMBOL> [SYMBOL2 ...]'
        );
        console.error('또는: node fetch_market_from_google_finance.js --all');
        console.error(
            '또는: node fetch_market_from_google_finance.js --query-only <SYMBOL>'
        );
        process.exit(1);
    }

    // --query-only 모드: 마켓 정보만 조회 (nav.json 업데이트 없이)
    if (args[0] === '--query-only' && args.length >= 2) {
        const symbol = args[1].toUpperCase();
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
        });
        const page = await context.newPage();

        try {
            const market = await queryMarketOnly(symbol, page);
            if (market) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        } finally {
            await browser.close();
        }
    }

    let symbols = [];

    if (args[0] === '--all') {
        // nav.json의 모든 티커 가져오기
        const navContent = await fs.readFile(NAV_JSON_PATH, 'utf-8');
        const navData = JSON.parse(navContent);
        symbols = navData.nav.filter((t) => !t.upcoming).map((t) => t.symbol);
        console.log(`총 ${symbols.length}개 티커를 처리합니다.`);
    } else {
        symbols = args.map((s) => s.toUpperCase());
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    const results = [];

    try {
        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            const result = await processSymbol(symbol, page);
            results.push(result);

            // 요청 간 딜레이 (API 제한 방지)
            if (i < symbols.length - 1) {
                await page.waitForTimeout(2000);
            }
        }
    } finally {
        await browser.close();
    }

    // 결과 요약
    console.log(`\n${'='.repeat(60)}`);
    console.log('처리 완료');
    console.log('='.repeat(60));

    const successCount = results.filter((r) => r.success).length;
    const changedCount = results.filter((r) => r.success && r.changed).length;

    console.log(`\n총 ${results.length}개 처리`);
    console.log(`성공: ${successCount}개`);
    console.log(`변경: ${changedCount}개`);

    if (changedCount > 0) {
        console.log('\n변경된 티커:');
        results
            .filter((r) => r.success && r.changed)
            .forEach((r) => {
                console.log(`  ${r.symbol}: ${r.oldMarket} → ${r.market}`);
            });

        console.log('\n자동으로 nav.json을 재생성합니다...');
        try {
            execSync('npm run generate-nav', { stdio: 'inherit' });
            console.log('\n✅ nav.json 재생성 완료');
        } catch (error) {
            console.error('\n❌ nav.json 재생성 실패:', error.message);
            console.log('수동으로 실행하세요: npm run generate-nav');
        }
    }
}

main().catch((error) => {
    console.error('오류 발생:', error);
    process.exit(1);
});
