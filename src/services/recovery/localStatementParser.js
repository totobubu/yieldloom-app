import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Keep extraction fully in the browser while letting Vite emit the worker as a
// local asset. No PDF bytes are sent to an API route.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
).toString();

const TYPE_PATTERNS = [
    ['외화증권배당금입금', 'dividend'],
    ['외화배당금입금', 'dividend'],
    ['외화배당단주대금입금', 'dividend'],
    ['배당세출금', 'tax'],
    ['외국납부세액출금', 'tax'],
    ['외화이자세금출금', 'tax'],
    ['외화세금환급', 'tax_refund'],
    ['외화배당금취소출금', 'other'],
    ['이자입금', 'interest'],
    ['외화이자입금', 'interest'],
    ['환전외화입금취소', 'exchange'],
    ['환전외화입금', 'exchange'],
    ['환전외화출금', 'exchange'],
    ['환전원화입금', 'exchange'],
    ['환전원화출금', 'exchange'],
    ['주식병합', 'other'],
    ['타사대체', 'other'],
    ['이벤트', 'other'],
    ['입고', 'other'],
    ['구매', 'buy'],
    ['매수', 'buy'],
    ['판매', 'sell'],
    ['매도', 'sell'],
    ['오픈뱅킹입금', 'deposit'],
    ['이체입금', 'deposit'],
    ['외화이체입금', 'deposit'],
    ['오픈뱅킹출금', 'withdrawal'],
    ['이체출금', 'withdrawal'],
    ['외화이체출금', 'withdrawal'],
];

const datePrefix = /(\d{4})[.-](\d{2})[.-](\d{2})/;
const tableFxPattern = /\b(\d{1,2},\d{3}\.\d{2})\b/;

function numberValues(text) {
    return [...text.matchAll(/-?[\d,]+(?:\.\d+)?/g)]
        .map((match) => Number(match[0].replaceAll(',', '')))
        .filter(Number.isFinite);
}

function detectType(text) {
    return TYPE_PATTERNS.find(([label]) => text.includes(label)) || null;
}

function fingerprint(entry) {
    return [
        entry.occurredAt,
        entry.rawType,
        entry.currency,
        entry.krwAmount ?? '',
        entry.usdAmount ?? '',
        entry.description,
    ].join('|');
}

function tableAmounts(text) {
    const fx = text.match(tableFxPattern);
    if (!fx || fx.index == null) return { actualFxRate: null, values: [] };

    // Toss rows render a KRW settlement table before the parenthesized USD
    // columns. The first value after the quantity is the KRW transaction
    // amount; the final value is a balance and must never be used as cashflow.
    const krwColumns = text.slice(fx.index + fx[0].length).split('(')[0];
    return {
        actualFxRate: Number(fx[1].replaceAll(',', '')),
        values: numberValues(krwColumns),
    };
}

/**
 * Parses one PDF page of Toss statement text into review candidates. This is
 * exported for deterministic tests; candidates are not financial records until
 * the user approves them in the UI.
 */
export function parseTossStatementText(pageText, pageNumber = 1) {
    return String(pageText || '')
        .split(/(?=\d{4}[.-]\d{2}[.-]\d{2})/)
        .map((rawText) => rawText.trim())
        .map((text) => {
            const date = text.match(datePrefix);
            const type = detectType(text);
            if (!date || !type) return null;

            const [rawType, kind] = type;
            const { actualFxRate, values } = tableAmounts(text);
            // For stock trade and income rows: [quantity, KRW settlement,
            // unit price, fee, tax, ...balance]. Never take values.at(-1).
            const krwAmount = values.length >= 2 ? values[1] : null;
            const feeKrw = ['buy', 'sell'].includes(kind) && values.length >= 4
                ? values[3]
                : null;
            const taxKrw = ['buy', 'sell'].includes(kind) && values.length >= 5
                ? values[4]
                : null;
            const entry = {
                occurredAt: `${date[1]}-${date[2]}-${date[3]}`,
                kind,
                rawType,
                currency: 'KRW',
                krwAmount,
                usdAmount: null,
                actualFxRate,
                feeKrw,
                taxKrw,
                description: text.slice(0, 400),
                source: 'toss-pdf-local',
                pageNumber,
                reviewStatus: 'needs_review',
            };
            return { ...entry, fingerprint: fingerprint(entry) };
        })
        .filter(Boolean);
}

/**
 * PDF text is deliberately parsed in the browser. Every row remains a review
 * candidate: statement layouts differ and an ambiguous amount must never be
 * written as a financial record without human confirmation.
 */
export async function parseTossStatementLocally(file, password = '') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes, password }).promise;
    const candidates = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str).join(' ');
        candidates.push(...parseTossStatementText(pageText, pageNumber));
    }

    return candidates;
}
