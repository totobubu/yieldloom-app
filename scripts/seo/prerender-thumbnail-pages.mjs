import { isDelisted } from '../../lib/security-status.js';
import { loadEnv } from 'vite';
import { loadOfficialIndex } from '../../lib/official-dividends.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const siteUrl = String(
    process.env.SITE_URL ?? 'https://totobubu-github-io.vercel.app'
).replace(/\/$/, '');
const base =
    process.env.DATA_RELEASE_BASE_URL ??
    process.env.VITE_DATA_RELEASE_BASE_URL ??
    loadEnv('production', root, 'VITE_').VITE_DATA_RELEASE_BASE_URL ??
    '';
const index = await loadOfficialIndex({ base });
const appHtml = await readFile(join(root, 'dist/index.html'), 'utf8');
const escapeHtml = (value) =>
    String(value ?? '').replace(
        /[&<>"']/g,
        (character) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[character]
    );
const amount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
        ? `$${number.toFixed(6).replace(/\.?0+$/, '')}`
        : '확정 배당 정보 없음';
};
const exDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))
        ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`
        : '날짜 미정';

for (const row of index.tickers ?? []) {
    const ticker = String(row.ticker ?? '').toUpperCase();
    if (!/^[A-Z0-9.-]{1,15}$/.test(ticker)) continue;
    const latest = ['official', 'cross_checked'].includes(
        row.latest?.verification_status
    )
        ? row.latest
        : {};
    const description = isDelisted(ticker)
        ? `${ticker} 상장폐지 · 과거 시세와 배당 이력 열람`
        : `${ticker} 최신 배당 ${amount(latest.distribution_per_share)} · 배당락일 ${exDate(latest.ex_date)} · Yieldloom에서 확인`;
    const canonical = `${siteUrl}/stock/${encodeURIComponent(ticker)}`;
    const head = [
        `<title>${escapeHtml(ticker)} 주식 상세정보 · 시세와 배당 | Yieldloom</title>`,
        `<meta name="description" content="${escapeHtml(description)}">`,
        `<link rel="canonical" href="${canonical}">`,
        `<meta property="og:title" content="${escapeHtml(ticker)} 주식 상세정보 · 시세와 배당 | Yieldloom">`,
        `<meta property="og:description" content="${escapeHtml(description)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:url" content="${canonical}">`,
        isDelisted(ticker)
            ? ''
            : `<meta property="og:image" content="${siteUrl}/api/thumbnail-og?ticker=${encodeURIComponent(ticker)}">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
    ].join('');
    // Vercel serves a concrete asset before the SPA fallback, allowing crawlers to read this without JavaScript.
    const html = appHtml.replace(/<title>[^<]*<\/title>/, head);
    const output = join(root, 'dist', 'stock', ticker, 'index.html');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, html, 'utf8');
}
