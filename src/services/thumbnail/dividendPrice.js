// A declared distribution may arrive before its ex-date closing price exists.
export function dividendPrice(row, quote, priceRows = [], today = new Date().toISOString().slice(0, 10)) {
    const close = Number(row?.close);
    if (Number.isFinite(close) && close > 0) return { price: close, date: row.date, latest: false };
    if (!row?.date || row.date < today) return { price: null, date: null, latest: false };
    const candidates = [quote, ...priceRows.map((item) => ({ price: item.close, date: item.date }))]
        .filter((item) => item?.date && item.date <= today && Number.isFinite(Number(item.price)) && Number(item.price) > 0)
        .sort((a, b) => b.date.localeCompare(a.date));
    const latest = candidates[0];
    return { price: latest ? Number(latest.price) : null, date: latest?.date ?? null, latest: Boolean(latest) };
}
