// scripts/utils/migrate_flat_to_market_layout.js
// public/data/ 루트에 잘못 생성된 파일들을 올바른 market 서브디렉토리로 이동

import fs from 'fs/promises';
import path from 'path';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const NAV_FILE_PATH = path.join(PUBLIC_DIR, 'nav.json');

const MARKET_SUBDIR_ALIASES = {
    KOSPI: 'kospi',
    KOSDAQ: 'kosdaq',
    KONEX: 'konex',
    KRX: 'krx',
    'KRX (KOSPI)': 'kospi',
    'KRX (KOSDAQ)': 'kosdaq',
    'KRX-KOSPI': 'kospi',
    'KRX-KOSDAQ': 'kosdaq',
};

const getMarketSubdirectory = (market) => {
    const normalized = String(market || '')
        .trim()
        .toUpperCase();
    if (!normalized) return 'misc';
    return MARKET_SUBDIR_ALIASES[normalized] || normalized.toLowerCase();
};

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

async function migrateFiles(dryRun = false) {
    console.log('--- Migrating files from flat layout to market layout ---');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'MIGRATE MODE (will move files)'}`);
    console.log('');

    // nav.json에서 티커 정보 로드
    let navData;
    try {
        const navContent = await fs.readFile(NAV_FILE_PATH, 'utf-8');
        navData = JSON.parse(navContent);
    } catch (error) {
        console.error(`❌ Failed to load nav.json: ${error.message}`);
        return;
    }

    // 티커별 market 정보 맵 생성
    const tickerMarketMap = new Map();
    navData.nav.forEach((item) => {
        const symbol = item.symbol;
        if (symbol) {
            const baseSymbol = getBaseSymbol(symbol);
            const filename = sanitizeTickerForFilename(symbol);
            tickerMarketMap.set(filename.toLowerCase(), {
                symbol: baseSymbol,
                market: item.market,
                currency: item.currency,
            });
        }
    });

    // public/data/ 루트의 JSON 파일들 확인
    let files;
    try {
        files = await fs.readdir(DATA_DIR);
    } catch (error) {
        console.error(`❌ Failed to read data directory: ${error.message}`);
        return;
    }

    const jsonFiles = files.filter(
        (f) => f.endsWith('.json') && !f.includes('_') // _2.json 같은 중복 파일 제외
    );

    console.log(`Found ${jsonFiles.length} JSON files in data root directory`);
    console.log('');

    let movedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const movedFiles = [];

    for (const file of jsonFiles) {
        const filePath = path.join(DATA_DIR, file);
        const filenameWithoutExt = file.replace('.json', '');

        try {
            // 파일 내용 확인하여 market 정보 추출 시도
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            const tickerInfo = data.tickerInfo || {};

            let market = tickerInfo.market || tickerInfo.Market;
            let symbol = tickerInfo.Symbol || tickerInfo.symbol;

            // nav.json에서 market 정보 찾기
            if (!market && tickerMarketMap.has(filenameWithoutExt.toLowerCase())) {
                const navInfo = tickerMarketMap.get(filenameWithoutExt.toLowerCase());
                market = navInfo.market;
                symbol = navInfo.symbol;
            }

            // market이 없으면 currency로 판단
            if (!market) {
                const currency = tickerInfo.currency || tickerInfo.Currency;
                if (currency === 'KRW') {
                    // 한국 티커인데 market이 없으면 KOSPI로 기본값 (나중에 수정 필요할 수 있음)
                    market = 'KOSPI';
                    console.warn(
                        `⚠️  [${file}] Market not found, defaulting to KOSPI (currency: ${currency})`
                    );
                } else {
                    console.warn(`⚠️  [${file}] Market and currency not found, skipping`);
                    skippedCount++;
                    continue;
                }
            }

            const marketDir = getMarketSubdirectory(market);
            const targetDir = path.join(DATA_DIR, marketDir);
            const targetPath = path.join(targetDir, file);

            // 이미 올바른 위치에 있으면 스킵
            if (filePath === targetPath) {
                continue;
            }

            // 대상 디렉토리가 없으면 생성
            if (!dryRun) {
                await fs.mkdir(targetDir, { recursive: true });
            }

            // 대상 파일이 이미 존재하는지 확인
            let targetExists = false;
            try {
                await fs.access(targetPath);
                targetExists = true;
            } catch {
                // 파일이 없으면 정상
            }

            if (targetExists) {
                console.warn(
                    `⚠️  [${file}] Target file already exists at ${targetPath}, skipping`
                );
                skippedCount++;
                continue;
            }

            if (dryRun) {
                console.log(
                    `📦 [${file}] Would move to ${marketDir}/${file} (market: ${market})`
                );
            } else {
                await fs.rename(filePath, targetPath);
                console.log(
                    `✅ [${file}] Moved to ${marketDir}/${file} (market: ${market})`
                );
            }

            movedFiles.push({ file, market, targetPath });
            movedCount++;
        } catch (error) {
            console.error(`❌ [${file}] Error: ${error.message}`);
            errorCount++;
        }
    }

    console.log('');
    console.log('--- Summary ---');
    console.log(`Files moved: ${movedCount}`);
    console.log(`Files skipped: ${skippedCount}`);
    console.log(`Files with errors: ${errorCount}`);

    if (dryRun && movedCount > 0) {
        console.log('');
        console.log('To actually migrate files, run without --dry-run flag:');
        console.log('  node scripts/utils/migrate_flat_to_market_layout.js');
    }
}

// 커맨드라인 인자 파싱
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');

migrateFiles(dryRun).catch(console.error);

