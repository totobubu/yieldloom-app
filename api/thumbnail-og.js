import { normalizeSymbol, validSymbol } from '../lib/thumbnail-projection.js';
import distributionIndex from '../public/content-studio/distribution-index.json' with { type: 'json' };

const normalize = normalizeSymbol;
const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const latest = (ticker) => {
    const row = (distributionIndex.tickers ?? []).find((item) => normalize(item.ticker) === ticker);
    return row?.latest ?? null;
};
const amount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? `$${number.toFixed(6).replace(/\.?0+$/, '')}` : '확정 배당 정보 없음';
};
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}` : '날짜 미정';

export default function handler(req, res) {
    const ticker = normalize(req.query.ticker);
    if (!validSymbol(ticker)) return res.status(400).send('Invalid ticker');
    const candidate = latest(ticker);
    const dividend = ['official', 'cross_checked'].includes(candidate?.verification_status) ? candidate : null;
    const dividendAmount = amount(dividend?.distribution_per_share ?? dividend?.amount);
    const exDate = date(dividend?.ex_date ?? dividend?.exDate);
    const label = `${ticker} 최신 배당`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071a35"/><stop offset="1" stop-color="#1462b8"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="1080" cy="-20" r="240" fill="#45b6ff" opacity=".2"/><text x="82" y="112" fill="#8ed0ff" font-family="Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="5">YIELDLOOM DIVIDEND</text><text x="82" y="265" fill="white" font-family="Arial, sans-serif" font-size="112" font-weight="800">${escapeXml(label)}</text><line x1="82" y1="320" x2="1118" y2="320" stroke="white" opacity=".28"/><text x="82" y="425" fill="#b9ddff" font-family="Arial, sans-serif" font-size="38">주당 확정 배당</text><text x="82" y="530" fill="white" font-family="Arial, sans-serif" font-size="86" font-weight="800">${escapeXml(dividendAmount)}</text><text x="810" y="425" fill="#b9ddff" font-family="Arial, sans-serif" font-size="38">배당락일</text><text x="810" y="530" fill="white" font-family="Arial, sans-serif" font-size="86" font-weight="800">${escapeXml(exDate)}</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(svg);
}
