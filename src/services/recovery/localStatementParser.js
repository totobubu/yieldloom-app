import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Keep extraction fully in the browser while letting Vite emit the worker as a
// local asset. No PDF bytes are sent to an API route.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
).toString();

const TYPE_PATTERNS = [
    ['외화증권배당금입금', 'dividend'],
    ['배당금입금', 'dividend'],
    ['배당', 'dividend'],
    ['이자입금', 'interest'],
    ['환전외화입금', 'exchange'],
    ['환전원화출금', 'exchange'],
    ['구매', 'buy'],
    ['매수', 'buy'],
    ['판매', 'sell'],
    ['매도', 'sell'],
    ['이체입금', 'deposit'],
    ['오픈뱅킹입금', 'deposit'],
    ['입금', 'deposit'],
    ['이체출금', 'withdrawal'],
    ['출금', 'withdrawal'],
];

function numberValues(text) {
    return [...text.matchAll(/(?:₩|\$)?\s*(-?[\d,]+(?:\.\d+)?)/g)]
        .map((match) => Number(match[1].replaceAll(',', '')))
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

/**
 * PDF text is deliberately parsed in the browser. Every row remains a review
 * candidate: statement layouts differ and an ambiguous amount must never be
 * written as a financial record without human confirmation.
 */
export async function parseTossStatementLocally(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const lines = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str).join(' ');
        pageText.split(/(?=\d{4}[.-]\d{2}[.-]\d{2})/).forEach((line) => {
            if (line.trim()) lines.push({ pageNumber, text: line.trim() });
        });
    }

    return lines
        .map(({ pageNumber, text }) => {
            const date = text.match(/(\d{4})[.-](\d{2})[.-](\d{2})/);
            const type = detectType(text);
            if (!date || !type) return null;

            const values = numberValues(text);
            const hasUsd = /\$|USD|달러|외화/.test(text);
            const [rawType, kind] = type;
            const labeledFx = text.match(
                /(?:환율|USD\/KRW)\s*([\d,]+(?:\.\d+)?)/
            )?.[1];
            // Toss statement rows commonly render the rate as an unlabeled
            // 1,xxx.xx token between the instrument name and amount columns.
            const tableFx = text.match(/\b(\d{1,2},\d{3}\.\d{2})\b/)?.[1];
            const entry = {
                occurredAt: `${date[1]}-${date[2]}-${date[3]}`,
                kind,
                rawType,
                currency: hasUsd ? 'USD' : 'KRW',
                // The candidate amount is intentionally conservative. It is a
                // review aid, not an automatic interpretation of a PDF table.
                krwAmount: hasUsd ? null : values.at(-1) ?? null,
                usdAmount: hasUsd ? values.at(-1) ?? null : null,
                actualFxRate: labeledFx || tableFx
                    ? Number((labeledFx || tableFx).replaceAll(',', ''))
                    : null,
                feeKrw: null,
                taxKrw: null,
                description: text.slice(0, 400),
                source: 'toss-pdf-local',
                pageNumber,
                reviewStatus: 'needs_review',
            };
            return { ...entry, fingerprint: fingerprint(entry) };
        })
        .filter(Boolean);
}
