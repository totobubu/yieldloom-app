// scripts/exchange/fetch_all_exchange_rates.js
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

const OUTPUT_FILE = path.resolve(
    process.cwd(),
    'public',
    'exchange-rates.json'
);
const TICKER = 'USDKRW=X'; // 환율 티커

async function updateLatestRates() {
    console.log('--- Starting Daily Exchange Rate Update ---');

    let existingRates = [];
    let lastDate = '1995-11-01'; // 기본 시작 날짜

    try {
        const fileContent = await fs.readFile(OUTPUT_FILE, 'utf-8');
        existingRates = JSON.parse(fileContent);
        if (existingRates.length > 0) {
            lastDate = existingRates[existingRates.length - 1].date;
            console.log(
                `Last recorded date is ${lastDate}. Fetching new data since then.`
            );
        }
    } catch (error) {
        console.warn(
            `⚠️ Could not read ${OUTPUT_FILE}. Will fetch all historical data from ${lastDate}.`
        );
    }

    const startDate = new Date(lastDate);
    startDate.setDate(startDate.getDate() + 1);

    if (startDate > new Date()) {
        console.log('✅ Exchange rates are already up to date.');
        return;
    }

    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

    console.log(
        `Fetching new rates from ${startDate.toISOString().split('T')[0]} to today...`
    );

    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (data.chart.error) {
            throw new Error(
                data.chart.error.description || `Unknown error for ${TICKER}`
            );
        }

        const result = data.chart.result[0];
        if (!result || !result.timestamp) {
            console.log('No new exchange rate data found.');
            return;
        }

        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];

        const newRates = timestamps
            .map((ts, i) => ({
                date: new Date(ts * 1000).toISOString().split('T')[0],
                rate: quotes.close[i],
            }))
            .filter((r) => r.rate != null);

        if (newRates.length === 0) {
            console.log('No new valid exchange rate data found.');
            return;
        }

        const combinedRates = [...existingRates, ...newRates];
        const rateMap = new Map(combinedRates.map((item) => [item.date, item]));
        const sortedRates = Array.from(rateMap.values()).sort(
            (a, b) => new Date(a.date) - new Date(b.date)
        );

        await fs.writeFile(OUTPUT_FILE, JSON.stringify(sortedRates, null, 2));
        console.log(
            `\n🎉 Successfully added ${newRates.length} new records. Total records: ${sortedRates.length}`
        );
    } catch (error) {
        console.error(
            '❌ Failed to fetch latest exchange rates:',
            error.message
        );
    }
}

updateLatestRates();
