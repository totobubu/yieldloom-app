import fs from 'fs/promises';
import path from 'path';
import yahooFinance from '../lib/yahooFinanceClient.js';

const dataDir = path.join(process.cwd(), 'public', 'data');
const backupDir = path.join(process.cwd(), 'backups', 'longname');
const FETCH_BATCH_SIZE = 20;
const FILE_BATCH_SIZE = 20;

function extractSymbol(fileName, tickerInfo) {
    if (tickerInfo?.Symbol && typeof tickerInfo.Symbol === 'string') {
        return tickerInfo.Symbol.trim();
    }
    return fileName.replace(/\.json$/i, '').toUpperCase();
}

function deriveLongName(quote) {
    if (!quote) return null;
    return (
        quote.longName ||
        quote.displayName ||
        quote.shortName ||
        null
    );
}

async function ensureBackup(filePath, relativeFile) {
    const targetPath = path.join(backupDir, relativeFile);
    const targetFolder = path.dirname(targetPath);
    await fs.mkdir(targetFolder, { recursive: true });
    await fs.copyFile(filePath, targetPath);
}

async function fetchQuoteBatch(symbols) {
    if (!symbols.length) return new Map();

    const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const symbolToQuote = new Map();

    for (let i = 0; i < uniqueSymbols.length; i += FETCH_BATCH_SIZE) {
        const batch = uniqueSymbols.slice(i, i + FETCH_BATCH_SIZE);
        try {
            const result = await yahooFinance.quote(batch);
            const quotes = Array.isArray(result) ? result : [result];
            for (const quote of quotes) {
                if (!quote?.symbol) continue;
                symbolToQuote.set(quote.symbol.toUpperCase(), quote);
            }
        } catch (error) {
            console.error(
                `❌ Yahoo Finance 조회 실패 (${batch.join(', ')}): ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    return symbolToQuote;
}

async function processFilesBatch(files) {
    const symbols = files.map((f) => f.symbol);
    const quotesMap = await fetchQuoteBatch(symbols);

    let updated = 0;
    let skipped = 0;

    for (const fileInfo of files) {
        const quote = quotesMap.get(fileInfo.symbol.toUpperCase());
        const newLongName = deriveLongName(quote);

        if (!newLongName) {
            skipped++;
            console.log(`⚠️ ${fileInfo.symbol}: longName 없음`);
            continue;
        }

        fileInfo.data.tickerInfo.longName = newLongName;

        await ensureBackup(fileInfo.filePath, fileInfo.file);
        await fs.writeFile(
            fileInfo.filePath,
            JSON.stringify(fileInfo.data, null, 4) + '\n',
            'utf8'
        );

        updated++;
        console.log(`✅ ${fileInfo.symbol}: ${newLongName}`);
    }

    return { updated, skipped };
}

async function fillMissingLongNames() {
    console.time('⏱️ longName 채우기');
    await fs.mkdir(backupDir, { recursive: true });

    const allFiles = await fs.readdir(dataDir);
    const pendingBatch = [];
    let totalTargets = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const file of allFiles) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(dataDir, file);
        let parsed;

        try {
            const content = await fs.readFile(filePath, 'utf8');
            parsed = JSON.parse(content);
        } catch (error) {
            console.warn(`⚠️ ${file}: 읽기/파싱 실패 (${error.message})`);
            continue;
        }

        const tickerInfo = parsed?.tickerInfo;
        if (!tickerInfo) continue;

        const currentLongName = tickerInfo.longName;
        if (currentLongName && typeof currentLongName === 'string') continue;

        const symbol = extractSymbol(file, tickerInfo);
        if (!symbol) continue;

        pendingBatch.push({ file, filePath, symbol, data: parsed });
        totalTargets++;

        if (pendingBatch.length >= FILE_BATCH_SIZE) {
            const { updated, skipped } = await processFilesBatch(pendingBatch.splice(0));
            totalUpdated += updated;
            totalSkipped += skipped;
        }
    }

    if (!totalTargets) {
        console.log('✅ 채울 longName 이 없습니다.');
        return;
    }

    console.log(`📊 longName 누락 파일: ${totalTargets}개`);

    if (pendingBatch.length) {
        const { updated, skipped } = await processFilesBatch(pendingBatch.splice(0));
        totalUpdated += updated;
        totalSkipped += skipped;
    }

    console.log(`\n총 업데이트: ${totalUpdated}개`);
    console.log(`longName 미확보로 건너뜀: ${totalSkipped}개`);
    console.timeEnd('⏱️ longName 채우기');
}

fillMissingLongNames().catch((error) => {
    console.error('❌ longName 업데이트 실패', error);
    process.exitCode = 1;
});

