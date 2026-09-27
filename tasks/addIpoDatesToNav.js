// tasks\addIpoDatesToNav.js
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { NAV_DIR, delay, writeJsonFile, readJsonFile } from './_utils.js';

async function getFirstTradeDate(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=history`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
        });

        if (data.chart.error) {
            throw new Error(
                data.chart.error.description || `Unknown error for ${symbol}`
            );
        }

        const result = data.chart.result[0];
        const firstTradeTime = result?.meta?.firstTradeDate;

        if (firstTradeTime && typeof firstTradeTime === 'number') {
            return new Date(firstTradeTime * 1000).toISOString().split('T')[0];
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function processNavFile(filePath) {
    console.log(`\nProcessing file: ${path.basename(filePath)}`);
    try {
        let tickers = await readJsonFile(filePath);
        let hasChanges = false;

        for (const ticker of tickers) {
            if (ticker.ipoDate) {
                continue;
            }
            const ipoDate = await getFirstTradeDate(ticker.symbol);
            await delay(300);

            if (ipoDate) {
                ticker.ipoDate = ipoDate;
                if (ticker.upcoming) {
                    delete ticker.upcoming;
                }
                hasChanges = true;
                console.log(
                    `  ✅ [PROMOTED] ${ticker.symbol}: Set ipoDate to ${ipoDate}`
                );
            } else {
                if (!ticker.upcoming) {
                    ticker.upcoming = true;
                    hasChanges = true;
                    console.log(
                        `  ⚠️ [MARKED] ${ticker.symbol} as 'upcoming' (IPO date not found)`
                    );
                }
            }
        }

        if (hasChanges) {
            tickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
            await writeJsonFile(filePath, tickers);
            console.log(`  -> Saved changes to ${path.basename(filePath)}`);
        } else {
            console.log(
                `  -> No changes needed for ${path.basename(filePath)}`
            );
        }
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error);
    }
}

async function main() {
    console.log('--- Starting to Sync Ticker Status (IPO Date & Upcoming) ---');
    const marketDirs = await fs.readdir(NAV_DIR);

    for (const market of marketDirs) {
        const marketPath = path.join(NAV_DIR, market);
        const stats = await fs.stat(marketPath);
        if (stats.isDirectory()) {
            const files = (await fs.readdir(marketPath)).filter((f) =>
                f.endsWith('.json')
            );
            for (const file of files) {
                await processNavFile(path.join(marketPath, file));
            }
        }
    }
    console.log('\n--- Finished processing all files. ---');
    console.log(
        "Now, please run 'npm run generate-nav' to create the final nav.json with updated status."
    );
}

main();
