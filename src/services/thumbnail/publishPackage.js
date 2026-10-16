import { zipSync, strToU8 } from 'fflate';
import {
    cardDimensions,
    normalizeCardPresentation,
} from './cardPresentation.js';

export function createPublishPackage({
    symbol,
    tone,
    cards,
    sourceStatus,
    presentation,
}) {
    const files = {};
    const manifest = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        symbol,
        tone,
        dataStatus: sourceStatus,
        presentation: {
            ...normalizeCardPresentation(presentation),
            ...cardDimensions(presentation),
        },
        cards: cards.map(({ kind, filename, text, sourceUrl, asOfDate }) => ({
            kind,
            filename,
            text,
            sourceUrl,
            asOfDate,
        })),
    };
    const sources = cards
        .map(
            (card) =>
                `## ${card.label}\n- 기준일: ${card.asOfDate || '미정'}\n- 출처: ${card.sourceUrl || '확인 불가'}\n- 상태: ${sourceStatus}\n`
        )
        .join('\n');
    for (const card of cards) {
        files[card.filename] = card.png;
        files[card.filename.replace(/\.png$/i, '.txt')] = strToU8(card.text);
    }
    files['sources.md'] = strToU8(`# ${symbol} 게시 패키지\n\n${sources}`);
    files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
    return new Blob([zipSync(files, { level: 6 })], {
        type: 'application/zip',
    });
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
