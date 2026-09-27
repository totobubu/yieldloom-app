// src\services\backtester\dataProcessor.js
export function processSymbolData(symbolData) {
    console.log(`[Processor] Processing data for ${symbolData.symbol}`, {
        symbolData,
    });

    let prices = (symbolData.prices || []).map((p) => ({
        ...p,
        date: new Date(p.date).toISOString().split('T')[0],
    }));
    let dividends = (symbolData.dividends || []).map((d) => ({
        ...d,
        date: new Date(d.date).toISOString().split('T')[0],
    }));

    if (symbolData.splits?.length > 0) {
        symbolData.splits.forEach((split) => {
            const splitDate = new Date(split.date);
            const [numerator, denominator] = split.ratio.split(':').map(Number);
            if (!(numerator > 0) || !(denominator > 0) || !Number.isFinite(numerator / denominator)) return;
            const ratio = numerator / denominator;
            prices.forEach((price) => {
                if (symbolData.priceBasis !== 'split_adjusted' && new Date(price.date) < splitDate) {
                    price.open /= ratio;
                    price.close /= ratio;
                }
            });
            dividends.forEach((div) => {
                if (symbolData.dividendBasis !== 'split_adjusted' && new Date(div.date) < splitDate) {
                    div.amount /= ratio;
                }
            });
        });
    }

    const priceMap = new Map(prices.map((p) => [p.date, p]));
    const dividendMap = new Map(dividends.map((d) => [d.date, d.amount]));

    console.log(
        `[Processor] Finished for ${symbolData.symbol}. Price Map Size: ${priceMap.size}, Dividend Map Size: ${dividendMap.size}`
    );
    return { priceMap, dividendMap };
}
