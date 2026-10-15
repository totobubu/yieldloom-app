const isoDate = (value) =>
    String(value ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
const numeric = (value) =>
    value != null && value !== '' && Number.isFinite(Number(value))
        ? Number(value)
        : null;

export function aggregateCandles(rows, interval = 'day') {
    const groups = new Map();
    for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
        let key = row.date;
        if (interval === 'month') key = row.date.slice(0, 7);
        if (interval === 'week') {
            const date = new Date(`${row.date}T12:00:00Z`);
            date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
            key = date.toISOString().slice(0, 10);
        }
        const previous = groups.get(key);
        if (previous) {
            previous.high = Math.max(previous.high, row.high);
            previous.low = Math.min(previous.low, row.low);
            previous.close = row.close;
            previous.endDate = row.date;
            previous.volume =
                previous.volume == null || row.volume == null
                    ? null
                    : previous.volume + row.volume;
        } else groups.set(key, { ...row, endDate: row.date });
    }
    return [...groups.values()];
}

export function monthlyDividendSeries(rows, asOf, months = 12) {
    if (!asOf) return [];
    const actual = rows.filter(
        (row) =>
            !row.forecasted &&
            row.date <= asOf &&
            numeric(row.amountFixed ?? row.amount) > 0
    );
    const firstDate = [...actual].sort((a, b) =>
        a.date.localeCompare(b.date)
    )[0]?.date;
    const totals = new Map();
    for (const row of actual) {
        const key = row.date.slice(0, 7),
            bucket = totals.get(key) ?? { total: 0, count: 0 };
        bucket.total += Number(row.amountFixed ?? row.amount);
        bucket.count++;
        totals.set(key, bucket);
    }
    return Array.from({ length: months }, (_, index) => {
        const date = new Date(`${asOf.slice(0, 7)}-01T12:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() - months + index + 1);
        const month = date.toISOString().slice(0, 7),
            previousKey = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
        const bucket = totals.get(month),
            previous = totals.get(previousKey);
        // No observation does not establish zero distributions or a full year's coverage.
        return {
            month,
            total: bucket?.total ?? null,
            count: bucket?.count ?? null,
            average: bucket ? bucket.total / bucket.count : null,
            previousTotal: previous?.total ?? null,
            growth:
                bucket &&
                previous?.total > 0 &&
                month !== asOf.slice(0, 7) &&
                firstDate < `${previousKey}-01`
                    ? (bucket.total / previous.total - 1) * 100
                    : null,
            partial: month === asOf.slice(0, 7),
        };
    });
}

export function stockHoldingMetrics(asset, price, currency = 'USD') {
    if (!asset) return null;
    const shares = numeric(asset.holdingShares ?? asset.holdings?.toss?.amount);
    const txs = [...(asset.transactions ?? [])].sort((a, b) =>
        isoDate(a.date).localeCompare(isoDate(b.date))
    );
    const lots = [];
    let complete = true,
        buys = 0,
        sells = 0,
        dividends = 0,
        dividendCount = 0,
        wonDividends = 0,
        firstBuy = null,
        wonKnown = true;
    for (const row of txs) {
        const kind = row.type,
            quantity = numeric(row.quantity);
        if (!['buy', 'sell', 'dividend'].includes(kind)) {
            if (quantity) complete = false;
            continue;
        }
        const cash =
            currency === 'KRW'
                ? numeric(row.amount)
                : row.currency === currency
                  ? numeric(row.nativeAmount)
                  : null;
        if (cash == null) complete = false;
        if (kind === 'dividend') {
            dividendCount++;
            if (numeric(row.amount) == null) wonKnown = false;
            wonDividends += Math.abs(numeric(row.amount) ?? 0);
            dividends += Math.abs(cash ?? 0);
            continue;
        }
        if (!(quantity > 0) || !(cash > 0)) {
            complete = false;
            continue;
        }
        if (kind === 'buy') {
            firstBuy ??= isoDate(row.date);
            buys += Math.abs(cash ?? 0);
            lots.push({ quantity, cost: Math.abs(cash ?? 0) });
        }
        if (kind === 'sell') {
            sells += Math.abs(cash ?? 0);
            let remaining = quantity;
            while (remaining > 1e-8 && lots.length) {
                const lot = lots[0],
                    used = Math.min(lot.quantity, remaining);
                lot.cost -= (lot.cost * used) / lot.quantity;
                lot.quantity -= used;
                remaining -= used;
                if (lot.quantity < 1e-8) lots.shift();
            }
            if (remaining > 1e-8) complete = false;
        }
    }
    const ledgerShares = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const reconciled =
        shares != null &&
        Math.abs(ledgerShares - shares) < 1e-6 &&
        txs.length > 0;
    complete = complete && reconciled && buys > 0;
    const remainingCost = lots.reduce((sum, lot) => sum + lot.cost, 0),
        marketValue =
            shares != null && numeric(price) > 0 ? shares * price : null;
    return {
        shares,
        marketValue,
        firstBuy,
        dividendCount,
        wonDividends: dividendCount && wonKnown ? wonDividends : null,
        averageCost: complete && shares > 0 ? remainingCost / shares : null,
        totalProfit:
            complete && marketValue != null
                ? marketValue + sells + dividends - buys
                : null,
        totalReturn:
            complete && marketValue != null
                ? ((marketValue + sells + dividends - buys) / buys) * 100
                : null,
        complete,
        latestDate: txs.at(-1)?.date ? isoDate(txs.at(-1).date) : null,
    };
}
